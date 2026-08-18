// Supabase Edge Function: send-quote-email
// Sends one quote email through Resend on behalf of an authenticated shop
// member. The Resend API key lives only in Edge Function secrets — it is
// never exposed to the browser.
//
// Deploy:  supabase functions deploy send-quote-email
// Secrets: supabase secrets set RESEND_API_KEY=... EMAIL_FROM="Shop <q@dom>" APP_URL=https://...
//
// The email copy here mirrors src/lib/emailTemplates.ts (used for previews).
// It's duplicated rather than imported — this function runs in Deno with its
// own module resolution, separate from the Vite/React client build (same
// established convention as this project's other Edge Functions). Update
// both together.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

type TemplateType = 'initial' | 'check_in' | 'financing_option' | 'payday_reminder' | 'final_check_in'
type OptionKind = 'main' | 'addon'
type TintBodyStyle = 'coupe' | 'sedan' | 'truck_single_cab' | 'truck_crew_cab' | 'suv_4_window' | 'suv_6_window' | 'minivan'
type TintWindowPosition = 'front_left' | 'front_right' | 'rear_left' | 'rear_right' | 'rear_quarter_left' | 'rear_quarter_right' | 'back_glass'

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

// ---------------------------------------------------------------------------
// Main + add-on pricing — mirrors src/lib/quotePricing.ts.
// ---------------------------------------------------------------------------

interface EmailQuoteItem {
  brand: string | null
  model: string | null
  name: string
  quantity: number
  imageUrl: string | null
}

interface EmailQuoteOption {
  id: string
  optionKind: OptionKind
  name: string
  description: string
  priceCents: number
  laborIncluded: boolean
  items: EmailQuoteItem[]
}

function mainOption(options: EmailQuoteOption[]): EmailQuoteOption | undefined {
  return options.find((o) => o.optionKind === 'main') ?? options[0]
}

function addonOptions(options: EmailQuoteOption[]): EmailQuoteOption[] {
  const main = mainOption(options)
  return options.filter((o) => o !== main)
}

function computeAddonBreakdown(options: EmailQuoteOption[]) {
  const main = mainOption(options)
  const basePriceCents = main?.priceCents ?? 0
  return addonOptions(options).map((option) => ({
    option,
    addonPriceCents: option.priceCents,
    totalWithAddonCents: basePriceCents + option.priceCents,
  }))
}

function fullTotalCents(options: EmailQuoteOption[]): number {
  return options.reduce((sum, o) => sum + o.priceCents, 0)
}

// ---------------------------------------------------------------------------
// Window tint summary — mirrors src/lib/emailTemplates.ts's tintSummaryHtml.
// This used to carry a full duplicate of src/lib/carDiagrams.ts's SVG
// geometry (~190 lines) to embed a car diagram per tint entry as a base64
// data: URI. The diagrams are pulled pending a top-down redesign, so the
// duplicated geometry is gone with them — a written breakdown of which glass
// is getting film is what the shop wants the customer to read anyway, and
// it's one less thing that has to be kept byte-identical across two runtimes.
// ---------------------------------------------------------------------------

interface EmailTintWindow {
  position: TintWindowPosition
  included: boolean
  vltPercent: number | null
}

interface EmailWindowTint {
  name: string
  bodyStyle: TintBodyStyle
  windows: EmailTintWindow[]
  tintType: 'normal' | 'ceramic'
  windshieldIncluded: boolean
  windshieldVltPercent: number | null
  sunroofIncluded: boolean
  sunroofVltPercent: number | null
  removeOldTint: boolean
}

/** Driver and passenger side collapse into one label — mirrors TINT_SLOT_LABEL / TINT_VISUAL_SLOT_POSITIONS in src/lib/windowTint.ts. */
const TINT_SLOT_LABELS: Array<{ label: string; positions: TintWindowPosition[] }> = [
  { label: 'Front windows', positions: ['front_left', 'front_right'] },
  { label: 'Rear windows', positions: ['rear_left', 'rear_right'] },
  { label: 'Rear quarter windows', positions: ['rear_quarter_left', 'rear_quarter_right'] },
  { label: 'Back glass', positions: ['back_glass'] },
]

