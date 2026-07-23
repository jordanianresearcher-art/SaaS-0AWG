import { beforeEach, describe, expect, it } from 'vitest'
import { DemoRepository } from './demoRepository'

function memoryStorage(): Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> & { map: Map<string, string> } {
  const map = new Map<string, string>()
  return {
    map,
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
  }
}

describe('DemoRepository', () => {
  let storage: ReturnType<typeof memoryStorage>
  let repo: DemoRepository

  beforeEach(() => {
    storage = memoryStorage()
    repo = new DemoRepository(storage)
  })

  it('seeds a demo shop with quotes in multiple states', async () => {
    const bundles = await repo.listQuoteBundles()
    expect(bundles.length).toBeGreaterThanOrEqual(6)
    const statuses = new Set(bundles.map((b) => b.quote.status))
    expect(statuses.has('draft')).toBe(true)
    expect(statuses.has('won')).toBe(true)
    expect(statuses.has('lost')).toBe(true)
    expect(statuses.has('responded')).toBe(true)
  })

  it('persists changes across instances (localStorage round-trip)', async () => {
    const bundles = await repo.listQuoteBundles()
    const target = bundles.find((b) => b.quote.status === 'viewed')!
    await repo.setQuoteStatus(target.quote.id, 'booked')

    const second = new DemoRepository(storage)
    const reloaded = await second.getQuoteBundle(target.quote.id)
    expect(reloaded?.quote.status).toBe('booked')
  })

  it('records a demo email honestly and schedules the next follow-up', async () => {
    const bundles = await repo.listQuoteBundles()
    const target = bundles.find((b) => b.quote.status === 'viewed')!
    const result = await repo.sendEmail(target.quote.id, 'check_in')
    expect(result.ok).toBe(true)
    expect(result.status).toBe('demo_sent')
    expect(result.message).toMatch(/no real email/i)

    const after = await repo.getQuoteBundle(target.quote.id)
    expect(after!.emails[0].status).toBe('demo_sent')
    expect(after!.quote.lastEmailedAt).toBeTruthy()
    expect(after!.quote.nextFollowUpAt).toBeTruthy()
    expect(after!.events[0].eventType).toBe('email_demo_sent')
  })

  it('creates a quote with customer, options, and items', async () => {
    const quote = await repo.createQuote({
      customer: {
        firstName: 'Test',
        lastName: null,
        email: 'test@example.com',
        phone: null,
        vehicleYear: 2020,
        vehicleMake: 'Toyota',
        vehicleModel: 'Tundra',
        vehicleTrim: null,
        source: null,
        emailContactPermissionConfirmed: true,
      },
      quote: { internalNotes: null, expirationDate: null, nextFollowUpAt: null },
      options: [
        {
          tier: 'good',
          name: 'Good',
          description: '',
          priceCents: 99900,
          laborIncluded: true,
          depositPaymentMethod: null,
          depositPaymentHandle: null,
          depositAmountCents: null,
          recommended: true,
          items: [{ brand: 'Kicker', model: 'X', name: 'Sub', quantity: 1, description: null }],
        },
      ],
    })
    const bundle = await repo.getQuoteBundle(quote.id)
    expect(bundle?.quote.status).toBe('draft')
    expect(bundle?.options).toHaveLength(1)
    expect(bundle?.options[0].items).toHaveLength(1)
    expect(bundle?.customer.emailContactPermissionConfirmedAt).toBeTruthy()
  })

  it('serves a sanitized public quote (no last name, phone, email, or notes)', async () => {
    const bundles = await repo.listQuoteBundles()
    const target = bundles.find((b) => b.quote.status === 'viewed')!
    const pub = await repo.getPublicQuote(target.quote.publicToken)
    expect(pub).not.toBeNull()
    const serialized = JSON.stringify(pub)
    expect(serialized).not.toContain(target.customer.lastName as string)
    expect(serialized).not.toContain(target.customer.email)
    expect(serialized).not.toContain(target.customer.phone as string)
    expect(serialized).not.toContain('internalNotes')
    expect(pub!.customerFirstName).toBe(target.customer.firstName)
  })

  it('hides draft quotes from the public page', async () => {
    const bundles = await repo.listQuoteBundles()
    const draft = bundles.find((b) => b.quote.status === 'draft')!
    expect(await repo.getPublicQuote(draft.quote.publicToken)).toBeNull()
  })

  it('records public responses and advances status without downgrading', async () => {
    const bundles = await repo.listQuoteBundles()
    const booked = bundles.find((b) => b.quote.status === 'booked')!
    await repo.submitPublicResponse(booked.quote.publicToken, 'question', null, 'Is Saturday ok?')
    const after = await repo.getQuoteBundle(booked.quote.id)
    expect(after!.quote.status).toBe('booked') // no downgrade
    expect(after!.responses[0].responseType).toBe('question')

    const viewed = bundles.find((b) => b.quote.status === 'viewed')!
    await repo.submitPublicResponse(viewed.quote.publicToken, 'ready_to_book', null, null)
    const after2 = await repo.getQuoteBundle(viewed.quote.id)
    expect(after2!.quote.status).toBe('responded')
  })

  it('rejects invalid public response types', async () => {
    const bundles = await repo.listQuoteBundles()
    const target = bundles[0]
    await expect(
      // @ts-expect-error deliberately invalid value, as an attacker would send
      repo.submitPublicResponse(target.quote.publicToken, 'delete_everything', null, null),
    ).rejects.toThrow()
  })

  it('opt-out disables follow-up and blocks future sends', async () => {
    const bundles = await repo.listQuoteBundles()
    const target = bundles.find((b) => b.quote.status === 'viewed')!
    await repo.optOutPublicQuote(target.quote.publicToken)

    const after = await repo.getQuoteBundle(target.quote.id)
    expect(after!.customer.emailOptOutAt).toBeTruthy()
    expect(after!.quote.emailFollowUpAllowed).toBe(false)
    expect(after!.quote.nextFollowUpAt).toBeNull()

    const send = await repo.sendEmail(target.quote.id, 'check_in')
    expect(send.ok).toBe(false)
    expect(send.status).toBe('failed')
    expect(send.message).toMatch(/stop/i)
  })

  it('stop_emails response routes to opt-out', async () => {
    const bundles = await repo.listQuoteBundles()
    const target = bundles.find((b) => b.quote.status === 'emailed')!
    await repo.submitPublicResponse(target.quote.publicToken, 'stop_emails', null, null)
    const after = await repo.getQuoteBundle(target.quote.id)
    expect(after!.customer.emailOptOutAt).toBeTruthy()
  })

  it('resets demo data back to the seed', async () => {
    const bundles = await repo.listQuoteBundles()
    const target = bundles.find((b) => b.quote.status === 'viewed')!
    await repo.setQuoteStatus(target.quote.id, 'won', 123400)
    repo.resetDemoData()
    const fresh = await repo.getQuoteBundle(target.quote.id)
    expect(fresh?.quote.status).toBe('viewed')
    expect(fresh?.quote.wonAmountCents).toBeNull()
  })

  it('marking won records the amount and clears follow-up', async () => {
    const bundles = await repo.listQuoteBundles()
    const target = bundles.find((b) => b.quote.status === 'responded')!
    await repo.setQuoteStatus(target.quote.id, 'won', 250000)
    const after = await repo.getQuoteBundle(target.quote.id)
    expect(after!.quote.status).toBe('won')
    expect(after!.quote.wonAmountCents).toBe(250000)
    expect(after!.quote.nextFollowUpAt).toBeNull()
    expect(after!.events[0].eventType).toBe('marked_won')
  })
})
