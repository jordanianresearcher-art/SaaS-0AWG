import { describe, expect, it } from 'vitest'
import {
  addCatalogItemToBuilder,
  addFreehandItemToBuilder,
  builderItemsToPackageItems,
  builderItemsToQuoteItems,
  computeBuilderItemsSubtotalCents,
  computeCatalogUsageCounts,
  customItemsSubtotalCents,
  customItemsToPackageItems,
  customItemsToQuoteItems,
  removeBuilderItem,
  setBuilderItemQuantity,
  sortCatalogByUsage,
  type BuilderLineItem,
  type CustomBuilderItem,
} from './packageBuilder'
import type { CatalogItem } from '../types'

function makeCatalogItem(overrides: Partial<CatalogItem> = {}): CatalogItem {
  return {
    id: 'cat-1',
    shopId: 'shop-1',
    brand: 'Kicker',
    model: 'CWRT8',
    name: '8" shallow subwoofer',
    category: 'subwoofer',
    description: null,
    sku: null,
    upc: null,
    defaultPriceCents: 9900,
    msrpCents: null,
    promoPriceCents: null,
    minStaffPriceCents: null,
    costCents: null,
    priceSourceUrl: null,
    priceSourceName: null,
    priceKind: null,
    priceCheckedAt: null,
    imageUrl: null,
    imageSourceUrl: null,
    sourceUrl: null,
    specs: null,
    active: true,
    availability: 'available',
    importSource: 'manual',
    externalSourceProductId: null,
    identificationConfidence: null,
    approvalStatus: 'approved',
    position: 0,
    quantityOnHand: 0,
    upcIsGenerated: false,
    labelPrintedAt: null,
    lowStockThreshold: null,
    lastCountedAt: null,
    lowStockAlerted: false,
    lowStockAlertedAt: null,
    shopifyProductId: null,
    shopifyVariantId: null,
    shopifySyncedAt: null,
    shopifySyncError: null,
    shopifyMatchedExisting: false,
    shopifyStatus: 'active',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  }
}

const sub1 = makeCatalogItem({ id: 'sub-1', category: 'subwoofer', defaultPriceCents: 9900 })
const sub2 = makeCatalogItem({ id: 'sub-2', category: 'subwoofer', name: '8" other sub', defaultPriceCents: 12900, position: 1 })
const enc1 = makeCatalogItem({
  id: 'enc-1',
  category: 'enclosure',
  name: 'Sealed dual 8" box',
  brand: null,
  model: null,
  defaultPriceCents: 8900,
  position: 2,
})
const catalog: CatalogItem[] = [sub1, sub2, enc1]

describe('addCatalogItemToBuilder', () => {
  it('adds a fresh row at quantity 1', () => {
    const items = addCatalogItemToBuilder([], sub1)
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({ catalogItemId: 'sub-1', brand: 'Kicker', model: 'CWRT8', quantity: 1 })
  })

  it('bumps quantity instead of adding a duplicate row when the same product is added again', () => {
    let items = addCatalogItemToBuilder([], sub1)
    items = addCatalogItemToBuilder(items, sub1)
    expect(items).toHaveLength(1)
    expect(items[0].quantity).toBe(2)
  })

  it('adds a separate row for a different product', () => {
    let items = addCatalogItemToBuilder([], sub1)
    items = addCatalogItemToBuilder(items, enc1)
    expect(items.map((i) => i.catalogItemId)).toEqual(['sub-1', 'enc-1'])
  })
})

describe('addFreehandItemToBuilder', () => {
  it('adds a row with no catalogItemId, e.g. from a web-search pick', () => {
    const items = addFreehandItemToBuilder([], { brand: 'JL Audio', model: 'XD600/6', name: '6-channel amp', category: null, imageUrl: null })
    expect(items).toEqual([
      expect.objectContaining({ catalogItemId: null, brand: 'JL Audio', model: 'XD600/6', name: '6-channel amp', quantity: 1 }),
    ])
  })
})

describe('setBuilderItemQuantity / removeBuilderItem', () => {
  it('sets an exact quantity', () => {
    const items = addCatalogItemToBuilder([], sub1)
    const updated = setBuilderItemQuantity(items, items[0].id, 5)
    expect(updated[0].quantity).toBe(5)
  })

  it('removes the row entirely once quantity drops to 0', () => {
    const items = addCatalogItemToBuilder([], sub1)
    expect(setBuilderItemQuantity(items, items[0].id, 0)).toEqual([])
  })

  it('removes one row without touching the others', () => {
    let items = addCatalogItemToBuilder([], sub1)
    items = addCatalogItemToBuilder(items, sub2)
    const kept = removeBuilderItem(items, items[0].id)
    expect(kept).toHaveLength(1)
    expect(kept[0].catalogItemId).toBe('sub-2')
  })
})

