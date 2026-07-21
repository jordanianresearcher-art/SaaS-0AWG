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

// --- Recovery Score --------------------------------------------------------
// A single 0-100 read on how well a shop is turning quotes into money,
// blended from metrics already computed above. Presentation (gauge, tiers,
// confetti) lives in the UI layer; this file only produces honest numbers.

export type RecoveryTier = 'none' | 'bronze' | 'silver' | 'gold' | 'platinum'

export interface RecoveryScore {
  /** Null when there isn't enough activity yet to score fairly. */
  score: number | null
  tier: RecoveryTier
  components: { revenueRate: number; winRate: number; responseRate: number; viewRate: number }
}

export const TIER_CONFIG: Record<RecoveryTier, { label: string; min: number; max: number }> = {
  none: { label: 'Not enough data yet', min: 0, max: 0 },
  bronze: { label: 'Bronze', min: 0, max: 39 },
  silver: { label: 'Silver', min: 40, max: 59 },
  gold: { label: 'Gold', min: 60, max: 79 },
  platinum: { label: 'Platinum', min: 80, max: 100 },
}

function safeRate(numerator: number, denominator: number): number {
  // A denominator of 0 with real activity (numerator > 0) is a window-
  // boundary artifact (e.g. a quote created just before the window won
  // inside it) — treat it as full credit rather than NaN/Infinity.
  if (denominator > 0) return numerator / denominator
  return numerator > 0 ? 1 : 0
}

const clamp01 = (n: number) => Math.min(1, Math.max(0, n))

function tierForScore(score: number): RecoveryTier {
  if (score >= TIER_CONFIG.platinum.min) return 'platinum'
  if (score >= TIER_CONFIG.gold.min) return 'gold'
  if (score >= TIER_CONFIG.silver.min) return 'silver'
  return 'bronze'
}

export function computeRecoveryScore(m: PilotMetrics): RecoveryScore {
  if (m.eligibleQuotes === 0 && m.emailsSent === 0) {
    return { score: null, tier: 'none', components: { revenueRate: 0, winRate: 0, responseRate: 0, viewRate: 0 } }
  }
  const revenueRate = clamp01(safeRate(m.recoveredRevenueCents, m.totalQuotedCents))
  const winRate = clamp01(safeRate(m.wonJobs, m.eligibleQuotes))
  const responseRate = clamp01(safeRate(m.responses, m.emailsSent))
  const viewRate = clamp01(safeRate(m.quoteViews, m.emailsSent))
  const score = Math.round(100 * (0.4 * revenueRate + 0.3 * winRate + 0.2 * responseRate + 0.1 * viewRate))
  return { score, tier: tierForScore(score), components: { revenueRate, winRate, responseRate, viewRate } }
}

// --- Milestones --------------------------------------------------------
// Lifetime badge unlocks, independent of whatever date range the reports
// page has selected — a milestone is a permanent achievement, not a
// windowed metric.

export interface Milestone {
  id: string
  label: string
  description: string
  achieved: boolean
}

export function computeMilestones(bundles: QuoteBundle[]): Milestone[] {
  const allTime = computeMetrics(bundles, new Date(0), new Date(8640000000000000))
  return [
    {
      id: 'first_recovered_sale',
      label: 'First recovered sale',
      description: 'Marked at least one quote as won.',
      achieved: allTime.wonJobs >= 1,
    },
    {
      id: 'five_quotes_emailed',
      label: '5 quotes emailed',
      description: 'Sent at least 5 quote emails.',
      achieved: allTime.emailsSent >= 5,
    },
    {
      id: 'half_view_rate',
      label: '50% view rate',
      description: 'At least half of emailed quotes were opened (minimum 5 emails sent).',
      achieved: allTime.emailsSent >= 5 && allTime.quoteViews / allTime.emailsSent >= 0.5,
    },
    {
      id: 'thousand_recovered',
      label: '$1,000 recovered',
      description: 'Recovered $1,000+ in previously-stalled quotes.',
      achieved: allTime.recoveredRevenueCents >= 100_000,
    },
  ]
}