function tintUniformPercent(windows: EmailTintWindow[]): number | null {
  const percents = windows.filter((w) => w.included && w.vltPercent !== null).map((w) => w.vltPercent as number)
  if (percents.length === 0) return null
  return new Set(percents).size === 1 ? percents[0] : null
}

/** One "Front windows 20% · Back glass 5%" line per entry, grouped by visual slot. */
function tintCoverageLine(windows: EmailTintWindow[]): string {
  const parts: string[] = []
  for (const { label, positions } of TINT_SLOT_LABELS) {
    const included = windows.filter((w) => positions.includes(w.position) && w.included && w.vltPercent !== null)
    if (included.length === 0) continue
    const percents = new Set(included.map((w) => w.vltPercent))
    if (percents.size === 1) parts.push(`${label} ${included[0].vltPercent}%`)
    else for (const w of included) parts.push(`${label} ${w.vltPercent}%`)
  }
  return parts.join(' · ')
}

// ---------------------------------------------------------------------------
// Email copy + rendering — mirrors src/lib/emailTemplates.ts.
// ---------------------------------------------------------------------------

/** Mirror of FinancingOffer in src/types.ts. */
interface EmailFinancingOffer {
  name: string
  applicationUrl: string
}

interface EmailContext {
  shopName: string
  shopPhone: string
  shopAddress: string
  shopReplyTo: string
  shopLogoUrl: string | null
  shopColor: string
  financingOffers: EmailFinancingOffer[]
  firstName: string
  vehicle: string | null
  options: EmailQuoteOption[]
  windowTints: EmailWindowTint[]
  showFullAddonTotal: boolean
  expirationDate: string | null
  publicUrl: string
  optOutUrl: string
}

const COPY: Record<TemplateType, { subject: (c: EmailContext) => string; intro: (c: EmailContext) => string; cta: string }> = {
  initial: {
    subject: (c) => (c.vehicle ? `Your ${c.vehicle} audio quote from ${c.shopName}` : `Your audio quote from ${c.shopName}`),
    intro: (c) =>
      `Thanks for stopping by ${c.shopName}. Here is the quote you asked for${c.vehicle ? ` on your ${c.vehicle}` : ''}. You can review the options and pricing at the link below.`,
    cta: 'View My Quote',
  },
  check_in: {
    subject: (c) => (c.vehicle ? `Any questions about your ${c.vehicle} quote?` : 'Any questions about your quote?'),
    intro: (c) =>
      `Just checking in on the quote we put together${c.vehicle ? ` for your ${c.vehicle}` : ' for you'}. If anything is unclear or you want to tweak the setup, reply to this email or give us a call — happy to help.`,
    cta: 'Review My Quote',
  },
  financing_option: {
    subject: (c) => `Options that fit your budget — ${c.shopName}`,
    intro: (c) =>
      `We know a full system is a real investment. If the price on your${c.vehicle ? ` ${c.vehicle}` : ''} quote is the holdup, we can talk financing or put together a lower-cost package that still sounds great. The quote link below has the current options.`,
    cta: 'See My Options',
  },
  payday_reminder: {
    subject: (c) => `Ready when you are — ${c.shopName}`,
    intro: (c) =>
      `You asked us to follow up in a bit${c.vehicle ? ` about your ${c.vehicle}` : ''}. Your quote is still ready to go — take a look when the timing works and we can get you on the schedule.`,
    cta: 'View My Quote',
  },
  final_check_in: {
    subject: (c) => (c.vehicle ? `Last note about your ${c.vehicle} quote` : 'Last note about your quote'),
    intro: (c) =>
      `This is our last note about ${c.vehicle ? `the quote for your ${c.vehicle}` : 'your quote'} — we won't keep filling your inbox. If you'd still like to get it done, the quote is at the link below and we'd love to have you in.`,
    cta: 'View My Quote',
  },
}

/**
 * Mirror of formatItemDisplayName in src/lib/productNaming.ts (Deno cannot
 * import from src/). The canonical customer-facing name is
 * "Brand Model — Descriptor"; keeping the two in sync is what stops the same
 * product reading differently in the app and in the email a customer receives.
 *
 * The brand-casing map is deliberately NOT duplicated here — brands are
 * canonicalized on write (when the item is saved), so by the time a quote item
 * reaches this function its brand is already stored in canonical form.
 */
