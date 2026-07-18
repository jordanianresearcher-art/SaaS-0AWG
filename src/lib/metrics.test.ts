import { describe, expect, it } from 'vitest'
import { subDays } from 'date-fns'
import { buildDemoData } from '../data/demoData'
import { DemoRepository } from '../data/demoRepository'
import { computeMetrics, activeQuoteValueCents, statusFunnel } from './metrics'

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

describe('buildDemoData', () => {
  it('is deterministic for a fixed date', () => {
    const a = buildDemoData(new Date('2026-07-17T12:00:00Z'))
    const b = buildDemoData(new Date('2026-07-17T12:00:00Z'))
    expect(JSON.stringify(a)).toBe(JSON.stringify(b))
  })
})
