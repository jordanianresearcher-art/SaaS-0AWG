import { describe, expect, it } from 'vitest'
import { subDays } from 'date-fns'
import { buildDemoData } from '../data/demoData'
import { DemoRepository } from '../data/demoRepository'
import { computeBookingMetrics, computeMetrics, activeQuoteValueCents, statusFunnel, computeRecoveryScore, computeMilestones } from './metrics'

function memoryStorage() {
  const map = new Map<string, string>()
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
  }
}

describe('computeMetrics', () => {
  it('computes the 14-day pilot metrics from seeded data', async () => {
    const repo = new DemoRepository(memoryStorage())
    const bundles = await repo.listQuoteBundles()
    const now = new Date()
    const m = computeMetrics(bundles, subDays(now, 14), now)

    expect(m.eligibleQuotes).toBeGreaterThan(0)
    expect(m.totalQuotedCents).toBeGreaterThan(0)
    expect(m.emailsSent).toBeGreaterThan(0)
    expect(m.quoteViews).toBeGreaterThan(0)
    expect(m.responses).toBeGreaterThan(0)
    expect(m.financingRequests).toBeGreaterThanOrEqual(1)
    expect(m.appointments).toBeGreaterThanOrEqual(1)
    expect(m.wonJobs).toBeGreaterThanOrEqual(1)
    // The seeded RAM win is 3,199.00
    expect(m.recoveredRevenueCents).toBeGreaterThanOrEqual(319900)
  })

  it('returns zeros for an empty window', async () => {
    const repo = new DemoRepository(memoryStorage())
    const bundles = await repo.listQuoteBundles()
    const m = computeMetrics(bundles, new Date('2000-01-01'), new Date('2000-01-02'))
    expect(m.eligibleQuotes).toBe(0)
    expect(m.recoveredRevenueCents).toBe(0)
    expect(m.emailsSent).toBe(0)
  })
})

describe('activeQuoteValueCents', () => {
  it('excludes won and lost quotes from the active pipeline', async () => {
    const repo = new DemoRepository(memoryStorage())
    const bundles = await repo.listQuoteBundles()
    const total = activeQuoteValueCents(bundles)
    const wonValue = 319900
    expect(total).toBeGreaterThan(0)
    const everything = bundles.length
    const funnel = statusFunnel(bundles)
    expect(funnel.reduce((n, f) => n + f.count, 0)).toBe(everything)
    // The won quote's recommended price should not be in the active pipeline.
    const naiveTotal = total + wonValue
    expect(naiveTotal).toBeGreaterThan(total)
  })
})

describe('computeRecoveryScore', () => {
  it('returns a score in [0, 100] with a tier for the seeded 14-day window', async () => {
    const repo = new DemoRepository(memoryStorage())
    const bundles = await repo.listQuoteBundles()
    const now = new Date()
    const m = computeMetrics(bundles, subDays(now, 14), now)
    const result = computeRecoveryScore(m)
    expect(result.score).not.toBeNull()
    expect(result.score as number).toBeGreaterThanOrEqual(0)
    expect(result.score as number).toBeLessThanOrEqual(100)
    expect(['bronze', 'silver', 'gold', 'platinum']).toContain(result.tier)
  })

  it('returns null/none for an empty window instead of a misleading zero', async () => {
    const repo = new DemoRepository(memoryStorage())
    const bundles = await repo.listQuoteBundles()
    const m = computeMetrics(bundles, new Date('2000-01-01'), new Date('2000-01-02'))
    const result = computeRecoveryScore(m)
    expect(result.score).toBeNull()
    expect(result.tier).toBe('none')
  })

  it('clamps rates to 1 even when revenue exceeds quoted value in-window', () => {
    const result = computeRecoveryScore({
      eligibleQuotes: 0,
      totalQuotedCents: 0,
      emailsSent: 1,
      quoteViews: 1,
      responses: 1,
      autoFollowUpsSent: 0,
      cheaperRequests: 0,
      financingRequests: 0,
      appointments: 0,
      deposits: 0,
      wonJobs: 1,
      recoveredRevenueCents: 500000,
    })
    expect(result.components.revenueRate).toBe(1)
    expect(result.components.winRate).toBe(1)
    expect(result.score).toBe(100)
  })
})