function formatItemDisplayName(item: { brand?: string | null; model?: string | null; name?: string | null }): string {
  const brand = item.brand?.trim() || ''
  let model = item.model?.trim().replace(/\s+/g, ' ') || ''
  if (brand && model.toLowerCase().startsWith(`${brand.toLowerCase()} `)) {
    model = model.slice(brand.length).trim()
  }
  const identity = [brand, model].filter(Boolean).join(' ')
  let descriptor = item.name?.trim().replace(/\s+/g, ' ') || ''
  for (const prefix of [brand, model]) {
    if (!prefix) continue
    const lower = descriptor.toLowerCase()
    if (lower.startsWith(`${prefix.toLowerCase()} `)) {
      descriptor = descriptor.slice(prefix.length).replace(/^\s*[-–—]?\s*/, '').trim()
    }
  }
  if (identity && descriptor) return `${identity} — ${descriptor}`
  if (identity) return identity
  return descriptor || 'Item'
}

function itemRowsHtml(items: EmailQuoteItem[]): string {
  if (items.length === 0) return ''
  return items
    .map((item) => {
      const label = `${item.quantity > 1 ? `${item.quantity}× ` : ''}${formatItemDisplayName(item)}`
      const img = item.imageUrl
        ? `<img src="${escapeHtml(item.imageUrl)}" width="36" height="36" alt="" style="display:block;width:36px;height:36px;border-radius:8px;object-fit:contain;background:#f4f4f5;" />`
        : `<div style="width:36px;height:36px;border-radius:8px;background:#f4f4f5;"></div>`
      return (
        `<tr>` +
        `<td style="padding:4px 10px 4px 0;vertical-align:middle;">${img}</td>` +
        `<td style="padding:4px 0;vertical-align:middle;font-size:14px;color:#3f3f46;">${escapeHtml(label)}</td>` +
        `</tr>`
      )
    })
    .join('')
}

function packageSummaryHtml(c: EmailContext, color: string): string {
  const main = mainOption(c.options)
  if (!main) return ''
  const addons = addonOptions(c.options)
  const breakdown = computeAddonBreakdown(c.options)

  const mainItemsTable =
    main.items.length > 0
      ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:8px 0 0;">${itemRowsHtml(main.items)}</table>`
      : ''

  const addonLines =
    addons.length > 0
      ? `<div style="margin:16px 0 0;padding-top:12px;border-top:1px solid #e4e4e7;">` +
        `<p style="margin:0 0 6px;font-size:12px;font-weight:700;letter-spacing:.03em;color:#71717a;text-transform:uppercase;">Optional add-ons</p>` +
        breakdown
          .map(
            (b) =>
              `<p style="margin:0 0 4px;font-size:14px;color:#3f3f46;">${escapeHtml(b.option.name.trim() || 'Add-on')} — <strong style="color:#18181b;">+${formatCurrency(b.addonPriceCents)}</strong> <span style="color:#a1a1aa;">(total ${formatCurrency(b.totalWithAddonCents)})</span></p>`,
          )
          .join('') +
        (c.showFullAddonTotal
          ? `<p style="margin:8px 0 0;font-size:14px;font-weight:700;color:${color};">Everything included: ${formatCurrency(fullTotalCents(c.options))}</p>`
          : '') +
        `</div>`
      : ''

  return (
    `<div style="margin:0 0 20px;padding:16px;background:#fafafa;border-radius:12px;">` +
    `<p style="margin:0;font-size:16px;font-weight:700;color:#18181b;">${escapeHtml(main.name.trim() || 'Complete system')}</p>` +
    mainItemsTable +
    addonLines +
    `</div>`
  )
}

