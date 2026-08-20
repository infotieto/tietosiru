import type { APIRoute } from 'astro';
import { verifyMemberSession } from '../../../lib/memberAuth.js';
import { getSupabaseServiceRole } from '../../../lib/supabase.js';
import { generateInvoicePdf } from '../../../lib/invoice.js';
import { sendInvoiceEmail } from '../../../lib/email.js';

export const prerender = false;

type CartItem = { id: string; name?: string; price_cents?: number; vat_percent?: number; qty: number };

export const POST: APIRoute = async ({ request, cookies }) => {
  const cookie = cookies.get('member_session')?.value;
  const session = await verifyMemberSession(cookie);
  if (!session) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { 'Content-Type': 'application/json' } });

  let items: CartItem[] = [];
  try {
    const body = await request.json() as { items?: CartItem[] };
    items = Array.isArray(body.items) ? body.items : [];
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid body' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }
  if (items.length === 0) return new Response(JSON.stringify({ error: 'Kori on tyhjä' }), { status: 400, headers: { 'Content-Type': 'application/json' } });

  const supabase = getSupabaseServiceRole();

  // Resolve customer
  const { data: customer, error: custErr } = await supabase.from('customers').select('id,email,company').eq('email', session.email.toLowerCase().trim()).is('deleted_at', null).maybeSingle();
  if (custErr || !customer) return new Response(JSON.stringify({ error: 'Asiakasta ei löytynyt' }), { status: 404, headers: { 'Content-Type': 'application/json' } });

  // Validate products & snapshot prices
  const ids = items.map((i) => i.id);
  const { data: products, error: prodErr } = await supabase.from('products').select('id,name,price_cents,vat_percent,active').in('id', ids);
  if (prodErr) return new Response(JSON.stringify({ error: prodErr.message }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  const byId = new Map((products ?? []).map((p) => [p.id, p]));
  const lines: Array<{ name: string; qty: number; price_cents: number; vat_percent: number; product_id: string }> = [];
  for (const it of items) {
    const p = byId.get(it.id);
    if (!p || !p.active) return new Response(JSON.stringify({ error: `Tuote ei saatavilla: ${it.id}` }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    const qty = Math.max(1, Math.floor(Number(it.qty) || 1));
    lines.push({ name: p.name, qty, price_cents: p.price_cents, vat_percent: p.vat_percent, product_id: p.id });
  }
  const total = lines.reduce((s, l) => s + l.price_cents * l.qty, 0);

  const siteUrl = (import.meta.env.PUBLIC_SITE_URL as string | undefined) || 'http://localhost:2121';
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

  // Create order (trigger fills invoice_number). Use service_role so RLS ok.
  const { data: order, error: orderErr } = await supabase
    .from('orders')
    .insert({
      customer_id: customer.id,
      status: 'tilattu',
      total_cents: total,
      cancel_token_expires_at: expiresAt,
    })
    .select('id,invoice_number,cancel_token')
    .single();
  if (orderErr || !order) return new Response(JSON.stringify({ error: orderErr?.message ?? 'Order create failed' }), { status: 500, headers: { 'Content-Type': 'application/json' } });

  const { error: itemsErr } = await supabase.from('order_items').insert(
    lines.map((l) => ({ order_id: order.id, product_id: l.product_id, qty: l.qty, price_cents: l.price_cents, vat_percent: l.vat_percent }))
  );
  if (itemsErr) return new Response(JSON.stringify({ error: itemsErr.message }), { status: 500, headers: { 'Content-Type': 'application/json' } });

  const cancelUrl = `${siteUrl.replace(/\/$/, '')}/api/orders/cancel?token=${order.cancel_token}`;
  const pdfBytes = await generateInvoicePdf({
    invoiceNumber: order.invoice_number,
    date: new Date(),
    customerEmail: customer.email,
    customerCompany: customer.company,
    lines: lines.map((l) => ({ name: l.name, qty: l.qty, price_cents: l.price_cents, vat_percent: l.vat_percent })),
    cancelUrl,
  });

  // Upload to storage (best-effort)
  const pdfPath = `${order.invoice_number}.pdf`;
  const { error: upErr } = await supabase.storage.from('invoices').upload(pdfPath, pdfBytes, { contentType: 'application/pdf', upsert: true });
  if (!upErr) {
    await supabase.from('orders').update({ invoice_pdf_url: pdfPath }).eq('id', order.id);
  }

  try {
    await sendInvoiceEmail({ to: customer.email, invoiceNumber: order.invoice_number, pdfBytes, cancelUrl });
  } catch (e) {
    console.error('sendInvoiceEmail failed', e);
    // Do not fail the order — admin can resend
  }

  return new Response(JSON.stringify({ ok: true, invoice_number: order.invoice_number }), { status: 200, headers: { 'Content-Type': 'application/json' } });
};
