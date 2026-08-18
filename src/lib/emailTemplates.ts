import type { Customer, FinancingOffer, Quote, QuoteOption, Shop, TemplateType } from '../types'
import { formatCurrency, formatDate, formatVehicle } from './format'
import { addonOptions, computeAddonBreakdown, fullTotalCents, mainOption } from './quotePricing'
import { summarizeWindowTint } from './windowTint'
import { sanitizeFinancingOffers } from './financing'
import { formatItemDisplayName } from './productNaming'

// All five manual email templates. Emails stay short and drive the customer to
// the public quote page — the full quote never rides inside the email.
// NOTE: supabase/functions/send-quote-email keeps a mirrored copy of this
// logic for server-side rendering. Update both together.

export interface RenderedEmail {
  subject: string
  html: string
  text: string
}

export interface EmailContext {
  shop: Shop
  customer: Customer
  quote: Quote
  options: QuoteOption[]
  publicUrl: string
  optOutUrl: string
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

interface TemplateCopy {
  subject: (ctx: EmailContext) => string
  intro: (ctx: EmailContext) => string
  cta: string
}

const COPY: Record<TemplateType, TemplateCopy> = {
  initial: {
    subject: (c) => {
      const v = formatVehicle(c.customer)
      return v ? `Your ${v} audio quote from ${c.shop.name}` : `Your audio quote from ${c.shop.name}`
    },
    intro: (c) => {
      const v = formatVehicle(c.customer)
      return `Thanks for stopping by ${c.shop.name}. Here is the quote you asked for${v ? ` on your ${v}` : ''}. You can review the options and pricing at the link below.`
    },
    cta: 'View My Quote',
  },
  check_in: {
    subject: (c) => {
      const v = formatVehicle(c.customer)
      return v ? `Any questions about your ${v} quote?` : 'Any questions about your quote?'
    },
    intro: (c) => {
      const v = formatVehicle(c.customer)
      return `Just checking in on the quote we put together${v ? ` for your ${v}` : ' for you'}. If anything is unclear or you want to tweak the setup, reply to this email or give us a call — happy to help.`
    },
    cta: 'Review My Quote',
  },
  financing_option: {
    subject: (c) => `Options that fit your budget — ${c.shop.name}`,
    intro: (c) => {
      const v = formatVehicle(c.customer)
      return `We know a full system is a real investment. If the price on your${v ? ` ${v}` : ''} quote is the holdup, we can talk financing or put together a lower-cost package that still sounds great. The quote link below has the current options.`
    },
    cta: 'See My Options',
  },
  payday_reminder: {
    subject: (c) => `Ready when you are — ${c.shop.name}`,
    intro: (c) => {
      const v = formatVehicle(c.customer)
      return `You asked us to follow up in a bit${v ? ` about your ${v}` : ''}. Your quote is still ready to go — take a look when the timing works and we can get you on the schedule.`
    },
    cta: 'View My Quote',
  },
  final_check_in: {
    subject: (c) => {
      const v = formatVehicle(c.customer)
      return v ? `Last note about your ${v} quote` : 'Last note about your quote'
    },
    intro: (c) => {
      const v = formatVehicle(c.customer)
      return `This is our last note about ${v ? `the quote for your ${v}` : 'your quote'} — we won't keep filling your inbox. If you'd still like to get it done, the quote is at the link below and we'd love to have you in.`
    },
    cta: 'View My Quote',
  },
}

/** One item row: a small product photo (when the line carries one) + name, deliberately no per-item price — the shop wants the customer to see pictures of what they're getting without a line-by-line breakdown, just the option total below. Table-based, not flex/grid, so it renders the same in Outlook as everywhere else. */
function itemRowsHtml(items: QuoteOption['items']): string {
  if (items.length === 0) return ''
  return items
    .map((item) => {
      // One canonical name everywhere — see src/lib/productNaming.ts.
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

/** "What's included" (main package items) + a compact add-on price list — the customer-facing summary this file was rewritten for: pictures of the products, one clear total, no itemized pricing. */
function packageSummaryHtml(ctx: EmailContext, color: string): string {
  const main = mainOption(ctx.options)
  if (!main) return ''
  const addons = addonOptions(ctx.options)
  const breakdown = computeAddonBreakdown(ctx.options)

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
        (ctx.quote.showFullAddonTotal
          ? `<p style="margin:8px 0 0;font-size:14px;font-weight:700;color:${color};">Everything included: ${formatCurrency(fullTotalCents(ctx.options))}</p>`
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

/**
 * A plain-text-styled summary of each tint entry — which glass is getting
 * film and at what %. Previously this embedded a car-diagram SVG per entry
 * as a base64 data: URI <img>; the diagrams are pulled pending a top-down
 * redesign, and a written breakdown is what the shop actually wants the
 * customer to read anyway. Only the first two entries ship; a long tail of
 * priced scenarios is what the public quote page is for.
 */
function tintSummaryHtml(windowTints: Quote['windowTints']): string {
  if (windowTints.length === 0) return ''
  const shown = windowTints.slice(0, 2)
  const blocks = shown
    .map((tint) => {
      const summary = summarizeWindowTint(tint)
      const coverage =
        summary.uniformPercent !== null
          ? `All windows at ${summary.uniformPercent}%`
          : summary.windowLines.length > 0
            ? summary.windowLines.map((w) => `${escapeHtml(w.label)} ${w.vltPercent}%`).join(' · ')
            : ''
      const extras = [
        summary.windshield ? `windshield ${summary.windshield.vltPercent}%` : null,
        summary.sunroof ? `sunroof ${summary.sunroof.vltPercent}%` : null,
        summary.removeOldTint ? 'old tint removed' : null,
      ].filter((x): x is string => x !== null)
      return (
        `<p style="margin:0 0 6px;font-size:14px;color:#3f3f46;">` +
        `<strong style="color:#18181b;">${escapeHtml(summary.name)}</strong> — ${escapeHtml(summary.tintTypeLabel)} film` +
        (coverage ? `<br /><span style="color:#71717a;">${coverage}</span>` : '') +
        (extras.length > 0 ? `<br /><span style="color:#a1a1aa;">Plus ${escapeHtml(extras.join(', '))}</span>` : '') +
        (summary.totalCents > 0 ? ` <strong style="color:#18181b;">${formatCurrency(summary.totalCents)}</strong>` : '') +
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
 * The shop's financing applications, rendered as tappable rows under the main
 * CTA. Placed *after* the price and the "See your quote" button on purpose:
 * sticker shock is exactly the moment financing becomes relevant, and "I need
 * financing" is already one of the most common replies on a public quote.
 *
 * Offers arrive pre-sanitized (see src/lib/financing.ts) — every applicationUrl
 * here is already known to be http/https, so it is safe to put in an href.
 */
function financingHtml(rawOffers: FinancingOffer[], color: string): string {
  // Sanitize here rather than trusting the caller. This function is the last
  // thing between stored data and an href in a real customer's inbox, and not
  // every write path runs through the Settings form — so it re-checks rather
  // than assuming someone upstream already did.
  const offers = sanitizeFinancingOffers(rawOffers)
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

/** Plain-text counterpart — every HTML email ships with a text alternative. */
function financingText(rawOffers: FinancingOffer[]): string | null {
  const offers = sanitizeFinancingOffers(rawOffers)
  if (offers.length === 0) return null
  return ['', 'Need to split this up? We offer financing:', ...offers.map((o) => `- ${o.name}: ${o.applicationUrl}`)].join('\n')
}

export function renderEmail(templateType: TemplateType, ctx: EmailContext): RenderedEmail {
  const copy = COPY[templateType]
  const { shop, customer, quote } = ctx
  const subject = copy.subject(ctx)
  const intro = copy.intro(ctx)
  const main = mainOption(ctx.options)
  const value = main?.priceCents ?? 0
  const vehicle = formatVehicle(customer)
  const valueLine =
    value > 0 ? (vehicle ? `Quoted from ${formatCurrency(value)} for your ${vehicle}.` : `Quoted from ${formatCurrency(value)}.`) : ''
  // The full "what's included" picture gallery + tint diagrams only ride
  // along on the very first email — follow-ups stay short reminders that
  // point back to the quote page, same as the old text-only tint teaser did.
  const showFullSummary = templateType === 'initial' && ctx.options.length > 0
  const expiration = quote.expirationDate
    ? `This quote is good through ${formatDate(quote.expirationDate)}.`
    : ''

  const text = [
    `Hi ${customer.firstName || 'there'},`,
    '',
    intro,
    '',
    `${copy.cta}: ${ctx.publicUrl}`,
    valueLine,
    financingText(shop.financingOffers),
    showFullSummary && quote.windowTints.length > 0 ? 'Includes window tint — see your quote for the diagram and details.' : '',
    expiration,
    '',
    `Questions? Call ${shop.phone} or reply to this email (${shop.replyToEmail}).`,
    '',
    `${shop.name}`,
    shop.address,
    '',
    `Don't want more emails about this quote? Stop follow-ups here: ${ctx.optOutUrl}`,
  ]
    .filter((line) => line !== null)
    .join('\n')

  const color = shop.primaryColor || '#1d4ed8'
  const html = `
<div style="margin:0;padding:24px 12px;background:#f4f4f5;font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <div style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #e4e4e7;">
    <div style="padding:20px 24px;border-bottom:3px solid ${color};">
      ${
        shop.logoUrl
          ? `<img src="${escapeHtml(shop.logoUrl)}" alt="${escapeHtml(shop.name)}" style="max-height:48px;max-width:220px;" />`
          : `<div style="font-size:20px;font-weight:800;color:#18181b;">${escapeHtml(shop.name)}</div>`
      }
    </div>
    <div style="padding:24px;color:#27272a;font-size:16px;line-height:1.6;">
      <p style="margin:0 0 16px;">Hi ${escapeHtml(customer.firstName || 'there')},</p>
      <p style="margin:0 0 20px;">${escapeHtml(intro)}</p>
      ${showFullSummary ? packageSummaryHtml(ctx, color) : ''}
      ${
        value > 0
          ? `<p style="margin:0 0 20px;color:#52525b;">${vehicle ? `Your ${escapeHtml(vehicle)} &middot; ` : ''}quoted from <strong style="color:#18181b;">${formatCurrency(value)}</strong></p>`
          : ''
      }
      ${showFullSummary ? tintSummaryHtml(quote.windowTints) : ''}
      <p style="margin:0 0 24px;text-align:center;">
        <a href="${escapeHtml(ctx.publicUrl)}" style="display:inline-block;background:${color};color:#ffffff;text-decoration:none;font-weight:700;font-size:17px;padding:14px 32px;border-radius:10px;">${copy.cta}</a>
      </p>
      ${financingHtml(shop.financingOffers, color)}
      ${expiration ? `<p style="margin:0 0 16px;color:#52525b;font-size:14px;">${escapeHtml(expiration)}</p>` : ''}
      <p style="margin:0;color:#52525b;font-size:15px;">Questions? Call <a href="tel:${escapeHtml(shop.phone)}" style="color:${color};">${escapeHtml(shop.phone)}</a> or just reply to this email.</p>
    </div>
    <div style="padding:16px 24px;background:#fafafa;border-top:1px solid #e4e4e7;color:#71717a;font-size:13px;line-height:1.6;">
      <div><strong>${escapeHtml(shop.name)}</strong> &middot; ${escapeHtml(shop.phone)}</div>
      <div>${escapeHtml(shop.address)}</div>
      <div style="margin-top:8px;">
        You received this because you asked ${escapeHtml(shop.name)} for a quote.
        <a href="${escapeHtml(ctx.optOutUrl)}" style="color:#71717a;">Stop follow-up emails</a>
      </div>
    </div>
  </div>
</div>`.trim()

  return { subject, html, text }
}