function tintSummaryHtml(windowTints: EmailWindowTint[]): string {
  if (windowTints.length === 0) return ''
  const shown = windowTints.slice(0, 2)
  const blocks = shown
    .map((tint) => {
      const name = tint.name.trim() || 'Tint option'
      const uniform = tintUniformPercent(tint.windows)
      const coverage = uniform !== null ? `All windows at ${uniform}%` : tintCoverageLine(tint.windows)
      const extras = [
        tint.windshieldIncluded && tint.windshieldVltPercent !== null ? `windshield ${tint.windshieldVltPercent}%` : null,
        tint.sunroofIncluded && tint.sunroofVltPercent !== null ? `sunroof ${tint.sunroofVltPercent}%` : null,
        tint.removeOldTint ? 'old tint removed' : null,
      ].filter((x): x is string => x !== null)
      return (
        `<p style="margin:0 0 6px;font-size:14px;color:#3f3f46;">` +
        `<strong style="color:#18181b;">${escapeHtml(name)}</strong> — ${tint.tintType === 'ceramic' ? 'Ceramic' : 'Normal'} film` +
        (coverage ? `<br /><span style="color:#71717a;">${escapeHtml(coverage)}</span>` : '') +
        (extras.length > 0 ? `<br /><span style="color:#a1a1aa;">Plus ${escapeHtml(extras.join(', '))}</span>` : '') +
        `</p>`
      )
    })
    .join('')
  return (
    `<div style="margin:0 0 20px;padding:16px;background:#fafafa;border-radius:12px;">` +
    `<p style="margin:0 0 8px;font-size:12px;font-weight:700;letter-spacing:.03em;color:#71717a;text-transform:uppercase;">Window tint</p>` +
    blocks +
    (windowTints.length > shown.length
      ? `<p style="margin:6px 0 0;font-size:12px;color:#a1a1aa;">+${windowTints.length - shown.length} more — see your full quote</p>`
      : '') +
    `</div>`
  )
}

/**
 * Duplicated from src/lib/financing.ts — Deno Edge Functions cannot import
 * from src/. Keep the two in sync: this is the copy that decides what a real
 * customer actually receives.
 *
 * Sanitizing here rather than trusting the column matters for one reason: the
 * value ends up in an href. A row carrying `javascript:` must never survive
 * this function.
 */
