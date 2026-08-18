// Supabase Edge Function: send-invoice-email
// Emails a copy of an invoice from the scan-to-invoice workspace through
// Resend. Simpler than send-quote-email — no template types, no
// eligibility/follow-up scheduling (invoices aren't part of the
// quote-recovery follow-up sequence), and no email_messages logging
// (that table exists specifically to drive/rate-limit the quote follow-up
// sequence, which doesn't apply to a one-off invoice send).
//
// Deploy:  supabase functions deploy send-invoice-email
// Secrets: reuses RESEND_API_KEY / EMAIL_FROM already set for
//          send-quote-email — no new secret needed.
//
// The email copy here mirrors src/lib/invoiceEmailTemplate.ts. Update
// both together.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

function json(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

function fail(status: number, message: string): Response {
  return json(status, { ok: false, message })
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

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

function formatCurrency(cents: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: cents % 100 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(cents / 100)
}

function formatDate(iso: string | null): string {
  if (!iso) return ''
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(iso))
}

// deno-lint-ignore no-explicit-any
function renderInvoiceEmail(shop: any, invoice: any, items: any[], recipientName: string) {
  const greetingName = recipientName.trim() || 'there'
  const subject = `Invoice #${invoice.invoice_number} from ${shop.name}`
  const paidLine =
    invoice.status === 'paid'
      ? `Paid${invoice.payment_method ? ` — ${PAYMENT_METHOD_LABELS[invoice.payment_method] ?? invoice.payment_method}` : ''}${
          invoice.paid_at ? ` on ${formatDate(invoice.paid_at)}` : ''
        }`
      : 'Payment due'

  const itemLines = items.map(
    (item) =>
      `  ${item.quantity}x ${item.name}${item.brand || item.model ? ` (${[item.brand, item.model].filter(Boolean).join(' ')})` : ''} — ${formatCurrency(item.unit_price_cents * item.quantity)}`,
  )

  const text = [
    `Hi ${greetingName},`,
    '',
    `Here's your invoice #${invoice.invoice_number} from ${shop.name}, dated ${formatDate(invoice.created_at)}.`,
    '',
    ...itemLines,
    '',
    `Subtotal: ${formatCurrency(invoice.subtotal_cents)}`,
    (invoice.discount_cents ?? 0) > 0 ? `Discount: -${formatCurrency(invoice.discount_cents)}` : null,
    (invoice.tax_cents ?? 0) > 0 ? `Tax: ${formatCurrency(invoice.tax_cents)}` : null,
    `Total: ${formatCurrency(invoice.total_cents)}`,
    paidLine,
    '',
    `Questions? Call ${shop.phone} or reply to this email.`,
    '',
    shop.name,
    shop.address,
  ].join('\n')

  const color = shop.primary_color || '#1d4ed8'
  const statusChip =
    invoice.status === 'paid'
      ? `<span style="display:inline-block;background:#dcfce7;color:#166534;font-weight:700;font-size:12px;padding:4px 10px;border-radius:999px;">${escapeHtml(paidLine.toUpperCase())}</span>`
      : `<span style="display:inline-block;background:#fef3c7;color:#92400e;font-weight:700;font-size:12px;padding:4px 10px;border-radius:999px;">UNPAID</span>`

  const rows = items
    .map(
      (item) => `
      <tr>
        <td style="padding:10px 0;border-bottom:1px solid #f4f4f5;">
          <div style="font-weight:600;color:#18181b;">${escapeHtml(item.name)}</div>
          ${item.brand || item.model ? `<div style="color:#71717a;font-size:13px;">${escapeHtml([item.brand, item.model].filter(Boolean).join(' · '))}</div>` : ''}
        </td>
        <td style="padding:10px 0;border-bottom:1px solid #f4f4f5;text-align:right;color:#71717a;">${item.quantity}</td>
        <td style="padding:10px 0;border-bottom:1px solid #f4f4f5;text-align:right;font-weight:600;color:#18181b;">${formatCurrency(item.unit_price_cents * item.quantity)}</td>
      </tr>`,
    )
    .join('')

  const html = `
<div style="margin:0;padding:24px 12px;background:#f4f4f5;font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <div style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #e4e4e7;">
    <div style="padding:20px 24px;border-top:6px solid ${color};display:flex;align-items:center;justify-content:space-between;">
      ${
        shop.logo_url
          ? `<img src="${escapeHtml(shop.logo_url)}" alt="${escapeHtml(shop.name)}" style="max-height:40px;max-width:200px;" />`
          : `<div style="font-size:18px;font-weight:800;color:#18181b;">${escapeHtml(shop.name)}</div>`
      }
      <div style="text-align:right;">
        <div style="font-size:12px;font-weight:700;color:#71717a;letter-spacing:0.05em;">INVOICE #${invoice.invoice_number}</div>
        <div style="font-size:12px;color:#a1a1aa;">${escapeHtml(formatDate(invoice.created_at))}</div>
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
        <div style="color:#71717a;font-size:14px;">Subtotal: ${formatCurrency(invoice.subtotal_cents)}</div>
        ${(invoice.discount_cents ?? 0) > 0 ? `<div style="color:#71717a;font-size:14px;">Discount: -${formatCurrency(invoice.discount_cents)}</div>` : ''}
        ${(invoice.tax_cents ?? 0) > 0 ? `<div style="color:#71717a;font-size:14px;">Tax: ${formatCurrency(invoice.tax_cents)}</div>` : ''}
        <div style="margin-top:4px;font-size:18px;font-weight:800;color:#18181b;">Total: ${formatCurrency(invoice.total_cents)}</div>
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

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return fail(405, 'Method not allowed')

  let body: { invoiceId?: string; recipientEmail?: string; recipientName?: string }
  try {
    body = await req.json()
  } catch {
    return fail(400, 'Invalid request')
  }
  const { invoiceId, recipientEmail } = body
  const recipientName = body.recipientName ?? ''
  if (!invoiceId || !recipientEmail || !EMAIL_RE.test(recipientEmail.trim())) {
    return fail(400, 'Invalid invoice or recipient email')
  }

  const authHeader = req.headers.get('Authorization') ?? ''
  const userClient = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: authHeader } } },
  )
  const {
    data: { user },
  } = await userClient.auth.getUser()
  if (!user) {
    return fail(401, 'You must be signed in to send emails.')
  }

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

  const { data: invoice } = await admin
    .from('invoices')
    .select('*, invoice_items(*), shops(*)')
    .eq('id', invoiceId)
    .maybeSingle()
  if (!invoice) {
    return fail(404, 'Invoice not found.')
  }

  const { data: membership } = await admin
    .from('shop_memberships')
    .select('id')
    .eq('shop_id', invoice.shop_id)
    .eq('user_id', user.id)
    .maybeSingle()
  if (!membership) {
    return fail(403, 'You are not a member of this shop.')
  }

  const shop = invoice.shops
  if (shop && shop.active === false) {
    return fail(403, "This shop's access has been suspended.")
  }

  const resendKey = Deno.env.get('RESEND_API_KEY')
  const emailFrom = Deno.env.get('EMAIL_FROM')
  if (!resendKey || !emailFrom) {
    return fail(503, 'Email sending is not configured yet. Ask your administrator to set up Resend.')
  }

  const items = (invoice.invoice_items ?? []).sort(
    // deno-lint-ignore no-explicit-any
    (a: any, b: any) => a.position - b.position,
  )
  const rendered = renderInvoiceEmail(shop, invoice, items, recipientName)

  try {
    const resendResponse = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${resendKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: emailFrom,
        to: [recipientEmail.trim()],
        reply_to: shop.reply_to_email || shop.email,
        subject: rendered.subject,
        html: rendered.html,
        text: rendered.text,
      }),
    })
    if (!resendResponse.ok) {
      throw new Error(`Provider returned ${resendResponse.status}`)
    }
  } catch (err) {
    console.error(err)
    return fail(502, 'The email provider rejected the message. Nothing was sent.')
  }

  return json(200, { ok: true })
})
