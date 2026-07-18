// Supabase Edge Function: send-quote-email
// Sends one quote email through Resend on behalf of an authenticated shop
// member. The Resend API key lives only in Edge Function secrets — it is
// never exposed to the browser.
//
// Deploy:  supabase functions deploy send-quote-email
// Secrets: supabase secrets set RESEND_API_KEY=... EMAIL_FROM="Shop <q@dom>" APP_URL=https://...
//
// The email copy here mirrors src/lib/emailTemplates.ts (used for previews).
// Update both together.

import { createClient } from 'jsr:@supabase/supabase-js@2'

type TemplateType = 'initial' | 'check_in' | 'financing_option' | 'payday_reminder' | 'final_check_in'

const VALID_TEMPLATES: TemplateType[] = [
  'initial',
  'check_in',
  'financing_option',
  'payday_reminder',
  'final_check_in',
]

// Follow-up gap (days) suggested after each template; final gets no follow-up.
const NEXT_FOLLOW_UP_DAYS: Record<TemplateType, number | null> = {
  initial: 2,
  check_in: 3,
  financing_option: 5,
  payday_reminder: 5,
  final_check_in: null,
}

const RATE_LIMIT_PER_QUOTE_PER_DAY = 3
const RATE_LIMIT_PER_SHOP_PER_HOUR = 30

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
  // Safe, user-facing message only — no provider details, no internals.
  return json(status, { ok: false, message })
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function formatCurrency(cents: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: cents % 100 === 0 ? 0 : 2,
  }).format(cents / 100)
}

function formatDate(iso: string): string {
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).format(
    new Date(iso),
  )
}

interface EmailContext {
  shopName: string
  shopPhone: string
  shopAddress: string
  shopReplyTo: string
  shopLogoUrl: string | null
  shopColor: string
  firstName: string
  vehicle: string
  valueCents: number
  expirationDate: string | null
  publicUrl: string
  optOutUrl: string
}

const COPY: Record<TemplateType, { subject: (c: EmailContext) => string; intro: (c: EmailContext) => string; cta: string }> = {
  initial: {
    subject: (c) => `Your ${c.vehicle} audio quote from ${c.shopName}`,
    intro: (c) =>
      `Thanks for stopping by ${c.shopName}. Here is the quote you asked for on your ${c.vehicle}. You can review the options and pricing at the link below.`,
    cta: 'View My Quote',
  },
  check_in: {
    subject: (c) => `Any questions about your ${c.vehicle} quote?`,
    intro: (c) =>
      `Just checking in on the quote we put together for your ${c.vehicle}. If anything is unclear or you want to tweak the setup, reply to this email or give us a call — happy to help.`,
    cta: 'Review My Quote',
  },
  financing_option: {
    subject: (c) => `Options that fit your budget — ${c.shopName}`,
    intro: (c) =>
      `We know a full system is a real investment. If the price on your ${c.vehicle} quote is the holdup, we can talk financing or put together a lower-cost package that still sounds great. The quote link below has the current options.`,
    cta: 'See My Options',
  },
  payday_reminder: {
    subject: (c) => `Ready when you are — ${c.shopName}`,
    intro: (c) =>
      `You asked us to follow up in a bit about your ${c.vehicle}. Your quote is still ready to go — take a look when the timing works and we can get you on the schedule.`,
    cta: 'View My Quote',
  },
  final_check_in: {
    subject: (c) => `Last note about your ${c.vehicle} quote`,
    intro: (c) =>
      `This is our last note about the quote for your ${c.vehicle} — we won't keep filling your inbox. If you'd still like to get it done, the quote is at the link below and we'd love to have you in.`,
    cta: 'View My Quote',
  },
}

