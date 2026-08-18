import { describe, expect, it } from 'vitest'
import { computeInventorySummary, effectiveThreshold, isLowStock, needsUpc, pickOverdueItem } from './inventory'
import type { CatalogItem } from '../types'

function item(overrides: Partial<CatalogItem> = {}): CatalogItem {
  return {
    id: 'i1',
    shopId: 's1',
    brand: 'DS18',
    model: 'PRO-X8.4',
    name: 'PRO-X8.4 Amplifier',
    category: 'multi_amp',
    description: null,
    sku: null,
    upc: '012345678905',
    defaultPriceCents: 20000,
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
    quantityOnHand: 5,
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

describe('effectiveThreshold / isLowStock', () => {
  it('falls back to the shop default when no per-item threshold is set', () => {
    expect(effectiveThreshold(item({ lowStockThreshold: null }), 3)).toBe(3)
  })

  it('prefers the per-item threshold when set', () => {
    expect(effectiveThreshold(item({ lowStockThreshold: 10 }), 3)).toBe(10)
  })

  it('is low stock only when strictly below threshold', () => {
    expect(isLowStock(item({ quantityOnHand: 3, lowStockThreshold: 3 }), 3)).toBe(false)
    expect(isLowStock(item({ quantityOnHand: 2, lowStockThreshold: 3 }), 3)).toBe(true)
  })
})

describe('needsUpc', () => {
  it('flags an item with no upc', () => {
    expect(needsUpc(item({ upc: null }))).toBe(true)
    expect(needsUpc(item({ upc: '012345678905' }))).toBe(false)
  })
})

describe('computeInventorySummary', () => {
  it('aggregates units, value, low-stock, and needs-upc counts', () => {
    const items = [
      item({ quantityOnHand: 5, defaultPriceCents: 1000, lowStockThreshold: 2 }),
      item({ quantityOnHand: 1, defaultPriceCents: 500, lowStockThreshold: 3, upc: null }),
      item({ quantityOnHand: 0, defaultPriceCents: null, lowStockThreshold: null }),
    ]
    const summary = computeInventorySummary(items, 3)
    expect(summary.totalSkus).toBe(3)
    expect(summary.totalUnits).toBe(6)
    expect(summary.totalValueCents).toBe(5 * 1000 + 1 * 500)
    // item 1: 5 >= 2 (not low); item 2: 1 < 3 (low); item 3: 0 < 3 (low)
    expect(summary.lowStockCount).toBe(2)
    expect(summary.needsUpcCount).toBe(1)
  })
})

describe('pickOverdueItem', () => {
  it('returns null for an empty list', () => {
    expect(pickOverdueItem([])).toBeNull()
  })

  it('always picks a never-counted item over a recently counted one', () => {
    const items = [
      { id: 'recent', lastCountedAt: new Date().toISOString() },
      { id: 'never', lastCountedAt: null },
    ]
    for (let i = 0; i < 20; i++) {
      expect(pickOverdueItem(items, 1)?.id).toBe('never')
    }
  })
})
