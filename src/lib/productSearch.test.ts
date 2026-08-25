import { describe, expect, it } from 'vitest'
import {
  dedupeSuggestions,
  knownBrands,
  mergeSearchHits,
  normalizeModelKey,
  scoreCatalogMatch,
  searchLocalCatalog,
  suggestionIdentity,
  type ProductSearchHit,
} from './productSearch'
import type { CatalogItem } from '../types'

function item(overrides: Partial<CatalogItem> = {}): CatalogItem {
  return {
    id: 'i1', shopId: 's1', brand: 'Nemesis Audio', model: 'NA-12F', name: 'NA-12F 12" subwoofer',
    category: 'subwoofer', description: null, sku: null, upc: null, defaultPriceCents: 19900,
    msrpCents: null, promoPriceCents: null, minStaffPriceCents: null, costCents: null,
    priceSourceUrl: null, priceSourceName: null, priceKind: null, priceCheckedAt: null,
    imageUrl: null, imageSourceUrl: null, sourceUrl: null, specs: null, active: true,
    availability: 'available', importSource: 'manual', externalSourceProductId: null,
    identificationConfidence: null, approvalStatus: 'approved', position: 0, quantityOnHand: 4,
    upcIsGenerated: false, labelPrintedAt: null, lowStockThreshold: null, lastCountedAt: null,
    lowStockAlerted: false, lowStockAlertedAt: null, shopifyProductId: null, shopifyVariantId: null,
    shopifySyncedAt: null, shopifySyncError: null, shopifyMatchedExisting: false, shopifyStatus: 'active',
    createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  }
}

describe('normalizeModelKey', () => {
  it('collapses punctuation and case so model variants compare equal', () => {
    expect(normalizeModelKey('NA-12F')).toBe('na12f')
    expect(normalizeModelKey('na 12 f')).toBe('na12f')
    expect(normalizeModelKey('Na12F')).toBe('na12f')
  })
})

describe('scoreCatalogMatch', () => {
  it('ranks an exact UPC above everything else', () => {
    const withUpc = item({ upc: '012345678905' })
    expect(scoreCatalogMatch(withUpc, '012345678905')).toBe(1000)
  })

  it('matches a model typed without its dash', () => {
    expect(scoreCatalogMatch(item(), 'na12f')).toBe(900)
  })

  it('ranks a model prefix above a name substring', () => {
    const prefix = scoreCatalogMatch(item({ model: 'NA-12F', name: 'Subwoofer' }), 'na12')
    const substring = scoreCatalogMatch(item({ model: 'ZZZ', name: 'Big na12 speaker' }), 'na12')
    expect(prefix).toBeGreaterThan(substring)
  })

  it('returns 0 for no match and for an empty query', () => {
    expect(scoreCatalogMatch(item(), 'xyz')).toBe(0)
    expect(scoreCatalogMatch(item(), '  ')).toBe(0)
  })
})

describe('searchLocalCatalog', () => {
  const catalog = [
    item({ id: 'a', brand: 'Nemesis Audio', model: 'NA-12F', name: 'NA-12F sub' }),
    item({ id: 'b', brand: 'DS18', model: 'NA-12X', name: 'NA-12X sub' }),
    item({ id: 'c', brand: 'Kicker', model: 'CompR', name: 'CompR 12' }),
  ]

  it('finds matches with no network and no brand lock', () => {
    const hits = searchLocalCatalog(catalog, 'na-12')
    expect(hits.map((h) => h.catalogItemId)).toEqual(['a', 'b'])
  })

  it('floats the locked brand to the top without hiding other brands', () => {
    const hits = searchLocalCatalog(catalog, 'na-12', 'DS18')
    expect(hits[0].catalogItemId).toBe('b')
    // The non-locked brand is still offered — staff do scan the wrong box.
    expect(hits.map((h) => h.catalogItemId)).toContain('a')
  })

  it('excludes non-matches entirely', () => {
    expect(searchLocalCatalog(catalog, 'na-12').map((h) => h.catalogItemId)).not.toContain('c')
  })

  it('carries the catalog item id and stock count so a scan can bind to it', () => {
    const [hit] = searchLocalCatalog(catalog, 'na-12f')
    expect(hit.source).toBe('catalog')
    expect(hit.catalogItemId).toBe('a')
    expect(hit.quantityOnHand).toBe(4)
  })
})

describe('knownBrands', () => {
  it('orders brands by how many products the shop stocks under them', () => {
    const catalog = [
      item({ id: 'a', brand: 'Kicker' }),
      item({ id: 'b', brand: 'Nemesis Audio' }),
      item({ id: 'c', brand: 'Nemesis Audio' }),
      item({ id: 'd', brand: null }),
    ]
    expect(knownBrands(catalog)).toEqual(['Nemesis Audio', 'Kicker'])
  })

  it('treats brand spellings that normalize the same as one brand', () => {
    const catalog = [item({ id: 'a', brand: 'Nemesis Audio' }), item({ id: 'b', brand: 'nemesis audio' })]
    expect(knownBrands(catalog)).toHaveLength(1)
  })
})

