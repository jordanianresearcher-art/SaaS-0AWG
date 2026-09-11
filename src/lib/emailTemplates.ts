import type { Customer, FinancingOffer, Quote, QuoteOption, Shop, TemplateType } from '../types'
import { formatCurrency, formatDate, formatVehicle } from './format'
import { computeAddonBreakdown, fullTotalCents, mainOption } from './quotePricing'
import { summarizeWindowTint } from './windowTint'
import { sanitizeFinancingOffers } from './financing'
import { formatItemDisplayName } from './productNaming'
import { detectQuoteFlavor, flavorCopy } from './quoteFlavor'
import { renderEmailHtml, type EmailView } from './emailLayout'

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

/**
 * A picture for the top of the email.
 *
 * The first main-package item that carries one. Deliberately not "the most
 * expensive" or "the biggest": the shop enters the headline product first,
 * and second-guessing that with a heuristic is how the wrong speaker ends up
 * as the face of a subwoofer quote.
 */
function pickHeroImage(options: QuoteOption[]): string | null {
  const main = mainOption(options)
  const fromMain = main?.items.find((i) => i.imageUrl)?.imageUrl
  if (fromMain) return fromMain
  for (const option of options) {
    const found = option.items.find((i) => i.imageUrl)?.imageUrl
    if (found) return found
  }
  return null
}

function tintViews(windowTints: Quote['windowTints']): EmailView['tints'] {
  return windowTints.slice(0, 2).map((tint) => {
    const summary = summarizeWindowTint(tint)
    const coverage =
      summary.uniformPercent !== null
        ? `All windows at ${summary.uniformPercent}%`
        : summary.windowLines.map((w) => `${w.label} ${w.vltPercent}%`).join(' · ')
    const extras = [
      summary.windshield ? `windshield ${summary.windshield.vltPercent}%` : null,
      summary.sunroof ? `sunroof ${summary.sunroof.vltPercent}%` : null,
      summary.removeOldTint ? 'old tint removed' : null,
    ]
      .filter((x): x is string => x !== null)
      .join(', ')
    return {
      name: summary.name,
      typeLabel: summary.tintTypeLabel,
      coverage,
      extras,
      totalCents: summary.totalCents,
    }
  })
}

/** Plain-text counterpart — every HTML email ships with a text alternative. */
function financingText(rawOffers: FinancingOffer[]): string | null {
  const offers = sanitizeFinancingOffers(rawOffers)
  if (offers.length === 0) return null
  const windows = offers.map((o) => o.payoffDays).filter((d): d is number => typeof d === 'number' && d > 0)
  const longest = windows.length > 0 ? Math.max(...windows) : null
  const heading = longest
    ? `Pay back in ${longest} days, get it today! Clear the balance within ${longest} days and there's no interest.`
    : 'Need to split this up? We offer financing:'
  return [
    '',
    heading,
    ...offers.map((o) => `- ${o.name}${o.payoffDays ? ` (${o.payoffDays} days to pay it off)` : ''}: ${o.applicationUrl}`),
  ].join('\n')
}

export function renderEmail(templateType: TemplateType, ctx: EmailContext): RenderedEmail {
  const copy = COPY[templateType]
  const { shop, customer, quote } = ctx
  // Subject and inbox-preview line come from the job-type-aware copy (see
  // quoteFlavor.ts) — a tint customer shouldn't get a subject about bass, and
  // four follow-ups that all lead with the same words read as spam. The body
  // intro stays shared; it is the subject that decides whether the email is
  // opened at all.
  const flavor = detectQuoteFlavor(quote, ctx.options)
  const flavored = flavorCopy(flavor, templateType, {
    shopName: shop.name,
    vehicle: formatVehicle(customer),
    firstName: customer.firstName,
  })
  const subject = flavored.subject
  const intro = copy.intro(ctx)
  const main = mainOption(ctx.options)
  const value = main?.priceCents ?? 0
  const vehicle = formatVehicle(customer)
  const valueLine =
    value > 0 ? (vehicle ? `Quoted from ${formatCurrency(value)} for your ${vehicle}.` : `Quoted from ${formatCurrency(value)}.`) : ''
  // Every email shows what the customer is actually buying, not just the
  // first. Follow-ups used to be a paragraph and a link, and in this pilot
  // they click at 10% against the first email's 22% — a reminder that shows
  // nothing is asking someone to remember why they wanted it.
  const showFullSummary = ctx.options.length > 0
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

  const view: EmailView = {
    shopName: shop.name,
    shopLogoUrl: shop.logoUrl ?? null,
    shopColor: shop.primaryColor || '#1d4ed8',
    shopPhone: shop.phone,
    shopAddress: shop.address,
    // First name only, everywhere a customer can see. Invariant, not style.
    firstName: customer.firstName,
    vehicle,
    publicUrl: ctx.publicUrl,
    optOutUrl: ctx.optOutUrl,
    preheader: flavored.preheader,
    intro,
    cta: copy.cta,
    packageName: main?.name ?? '',
    priceCents: value,
    // The hero rides on every email, including follow-ups. A follow-up used
    // to be a wall of text, and this pilot's follow-ups have a 10% click rate
    // against the first email's 22% — a picture of the thing they wanted is
    // the cheapest difference available.
    heroImageUrl: pickHeroImage(ctx.options),
    items: showFullSummary
      ? (main?.items ?? []).map((item) => ({
          label: `${item.quantity > 1 ? `${item.quantity}× ` : ''}${formatItemDisplayName(item)}`,
          imageUrl: item.imageUrl ?? null,
        }))
      : [],
    addons: showFullSummary
      ? computeAddonBreakdown(ctx.options).map((b) => ({
          name: b.option.name,
          addonPriceCents: b.addonPriceCents,
          totalWithAddonCents: b.totalWithAddonCents,
        }))
      : [],
    fullTotalCents: showFullSummary && quote.showFullAddonTotal ? fullTotalCents(ctx.options) : null,
    tints: showFullSummary ? tintViews(quote.windowTints) : [],
    moreTints: showFullSummary ? Math.max(0, quote.windowTints.length - 2) : 0,
    // Sanitized here rather than trusting the caller: not every write path
    // runs through the Settings form, and this is the last step before a URL
    // reaches a real inbox.
    financing: sanitizeFinancingOffers(shop.financingOffers).map((o) => ({
      name: o.name,
      url: o.applicationUrl,
      payoffDays: o.payoffDays,
    })),
    expiration,
    showFullSummary,
  }
  const html = renderEmailHtml(view)

  return { subject, html, text }
}
