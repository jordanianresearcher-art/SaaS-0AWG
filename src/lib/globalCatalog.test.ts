import { describe, expect, it } from 'vitest'
import { globalMatchKey, shareableBarcode, toGlobalProductDraft } from './globalCatalog'
import type { CatalogItem } from '../types'

/**
 * A catalog row with a distinct sentinel in every field a shop would consider
 * its own business. The leak test below stringifies the draft and asserts none
 * of these strings or numbers appear anywhere in it.
 */
const PRIVATE_SENTINELS = {
  shopId: 'SHOP-PRIVATE-ID',
  sku: 'SHOP-PRIVATE-SKU',
  defaultPriceCents: 111111,
  costCents: 222222,
  minStaffPriceCents: 333333,
  promoPriceCents: 444444,
  quantityOnHand: 555555,
}

function item(overrides: Partial<CatalogItem> = {}): CatalogItem {
  return {
    id: 'SHOP-PRIVATE-ROW-ID',
    shopId: PRIVATE_SENTINELS.shopId,
    brand: 'kicker',
    model: 'CompR 12',
    name: '12" subwoofer',
    category: 'subwoofer',
    description: null,
    sku: PRIVATE_SENTINELS.sku,
    upc: '036000291452',
    upcIsGenerated: false,
    defaultPriceCents: PRIVATE_SENTINELS.defaultPriceCents,
    msrpCents: 14999,
    promoPriceCents: PRIVATE_SENTINELS.promoPriceCents,
    minStaffPriceCents: PRIVATE_SENTINELS.minStaffPriceCents,
    costCents: PRIVATE_SENTINELS.costCents,
    priceSourceUrl: 'https://example.com/product',
    priceSourceName: 'Manufacturer',
    priceKind: 'msrp',
    priceCheckedAt: null,
    imageUrl: 'https://example.com/a.jpg',
    imageSourceUrl: 'https://example.com/product',
    sourceUrl: 'https://example.com/product',
    specs: { size_in: 12, rms_watts: 500 },
    active: true,
    availability: 'in_stock',
    importSource: 'manual',
    externalSourceProductId: null,
    identificationConfidence: null,
    quantityOnHand: PRIVATE_SENTINELS.quantityOnHand,
    ...overrides,
  } as CatalogItem
}

describe('toGlobalProductDraft — what must never leave a shop', () => {
  it('carries no field a shop would call its own business', () => {
    // Deliberately written against a serialized blob rather than named fields:
    // a column added to CatalogItem later and mistakenly copied through will
    // fail this test even though nobody remembered this file existed.
    const draft = toGlobalProductDraft(item())
    const serialized = JSON.stringify(draft)

    for (const [field, sentinel] of Object.entries(PRIVATE_SENTINELS)) {
      expect(serialized, `${field} leaked into the shared catalog`).not.toContain(String(sentinel))
    }
    expect(serialized).not.toContain('SHOP-PRIVATE-ROW-ID')
  })

  it('shares the manufacturer list price, not the shop price', () => {
    const draft = toGlobalProductDraft(item())!
    expect(draft.referencePriceCents).toBe(14999)
    expect(draft.referencePriceCents).not.toBe(PRIVATE_SENTINELS.defaultPriceCents)
  })

  it('shares the public product facts that make it worth sharing', () => {
    const draft = toGlobalProductDraft(item())!
    expect(draft.brand).toBe('Kicker')
    expect(draft.model).toBe('CompR 12')
    expect(draft.category).toBe('subwoofer')
    expect(draft.specs).toEqual({ size_in: 12, rms_watts: 500 })
    expect(draft.imageUrl).toBe('https://example.com/a.jpg')
  })

  it('canonicalizes on the way out so two shops contribute one shape', () => {
    const a = toGlobalProductDraft(item({ brand: 'kicker', model: 'Kicker CompR 12' }))!
    const b = toGlobalProductDraft(item({ brand: 'KICKER', model: 'CompR 12' }))!
    expect(a.brand).toBe(b.brand)
    expect(a.model).toBe(b.model)
  })

  it('refuses a row with no identity anyone else could match', () => {
    // "Custom fab work" is real work but not a product. Indexing it globally
    // only makes everyone's search worse.
    expect(toGlobalProductDraft(item({ brand: null, model: null, upc: null, name: 'Custom fab work' }))).toBeNull()
  })
})

describe('shareableBarcode', () => {
  it('shares a real manufacturer barcode', () => {
    expect(shareableBarcode({ upc: '036000291452', upcIsGenerated: false })).toBe('036000291452')
  })

  it('never shares a code this app generated', () => {
    // "KICKER-CWRT8" means nothing on anyone else's shelf, and two shops would
    // generate colliding codes for different products.
    expect(shareableBarcode({ upc: 'KICKER-CWRT8', upcIsGenerated: true })).toBeNull()
  })

  it('never shares a store-assigned barcode', () => {
    // Structurally valid, locally meaningful, globally noise — the same
    // problem wearing a real barcode's clothes.
    expect(shareableBarcode({ upc: '200001188725', upcIsGenerated: false })).toBeNull()
  })

  it('never shares an internal item number or a misread', () => {
    expect(shareableBarcode({ upc: '26040308', upcIsGenerated: false })).toBeNull()
    expect(shareableBarcode({ upc: '200001188726', upcIsGenerated: false })).toBeNull()
  })

  it('still shares the record without a barcode, on brand and model', () => {
    const draft = toGlobalProductDraft(item({ upc: 'KICKER-CWRT8', upcIsGenerated: true }))
    expect(draft).not.toBeNull()
    expect(draft!.barcode).toBeNull()
    expect(draft!.brand).toBe('Kicker')
  })
})

describe('globalMatchKey', () => {
  it('prefers an exact barcode', () => {
    expect(globalMatchKey({ barcode: '036000291452', brand: 'Kicker', model: 'CompR 12' })).toBe('upc:036000291452')
  })

  it('folds case and punctuation so two spellings meet', () => {
    const a = globalMatchKey({ barcode: null, brand: 'Rockford Fosgate', model: 'P3D4-12' })
    const b = globalMatchKey({ barcode: null, brand: 'rockford fosgate', model: 'p3d4 12' })
    expect(a).toBe(b)
  })

  it('has no key for something unidentifiable', () => {
    expect(globalMatchKey({ barcode: null, brand: null, model: null })).toBeNull()
  })
})
