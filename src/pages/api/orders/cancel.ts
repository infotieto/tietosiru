import type { APIRoute } from 'astro';
import { getSupabaseServiceRole } from '../../../lib/supabase.js';
import { generateCreditNotePdf } from '../../../lib/invoice.js';
import { sendAdminNotification } from '../../../lib/email.js';

export const prerender = false;

export const GET: APIRoute = async ({ request, url }) => {
  const token = url.searchParams.get('token');
  if (!token) return new Response('Virheellinen linkki', { status: 400, headers: { 'Content-Type': 'text/html; charset=utf-8' } });

  const supabase = getSupabaseServiceRole();
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || request.headers.get('x-nf-client-connection-ip') || 'unknown';
  const ua = request.headers.get('user-agent') || '';

  await supabase.from('order_cancel_logs').insert({ token, ip, user_agent: ua });

  const { data: order, error } = await supabase
    .from('orders')
    .select('id,invoice_number,status,cancel_token_expires_at,created_at,customer_id')
    .eq('cancel_token', token)
    .maybeSingle();

  if (error || !order) return new Response('Linkki on virheellinen tai vanhentunut.', { status: 400, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
  if (order.status === 'hyvitetty') return new Response('Tilaus on jo hyvitetty.', { status: 400, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
  if (order.cancel_token_expires_at && new Date(order.cancel_token_expires_at).getTime() < Date.now()) {
    return new Response('Peruutuslinkki on vanhentunut (7 pv). Ota yhteyttä.', { status: 400, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
  }

  // Fetch customer + items for credit note
  const { data: customer } = await supabase.from('customers').select('email,company').eq('id', order.customer_id).maybeSingle();
  const { data: items } = await supabase.from('order_items').select('qty,price_cents,vat_percent,product_id').eq('order_id', order.id);
  // Resolve product names best-effort
  let lines: Array<{ name: string; qty: number; price_cents: number; vat_percent: number }> = [];
  if (items && items.length) {
    const ids = items.map((i) => i.product_id).filter(Boolean) as string[];
    const { data: prods } = ids.length ? await supabase.from('products').select('id,name').in('id', ids) : { data: [] as Array<{id:string;name:string}> };
    const nameById = new Map((prods ?? []).map((p) => [p.id, p.name]));
    lines = items.map((i) => ({ name: nameById.get(i.product_id ?? '') ?? 'Tuote', qty: i.qty, price_cents: i.price_cents, vat_percent: i.vat_percent }));
  }

  // Mark as hyvitetty (trigger fills credit_note_number)
  const { data: updated, error: updErr } = await supabase
    .from('orders')
    .update({ status: 'hyvitetty', cancelled_at: new Date().toISOString(), cancel_method: 'customer_self_service' })
    .eq('id', order.id)
    .eq('status', order.status) // optimistic single-use
    .select('id,invoice_number,credit_note_number')
    .single();
  if (updErr || !updated) return new Response('Peruutus epäonnistui — tilaus on ehkä jo käsitelty.', { status: 409, headers: { 'Content-Type': 'text/html; charset=utf-8' } });

  try {
    const pdf = await generateCreditNotePdf({
      invoiceNumber: updated.invoice_number,
      creditNoteNumber: updated.credit_note_number ?? 'HYV-?',
      originalInvoiceNumber: updated.invoice_number,
      date: new Date(),
      customerEmail: customer?.email ?? 'asiakas',
      customerCompany: customer?.company ?? null,
      lines,
    });
    const path = `${updated.credit_note_number ?? updated.invoice_number}-hyvitys.pdf`;
    await supabase.storage.from('invoices').upload(path, pdf, { contentType: 'application/pdf', upsert: true });
    await supabase.from('orders').update({ credit_note_url: path }).eq('id', order.id);
  } catch (e) {
    console.error('credit note pdf failed', e);
  }

  const adminEmail = import.meta.env.ADMIN_EMAIL as string | undefined;
  if (adminEmail) {
    try {
      await sendAdminNotification({
        to: adminEmail,
        subject: `Tilaus peruutettu: ${order.invoice_number}`,
        html: `<p>Asiakas ${customer?.email ?? ''} peruutti tilauksen ${order.invoice_number}. Hyvityslasku: ${updated.credit_note_number ?? ''}</p>`,
      });
    } catch {}
  }

  return new Response(`<!doctype html><meta charset="utf-8"><title>Peruutettu</title><body style="font-family:sans-serif;max-width:600px;margin:48px auto;padding:24px"><h1>Tilaus peruutettu</h1><p>Lasku ${order.invoice_number} on hyvitetty. Hyvityslasku ${updated.credit_note_number ?? ''} on luotu kirjanpitoa varten. Jos ehdit jo maksaa, ota yhteyttä.</p><p><a href="/">Etusivulle</a></p></body>`, { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
};