describe('mergeSearchHits', () => {
  const local: ProductSearchHit[] = [
    { key: 'catalog:a', source: 'catalog', brand: 'Nemesis Audio', model: 'NA-12F', name: 'NA-12F sub', priceCents: 19900, imageUrl: null, catalogItemId: 'a', score: 900 },
  ]

  it('drops a web result duplicating a product the shop already stocks', () => {
    const web: ProductSearchHit[] = [
      { key: 'web:1', source: 'web', brand: 'Nemesis Audio', model: 'NA-12F', name: 'Nemesis NA-12F', priceCents: 21900, imageUrl: null, score: 10 },
    ]
    expect(mergeSearchHits(local, web)).toHaveLength(1)
  })

  it('appends genuinely new web results after the local ones', () => {
    const web: ProductSearchHit[] = [
      { key: 'web:2', source: 'web', brand: 'Nemesis Audio', model: 'NA-15F', name: 'Nemesis NA-15F', priceCents: 24900, imageUrl: null, score: 10 },
    ]
    const merged = mergeSearchHits(local, web)
    expect(merged.map((h) => h.key)).toEqual(['catalog:a', 'web:2'])
  })

  it('never reorders local hits when web results arrive', () => {
    const twoLocal = [...local, { ...local[0], key: 'catalog:b', catalogItemId: 'b', model: 'NA-15F', score: 400 }]
    const web: ProductSearchHit[] = [
      { key: 'web:3', source: 'web', brand: 'Nemesis Audio', model: 'NA-18F', name: 'NA-18F', priceCents: null, imageUrl: null, score: 999 },
    ]
    expect(mergeSearchHits(twoLocal, web).slice(0, 2).map((h) => h.key)).toEqual(['catalog:a', 'catalog:b'])
  })
})

describe('suggestionIdentity', () => {
  it('treats punctuation and case differences in a model as the same product', () => {
    const a = { brand: 'Down4Sound', model: 'JP-284', name: 'JP-284 Amplifier' }
    const b = { brand: 'DOWN4SOUND', model: 'jp284', name: 'JP284 2-Channel Amp' }
    expect(suggestionIdentity(a)).toBe(suggestionIdentity(b))
  })

  it('does not collide two models from the same brand', () => {
    const a = { brand: 'Taramps', model: 'TS 400X4', name: 'TS 400x4' }
    const b = { brand: 'Taramps', model: 'TS 800X4', name: 'TS 800x4' }
    expect(suggestionIdentity(a)).not.toBe(suggestionIdentity(b))
  })

  it('falls back to the name when a product genuinely has no model number', () => {
    const a = { brand: 'Kicker', model: null, name: 'Speaker wire, 16ga' }
    const b = { brand: 'Kicker', model: null, name: 'RCA cable, 3ft' }
    expect(suggestionIdentity(a)).not.toBe(suggestionIdentity(b))
  })

  it('keeps a modelless row from colliding with a real model of the same brand', () => {
    // Without the '~' marker, brand 'X' + model '' and brand 'X' + name ''
    // could both normalize to "x|" and silently swallow one another.
    const noModel = { brand: 'Kicker', model: null, name: 'CompR' }
    const withModel = { brand: 'Kicker', model: 'CompR', name: 'Something else' }
    expect(suggestionIdentity(noModel)).not.toBe(suggestionIdentity(withModel))
  })
})

describe('dedupeSuggestions', () => {
  const catalog = { brand: 'Down4Sound', model: 'JP-284', name: 'JP-284 (shop stock)' }
  const shared = { brand: 'down4sound', model: 'jp284', name: 'JP284 from shared catalog' }
  const web = { brand: 'Down4Sound', model: 'JP 284', name: 'JP 284 from a retailer' }

  it('keeps the most authoritative copy of a product and drops the rest', () => {
    const out = dedupeSuggestions([[catalog], [shared], [web]])
    expect(out).toEqual([catalog])
  })

  it('preserves group order so a later phase can only append', () => {
    const other = { brand: 'Taramps', model: 'TS 400X4', name: 'TS 400x4' }
    const out = dedupeSuggestions([[catalog], [other]])
    expect(out.map((s) => s.model)).toEqual(['JP-284', 'TS 400X4'])
  })

  it('produces a prefix of the fuller list when a slow group has not arrived yet', () => {
    // This is the property that makes progressive rendering safe: adding the
    // web group must never reorder or remove what is already on screen.
    const early = dedupeSuggestions([[catalog], [shared]])
    const late = dedupeSuggestions([[catalog], [shared], [web]])
    expect(late.slice(0, early.length)).toEqual(early)
  })

  it('honours the limit across groups, not per group', () => {
    const many = Array.from({ length: 6 }, (_, i) => ({
      brand: 'B',
      model: `M${i}`,
      name: `n${i}`,
    }))
    const out = dedupeSuggestions([many, many.map((m) => ({ ...m, model: `X${m.model}` }))], 8)
    expect(out).toHaveLength(8)
  })

  it('ignores empty groups', () => {
    expect(dedupeSuggestions([[], [], [web]])).toEqual([web])
  })
})