describe('computeBuilderItemsSubtotalCents', () => {
  it('sums catalog unit price × quantity across every row', () => {
    let items = addCatalogItemToBuilder([], sub1) // 9900 x 1
    items = setBuilderItemQuantity(items, items[0].id, 2) // 9900 x 2
    items = addCatalogItemToBuilder(items, enc1) // 8900 x 1
    expect(computeBuilderItemsSubtotalCents(items, catalog)).toBe(9900 * 2 + 8900)
  })

  it('is zero for a freehand row (no catalog product to price it from)', () => {
    const items = addFreehandItemToBuilder([], { brand: null, model: null, name: 'Web result', category: null, imageUrl: null })
    expect(computeBuilderItemsSubtotalCents(items, catalog)).toBe(0)
  })

  it('is zero with no rows', () => {
    expect(computeBuilderItemsSubtotalCents([], catalog)).toBe(0)
  })
})

describe('builderItemsToQuoteItems / builderItemsToPackageItems', () => {
  const items: BuilderLineItem[] = [
    { id: 'r1', catalogItemId: 'sub-1', brand: 'Kicker', model: 'CWRT8', name: '8" shallow subwoofer', quantity: 2, category: 'subwoofer', imageUrl: 'https://example.com/sub.jpg' },
  ]

  it('maps rows into the option line-item shape', () => {
    expect(builderItemsToQuoteItems(items)).toEqual([
      { brand: 'Kicker', model: 'CWRT8', name: '8" shallow subwoofer', quantity: 2, description: null, category: 'subwoofer' },
    ])
  })

  it('mirrors that but also carries imageUrl, for saving a reusable package', () => {
    expect(builderItemsToPackageItems(items)).toEqual([
      { brand: 'Kicker', model: 'CWRT8', name: '8" shallow subwoofer', quantity: 2, description: null, category: 'subwoofer', imageUrl: 'https://example.com/sub.jpg' },
    ])
  })
})

describe('computeCatalogUsageCounts / sortCatalogByUsage', () => {
  it('counts a past item toward its matching catalog product by brand/model/name', () => {
    const counts = computeCatalogUsageCounts(catalog, [
      { brand: 'Kicker', model: 'CWRT8', name: '8" shallow subwoofer' },
      { brand: 'Kicker', model: 'CWRT8', name: '8" shallow subwoofer' },
      { brand: null, model: null, name: 'Sealed dual 8" box' },
    ])
    expect(counts.get('sub-1')).toBe(2)
    expect(counts.get('enc-1')).toBe(1)
    expect(counts.get('sub-2')).toBeUndefined()
  })

  it('ignores a past item that matches no current catalog product', () => {
    const counts = computeCatalogUsageCounts(catalog, [{ brand: 'Unknown', model: 'X', name: 'Discontinued thing' }])
    expect(counts.size).toBe(0)
  })

  it('sorts most-used first, falling back to catalog position for ties', () => {
    const counts = new Map([['enc-1', 3]])
    const sorted = sortCatalogByUsage(catalog, counts)
    expect(sorted.map((i) => i.id)).toEqual(['enc-1', 'sub-1', 'sub-2'])
  })

  it('keeps catalog position order when nothing has any usage yet', () => {
    expect(sortCatalogByUsage(catalog, new Map()).map((i) => i.id)).toEqual(['sub-1', 'sub-2', 'enc-1'])
  })
})

describe('custom items (one-off items with no catalog product)', () => {
  const items: CustomBuilderItem[] = [
    { id: 'c1', name: 'Shop supplies fee', price: '25', quantity: 1 },
    { id: 'c2', name: 'Extra fuse kit', price: '9.99', quantity: 2 },
  ]

  it('sums price x quantity across every custom item', () => {
    expect(customItemsSubtotalCents(items)).toBe(2500 + 999 * 2)
  })

  it('treats a blank or invalid price as zero rather than throwing', () => {
    const blank: CustomBuilderItem[] = [{ id: 'c1', name: 'TBD item', price: '', quantity: 1 }]
    expect(customItemsSubtotalCents(blank)).toBe(0)
  })

  it('converts named items into the quote-item shape, dropping blank-named rows', () => {
    const withBlank = [...items, { id: 'c3', name: '   ', price: '5', quantity: 1 }]
    const quoteItems = customItemsToQuoteItems(withBlank)
    expect(quoteItems).toEqual([
      { brand: null, model: null, name: 'Shop supplies fee', quantity: 1, description: null, category: null },
      { brand: null, model: null, name: 'Extra fuse kit', quantity: 2, description: null, category: null },
    ])
  })

  it('converts to package-item shape with a null image (no catalog product behind it)', () => {
    const packageItems = customItemsToPackageItems(items)
    expect(packageItems[0]).toEqual({
      brand: null,
      model: null,
      name: 'Shop supplies fee',
      quantity: 1,
      description: null,
      category: null,
      imageUrl: null,
    })
  })
})
