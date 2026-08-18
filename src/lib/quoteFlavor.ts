// What kind of job is this quote for, and what should the email sound like?
//
// The app has always sent one generic family of emails ("Your audio quote from
// …"). But a customer who came in for window tint doesn't care about audio, and
// someone waiting on a subwoofer build doesn't respond to a message about heat
// rejection. Same quote engine, different pitch.
//
// Subject lines matter more than the body here: the follow-up cadence sends up
// to four emails, and if they all lead with the same words the later ones read
// as spam even when the customer is still interested. So each stage gets its
// own angle, per flavor.
//
// Preheader text is the short line an inbox shows after the subject. It is the
// second half of the hook and is otherwise wasted — most clients fall back to
// showing whatever the first text in the body is, which for us is "Hi Marcus,".

import type { Quote, QuoteOption, TemplateType } from '../types'

export type QuoteFlavor = 'tint' | 'audio' | 'mixed'

/**
 * Tint work is recorded structurally (quote.windowTints), so it is detected
 * exactly rather than guessed from words. Product work is detected by the
 * presence of line items — tint pricing lives on the tint config itself, so a
 * tint-only quote carries no items even though it does carry a priced option.
 *
 * A quote with neither (labor-only, or a bare price) reads as 'audio', which is
 * this product's default voice and the safest thing to say when unsure.
 */
export function detectQuoteFlavor(
  quote: Pick<Quote, 'windowTints'>,
  options: Pick<QuoteOption, 'items'>[],
): QuoteFlavor {
  const hasTint = quote.windowTints.length > 0
  const hasProducts = options.some((o) => o.items.length > 0)
  if (hasTint && hasProducts) return 'mixed'
  if (hasTint) return 'tint'
  return 'audio'
}

export interface FlavorCopy {
  subject: string
  /** The inbox preview line. Kept under ~90 chars — most clients truncate past that. */
  preheader: string
}

interface CopyContext {
  shopName: string
  vehicle: string | null
  firstName: string | null
}

/**
 * Subject + preheader per (flavor, stage). Deliberately written as complete
 * strings rather than assembled from fragments — these are the words a real
 * customer reads, and they should be easy to read and edit here as a block.
 */
const FLAVOR_COPY: Record<QuoteFlavor, Record<TemplateType, (c: CopyContext) => FlavorCopy>> = {
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
      preheader: 'Any questions about the shades or the film? Reply and we’ll sort it out.',
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
      preheader: 'Questions on any part of it? Reply and we’ll walk you through it.',
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

export function flavorCopy(flavor: QuoteFlavor, template: TemplateType, ctx: CopyContext): FlavorCopy {
  return FLAVOR_COPY[flavor][template](ctx)
}

/**
 * The hidden preheader block. Two parts, both required: the text itself, then
 * a run of zero-width joiners that pushes the body's real first line ("Hi
 * Marcus,") out of the inbox preview. Without the padding, clients concatenate
 * the two and the preview reads as a run-on.
 */
export function preheaderHtml(text: string): string {
  const escaped = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  return (
    `<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;font-size:1px;line-height:1px;color:#ffffff;opacity:0;">` +
    `${escaped}${'&zwnj;&nbsp;'.repeat(60)}` +
    `</div>`
  )
}
