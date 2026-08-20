import { Resend } from 'resend';

export function getResend(): Resend {
  const key = import.meta.env.RESEND_API_KEY as string | undefined;
  if (!key) throw new Error('Missing RESEND_API_KEY');
  return new Resend(key);
}

export async function sendInvoiceEmail(opts: {
  to: string;
  invoiceNumber: string;
  pdfBytes: Uint8Array;
  cancelUrl?: string | null;
}): Promise<void> {
  const resend = getResend();
  const from = (import.meta.env.ADMIN_EMAIL as string | undefined) || 'noreply@tietosiru.fi';
  const cancelBlock = opts.cancelUrl
    ? `<p style="margin-top:16px"><a href="${opts.cancelUrl}">Peruuta tilaus (7 päivän kuluessa)</a></p>`
    : '';
  const html = `<p>Hei,</p><p>Kiitos tilauksestasi. Lasku <strong>${opts.invoiceNumber}</strong> on liitteenä.</p>${cancelBlock}<p>Ystävällisin terveisin,<br/>Tietosiru Oy</p>`;
  const { error } = await resend.emails.send({
    from,
    to: opts.to,
    subject: `Lasku ${opts.invoiceNumber} — Tietosiru Oy`,
    html,
    attachments: [{ filename: `lasku-${opts.invoiceNumber}.pdf`, content: Buffer.from(opts.pdfBytes) }],
  });
  if (error) throw new Error(`Resend error: ${JSON.stringify(error)}`);
}

export async function sendAdminNotification(opts: { to: string; subject: string; html: string }): Promise<void> {
  const resend = getResend();
  const from = (import.meta.env.ADMIN_EMAIL as string | undefined) || 'noreply@tietosiru.fi';
  const { error } = await resend.emails.send({ from, to: opts.to, subject: opts.subject, html: opts.html });
  if (error) throw new Error(`Resend error: ${JSON.stringify(error)}`);
}
