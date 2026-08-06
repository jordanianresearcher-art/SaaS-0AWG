// Supabase Edge Function: notify-shop-response
// Best-effort staff notification when a customer submits a high-intent
// response on their public quote page (currently: "I need financing" —
// see docs/FINANCING_INTENT.md). Reuses the same Resend secrets
// send-quote-email/send-invoice-email already use; deliberately not a
// blocking step for the customer -- PublicQuotePage calls this after its
// own submitResponse() already succeeded, fire-and-forget, and never
// surfaces a failure here to the customer.
//
// Deploy:  supabase functions deploy notify-shop-response
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

// Every response here is "ok" from the client's point of view -- this is
// a fire-and-forget best-effort notification, not a step the customer's
// own confirmation should ever depend on or surface a failure for.
function noop(reason: string): Response {
  console.log('notify-shop-response: no-op —', reason)
  return json(200, { ok: true, sent: false })
}

const RESPONSE_LABELS: Record<string, string> = {
  need_financing: 'asked about financing',
  ready_to_book: "said they're ready to book",
  want_cheaper: 'asked for a cheaper option',
  after_payday: 'asked to be contacted after payday',
  question: 'has a question',
  not_interested: 'said they are no longer interested',
}

// Response types genuinely worth an inbox interruption. (not_interested/
// want_cheaper are visible in the app's normal activity feed already and
// don't need a real-time ping the way "ready to buy right now" does.)
const HIGH_INTENT_TYPES = new Set(['need_financing', 'ready_to_book'])

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return noop('method not allowed')

  const body = await req.json().catch(() => null)
  const publicToken = typeof body?.publicToken === 'string' ? body.publicToken : ''
  const responseType = typeof body?.responseType === 'string' ? body.responseType : ''
  if (!publicToken || !HIGH_INTENT_TYPES.has(responseType)) {
    return noop('missing token or not a high-intent response type')
  }

  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )

  const { data: quote } = await admin
    .from('quotes')
    .select('*, customers(*), shops(*)')
    .eq('public_token', publicToken)
    .neq('status', 'draft')
    .maybeSingle()
  if (!quote) return noop('quote not found')

  const shop = quote.shops
  const customer = quote.customers
  if (!shop || shop.active === false) return noop('shop missing or inactive')
  if (!shop.email) return noop('shop has no notification email on file')

  // Cheap replay guard: only notify if the matching customer_responded
  // event this call is presumably reacting to was recorded very recently.
  // A stale/retried call (long after the real response) doesn't re-notify.
  const { data: recentEvent } = await admin
    .from('quote_events')
    .select('created_at, metadata')
    .eq('quote_id', quote.id)
    .eq('event_type', 'customer_responded')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  const matchesType = recentEvent?.metadata && (recentEvent.metadata as { responseType?: string }).responseType === responseType
  const isRecent = recentEvent?.created_at && Date.now() - new Date(recentEvent.created_at).getTime() < 30_000
  if (!matchesType || !isRecent) return noop('no matching recent response event')

  const resendKey = Deno.env.get('RESEND_API_KEY')
  const emailFrom = Deno.env.get('EMAIL_FROM')
  if (!resendKey || !emailFrom) return noop('email sending not configured')

  const appUrl = (Deno.env.get('APP_URL') ?? '').replace(/\/$/, '')
  const customerName = customer ? `${customer.first_name}${customer.last_name ? ` ${customer.last_name}` : ''}` : 'A customer'
  const label = RESPONSE_LABELS[responseType] ?? 'responded to their quote'
  const detailUrl = `${appUrl}/app/quotes/${quote.id}`

  const subject = `${customerName} ${label} — follow up`
  const text = [
    `${customerName} ${label} on their quote.`,
    '',
    `Follow up here: ${detailUrl}`,
  ].join('\n')
  const html = `
<div style="margin:0;padding:24px 12px;background:#f4f4f5;font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <div style="max-width:480px;margin:0 auto;background:#ffffff;border-radius:12px;padding:24px;border:1px solid #e4e4e7;">
    <p style="margin:0 0 16px;font-size:16px;color:#27272a;">
      <strong>${escapeHtml(customerName)}</strong> ${escapeHtml(label)} on their quote.
    </p>
    <p style="margin:0;text-align:center;">
      <a href="${escapeHtml(detailUrl)}" style="display:inline-block;background:${escapeHtml(shop.primary_color || '#1d4ed8')};color:#ffffff;text-decoration:none;font-weight:700;font-size:16px;padding:12px 28px;border-radius:10px;">Follow up now</a>
    </p>
  </div>
</div>`.trim()

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: emailFrom, to: [shop.email], subject, html, text }),
    })
    if (!res.ok) return noop(`resend returned ${res.status}`)
  } catch (err) {
    console.error('notify-shop-response: send failed', err)
    return noop('send threw')
  }

  return json(200, { ok: true, sent: true })
})
