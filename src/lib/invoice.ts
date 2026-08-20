// PDF generation helpers — pdf-lib (PLAN §10)
// Keep template minimal; Tietosiru to confirm logo/address/IBAN before final styling.
import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';

export type InvoiceLine = { name: string; qty: number; price_cents: number; vat_percent: number };
export type InvoiceInput = {
  invoiceNumber: string;
  date: Date;
  customerEmail: string;
  customerCompany?: string | null;
  lines: InvoiceLine[];
  cancelUrl?: string | null;
};

function fmtCents(cents: number): string {
  return new Intl.NumberFormat('fi-FI', { style: 'currency', currency: 'EUR' }).format(cents / 100);
}

export async function generateInvoicePdf(input: InvoiceInput): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([595.28, 841.89]); // A4
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const { width, height } = page.getSize();
  let y = height - 48;

  const draw = (text: string, x: number, opts: { size?: number; f?: typeof font; color?: ReturnType<typeof rgb> } = {}) => {
    const size = opts.size ?? 10;
    page.drawText(text, { x, y, size, font: opts.f ?? font, color: opts.color ?? rgb(0.13, 0.13, 0.13) });
  };

  // Header
  draw('Tietosiru Oy', 40, { f: bold, size: 16 });
  y -= 18;
  draw('LASKU', 40, { f: bold, size: 12, color: rgb(0.2, 0.4, 0.8) });
  y -= 20;
  draw(`Laskun numero: ${input.invoiceNumber}`, 40, { size: 10 });
  y -= 14;
  draw(`Päivämäärä: ${input.date.toLocaleDateString('fi-FI')}`, 40);
  y -= 14;
  draw(`Asiakas: ${input.customerCompany ? `${input.customerCompany} — ` : ''}${input.customerEmail}`, 40);
  y -= 28;

  // Table header
  const colX = [40, 280, 340, 400, 500];
  draw('Tuote', colX[0], { f: bold, size: 9 });
  draw('Määrä', colX[1], { f: bold, size: 9 });
  draw('Hinta', colX[2], { f: bold, size: 9 });
  draw('Alv', colX[3], { f: bold, size: 9 });
  draw('Yhteensä', colX[4], { f: bold, size: 9 });
  y -= 10;
  page.drawLine({ start: { x: 40, y }, end: { x: width - 40, y }, thickness: 1, color: rgb(0.8, 0.8, 0.8) });
  y -= 16;

  let total = 0;
  for (const line of input.lines) {
    const sum = line.price_cents * line.qty;
    total += sum;
    if (y < 120) {
      // naive single-page MVP; overflow not paginated
      y -= 12;
      draw('(jatkuu — ota yhteyttä jos lasku katkeaa)', 40, { size: 8, color: rgb(0.6, 0, 0) });
      break;
    }
    draw(line.name.slice(0, 40), colX[0], { size: 9 });
    draw(String(line.qty), colX[1], { size: 9 });
    draw(fmtCents(line.price_cents), colX[2], { size: 9 });
    draw(`${line.vat_percent}%`, colX[3], { size: 9 });
    draw(fmtCents(sum), colX[4], { size: 9 });
    y -= 14;
  }

  y -= 8;
  page.drawLine({ start: { x: 40, y }, end: { x: width - 40, y }, thickness: 1, color: rgb(0.8, 0.8, 0.8) });
  y -= 18;
  draw(`Yhteensä: ${fmtCents(total)}`, width - 180, { f: bold, size: 11 });
  y -= 20;
  draw('Maksuehto: 14 pv netto', 40, { size: 9, color: rgb(0.35, 0.35, 0.35) });
  y -= 12;
  draw('Kiitos tilauksesta.', 40, { size: 9, color: rgb(0.35, 0.35, 0.35) });

  if (input.cancelUrl) {
    y -= 24;
    draw('Peruuta tilaus (7 pv ajan):', 40, { size: 8, color: rgb(0.4, 0.4, 0.4) });
    y -= 10;
    draw(input.cancelUrl, 40, { size: 7, color: rgb(0.2, 0.4, 0.8) });
  }

  return doc.save();
}

export type CreditNoteInput = InvoiceInput & { creditNoteNumber: string; originalInvoiceNumber: string };

export async function generateCreditNotePdf(input: CreditNoteInput): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([595.28, 841.89]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const { width, height } = page.getSize();
  let y = height - 48;
  const draw = (text: string, x: number, opts: { size?: number; f?: typeof font; color?: ReturnType<typeof rgb> } = {}) => {
    page.drawText(text, { x, y, size: opts.size ?? 10, font: opts.f ?? font, color: opts.color ?? rgb(0.13, 0.13, 0.13) });
  };
  draw('Tietosiru Oy', 40, { f: bold, size: 16 });
  y -= 18;
  draw('HYVITYSLASKU', 40, { f: bold, size: 12, color: rgb(0.7, 0.15, 0.15) });
  y -= 20;
  draw(`Hyvityslaskun numero: ${input.creditNoteNumber}`, 40);
  y -= 14;
  draw(`Alkuperäinen lasku: ${input.originalInvoiceNumber}`, 40);
  y -= 14;
  draw(`Päivämäärä: ${input.date.toLocaleDateString('fi-FI')}`, 40);
  y -= 14;
  draw(`Asiakas: ${input.customerEmail}`, 40);
  y -= 28;
  const colX = [40, 280, 340, 400, 500];
  draw('Tuote', colX[0], { f: bold, size: 9 });
  draw('Määrä', colX[1], { f: bold, size: 9 });
  draw('Hinta', colX[2], { f: bold, size: 9 });
  draw('Alv', colX[3], { f: bold, size: 9 });
  draw('Yhteensä', colX[4], { f: bold, size: 9 });
  y -= 10;
  page.drawLine({ start: { x: 40, y }, end: { x: width - 40, y }, thickness: 1, color: rgb(0.8, 0.8, 0.8) });
  y -= 16;
  let total = 0;
  for (const line of input.lines) {
    const sum = line.price_cents * line.qty;
    total += sum;
    draw(line.name.slice(0, 40), colX[0], { size: 9 });
    draw(String(line.qty), colX[1], { size: 9 });
    draw(fmtCents(line.price_cents), colX[2], { size: 9 });
    draw(`${line.vat_percent}%`, colX[3], { size: 9 });
    draw(`-${fmtCents(sum)}`, colX[4], { size: 9, color: rgb(0.7, 0.15, 0.15) });
    y -= 14;
  }
  y -= 8;
  page.drawLine({ start: { x: 40, y }, end: { x: width - 40, y }, thickness: 1, color: rgb(0.8, 0.8, 0.8) });
  y -= 18;
  draw(`Hyvitetään: -${fmtCents(total)}`, width - 200, { f: bold, size: 11, color: rgb(0.7, 0.15, 0.15) });
  return doc.save();
}
