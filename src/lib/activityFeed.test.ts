import { describe, expect, it } from 'vitest'
import { buildActivityFeed, countActivity, type ActivityKind } from './activityFeed'
import type { QuoteBundle } from '../types'

const HOUR = 60 * 60 * 1000
const NOW = new Date('2026-09-14T12:00:00Z')
const ago = (hours: number) => new Date(NOW.getTime() - hours * HOUR).toISOString()

function bundle(overrides: Partial<QuoteBundle> & { id: string; first: string }): QuoteBundle {
  const { id, first, ...rest } = overrides
  return {
    quote: { id, publicToken: `tok-${id}`, status: 'emailed' } as QuoteBundle['quote'],
    customer: { id: `c-${id}`, firstName: first, lastName: 'Reyes', vehicleYear: 2023, vehicleMake: 'RAM', vehicleModel: '1500' } as QuoteBundle['customer'],
    options: [{ optionKind: 'main', priceCents: 159900 } as QuoteBundle['options'][number]],
    events: [],
    responses: [],
    emails: [],
    ...rest,
  }
}

const email = (id: string, firstViewedAt: string | null, templateType = 'initial') =>
  ({ id, templateType, status: 'sent', firstViewedAt, viewCount: firstViewedAt ? 1 : 0 }) as QuoteBundle['emails'][number]

const event = (id: string, eventType: string, createdAt: string, metadata: Record<string, unknown> | null = null) =>
  ({ id, eventType, createdAt, metadata }) as unknown as QuoteBundle['events'][number]

describe('buildActivityFeed', () => {
  it('reports a quote being opened, naming who and when', () => {
    const feed = buildActivityFeed([bundle({ id: 'q1', first: 'Javier', emails: [email('e1', ago(2))] })], { now: NOW })
    expect(feed).toHaveLength(1)
    expect(feed[0]).toMatchObject({ kind: 'opened', customerName: 'Javier Reyes', quoteId: 'q1', detail: 'initial' })
  })

  it('ignores an email nobody has opened', () => {
    const feed = buildActivityFeed([bundle({ id: 'q1', first: 'Javier', emails: [email('e1', null)] })], { now: NOW })
    expect(feed).toEqual([])
  })

  it('names the financing provider the customer actually tapped', () => {
    // The whole point of the report that prompted this: knowing somebody
    // started a finance application, and with whom.
    const feed = buildActivityFeed(
      [bundle({ id: 'q1', first: 'Kiley', events: [event('v1', 'financing_clicked', ago(1), { offer: 'Snap Finance' })] })],
      { now: NOW },
    )
    expect(feed[0]).toMatchObject({ kind: 'financing_clicked', detail: 'Snap Finance' })
  })

  it('survives a financing event with no offer recorded', () => {
    const feed = buildActivityFeed(
      [bundle({ id: 'q1', first: 'Kiley', events: [event('v1', 'financing_clicked', ago(1), {})] })],
      { now: NOW },
    )
    expect(feed[0]).toMatchObject({ kind: 'financing_clicked', detail: null })
  })

  it('puts the newest thing first', () => {
    const feed = buildActivityFeed(
      [
        bundle({ id: 'q1', first: 'Old', emails: [email('e1', ago(48))] }),
        bundle({ id: 'q2', first: 'New', emails: [email('e2', ago(1))] }),
        bundle({ id: 'q3', first: 'Middle', emails: [email('e3', ago(6))] }),
      ],
      { now: NOW },
    )
    expect(feed.map((i) => i.customerName)).toEqual(['New Reyes', 'Middle Reyes', 'Old Reyes'])
  })

  it('orders ties deterministically instead of reshuffling under the reader', () => {
    const at = ago(3)
    const b = bundle({
      id: 'q1',
      first: 'Sam',
      events: [
        event('zzz', 'financing_clicked', at, { offer: 'Acima' }),
        event('aaa', 'customer_message', at, { preview: 'Can I pay Friday?' }),
      ],
    })
    const once = buildActivityFeed([b], { now: NOW }).map((i) => i.id)
    const twice = buildActivityFeed([b], { now: NOW }).map((i) => i.id)
    expect(once).toEqual(twice)
    expect(once).toHaveLength(2)
  })

  it('leaves out what the shop itself just did', () => {
    // "Quote created" and "email sent" are not news to the person who did
    // them, and they would bury the four things that are.
    const feed = buildActivityFeed(
      [
        bundle({
          id: 'q1',
          first: 'Sam',
          events: [
            event('v1', 'created', ago(1)),
            event('v2', 'email_sent', ago(1)),
            event('v3', 'follow_up_rescheduled', ago(1)),
            event('v4', 'shop_message', ago(1), { preview: 'hi' }),
          ],
        }),
      ],
      { now: NOW },
    )
    expect(feed).toEqual([])
  })

  it('filters to the kinds asked for', () => {
    const b = bundle({
      id: 'q1',
      first: 'Sam',
      emails: [email('e1', ago(2))],
      events: [event('v1', 'financing_clicked', ago(1), { offer: 'Acima' })],
    })
    const only: ActivityKind[] = ['financing_clicked']
    expect(buildActivityFeed([b], { now: NOW, kinds: only }).map((i) => i.kind)).toEqual(['financing_clicked'])
  })

  it('honours a time floor', () => {
    const b = bundle({ id: 'q1', first: 'Sam', emails: [email('e1', ago(24 * 9)), email('e2', ago(24 * 2))] })
    expect(buildActivityFeed([b], { now: NOW, sinceDays: 7 })).toHaveLength(1)
  })

  it('caps the list without dropping the newest', () => {
    const b = bundle({
      id: 'q1',
      first: 'Sam',
      emails: [email('e1', ago(10)), email('e2', ago(1)), email('e3', ago(5))],
    })
    const feed = buildActivityFeed([b], { now: NOW, limit: 2 })
    expect(feed).toHaveLength(2)
    expect(feed[0].id).toBe('open-e2')
  })

  it('ignores a timestamp that is not a date', () => {
    const b = bundle({ id: 'q1', first: 'Sam', emails: [email('e1', 'not-a-date')] })
    expect(buildActivityFeed([b], { now: NOW })).toEqual([])
  })

  it('carries the quote value so the list can be read by what is at stake', () => {
    const feed = buildActivityFeed([bundle({ id: 'q1', first: 'Sam', emails: [email('e1', ago(1))] })], { now: NOW })
    expect(feed[0].quoteValueCents).toBe(159900)
  })
})

describe('countActivity', () => {
  it('counts every kind, past the feed cap', () => {
    // A count that silently stopped at the display limit would be a wrong
    // number, not a short list.
    const emails = Array.from({ length: 60 }, (_, i) => email(`e${i}`, ago(i + 1)))
    const counts = countActivity([bundle({ id: 'q1', first: 'Sam', emails })], { now: NOW })
    expect(counts.opened).toBe(60)
  })

  it('reports zeroes for a quiet shop rather than nothing', () => {
    expect(countActivity([], { now: NOW })).toEqual({
      opened: 0,
      financing_clicked: 0,
      responded: 0,
      message: 0,
      won: 0,
      booked: 0,
    })
  })

  it('respects the same time floor the feed uses', () => {
    const b = bundle({ id: 'q1', first: 'Sam', emails: [email('e1', ago(24 * 9)), email('e2', ago(24 * 2))] })
    expect(countActivity([b], { now: NOW, sinceDays: 7 }).opened).toBe(1)
  })
})