function renderEmail(template: TemplateType, c: EmailContext): { subject: string; html: string; text: string } {
  const copy = COPY[template]
  const subject = copy.subject(c)
  const intro = copy.intro(c)
  const expiration = c.expirationDate ? `This quote is good through ${formatDate(c.expirationDate)}.` : ''

  const text = [
    `Hi ${c.firstName},`,
    '',
    intro,
    '',
    `${copy.cta}: ${c.publicUrl}`,
    c.valueCents > 0 ? `Quoted from ${formatCurrency(c.valueCents)} for your ${c.vehicle}.` : '',
    expiration,
    '',
    `Questions? Call ${c.shopPhone} or reply to this email (${c.shopReplyTo}).`,
    '',
    c.shopName,
    c.shopAddress,
    '',
    `Don't want more emails about this quote? Stop follow-ups here: ${c.optOutUrl}`,
  ].join('\n')

  const color = c.shopColor || '#1d4ed8'
  const html = `
<div style="margin:0;padding:24px 12px;background:#f4f4f5;font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <div style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #e4e4e7;">
    <div style="padding:20px 24px;border-bottom:3px solid ${color};">
      ${
        c.shopLogoUrl
          ? `<img src="${escapeHtml(c.shopLogoUrl)}" alt="${escapeHtml(c.shopName)}" style="max-height:48px;max-width:220px;" />`
          : `<div style="font-size:20px;font-weight:800;color:#18181b;">${escapeHtml(c.shopName)}</div>`
      }
    </div>
    <div style="padding:24px;color:#27272a;font-size:16px;line-height:1.6;">
      <p style="margin:0 0 16px;">Hi ${escapeHtml(c.firstName)},</p>
      <p style="margin:0 0 20px;">${escapeHtml(intro)}</p>
      ${
        c.valueCents > 0
          ? `<p style="margin:0 0 20px;color:#52525b;">Your ${escapeHtml(c.vehicle)} &middot; quoted from <strong style="color:#18181b;">${formatCurrency(c.valueCents)}</strong></p>`
          : ''
      }
      <p style="margin:0 0 24px;text-align:center;">
        <a href="${escapeHtml(c.publicUrl)}" style="display:inline-block;background:${color};color:#ffffff;text-decoration:none;font-weight:700;font-size:17px;padding:14px 32px;border-radius:10px;">${copy.cta}</a>
      </p>
      ${expiration ? `<p style="margin:0 0 16px;color:#52525b;font-size:14px;">${escapeHtml(expiration)}</p>` : ''}
      <p style="margin:0;color:#52525b;font-size:15px;">Questions? Call <a href="tel:${escapeHtml(c.shopPhone)}" style="color:${color};">${escapeHtml(c.shopPhone)}</a> or just reply to this email.</p>
    </div>
    <div style="padding:16px 24px;background:#fafafa;border-top:1px solid #e4e4e7;color:#71717a;font-size:13px;line-height:1.6;">
      <div><strong>${escapeHtml(c.shopName)}</strong> &middot; ${escapeHtml(c.shopPhone)}</div>
      <div>${escapeHtml(c.shopAddress)}</div>
      <div style="margin-top:8px;">
        You received this because you asked ${escapeHtml(c.shopName)} for a quote.
        <a href="${escapeHtml(c.optOutUrl)}" style="color:#71717a;">Stop follow-up emails</a>
      </div>
    </div>
  </div>
</div>`.trim()

  return { subject, html, text }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }
  if (req.method !== 'POST') {
    return fail(405, 'Method not allowed')
  }

  let body: { quoteId?: string; templateType?: string }
  try {
    body = await req.json()
  } catch {
    return fail(400, 'Invalid request')
  }
  const { quoteId, templateType } = body
  if (!quoteId || !templateType || !VALID_TEMPLATES.includes(templateType as TemplateType)) {
    return fail(400, 'Invalid quote or email type')
  }
  const template = templateType as TemplateType

  // Client bound to the caller's JWT — used only to identify the user.
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

  // Service-role client for reads/writes after we verify membership ourselves.
  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )

  const { data: quote } = await admin
    .from('quotes')
    .select('*, customers(*), shops(*), quote_options(price_cents, recommended)')
    .eq('id', quoteId)
    .maybeSingle()
  if (!quote) {
    return fail(404, 'Quote not found.')
  }

  // The caller must be a member of the quote's shop.
  const { data: membership } = await admin
    .from('shop_memberships')
    .select('id')
    .eq('shop_id', quote.shop_id)
    .eq('user_id', user.id)
    .maybeSingle()
  if (!membership) {
    return fail(403, 'You are not a member of this shop.')
  }

  const customer = quote.customers
  const shop = quote.shops

  // Eligibility — mirrors src/lib/eligibility.ts.
  if (!customer?.email) {
    return fail(400, 'This customer has no email address on file.')
  }
  if (!customer.email_contact_permission_confirmed) {
    return fail(400, 'Email permission was never confirmed for this customer.')
  }
  if (customer.email_opt_out_at) {
    return fail(400, 'This customer asked to stop receiving emails. Sends are blocked.')
  }
  if (!quote.email_follow_up_allowed) {
    return fail(400, 'Follow-up emails are turned off for this quote.')
  }
  if (['won', 'lost', 'expired'].includes(quote.status)) {
    return fail(400, 'This quote is closed. Reopen it before emailing.')
  }

  // Rate protection.
  const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
  const hourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString()
  const [{ count: quoteCount }, { count: shopCount }] = await Promise.all([
    admin
      .from('email_messages')
      .select('id', { count: 'exact', head: true })
      .eq('quote_id', quoteId)
      .in('status', ['sent', 'sending'])
      .gte('created_at', dayAgo),
    admin
      .from('email_messages')
      .select('id', { count: 'exact', head: true })
      .eq('shop_id', quote.shop_id)
      .in('status', ['sent', 'sending'])
      .gte('created_at', hourAgo),
  ])
  if ((quoteCount ?? 0) >= RATE_LIMIT_PER_QUOTE_PER_DAY) {
    return fail(429, 'This customer already received several emails today. Try again tomorrow.')
  }
  if ((shopCount ?? 0) >= RATE_LIMIT_PER_SHOP_PER_HOUR) {
    return fail(429, 'Your shop hit the hourly email limit. Try again shortly.')
  }

  const resendKey = Deno.env.get('RESEND_API_KEY')
  const emailFrom = Deno.env.get('EMAIL_FROM')
  if (!resendKey || !emailFrom) {
    return fail(503, 'Email sending is not configured yet. Ask your administrator to set up Resend.')
  }

  const appUrl = (Deno.env.get('APP_URL') ?? '').replace(/\/$/, '')
  const publicUrl = `${appUrl}/q/${quote.public_token}`
  const options = (quote.quote_options ?? []) as Array<{ price_cents: number; recommended: boolean }>
  const recommended = options.find((o) => o.recommended)
  const valueCents = recommended?.price_cents ?? (options.length ? Math.max(...options.map((o) => o.price_cents)) : 0)

  const rendered = renderEmail(template, {
    shopName: shop.name,
    shopPhone: shop.phone,
    shopAddress: shop.address,
    shopReplyTo: shop.reply_to_email || shop.email,
    shopLogoUrl: shop.logo_url,
    shopColor: shop.primary_color,
    firstName: customer.first_name,
    vehicle: `${customer.vehicle_year} ${customer.vehicle_make} ${customer.vehicle_model}`,
    valueCents,
    expirationDate: quote.expiration_date,
    publicUrl,
    optOutUrl: `${publicUrl}?stop=1`,
  })

  // Record the attempt first so failures are visible in the app.
  const { data: emailRow } = await admin
    .from('email_messages')
    .insert({
      shop_id: quote.shop_id,
      quote_id: quoteId,
      recipient_email: customer.email,
      template_type: template,
      subject: rendered.subject,
      status: 'sending',
      sent_by: user.id,
    })
    .select('id')
    .single()

  let providerMessageId: string | null = null
  try {
    const resendResponse = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${resendKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: emailFrom,
        to: [customer.email],
        reply_to: shop.reply_to_email || shop.email,
        subject: rendered.subject,
        html: rendered.html,
        text: rendered.text,
      }),
    })
    if (!resendResponse.ok) {
      throw new Error(`Provider returned ${resendResponse.status}`)
    }
    const result = (await resendResponse.json()) as { id?: string }
    providerMessageId = result.id ?? null
  } catch (err) {
    if (emailRow) {
      await admin
        .from('email_messages')
        .update({ status: 'failed', error_message: String(err).slice(0, 300) })
        .eq('id', emailRow.id)
    }
    await admin.from('quote_events').insert({
      quote_id: quoteId,
      event_type: 'email_failed',
      metadata: { templateType: template },
      created_by: user.id,
    })
    return fail(502, 'The email provider rejected the message. Nothing was sent.')
  }

  const now = new Date()
  if (emailRow) {
    await admin
      .from('email_messages')
      .update({ status: 'sent', provider_message_id: providerMessageId, sent_at: now.toISOString() })
      .eq('id', emailRow.id)
  }

  const followUpDays = NEXT_FOLLOW_UP_DAYS[template]
  const schedule = (shop.follow_up_schedule_days ?? []) as number[]
  const stepIndex: Record<TemplateType, number> = {
    initial: 0,
    check_in: 1,
    financing_option: 2,
    payday_reminder: 2,
    final_check_in: 3,
  }
  const customGap = schedule[stepIndex[template]]
  const gap = typeof customGap === 'number' && customGap > 0 ? customGap : followUpDays
  const nextFollowUp = gap === null ? null : new Date(now.getTime() + gap * 24 * 60 * 60 * 1000).toISOString()

  await admin
    .from('quotes')
    .update({
      last_emailed_at: now.toISOString(),
      next_follow_up_at: nextFollowUp,
      // Advance-only: sending never downgrades a later status.
      ...(quote.status === 'draft' ? { status: 'emailed' } : {}),
    })
    .eq('id', quoteId)

  await admin.from('quote_events').insert({
    quote_id: quoteId,
    event_type: 'email_sent',
    metadata: { templateType: template },
    created_by: user.id,
  })

  // Safe response: no provider IDs, no internals.
  return json(200, { ok: true, message: 'Email accepted by the email provider.' })
})