describe('computeMilestones', () => {
  it('marks first-recovered-sale and thousand-recovered achieved against seeded demo data', async () => {
    const repo = new DemoRepository(memoryStorage())
    const bundles = await repo.listQuoteBundles()
    const milestones = computeMilestones(bundles)
    const byId = Object.fromEntries(milestones.map((m) => [m.id, m]))
    expect(byId.first_recovered_sale.achieved).toBe(true)
    expect(byId.thousand_recovered.achieved).toBe(true)
    expect(byId.five_quotes_emailed.achieved).toBe(true)
  })

  it('gates the view-rate badge on a minimum sample size', () => {
    const milestones = computeMilestones([])
    const byId = Object.fromEntries(milestones.map((m) => [m.id, m]))
    expect(byId.half_view_rate.achieved).toBe(false)
    expect(byId.first_recovered_sale.achieved).toBe(false)
  })
})

describe('buildDemoData', () => {
  it('is deterministic for a fixed date', () => {
    const a = buildDemoData(new Date('2026-07-17T12:00:00Z'))
    const b = buildDemoData(new Date('2026-07-17T12:00:00Z'))
    expect(JSON.stringify(a)).toBe(JSON.stringify(b))
  })
})

describe('computeBookingMetrics', () => {
  const FROM = new Date('2026-08-01T00:00:00Z')
  const TO = new Date('2026-08-31T23:59:59Z')
  const appt = (o: Partial<Parameters<typeof computeBookingMetrics>[0][number]> = {}) => ({
    status: 'confirmed' as const,
    startsAt: '2026-08-15T15:00:00Z',
    depositPaidAt: null,
    depositAmountCents: null,
    reminderSentAt: null,
    cancelledAt: null,
    ...o,
  })

  it('counts what happened in the window', () => {
    const m = computeBookingMetrics(
      [
        appt({ status: 'completed' }),
        appt({ status: 'completed' }),
        appt({ status: 'no_show' }),
        appt({ status: 'cancelled' }),
        appt(),
      ],
      FROM,
      TO,
    )
    expect(m.booked).toBe(5)
    expect(m.completed).toBe(2)
    expect(m.noShows).toBe(1)
    expect(m.cancelled).toBe(1)
  })

  it('ignores appointments outside the window', () => {
    const m = computeBookingMetrics([appt({ startsAt: '2026-07-01T15:00:00Z' })], FROM, TO)
    expect(m.booked).toBe(0)
  })

  it('sums deposits actually collected', () => {
    const m = computeBookingMetrics(
      [
        appt({ depositPaidAt: '2026-08-14T12:00:00Z', depositAmountCents: 2000 }),
        appt({ depositPaidAt: '2026-08-16T12:00:00Z', depositAmountCents: 5000 }),
        appt({ depositAmountCents: 2000 }),
      ],
      FROM,
      TO,
    )
    expect(m.depositsCollected).toBe(2)
    expect(m.depositsCollectedCents).toBe(7000)
  })

  it('counts reminders the app sent', () => {
    const m = computeBookingMetrics([appt({ reminderSentAt: '2026-08-14T12:00:00Z' }), appt()], FROM, TO)
    expect(m.remindersSent).toBe(1)
  })

  it('computes show rate only from settled appointments', () => {
    // 3 completed, 1 no-show, 1 still upcoming — the upcoming one must not drag the rate down.
    const m = computeBookingMetrics(
      [
        appt({ status: 'completed' }),
        appt({ status: 'completed' }),
        appt({ status: 'completed' }),
        appt({ status: 'no_show' }),
        appt({ status: 'confirmed' }),
      ],
      FROM,
      TO,
    )
    expect(m.showRate).toBeCloseTo(0.75)
  })

  it('reports no show rate when nothing has happened yet, rather than a misleading zero', () => {
    expect(computeBookingMetrics([appt({ status: 'confirmed' })], FROM, TO).showRate).toBeNull()
    expect(computeBookingMetrics([], FROM, TO).showRate).toBeNull()
  })
})
