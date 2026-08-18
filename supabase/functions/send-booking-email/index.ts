// Supabase Edge Function: send-booking-email
// Fire-and-forget booking confirmation, invoked right after book_appointment
// succeeds (both the public self-serve wizard and staff's "Book & send" on
// the calendar) — same trust model as notify-shop-response: the customer's
// own confirmation on-screen never depends on or waits for this, and no
// failure here is ever surfaced to them. Reuses the same Resend secrets
// send-quote-email/send-invoice-email/notify-shop-response already use.
//
// Deploy:  supabase functions deploy send-booking-email
// No new secrets needed -- reuses RESEND_API_KEY / EMAIL_FROM / APP_URL.

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

function noop(reason: string): Response {
  console.log('send-booking-email: no-op —', reason)
  return json(200, { ok: true, sent: false })
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function formatCurrency(cents: number): string {
  return (cents / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' })
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return noop('method not allowed')

  const body = await req.json().catch(() => null)
  const publicToken = typeof body?.publicToken === 'string' ? body.publicToken : ''
  if (!publicToken) return noop('missing publicToken')
  // 'confirmation' right after booking, 'reminder' the day before. Same
  // appointment lookup and layout — only the framing changes, so the two can
  // never drift apart in styling or in what they link to.
  const kind: 'confirmation' | 'reminder' = body?.kind === 'reminder' ? 'reminder' : 'confirmation'

  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )

  const { data: appt } = await admin
    .from('appointments')
    .select('*, customers(*), shops(*), appointment_services(name, duration_minutes, position)')
    .eq('public_token', publicToken)
    .maybeSingle()
  if (!appt) return noop('appointment not found')

  const shop = appt.shops
  const customer = appt.customers
  if (!shop || shop.active === false) return noop('shop missing or inactive')
  if (!customer?.email) return noop('customer has no email on file')

  const resendKey = Deno.env.get('RESEND_API_KEY')
  const emailFrom = Deno.env.get('EMAIL_FROM')
  if (!resendKey || !emailFrom) return noop('email sending not configured')

  const appUrl = (Deno.env.get('APP_URL') ?? '').replace(/\/$/, '')
  const manageUrl = `${appUrl}/booking/${appt.public_token}`
  const color = shop.primary_color || '#1d4ed8'

  const services = ((appt.appointment_services as Array<{ name: string; duration_minutes: number; position: number }>) ?? [])
    .sort((a, b) => a.position - b.position)
    .map((s) => s.name)
    .join(', ')

  const start = new Date(appt.starts_at)
  const end = new Date(appt.ends_at)
  const dateLabel = start.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })
  const timeLabel = `${start.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })} – ${end.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`

  const needsDeposit = appt.status === 'awaiting_deposit'
  const isReminder = kind === 'reminder'
  const subject = isReminder
    ? needsDeposit
      ? `Tomorrow — your deposit still holds this slot`
      : `See you ${dateLabel} at ${shop.name}`
    : needsDeposit
      ? `Almost set — pay your deposit to confirm ${dateLabel}`
      : `You're booked — ${dateLabel} at ${shop.name}`

  // A reminder for an appointment that is cancelled or already done would be
  // worse than no reminder at all.
  if (isReminder && appt.status !== 'confirmed' && appt.status !== 'awaiting_deposit') {
    return noop(`reminder skipped for status ${appt.status}`)
  }

  const depositLine = needsDeposit && appt.deposit_amount_cents
    ? `A ${formatCurrency(appt.deposit_amount_cents)} deposit holds this slot — pay it here: ${manageUrl}`
    : ''

  const text = [
    `Hi ${customer.first_name || 'there'},`,
    '',
    isReminder
      ? `Reminder: your ${services} at ${shop.name} is coming up ${dateLabel}, ${timeLabel}.`
      : needsDeposit
        ? `Your ${services} appointment at ${shop.name} is set for ${dateLabel}, ${timeLabel} — pending your deposit.`
        : `You're booked for ${services} at ${shop.name} on ${dateLabel}, ${timeLabel}.`,
    depositLine,
    '',
    `Manage or cancel: ${manageUrl}`,
    '',
    `Questions? Call ${shop.phone}.`,
    '',
    shop.name,
    shop.address,
  ]
    .filter((line) => line !== '')
    .join('\n')

  const html = `
<div style="margin:0;padding:24px 12px;background:#f4f4f5;font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <div style="max-width:480px;margin:0 auto;background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #e4e4e7;">
    <div style="padding:20px 24px;border-bottom:3px solid ${color};">
      <div style="font-size:20px;font-weight:800;color:#18181b;">${escapeHtml(shop.name)}</div>
    </div>
    <div style="padding:24px;color:#27272a;font-size:16px;line-height:1.6;">
      <p style="margin:0 0 16px;">Hi ${escapeHtml(customer.first_name || 'there')},</p>
      <p style="margin:0 0 16px;">
        ${isReminder ? `Just a reminder — your <strong>${escapeHtml(services)}</strong> is coming up` : needsDeposit ? `Your <strong>${escapeHtml(services)}</strong> appointment is set for` : `You're booked for <strong>${escapeHtml(services)}</strong> on`}
        <strong style="color:#18181b;">${escapeHtml(dateLabel)}, ${escapeHtml(timeLabel)}</strong>${needsDeposit ? ' — pending your deposit.' : '.'}
      </p>
      ${
        needsDeposit && appt.deposit_amount_cents
          ? `<p style="margin:0 0 20px;padding:14px;background:#fffbeb;border-radius:10px;color:#92400e;font-weight:600;">A ${escapeHtml(formatCurrency(appt.deposit_amount_cents))} deposit holds this slot.</p>`
          : ''
      }
      <p style="margin:0 0 24px;text-align:center;">
        <a href="${escapeHtml(manageUrl)}" style="display:inline-block;background:${color};color:#ffffff;text-decoration:none;font-weight:700;font-size:17px;padding:14px 32px;border-radius:10px;">${needsDeposit ? 'Pay Deposit & Confirm' : 'Manage My Appointment'}</a>
      </p>
      <p style="margin:0;color:#52525b;font-size:15px;">Questions? Call <a href="tel:${escapeHtml(shop.phone)}" style="color:${color};">${escapeHtml(shop.phone)}</a>.</p>
    </div>
    <div style="padding:16px 24px;background:#fafafa;border-top:1px solid #e4e4e7;color:#71717a;font-size:13px;line-height:1.6;">
      <div><strong>${escapeHtml(shop.name)}</strong> &middot; ${escapeHtml(shop.phone)}</div>
      <div>${escapeHtml(shop.address)}</div>
    </div>
  </div>
</div>`.trim()

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: emailFrom, to: [customer.email], subject, html, text }),
    })
    if (!res.ok) return noop(`resend returned ${res.status}`)
  } catch (err) {
    console.error('send-booking-email: send failed', err)
    return noop('send threw')
  }

  return json(200, { ok: true, sent: true })
})
