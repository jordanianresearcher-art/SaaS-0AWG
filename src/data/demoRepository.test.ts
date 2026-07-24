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
      quote: { internalNotes: null, expirationDate: null, nextFollowUpAt: null, windowTints: [] },
      options: [
        {
          tier: 'good',
          name: 'Good',
          description: '',
          configId: 'truck_2x8',
          priceCents: 99900,
          laborIncluded: true,
          depositPaymentMethod: null,
          depositPaymentHandle: null,
          depositAmountCents: null,
          recommended: true,
          items: [{ brand: 'Kicker', model: 'X', name: 'Sub', quantity: 2, description: null, category: 'subwoofer' }],
        },
      ],
    })
    const bundle = await repo.getQuoteBundle(quote.id)
    expect(bundle?.quote.status).toBe('draft')
    expect(bundle?.options).toHaveLength(1)
    expect(bundle?.options[0].items).toHaveLength(1)
    expect(bundle?.options[0].configId).toBe('truck_2x8')
    expect(bundle?.options[0].items[0].category).toBe('subwoofer')
    expect(bundle?.customer.emailContactPermissionConfirmedAt).toBeTruthy()
  })

  it('creates a bare quote with no vehicle and no pricing options', async () => {
    const quote = await repo.createQuote({
      customer: {
        firstName: '',
        lastName: null,
        email: 'lead@example.com',
        phone: null,
        vehicleYear: null,
        vehicleMake: null,
        vehicleModel: null,
        vehicleTrim: null,
        source: null,
        emailContactPermissionConfirmed: true,
      },
      quote: { internalNotes: null, expirationDate: null, nextFollowUpAt: null, windowTints: [] },
      options: [],
    })
    const bundle = await repo.getQuoteBundle(quote.id)
    expect(bundle?.options).toHaveLength(0)
    expect(bundle?.customer.vehicleYear).toBeNull()

    await repo.setQuoteStatus(quote.id, 'emailed')
    const pub = await repo.getPublicQuote(quote.publicToken)
    expect(pub).not.toBeNull()
    expect(pub!.options).toHaveLength(0)
    expect(pub!.vehicle.year).toBeNull()
  })

  it('seeds a catalog with categorized products usable for slot-filling', async () => {
    const items = await repo.listCatalogItems()
    expect(items.length).toBeGreaterThan(0)
    const categories = new Set(items.map((i) => i.category))
    for (const cat of ['subwoofer', 'enclosure', 'mono_amp', 'wiring_kit', 'labor']) {
      expect(categories).toContain(cat)
    }
    // Bundled/self-contained products are deliberately left uncategorized.
    expect(items.some((i) => i.category === null)).toBe(true)
    expect(items.every((i) => i.approvalStatus === 'approved' && i.importSource === 'manual')).toBe(true)
  })

  it('creates a catalog item defaulting every new field sensibly', async () => {
    const item = await repo.createCatalogItem({ brand: 'JL Audio', model: '10W3', name: '10" subwoofer', defaultPriceCents: 19900 })
    expect(item.category).toBeNull()
    expect(item.active).toBe(true)
    expect(item.availability).toBe('not_tracked')
    expect(item.importSource).toBe('manual')
    expect(item.approvalStatus).toBe('approved')
    expect(item.msrpCents).toBeNull()
  })

  it('updating a catalog item never clobbers fields the caller did not send', async () => {
    const created = await repo.createCatalogItem({
      brand: 'JL Audio',
      model: '10W3',
      name: '10" subwoofer',
      defaultPriceCents: 19900,
      category: 'subwoofer',
      imageUrl: 'https://example.com/10w3.jpg',
      msrpCents: 22900,
    })
    // Settings form only ever sends brand/model/name/defaultPriceCents —
    // a plain price edit must not wipe the category/image/MSRP above.
    const updated = await repo.updateCatalogItem(created.id, {
      brand: 'JL Audio',
      model: '10W3',
      name: '10" subwoofer',
      defaultPriceCents: 17900,
    })
    expect(updated.defaultPriceCents).toBe(17900)
    expect(updated.category).toBe('subwoofer')
    expect(updated.imageUrl).toBe('https://example.com/10w3.jpg')
    expect(updated.msrpCents).toBe(22900)
  })

  it('seeds package templates covering approved, sourced-from-a-quote, and pending review states', async () => {
    const templates = await repo.listPackageTemplates()
    expect(templates.length).toBeGreaterThanOrEqual(3)
    expect(templates.some((t) => t.approvalStatus === 'approved')).toBe(true)
    expect(templates.some((t) => t.approvalStatus === 'pending_review')).toBe(true)
    const sourced = templates.find((t) => t.sourceQuoteId !== null)
    expect(sourced?.sourceQuoteOptionId).not.toBeNull()
    expect(templates.every((t) => t.items.length > 0)).toBe(true)
  })

  it('creates a package template defaulting to pending_review', async () => {
    const template = await repo.createPackageTemplate({
      name: 'Test Package',
      description: '',
      configId: 'car_1x10',
      vehicleTypes: ['car'],
      installedPriceCents: 49900,
      laborIncluded: true,
      source: 'staff_saved',
      items: [{ brand: 'Kicker', model: 'CompR', name: '10" sub', quantity: 1, description: null, category: 'subwoofer', imageUrl: null }],
    })
    expect(template.approvalStatus).toBe('pending_review')
    expect(template.items).toHaveLength(1)
  })

  it('does not let saving a package hold a live reference back to the source quote', async () => {
    const bundles = await repo.listQuoteBundles()
    const target = bundles.find((b) => b.options.length > 0 && b.options[0].items.length > 0)!
    const option = target.options[0]
    const template = await repo.createPackageTemplate({
      name: 'Snapshot check',
      description: option.description,
      configId: option.configId,
      vehicleTypes: [],
      installedPriceCents: option.priceCents,
      laborIncluded: option.laborIncluded,
      source: 'staff_saved',
      sourceQuoteId: option.quoteId,
      sourceQuoteOptionId: option.id,
      items: option.items.map((i) => ({ brand: i.brand, model: i.model, name: i.name, quantity: i.quantity, description: i.description, category: i.category, imageUrl: null })),
    })

    // Mutating the original quote's status/data afterwards must never
    // affect the already-saved package snapshot.
    await repo.setQuoteStatus(target.quote.id, 'lost')
    const reloaded = await repo.listPackageTemplates()
    const stillThere = reloaded.find((t) => t.id === template.id)
    expect(stillThere).toBeTruthy()
    expect(stillThere?.items[0].name).toBe(option.items[0].name)
  })

  it('approves and deletes a package template', async () => {
    const templates = await repo.listPackageTemplates()
    const pending = templates.find((t) => t.approvalStatus === 'pending_review')!
    await repo.setPackageTemplateApproval(pending.id, 'approved')
    let reloaded = await repo.listPackageTemplates()
    expect(reloaded.find((t) => t.id === pending.id)?.approvalStatus).toBe('approved')

    await repo.deletePackageTemplate(pending.id)
    reloaded = await repo.listPackageTemplates()
    expect(reloaded.find((t) => t.id === pending.id)).toBeUndefined()
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
