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

// MIRROR-BEGIN emailLayout — keep byte-identical with supabase/functions/send-quote-email/index.ts
/** Everything the layout needs, as primitives. Strings arrive RAW and are escaped here. */
interface EmailView {
  shopName: string
  shopLogoUrl: string | null
  /** The shop's own brand colour. Drives every accent; never overridden by app chrome. */
  shopColor: string
  shopPhone: string
  shopAddress: string
  /** First name only. The customer's surname and number never appear in an email. */
  firstName: string
  vehicle: string | null
  publicUrl: string
  optOutUrl: string
  preheader: string
  intro: string
  cta: string
  packageName: string
  priceCents: number
  /** The one big photo at the top. Null falls back to a typographic hero. */
  heroImageUrl: string | null
  items: { label: string; imageUrl: string | null }[]
  addons: { name: string; addonPriceCents: number; totalWithAddonCents: number }[]
  fullTotalCents: number | null
  tints: { name: string; typeLabel: string; coverage: string; extras: string; totalCents: number }[]
  moreTints: number
  financing: { name: string; url: string }[]
  expiration: string
  /** The gallery, add-ons and tint detail ride on the first email only. */
  showFullSummary: boolean
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function money(cents: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: cents % 100 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(cents / 100)
}

/** Opens a full-width row inside the 600px card. */
function row(inner: string, padding: string, background: string): string {
  return `<tr><td style="padding:${padding};background:${background};">${inner}</td></tr>`
}

/**
 * The inbox preview line — the text a client shows next to the subject.
 *
 * Padded with sixty zero-width non-joiners so the client stops before it
 * starts reading the greeting. Without the padding, every email previews as
 * "Hi Marcus, Thanks for stopping by" and four follow-ups look identical in
 * the list.
 */
function preheader(text: string): string {
  return (
    `<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;font-size:1px;line-height:1px;color:#ffffff;opacity:0;">` +
    `${esc(text)}${'&zwnj;&nbsp;'.repeat(60)}` +
    `</div>`
  )
}

/**
 * The hero. A large product photo when the quote has one, and a typographic
 * panel when it does not.
 *
 * Capped at 420px wide inside a 600px band rather than bled to the edges,
 * because catalog photography is whatever the manufacturer shot — a tall
 * enclosure and a wide amplifier both have to look deliberate here, and only
 * a fixed frame does that. `max-height` is ignored by Outlook, which is
 * acceptable: it degrades to a big picture, not a broken one.
 */
function heroHtml(v: EmailView): string {
  if (v.heroImageUrl) {
    // alt="" and a grey ground on the <img> itself, not a caption. Most
    // clients block remote images until the reader allows them, so this band
    // is first seen empty — and an empty band has to look like a deliberate
    // grey panel, never like a broken-image icon with a product name spilling
    // out beside it. The fixed-height cell keeps the layout from jumping when
    // the pictures finally load.
    return row(
      `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse:collapse;">` +
        `<tr><td align="center" height="220" style="height:220px;padding:0;">` +
        `<img src="${esc(v.heroImageUrl)}" alt="" width="400" height="220" ` +
        `style="display:block;width:100%;max-width:400px;height:220px;object-fit:contain;margin:0 auto;border:0;outline:none;background:#e9e9ec;" />` +
        `</td></tr></table>`,
      '26px 24px',
      '#f4f4f5',
    )
  }
  const line = v.vehicle ? `Built for your ${v.vehicle}` : 'Built for you'
  return row(
    `<p style="margin:0;font-size:22px;line-height:1.25;font-weight:800;letter-spacing:-0.01em;color:#0b0b0c;text-align:center;">${esc(line)}</p>`,
    '32px 24px',
    '#f4f4f5',
  )
}

/**
 * The price, as the loudest thing in the email.
 *
 * It used to be a grey sentence in the middle of a paragraph — "quoted from
 * $3,199" — which is where a number goes when you are apologising for it. A
 * shop that has done the work should say the number plainly. Near-black panel
 * so it reads as a plate on a piece of equipment rather than a web callout,
 * and so it survives a client that inverts colours for dark mode.
 */
function priceHtml(v: EmailView): string {
  if (v.priceCents <= 0) return ''
  const label = v.packageName.trim() || 'Your build'
  const sub = v.vehicle ? `for your ${v.vehicle}` : 'for you'
  return row(
    `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse:collapse;">` +
      `<tr><td style="padding:20px 24px;background:#0b0b0c;border-radius:14px;">` +
      `<p style="margin:0 0 4px;font-size:12px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:${esc(v.shopColor)};">${esc(label)}</p>` +
      `<p style="margin:0;font-size:38px;line-height:1.1;font-weight:800;letter-spacing:-0.02em;color:#ffffff;">${money(v.priceCents)}</p>` +
      `<p style="margin:6px 0 0;font-size:14px;color:#a1a1aa;">${esc(sub)}</p>` +
      `</td></tr></table>`,
    '20px 24px 4px',
    '#ffffff',
  )
}

/**
 * The call to action.
 *
 * One button, full width, 56px of height. There is no competing link above
 * it, and the caption underneath says what happens next rather than repeating
 * the button. A phone number sits below as the second option for the customer
 * who would always rather call than tap.
 */
function ctaHtml(v: EmailView): string {
  return row(
    `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse:collapse;">` +
      `<tr><td align="center" bgcolor="${esc(v.shopColor)}" style="background:${esc(v.shopColor)};border-radius:12px;">` +
      `<a href="${esc(v.publicUrl)}" style="display:block;padding:18px 24px;font-size:18px;font-weight:800;letter-spacing:-0.01em;color:#ffffff;text-decoration:none;">${esc(v.cta)}</a>` +
      `</td></tr></table>` +
      `<p style="margin:12px 0 0;font-size:14px;line-height:1.5;color:#71717a;text-align:center;">` +
      `Everything is on one page — pick your options and reply right there.</p>` +
      `<p style="margin:10px 0 0;font-size:15px;text-align:center;color:#3f3f46;">` +
      `Or call <a href="tel:${esc(v.shopPhone)}" style="color:${esc(v.shopColor)};font-weight:700;text-decoration:none;">${esc(v.shopPhone)}</a></p>`,
    '16px 24px 24px',
    '#ffffff',
  )
}

/**
 * "What's in it" — the products, at a size a person can actually see.
 *
 * Two across, 240px wide. These were 36px thumbnails, which is a favicon: it
 * proves a photo exists without showing anyone anything. A customer who paid
 * for a Kicker CompR should see the Kicker CompR. Each tile keeps its grey
 * ground when the image is blocked, so a two-column grid of empty boxes still
 * reads as a layout.
 */
function galleryHtml(v: EmailView): string {
  if (v.items.length === 0) return ''
  const tile = (item: EmailView['items'][number]): string =>
    `<td width="50%" valign="top" style="padding:6px;vertical-align:top;">` +
    `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse:collapse;background:#fafafa;border:1px solid #e4e4e7;border-radius:12px;">` +
    // Fixed 140px picture cell whether or not there is a picture. Tiles sit
    // two across, and a row whose cells disagree about their height reads as
    // a broken grid — which is what happens the moment one product has no
    // photo, or the reader has images turned off.
    `<tr><td align="center" height="140" style="height:140px;padding:14px 10px 6px;">` +
    (item.imageUrl
      ? `<img src="${esc(item.imageUrl)}" alt="" width="190" height="140" style="display:block;width:100%;max-width:190px;height:140px;object-fit:contain;border:0;background:#fafafa;" />`
      : `<div style="height:140px;line-height:140px;font-size:13px;color:#c4c4c8;">No photo yet</div>`) +
    `</td></tr>` +
    `<tr><td style="padding:0 12px 14px;font-size:14px;line-height:1.4;font-weight:600;color:#27272a;text-align:center;">${esc(item.label)}</td></tr>` +
    `</table></td>`

  const rows: string[] = []
  for (let i = 0; i < v.items.length; i += 2) {
    const pair = v.items.slice(i, i + 2)
    rows.push(`<tr>${pair.map(tile).join('')}${pair.length === 1 ? '<td width="50%"></td>' : ''}</tr>`)
  }
  return row(
    `<p style="margin:0 0 10px;font-size:12px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:#71717a;">What&rsquo;s in it</p>` +
      `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse:collapse;margin:0 -6px;">${rows.join('')}</table>`,
    '8px 18px 4px',
    '#ffffff',
  )
}

/** Add-ons priced as increments on the main package, never as rival totals. */
function addonsHtml(v: EmailView): string {
  if (v.addons.length === 0) return ''
  const lines = v.addons
    .map(
      (a) =>
        `<tr>` +
        `<td style="padding:9px 0;border-top:1px solid #e4e4e7;font-size:15px;color:#3f3f46;">${esc(a.name.trim() || 'Add-on')}` +
        `<br /><span style="font-size:13px;color:#a1a1aa;">Brings it to ${money(a.totalWithAddonCents)}</span></td>` +
        `<td align="right" style="padding:9px 0;border-top:1px solid #e4e4e7;font-size:16px;font-weight:800;color:#0b0b0c;white-space:nowrap;">+${money(a.addonPriceCents)}</td>` +
        `</tr>`,
    )
    .join('')
  const full =
    v.fullTotalCents !== null
      ? `<p style="margin:12px 0 0;font-size:15px;font-weight:700;color:${esc(v.shopColor)};">Everything included: ${money(v.fullTotalCents)}</p>`
      : ''
  return row(
    `<p style="margin:0 0 4px;font-size:12px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:#71717a;">Want to go further?</p>` +
      `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse:collapse;">${lines}</table>` +
      full,
    '16px 24px 4px',
    '#ffffff',
  )
}

/** Window tint written out in words — which glass, at what percentage. */
function tintHtml(v: EmailView): string {
  if (v.tints.length === 0) return ''
  const blocks = v.tints
    .map(
      (t) =>
        `<p style="margin:0 0 10px;font-size:15px;line-height:1.5;color:#3f3f46;">` +
        `<strong style="color:#0b0b0c;">${esc(t.name)}</strong> &mdash; ${esc(t.typeLabel)} film` +
        (t.coverage ? `<br /><span style="color:#71717a;">${esc(t.coverage)}</span>` : '') +
        (t.extras ? `<br /><span style="color:#a1a1aa;">Plus ${esc(t.extras)}</span>` : '') +
        (t.totalCents > 0 ? ` <strong style="color:#0b0b0c;">${money(t.totalCents)}</strong>` : '') +
        `</p>`,
    )
    .join('')
  return row(
    `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse:collapse;background:#fafafa;border-radius:12px;">` +
      `<tr><td style="padding:16px 18px;">` +
      `<p style="margin:0 0 10px;font-size:12px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:#71717a;">Window tint</p>` +
      blocks +
      (v.moreTints > 0
        ? `<p style="margin:0;font-size:13px;color:#a1a1aa;">+${v.moreTints} more &mdash; see your full quote</p>`
        : '') +
      `</td></tr></table>`,
    '16px 24px 4px',
    '#ffffff',
  )
}

/**
 * Financing, placed after the price on purpose.
 *
 * The moment a number lands is the moment "can I split this up?" occurs to
 * someone, and it is already one of the most common replies on a public
 * quote. Every URL here has been sanitized upstream and is escaped again on
 * the way into the href, because this function is the last thing between
 * stored data and a real inbox.
 */
function financingHtml(v: EmailView): string {
  if (v.financing.length === 0) return ''
  const rows = v.financing
    .map(
      (o) =>
        `<tr><td align="center" style="padding:0 0 8px;">` +
        `<a href="${esc(o.url)}" style="display:block;padding:14px 18px;background:#ffffff;border:2px solid ${esc(v.shopColor)};border-radius:11px;color:${esc(v.shopColor)};text-decoration:none;font-weight:700;font-size:15px;">Apply with ${esc(o.name)}</a>` +
        `</td></tr>`,
    )
    .join('')
  return row(
    `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse:collapse;background:#f4f4f5;border-radius:12px;">` +
      `<tr><td style="padding:18px;">` +
      `<p style="margin:0 0 4px;font-size:17px;font-weight:800;color:#0b0b0c;">Don&rsquo;t want to pay it all at once?</p>` +
      `<p style="margin:0 0 14px;font-size:14px;color:#71717a;">Applying takes a few minutes and most decisions come back right away.</p>` +
      `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse:collapse;">${rows}</table>` +
      `</td></tr></table>`,
    '16px 24px 8px',
    '#ffffff',
  )
}

/**
 * The whole email.
 *
 * A complete document rather than a bare <div>, which is what unlocks the
 * <head>: a viewport tag, a colour-scheme declaration so a dark-mode client
 * stops inverting the palette by guesswork, and the media query that turns
 * the two-across gallery into one column on a phone. None of it is load
 * bearing — every rule has an inline equivalent or degrades to the desktop
 * layout — but on the clients that honour it, the difference is the whole
 * impression.
 */
function renderEmailHtml(v: EmailView): string {
  const color = v.shopColor || '#1d4ed8'
  const view: EmailView = { ...v, shopColor: color }
  const header =
    `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse:collapse;">` +
    `<tr>` +
    `<td style="vertical-align:middle;">` +
    (view.shopLogoUrl
      ? `<img src="${esc(view.shopLogoUrl)}" alt="${esc(view.shopName)}" style="display:block;max-height:44px;max-width:210px;border:0;" />`
      : `<span style="font-size:19px;font-weight:800;letter-spacing:-0.01em;color:#0b0b0c;">${esc(view.shopName)}</span>`) +
    `</td>` +
    `<td align="right" style="vertical-align:middle;font-size:11px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:#a1a1aa;">Your quote</td>` +
    `</tr></table>`

  const body =
    `<p style="margin:0 0 14px;font-size:20px;font-weight:800;letter-spacing:-0.01em;color:#0b0b0c;">Hi ${esc(view.firstName || 'there')},</p>` +
    `<p style="margin:0;font-size:16px;line-height:1.6;color:#3f3f46;">${esc(view.intro)}</p>`

  const closing =
    (view.expiration
      ? `<p style="margin:0 0 12px;font-size:14px;color:#71717a;">${esc(view.expiration)}</p>`
      : '') +
    `<p style="margin:0;font-size:15px;line-height:1.6;color:#3f3f46;">Reply to this email and it comes straight to us.</p>`

  const footer =
    `<p style="margin:0 0 2px;font-size:14px;font-weight:700;color:#3f3f46;">${esc(view.shopName)}</p>` +
    `<p style="margin:0 0 2px;font-size:13px;color:#71717a;">${esc(view.shopAddress)}</p>` +
    `<p style="margin:0 0 10px;font-size:13px;color:#71717a;">${esc(view.shopPhone)}</p>` +
    `<p style="margin:0;font-size:12px;line-height:1.6;color:#a1a1aa;">` +
    `You got this because you asked ${esc(view.shopName)} for a quote. ` +
    `<a href="${esc(view.optOutUrl)}" style="color:#a1a1aa;text-decoration:underline;">Stop follow-up emails</a></p>`

  const rows = [
    row(header, '20px 24px 18px', '#ffffff'),
    `<tr><td style="padding:0;height:3px;line-height:3px;font-size:0;background:${esc(color)};">&nbsp;</td></tr>`,
    heroHtml(view),
    row(body, '24px 24px 4px', '#ffffff'),
    priceHtml(view),
    ctaHtml(view),
    view.showFullSummary ? galleryHtml(view) : '',
    view.showFullSummary ? addonsHtml(view) : '',
    view.showFullSummary ? tintHtml(view) : '',
    financingHtml(view),
    row(closing, '12px 24px 24px', '#ffffff'),
    row(footer, '20px 24px', '#fafafa'),
  ].join('')

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<meta name="color-scheme" content="light" />
<meta name="supported-color-schemes" content="light" />
<title>${esc(view.shopName)}</title>
<style>
  body { margin:0; padding:0; width:100% !important; -webkit-text-size-adjust:100%; }
  img { -ms-interpolation-mode:bicubic; }
  a { text-decoration:none; }
  @media only screen and (max-width:620px) {
    /* The gallery deliberately stays two across on a phone: at 390px the
       tiles are still 170px wide, which is a product you can see, and one
       column would push the add-ons below three screens of scrolling. */
    .og-shell { padding:12px 8px !important; }
  }
</style>
</head>
<body style="margin:0;padding:0;background:#e9e9ec;">
${preheader(view.preheader)}
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse:collapse;background:#e9e9ec;">
<tr><td class="og-shell" align="center" style="padding:28px 12px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600" style="border-collapse:collapse;width:100%;max-width:600px;background:#ffffff;border-radius:16px;overflow:hidden;">
${rows}
</table>
</td></tr>
</table>
</body>
</html>`
}
// MIRROR-END emailLayout

/**
 * View-model builders. These are NOT mirrored: each side reads its own data
 * shape, and that is exactly why the layout above could be made identical.
 * Mirror of pickHeroImage / tintViews in src/lib/emailTemplates.ts.
 */
function pickHeroImage(options: EmailQuoteOption[]): string | null {
  const main = mainOption(options)
  const fromMain = main?.items.find((i) => i.imageUrl)?.imageUrl
  if (fromMain) return fromMain
  for (const option of options) {
    const found = option.items.find((i) => i.imageUrl)?.imageUrl
    if (found) return found
  }
  return null
}

function tintViews(windowTints: EmailWindowTint[]): EmailView['tints'] {
  return windowTints.slice(0, 2).map((tint) => {
    const uniform = tintUniformPercent(tint.windows)
    return {
      name: tint.name.trim() || 'Tint option',
      typeLabel: tint.tintType === 'ceramic' ? 'Ceramic' : 'Normal',
      coverage: uniform !== null ? `All windows at ${uniform}%` : tintCoverageLine(tint.windows),
      extras: [
        tint.windshieldIncluded && tint.windshieldVltPercent !== null ? `windshield ${tint.windshieldVltPercent}%` : null,
        tint.sunroofIncluded && tint.sunroofVltPercent !== null ? `sunroof ${tint.sunroofVltPercent}%` : null,
        tint.removeOldTint ? 'old tint removed' : null,
      ].filter((x): x is string => x !== null).join(', '),
      // The server payload carries no per-tint total; the app's copy fills it
      // in from summarizeWindowTint. Zero means "do not print a price here",
      // which is the honest default when the number is not in the payload.
      totalCents: 0,
    }
  })
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

/** Mirror of financingText in src/lib/emailTemplates.ts. */
function financingText(offers: EmailFinancingOffer[]): string {
  if (offers.length === 0) return ''
  return ['', 'Need to split this up? We offer financing:', ...offers.map((o) => `- ${o.name}: ${o.applicationUrl}`)].join('\n')
}

/**
 * Mirror of src/lib/quoteFlavor.ts (Deno cannot import from src/). A tint
 * customer should not get a subject about bass, and four follow-ups that all
 * lead with the same words read as spam. Update both together — this is the
 * copy real customers receive.
 */
type QuoteFlavor = 'tint' | 'audio' | 'mixed'

function detectQuoteFlavor(windowTints: unknown[], options: EmailQuoteOption[]): QuoteFlavor {
  const hasTint = windowTints.length > 0
  const hasProducts = options.some((o) => o.items.length > 0)
  if (hasTint && hasProducts) return 'mixed'
  if (hasTint) return 'tint'
  return 'audio'
}

const FLAVOR_COPY: Record<QuoteFlavor, Record<TemplateType, (c: { shopName: string; vehicle: string | null }) => { subject: string; preheader: string }>> = {
  audio: {
    initial: (c) => ({
      subject: c.vehicle ? `Ready for some bass in the ${c.vehicle}?` : 'Ready for some bass?',
      preheader: `Your quote from ${c.shopName} is ready — tap to see the build and the price.`,
    }),
    check_in: (c) => ({
      subject: c.vehicle ? `Still thinking about the ${c.vehicle} build?` : 'Still thinking about your build?',
      preheader: 'Any questions on the gear or the install? Just reply — we answer fast.',
    }),
    financing_option: () => ({
      subject: 'Good sound now, pay over time',
      preheader: 'Financing takes a few minutes and most approvals come back instantly.',
    }),
    payday_reminder: (c) => ({
      subject: `Ready when you are — ${c.shopName}`,
      preheader: 'You asked us to check back. Your quote is still good and the schedule is open.',
    }),
    final_check_in: (c) => ({
      subject: c.vehicle ? `Last note about the ${c.vehicle}` : 'Last note about your quote',
      preheader: "We won't keep filling your inbox — but the quote is here whenever you want it.",
    }),
  },
  tint: {
    initial: (c) => ({
      subject: c.vehicle ? `Beat the heat — your ${c.vehicle} tint quote` : 'Beat the heat — your tint quote is ready',
      preheader: `${c.shopName} put your numbers together. Cooler, darker, done in a day.`,
    }),
    check_in: () => ({
      subject: 'Still want those windows done?',
      preheader: 'Any questions about the shades or the film? Reply and we\u2019ll sort it out.',
    }),
    financing_option: () => ({
      subject: 'Tint now, pay over time',
      preheader: 'Financing takes a few minutes and most approvals come back instantly.',
    }),
    payday_reminder: (c) => ({
      subject: `Ready when you are — ${c.shopName}`,
      preheader: 'You asked us to check back. Your tint quote is still good.',
    }),
    final_check_in: () => ({
      subject: 'Last note about your tint',
      preheader: "We won't keep filling your inbox — the quote is here whenever you want it.",
    }),
  },
  mixed: {
    initial: (c) => ({
      subject: c.vehicle ? `Your ${c.vehicle} is about to get good` : 'Your build is ready to go',
      preheader: `${c.shopName} put the whole thing together — sound and tint, one price.`,
    }),
    check_in: (c) => ({
      subject: c.vehicle ? `Still thinking about the ${c.vehicle}?` : 'Still thinking it over?',
      preheader: 'Questions on any part of it? Reply and we\u2019ll walk you through it.',
    }),
    financing_option: () => ({
      subject: 'Get it all done, pay over time',
      preheader: 'Financing takes a few minutes and most approvals come back instantly.',
    }),
    payday_reminder: (c) => ({
      subject: `Ready when you are — ${c.shopName}`,
      preheader: 'You asked us to check back. Your quote is still good and the schedule is open.',
    }),
    final_check_in: () => ({
      subject: 'Last note about your quote',
      preheader: "We won't keep filling your inbox — but it's here whenever you want it.",
    }),
  },
}


function renderEmail(template: TemplateType, c: EmailContext): { subject: string; html: string; text: string } {
  const copy = COPY[template]
  const flavor = detectQuoteFlavor(c.windowTints, c.options)
  const flavored = FLAVOR_COPY[flavor][template]({ shopName: c.shopName, vehicle: c.vehicle })
  const subject = flavored.subject
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

  const view: EmailView = {
    shopName: c.shopName,
    shopLogoUrl: c.shopLogoUrl,
    shopColor: c.shopColor || '#1d4ed8',
    shopPhone: c.shopPhone,
    shopAddress: c.shopAddress,
    firstName: c.firstName,
    vehicle: c.vehicle,
    publicUrl: c.publicUrl,
    optOutUrl: c.optOutUrl,
    preheader: flavored.preheader,
    intro,
    cta: copy.cta,
    packageName: main?.name ?? '',
    priceCents: value,
    heroImageUrl: pickHeroImage(c.options),
    items: showFullSummary
      ? (main?.items ?? []).map((item) => ({
        label: `${item.quantity > 1 ? `${item.quantity}× ` : ''}${formatItemDisplayName(item)}`,
        imageUrl: item.imageUrl ?? null,
      }))
      : [],
    addons: showFullSummary
      ? computeAddonBreakdown(c.options).map((b) => ({
        name: b.option.name,
        addonPriceCents: b.addonPriceCents,
        totalWithAddonCents: b.totalWithAddonCents,
      }))
      : [],
    fullTotalCents: showFullSummary && c.showFullAddonTotal ? fullTotalCents(c.options) : null,
    tints: showFullSummary ? tintViews(c.windowTints) : [],
    moreTints: showFullSummary ? Math.max(0, c.windowTints.length - 2) : 0,
    financing: sanitizeFinancingOffers(c.financingOffers).map((o) => ({ name: o.name, url: o.applicationUrl })),
    expiration,
    showFullSummary,
  }
  const html = renderEmailHtml(view)

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

  // The subject line never depends on the quote link itself, so it can be
  // computed before the email_messages row exists. It MUST be derived the same
  // way renderEmail derives it (flavor-aware) — otherwise the subject logged
  // in email_messages, and shown in the app's send history, silently disagrees
  // with the one the customer actually received.
  const subject = FLAVOR_COPY[detectQuoteFlavor(windowTints, options)][template]({
    shopName: shop.name,
    vehicle,
  }).subject

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
