import type { QuoteBundle } from '../types'
import { quoteValueCents } from './format'

// Metrics shared by the dashboard and the printable pilot reports.

export interface PilotMetrics {
  eligibleQuotes: number
  totalQuotedCents: number
  emailsSent: number
  quoteViews: number
  responses: number
  cheaperRequests: number
  financingRequests: number
  appointments: number
  deposits: number
  wonJobs: number
  recoveredRevenueCents: number
}

function within(iso: string, from: Date, to: Date): boolean {
  const t = new Date(iso).getTime()
  return t >= from.getTime() && t <= to.getTime()
}

export function computeMetrics(bundles: QuoteBundle[], from: Date, to: Date): PilotMetrics {
  const m: PilotMetrics = {
    eligibleQuotes: 0,
    totalQuotedCents: 0,
    emailsSent: 0,
    quoteViews: 0,
    responses: 0,
    cheaperRequests: 0,
    financingRequests: 0,
    appointments: 0,
    deposits: 0,
    wonJobs: 0,
    recoveredRevenueCents: 0,
  }
  for (const b of bundles) {
    if (within(b.quote.createdAt, from, to)) {
      m.eligibleQuotes += 1
      m.totalQuotedCents += quoteValueCents(b.options)
    }
    for (const e of b.emails) {
      if ((e.status === 'sent' || e.status === 'demo_sent') && within(e.createdAt, from, to)) m.emailsSent += 1
    }
    for (const ev of b.events) {
      if (!within(ev.createdAt, from, to)) continue
      if (ev.eventType === 'quote_viewed') m.quoteViews += 1
      if (ev.eventType === 'appointment_booked') m.appointments += 1
      if (ev.eventType === 'deposit_paid') m.deposits += 1
      if (ev.eventType === 'marked_won') {
        m.wonJobs += 1
        m.recoveredRevenueCents += b.quote.wonAmountCents ?? quoteValueCents(b.options)
      }
    }
    for (const r of b.responses) {
      if (!within(r.createdAt, from, to)) continue
      m.responses += 1
      if (r.responseType === 'want_cheaper') m.cheaperRequests += 1
      if (r.responseType === 'need_financing') m.financingRequests += 1
    }
  }
  return m
}

/** Funnel counts by current status, for the dashboard. */
export function statusFunnel(bundles: QuoteBundle[]): Array<{ status: string; count: number }> {
  const order = ['draft', 'emailed', 'viewed', 'responded', 'booked', 'deposit_paid', 'won', 'lost'] as const
  return order.map((status) => ({
    status,
    count: bundles.filter((b) => b.quote.status === status).length,
  }))
}

/** Active pipeline = quotes that are still in play (not won/lost/expired). */
export function activeQuoteValueCents(bundles: QuoteBundle[]): number {
  return bundles
    .filter((b) => !['won', 'lost', 'expired'].includes(b.quote.status))
    .reduce((sum, b) => sum + quoteValueCents(b.options), 0)
}