function sanitizeFinancingOffers(value: unknown): EmailFinancingOffer[] {
  if (!Array.isArray(value)) return []
  const offers: EmailFinancingOffer[] = []
  for (const entry of value) {
    if (!entry || typeof entry !== 'object') continue
    const row = entry as Record<string, unknown>
    const name = typeof row.name === 'string' ? row.name.trim() : ''
    const rawUrl = typeof row.applicationUrl === 'string' ? row.applicationUrl.trim() : ''
    if (!name || !rawUrl) continue
    let parsed: URL
    try {
      parsed = new URL(/^[a-z][a-z0-9+.-]*:/i.test(rawUrl) ? rawUrl : `https://${rawUrl}`)
    } catch {
      continue
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') continue
    if (!parsed.hostname || !parsed.hostname.includes('.')) continue
    offers.push({ name, applicationUrl: parsed.toString() })
    if (offers.length >= 6) break
  }
  return offers
}

/** Mirror of financingHtml in src/lib/emailTemplates.ts. */
function financingHtml(offers: EmailFinancingOffer[], color: string): string {
  if (offers.length === 0) return ''
  const rows = offers
    .map(
      (offer) =>
        `<a href="${escapeHtml(offer.applicationUrl)}" style="display:block;margin:0 0 8px;padding:12px 16px;background:#ffffff;border:1px solid ${color};border-radius:10px;color:${color};text-decoration:none;font-weight:700;font-size:15px;text-align:center;">Apply with ${escapeHtml(offer.name)}</a>`,
    )
    .join('')
  return (
    `<div style="margin:0 0 24px;padding:16px;background:#f4f4f5;border-radius:10px;">` +
    `<p style="margin:0 0 12px;font-size:15px;font-weight:700;color:#18181b;">Need to split this up? We offer financing.</p>` +
    rows +
    `<p style="margin:8px 0 0;font-size:13px;color:#71717a;">Applying takes a few minutes and most decisions are instant.</p>` +
    `</div>`
  )
}

/** Mirror of financingText in src/lib/emailTemplates.ts. */
function financingText(offers: EmailFinancingOffer[]): string {
  if (offers.length === 0) return ''
  return ['', 'Need to split this up? We offer financing:', ...offers.map((o) => `- ${o.name}: ${o.applicationUrl}`)].join('\n')
}

function renderEmail(template: TemplateType, c: EmailContext): { subject: string; html: string; text: string } {
  const copy = COPY[template]
  const subject = copy.subject(c)
  const intro = copy.intro(c)
  const expiration = c.expirationDate ? `This quote is good through ${formatDate(c.expirationDate)}.` : ''
  const main = mainOption(c.options)
  const value = main?.priceCents ?? 0
  const valueLine =
    value > 0
      ? c.vehicle
        ? `Quoted from ${formatCurrency(value)} for your ${c.vehicle}.`
        : `Quoted from ${formatCurrency(value)}.`
      : ''
  const showFullSummary = template === 'initial' && c.options.length > 0

  const text = [
    `Hi ${c.firstName || 'there'},`,
    '',
    intro,
    '',
    `${copy.cta}: ${c.publicUrl}`,
    valueLine,
    financingText(c.financingOffers),
    showFullSummary && c.windowTints.length > 0 ? 'Includes window tint — see your quote for the diagram and details.' : '',
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
      <p style="margin:0 0 16px;">Hi ${escapeHtml(c.firstName || 'there')},</p>
      <p style="margin:0 0 20px;">${escapeHtml(intro)}</p>
      ${showFullSummary ? packageSummaryHtml(c, color) : ''}
      ${
        value > 0
          ? `<p style="margin:0 0 20px;color:#52525b;">${c.vehicle ? `Your ${escapeHtml(c.vehicle)} &middot; ` : ''}quoted from <strong style="color:#18181b;">${formatCurrency(value)}</strong></p>`
          : ''
      }
      ${showFullSummary ? tintSummaryHtml(c.windowTints) : ''}
      <p style="margin:0 0 24px;text-align:center;">
        <a href="${escapeHtml(c.publicUrl)}" style="display:inline-block;background:${color};color:#ffffff;text-decoration:none;font-weight:700;font-size:17px;padding:14px 32px;border-radius:10px;">${copy.cta}</a>
      </p>
      ${financingHtml(c.financingOffers, color)}
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

  // Two ways in.
  //
  // 1. A signed-in staff member pressing Send (the original path). Their user
  //    id is recorded on the email and the timeline event.
  // 2. The scheduled follow-up sender (send-quote-followups), which has no
  //    human behind it and authenticates with CRON_SECRET instead. Sends are
  //    then recorded with a null actor and an `automatic: true` marker, so the
  //    timeline never implies a person pressed the button.
  //
  // The membership check below is skipped for (2) — there is no user to check
  // — but every other guard (shop active, customer permission, opt-out, quote
  // status) still runs exactly the same, which is the point of routing
  // automated sends through this function rather than duplicating it.
  const cronSecret = Deno.env.get('CRON_SECRET')
  const providedCronSecret = req.headers.get('X-Cron-Secret')
  const isSystemSend = Boolean(cronSecret && providedCronSecret && providedCronSecret === cronSecret)

  let user: { id: string } | null = null
  if (!isSystemSend) {
    // Client bound to the caller's JWT — used only to identify the user.
    const authHeader = req.headers.get('Authorization') ?? ''
    const userClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } },
    )
    const {
      data: { user: authedUser },
    } = await userClient.auth.getUser()
    if (!authedUser) {
      return fail(401, 'You must be signed in to send emails.')
    }
    user = authedUser
  }

  // Service-role client for reads/writes after we verify membership ourselves.
  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )

  const { data: quote } = await admin
    .from('quotes')
    .select('*, customers(*), shops(*), quote_options(id, option_kind, name, description, price_cents, labor_included, position, quote_items(brand, model, name, quantity, image_url, position))')
    .eq('id', quoteId)
    .maybeSingle()
  if (!quote) {
    return fail(404, 'Quote not found.')
  }

  // The caller must be a member of the quote's shop. Skipped for a system
  // send, which has no user — the scheduler already scoped its candidates to
  // shops with automation enabled.
  if (user) {
    const { data: membership } = await admin
      .from('shop_memberships')
      .select('id')
      .eq('shop_id', quote.shop_id)
      .eq('user_id', user.id)
      .maybeSingle()
    if (!membership) {
      return fail(403, 'You are not a member of this shop.')
    }
  }

  const customer = quote.customers
  const shop = quote.shops

  if (shop && shop.active === false) {
    return fail(403, "This shop's access has been suspended.")
  }

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

  interface OptionRow {
    id: string
    option_kind: OptionKind
    name: string
    description: string | null
    price_cents: number
    labor_included: boolean
    position: number
    quote_items: Array<{ brand: string | null; model: string | null; name: string; quantity: number; image_url: string | null; position: number }>
  }
  const rawOptions = ((quote.quote_options ?? []) as OptionRow[]).slice().sort((a, b) => a.position - b.position)
  const options: EmailQuoteOption[] = rawOptions.map((o) => ({
    id: o.id,
    optionKind: o.option_kind,
    name: o.name,
    description: o.description ?? '',
    priceCents: o.price_cents,
    laborIncluded: o.labor_included,
    items: (o.quote_items ?? [])
      .slice()
      .sort((a, b) => a.position - b.position)
      .map((i) => ({ brand: i.brand, model: i.model, name: i.name, quantity: i.quantity, imageUrl: i.image_url })),
  }))
  const windowTints: EmailWindowTint[] = Array.isArray(quote.window_tints)
    ? quote.window_tints.map((t: Record<string, unknown>) => ({
        name: (t.name as string) ?? '',
        bodyStyle: t.bodyStyle as TintBodyStyle,
        windows: (t.windows as EmailTintWindow[]) ?? [],
        tintType: (t.tintType as 'normal' | 'ceramic') ?? 'normal',
        windshieldIncluded: Boolean(t.windshieldIncluded),
        windshieldVltPercent: (t.windshieldVltPercent as number | null) ?? null,
        sunroofIncluded: Boolean(t.sunroofIncluded),
        sunroofVltPercent: (t.sunroofVltPercent as number | null) ?? null,
        removeOldTint: Boolean(t.removeOldTint),
      }))
    : []
  const vehicle =
    customer.vehicle_year && customer.vehicle_make && customer.vehicle_model
      ? `${customer.vehicle_year} ${customer.vehicle_make} ${customer.vehicle_model}`
      : null

  // The subject line never depends on the quote link itself (see COPY
  // above), so it can be computed before the email_messages row exists.
  const subject = COPY[template].subject({ shopName: shop.name, vehicle } as EmailContext)

  // Record the attempt first (this is also where delivery_token comes
  // from -- one real, distinct token per send, embedded in the actual
  // link below) so failures are visible in the app either way.
  const { data: emailRow } = await admin
    .from('email_messages')
    .insert({
      shop_id: quote.shop_id,
      quote_id: quoteId,
      recipient_email: customer.email,
      template_type: template,
      subject,
      status: 'sending',
      sent_by: user?.id ?? null,
    })
    .select('id, delivery_token')
    .single()

  // The link that actually goes out in the email carries this send's own
  // delivery_token -- this is what lets record_quote_delivery_view tell a
  // real customer open apart from staff's bare-token "Open quote"/"Copy
  // link" (which never has one). If the insert somehow failed to return a
  // token (should never happen -- the column has a DB default), fall back
  // to the bare link rather than blocking the send entirely; that send
  // just won't be view-trackable, which is a smaller problem than not
  // sending it.
  const publicUrl = emailRow?.delivery_token
    ? `${appUrl}/q/${quote.public_token}?d=${emailRow.delivery_token}`
    : `${appUrl}/q/${quote.public_token}`

  const rendered = renderEmail(template, {
    shopName: shop.name,
    shopPhone: shop.phone,
    shopAddress: shop.address,
    shopReplyTo: shop.reply_to_email || shop.email,
    shopLogoUrl: shop.logo_url,
    shopColor: shop.primary_color,
    financingOffers: sanitizeFinancingOffers(shop.financing_offers),
    firstName: customer.first_name,
    vehicle,
    options,
    windowTints,
    showFullAddonTotal: Boolean(quote.show_full_addon_total),
    expirationDate: quote.expiration_date,
    publicUrl,
    optOutUrl: `${appUrl}/q/${quote.public_token}?stop=1`,
  })

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
      metadata: { templateType: template, automatic: isSystemSend },
      created_by: user?.id ?? null,
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
    metadata: { templateType: template, automatic: isSystemSend },
    created_by: user?.id ?? null,
  })

  // Safe response: no provider IDs, no internals.
  return json(200, { ok: true, message: 'Email accepted by the email provider.' })
})
