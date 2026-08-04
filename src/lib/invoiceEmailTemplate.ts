import type { Invoice, Shop } from '../types'
import { formatCurrency, formatDate } from './format'

// Renders an emailed copy of an invoice from the scan-to-invoice workspace
// (src/pages/app/ScanWorkspacePage.tsx's InvoiceDocument is the on-screen/
// print sibling — keep the two in visual sync). Unlike quote emails, which
// stay short and link out to a public quote page, there's no public
// invoice page — the itemized invoice rides directly in the email body,
// same as a real receipt.
// NOTE: supabase/functions/send-invoice-email keeps a mirrored copy of
// this logic for server-side rendering. Update both together.

export interface RenderedInvoiceEmail {
  subject: string
  html: string
  text: string
}

export interface InvoiceEmailContext {
  shop: Shop
  invoice: Invoice
  /** Typed at send time in the scan workspace — not a persisted Customer record (see ScanWorkspacePage). */
  recipientName: string
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

const PAYMENT_METHOD_LABELS: Record<string, string> = {
  cash: 'Cash',
  card: 'Card',
  zelle: 'Zelle',
  cashapp: 'Cash App',
  venmo: 'Venmo',
  paypal: 'PayPal',
  link: 'Payment link',
  other: 'Other',
}

export function renderInvoiceEmail(ctx: InvoiceEmailContext): RenderedInvoiceEmail {
  const { shop, invoice } = ctx
  const greetingName = ctx.recipientName.trim() || 'there'
  const subject = `Invoice #${invoice.invoiceNumber} from ${shop.name}`
  const paidLine =
    invoice.status === 'paid'
      ? `Paid${invoice.paymentMethod ? ` — ${PAYMENT_METHOD_LABELS[invoice.paymentMethod] ?? invoice.paymentMethod}` : ''}${
          invoice.paidAt ? ` on ${formatDate(invoice.paidAt)}` : ''
        }`
      : 'Payment due'

  const itemLines = invoice.items.map(
    (item) => `  ${item.quantity}x ${item.name}${item.brand || item.model ? ` (${[item.brand, item.model].filter(Boolean).join(' ')})` : ''} — ${formatCurrency(item.unitPriceCents * item.quantity)}`,
  )

  const text = [
    `Hi ${greetingName},`,
    '',
    `Here's your invoice #${invoice.invoiceNumber} from ${shop.name}, dated ${formatDate(invoice.createdAt)}.`,
    '',
    ...itemLines,
    '',
    `Subtotal: ${formatCurrency(invoice.subtotalCents)}`,
    `Total: ${formatCurrency(invoice.totalCents)}`,
    paidLine,
    '',
    `Questions? Call ${shop.phone} or reply to this email.`,
    '',
    shop.name,
    shop.address,
  ]
    .filter((line) => line !== null)
    .join('\n')

  const color = shop.primaryColor || '#1d4ed8'
  const statusChip =
    invoice.status === 'paid'
      ? `<span style="display:inline-block;background:#dcfce7;color:#166534;font-weight:700;font-size:12px;padding:4px 10px;border-radius:999px;">${escapeHtml(paidLine.toUpperCase())}</span>`
      : `<span style="display:inline-block;background:#fef3c7;color:#92400e;font-weight:700;font-size:12px;padding:4px 10px;border-radius:999px;">UNPAID</span>`

  const rows = invoice.items
    .map(
      (item) => `
      <tr>
        <td style="padding:10px 0;border-bottom:1px solid #f4f4f5;">
          <div style="font-weight:600;color:#18181b;">${escapeHtml(item.name)}</div>
          ${item.brand || item.model ? `<div style="color:#71717a;font-size:13px;">${escapeHtml([item.brand, item.model].filter(Boolean).join(' · '))}</div>` : ''}
        </td>
        <td style="padding:10px 0;border-bottom:1px solid #f4f4f5;text-align:right;color:#71717a;">${item.quantity}</td>
        <td style="padding:10px 0;border-bottom:1px solid #f4f4f5;text-align:right;font-weight:600;color:#18181b;">${formatCurrency(item.unitPriceCents * item.quantity)}</td>
      </tr>`,
    )
    .join('')

  const html = `
<div style="margin:0;padding:24px 12px;background:#f4f4f5;font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <div style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #e4e4e7;">
    <div style="padding:20px 24px;border-top:6px solid ${color};display:flex;align-items:center;justify-content:space-between;">
      ${
        shop.logoUrl
          ? `<img src="${escapeHtml(shop.logoUrl)}" alt="${escapeHtml(shop.name)}" style="max-height:40px;max-width:200px;" />`
          : `<div style="font-size:18px;font-weight:800;color:#18181b;">${escapeHtml(shop.name)}</div>`
      }
      <div style="text-align:right;">
        <div style="font-size:12px;font-weight:700;color:#71717a;letter-spacing:0.05em;">INVOICE #${invoice.invoiceNumber}</div>
        <div style="font-size:12px;color:#a1a1aa;">${escapeHtml(formatDate(invoice.createdAt))}</div>
      </div>
    </div>
    <div style="padding:24px;color:#27272a;font-size:15px;line-height:1.6;">
      <p style="margin:0 0 8px;">Hi ${escapeHtml(greetingName)},</p>
      <p style="margin:0 0 16px;">Here's your invoice from ${escapeHtml(shop.name)}. ${statusChip}</p>
      <table style="width:100%;border-collapse:collapse;font-size:14px;">
        <thead>
          <tr>
            <th style="text-align:left;padding-bottom:6px;border-bottom:2px solid #e4e4e7;color:#a1a1aa;font-size:11px;text-transform:uppercase;letter-spacing:0.05em;">Item</th>
            <th style="text-align:right;padding-bottom:6px;border-bottom:2px solid #e4e4e7;color:#a1a1aa;font-size:11px;text-transform:uppercase;letter-spacing:0.05em;">Qty</th>
            <th style="text-align:right;padding-bottom:6px;border-bottom:2px solid #e4e4e7;color:#a1a1aa;font-size:11px;text-transform:uppercase;letter-spacing:0.05em;">Total</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
      <div style="margin-top:16px;text-align:right;">
        <div style="color:#71717a;font-size:14px;">Subtotal: ${formatCurrency(invoice.subtotalCents)}</div>
        <div style="margin-top:4px;font-size:18px;font-weight:800;color:#18181b;">Total: ${formatCurrency(invoice.totalCents)}</div>
      </div>
      <p style="margin:20px 0 0;color:#52525b;font-size:14px;">Questions? Call <a href="tel:${escapeHtml(shop.phone)}" style="color:${color};">${escapeHtml(shop.phone)}</a> or just reply to this email.</p>
    </div>
    <div style="padding:16px 24px;background:#fafafa;border-top:1px solid #e4e4e7;color:#71717a;font-size:13px;line-height:1.6;">
      <div><strong>${escapeHtml(shop.name)}</strong> &middot; ${escapeHtml(shop.phone)}</div>
      <div>${escapeHtml(shop.address)}</div>
    </div>
  </div>
</div>`.trim()

  return { subject, html, text }
}
