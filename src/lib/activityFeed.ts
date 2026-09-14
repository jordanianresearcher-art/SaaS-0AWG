import type { QuoteBundle } from '../types'
import { customerDisplayName, formatVehicle, quoteValueCents } from './format'

// "What has actually been happening?" — one stream across every quote.
//
// The app could already answer this per quote, one quote at a time, which is
// the same as not answering it. A shop owner opening this software between
// customers wants to know who looked, who is close, and who to call, and the
// only screen that aggregated anything showed four money figures and three
// counts. The specific report that prompted this: "a lot of customers opened
// their quotes and started doing finances, and it didn't show."
//
// Built from the bundles the app already holds rather than a new query. Every
// fact here is one the shop can act on within the hour, which is the test for
// belonging in this list at all — "quote created" and "email sent" are things
// the shop itself just did and are deliberately absent.

export type ActivityKind = 'opened' | 'financing_clicked' | 'responded' | 'message' | 'won' | 'booked'

export interface ActivityItem {
  /** Stable across rebuilds so React keys and "seen" state survive a refresh. */
  id: string
  quoteId: string
  customerName: string
  vehicle: string | null
  kind: ActivityKind
  /** ISO timestamp of the thing itself, not of when it was recorded. */
  at: string
  /**
   * The payload for this kind, raw: the financing provider's name, the
   * response type, the email template, or a message preview. Left unlabelled
   * on purpose — the words a shop owner reads are the component's business,
   * and putting them here would make this module untestable without them.
   */
  detail: string | null
  quoteValueCents: number
}

export interface ActivityOptions {
  limit?: number
  /** Only these kinds. Omit for everything. */
  kinds?: ActivityKind[]
  /** Ignore anything older than this. Omit for no floor. */
  sinceDays?: number
  now?: Date
}

function isFiniteDate(iso: string | null | undefined): iso is string {
  if (!iso) return false
  return !Number.isNaN(new Date(iso).getTime())
}

/**
 * Newest first, capped.
 *
 * Note on "opened": this reads `firstViewedAt` on a sent email, which is the
 * customer loading their quote page from that email's own link. It is
 * click-through, NOT an email open — there is no tracking pixel anywhere in
 * this product, and calling it an open would be the kind of dressed-up number
 * the playbook exists to prevent. Staff previewing a quote never sets it.
 */
export function buildActivityFeed(bundles: QuoteBundle[], options: ActivityOptions = {}): ActivityItem[] {
  const { limit = 40, kinds, sinceDays, now = new Date() } = options
  const wanted = kinds ? new Set(kinds) : null
  const floor = sinceDays === undefined ? null : now.getTime() - sinceDays * 24 * 60 * 60 * 1000

  const items: ActivityItem[] = []
  const push = (b: QuoteBundle, id: string, kind: ActivityKind, at: string | null | undefined, detail: string | null) => {
    if (wanted && !wanted.has(kind)) return
    if (!isFiniteDate(at)) return
    if (floor !== null && new Date(at).getTime() < floor) return
    items.push({
      id,
      quoteId: b.quote.id,
      customerName: customerDisplayName(b.customer),
      vehicle: formatVehicle(b.customer),
      kind,
      at,
      detail,
      quoteValueCents: quoteValueCents(b.options),
    })
  }

  for (const b of bundles) {
    for (const email of b.emails) {
      push(b, `open-${email.id}`, 'opened', email.firstViewedAt, email.templateType)
    }
    for (const response of b.responses) {
      push(b, `resp-${response.id}`, 'responded', response.createdAt, response.responseType)
    }
    for (const event of b.events) {
      const meta = event.metadata as Record<string, unknown> | null
      if (event.eventType === 'financing_clicked') {
        const offer = typeof meta?.offer === 'string' ? meta.offer : null
        push(b, `fin-${event.id}`, 'financing_clicked', event.createdAt, offer)
      } else if (event.eventType === 'customer_message') {
        const preview = typeof meta?.preview === 'string' ? meta.preview : null
        push(b, `msg-${event.id}`, 'message', event.createdAt, preview)
      } else if (event.eventType === 'marked_won') {
        push(b, `won-${event.id}`, 'won', event.createdAt, null)
      } else if (event.eventType === 'appointment_booked') {
        push(b, `book-${event.id}`, 'booked', event.createdAt, null)
      }
    }
  }

  // Ties broken by id so the order is stable between renders. Two events can
  // share a timestamp to the millisecond — a response and the message that
  // carried it, most obviously — and a list that reshuffles under the reader
  // is worse than one in a slightly arbitrary order.
  items.sort((a, b) => (a.at === b.at ? a.id.localeCompare(b.id) : a.at < b.at ? 1 : -1))
  return items.slice(0, Math.max(0, limit))
}

/** How many of each kind are in a window, for the counts above the feed. */
export function countActivity(bundles: QuoteBundle[], options: Omit<ActivityOptions, 'limit' | 'kinds'> = {}): Record<ActivityKind, number> {
  const counts: Record<ActivityKind, number> = {
    opened: 0,
    financing_clicked: 0,
    responded: 0,
    message: 0,
    won: 0,
    booked: 0,
  }
  // No cap: a count that silently stops at 40 is a wrong number, not a short
  // list.
  for (const item of buildActivityFeed(bundles, { ...options, limit: Number.MAX_SAFE_INTEGER })) {
    counts[item.kind] += 1
  }
  return counts
}
