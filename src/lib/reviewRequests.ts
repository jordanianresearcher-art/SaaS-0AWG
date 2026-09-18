import { normalizePhoneForSms } from './sms'

// Asking a customer for a review, and deciding where that ask sends them.
//
// The shop's own workflow: a phone number goes on a slip of paper at the
// counter when someone pays. Staff type it in, the app writes a text, and the
// staff member's own phone sends it — the same tap-to-text stance as every
// other message in this product, and for the same reason (no A2P registration,
// and a text from the number the customer recognizes lands better).
//
// ON THE GATE. Sending five-star customers to a public review site while
// diverting everyone else to a private form is "review gating". Google's
// review policies prohibit it, and a listing caught doing it can have its
// reviews stripped or be suspended. This module implements it because the shop
// asked for it and it is their listing, but the behaviour is a setting rather
// than a fact of the code — `gateEnabled: false` shows the public link to
// everyone and still collects the written feedback, which is the version that
// does not put the listing at risk.

/** Top of the scale. A "5 stars or more" ask on a five-star scale means exactly five. */
export const MAX_STARS = 5

export interface ReviewGateInput {
  /** 1-5, as tapped. */
  rating: number
  /**
   * Whether this request has already been locked out of the public link.
   *
   * Sticky by design: once someone rates below the threshold, they never see
   * the public review link again, however many times they come back and tap
   * five. That is the shop's explicit requirement and the one rule here that
   * must never be softened into "unless they change their mind".
   */
  alreadyBlocked: boolean
  /** The shop's public review URL, or null when they have not set one. */
  reviewLink: string | null
  /** False sends everyone to the public link. See the note at the top of this file. */
  gateEnabled: boolean
  /** Lowest rating that still earns the public link. Defaults to the top of the scale. */
  minStars?: number
}

export interface ReviewGateDecision {
  /** Where to send them, or null to stay on the page. */
  redirectTo: string | null
  /** Whether to ask for written feedback. */
  showFeedback: boolean
  /** True when THIS rating is what locks the public link off for good. */
  locksRedirect: boolean
}

/**
 * Where a rating sends the customer.
 *
 * Deliberately pure and total: every combination returns a decision, because
 * the one thing that must never happen is a customer tapping a star and
 * getting a blank screen.
 */
export function decideReviewGate(input: ReviewGateInput): ReviewGateDecision {
  const { rating, alreadyBlocked, reviewLink, gateEnabled } = input
  const minStars = input.minStars ?? MAX_STARS
  const link = reviewLink && reviewLink.trim() ? reviewLink.trim() : null

  // The permanent lock outranks everything, including a later five-star tap.
  if (alreadyBlocked) return { redirectTo: null, showFeedback: true, locksRedirect: false }

  if (!gateEnabled) {
    // Ungated: the same link for everyone, and the feedback box stays up so a
    // three-star customer can still tell the shop what went wrong.
    return { redirectTo: link, showFeedback: true, locksRedirect: false }
  }

  if (rating >= minStars) {
    // A happy customer with nowhere to send them is not a reason to lock them
    // out — the shop may set a link tomorrow. Collect feedback instead.
    if (!link) return { redirectTo: null, showFeedback: true, locksRedirect: false }
    return { redirectTo: link, showFeedback: false, locksRedirect: false }
  }

  return { redirectTo: null, showFeedback: true, locksRedirect: true }
}

export type ReviewStage = 'sent' | 'opened' | 'rated' | 'feedback'

export interface ReviewRequestLike {
  firstOpenedAt: string | null
  rating: number | null
  feedback: string | null
}

/**
 * How far along one request is — what the list on the staff screen sorts and
 * colours by. Highest thing reached wins; a customer who left feedback also
 * rated and also opened.
 */
export function reviewStage(request: ReviewRequestLike): ReviewStage {
  if (request.feedback && request.feedback.trim()) return 'feedback'
  if (request.rating !== null) return 'rated'
  if (request.firstOpenedAt) return 'opened'
  return 'sent'
}

export interface ReviewSummary {
  sent: number
  opened: number
  rated: number
  /** Ratings at or above the threshold — the ones that saw the public link. */
  promoters: number
  /** Ratings below it — the ones the shop needs to hear about. */
  detractors: number
  feedback: number
  /** Mean of every rating given, or null when nobody has rated. */
  averageRating: number | null
  /** Opened ÷ sent, or null with nothing sent. */
  openRate: number | null
  /** Rated ÷ opened, or null with nothing opened. */
  ratingRate: number | null
}

export function summarizeReviewRequests(
  requests: ReviewRequestLike[],
  minStars: number = MAX_STARS,
): ReviewSummary {
  const summary: ReviewSummary = {
    sent: requests.length,
    opened: 0,
    rated: 0,
    promoters: 0,
    detractors: 0,
    feedback: 0,
    averageRating: null,
    openRate: null,
    ratingRate: null,
  }
  let total = 0
  for (const r of requests) {
    if (r.firstOpenedAt) summary.opened += 1
    if (r.rating !== null) {
      summary.rated += 1
      total += r.rating
      if (r.rating >= minStars) summary.promoters += 1
      else summary.detractors += 1
    }
    if (r.feedback && r.feedback.trim()) summary.feedback += 1
  }
  // Rates are null rather than 0 when the denominator is empty. "0% opened"
  // off nothing sent is a wrong number, not a bad one.
  if (summary.rated > 0) summary.averageRating = total / summary.rated
  if (summary.sent > 0) summary.openRate = summary.opened / summary.sent
  if (summary.opened > 0) summary.ratingRate = summary.rated / summary.opened
  return summary
}

/**
 * The digits to text, or null when there is nothing dialable.
 *
 * Same normalizer the rest of the app's tap-to-text uses, so a number that
 * works on a quote works here.
 */
export function normalizeReviewPhone(raw: string): string | null {
  return normalizePhoneForSms(raw)
}

/** "(214) 555-0100" for a US number; anything else is returned as given. */
export function formatPhoneDisplay(raw: string | null | undefined): string {
  if (!raw) return ''
  const digits = normalizePhoneForSms(raw)
  if (!digits || digits.length !== 10) return raw
  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`
}

export interface ReviewSmsContext {
  firstName: string | null
  shopName: string
  reviewUrl: string
}

/**
 * The text the staff member's phone will send.
 *
 * Short on purpose: it is read on a lock screen, from a number the customer
 * recognizes, minutes after they paid. Anything longer reads as marketing.
 */
export function buildReviewRequestSmsBody(ctx: ReviewSmsContext): string {
  const hello = ctx.firstName?.trim() ? `${ctx.firstName.trim()}, ` : ''
  return `${hello}thanks for coming to ${ctx.shopName}! How did we do? ${ctx.reviewUrl}`
}
