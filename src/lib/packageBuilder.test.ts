import { describe, expect, it } from 'vitest'
import {
  addToSlot,
  assignmentsToPackageItems,
  assignmentsToQuoteItems,
  assignmentsToSlottableItems,
  catalogItemsForSlot,
  computeComponentSubtotalCents,
  customItemsSubtotalCents,
  customItemsToPackageItems,
  customItemsToQuoteItems,
  isBuilderComplete,
  LABOR_CATALOG_ITEM_ID,
  removeFromSlot,
  requiresCompatibilityConfirmation,
  resolveBuilderCatalog,
  setSlotQuantity,
  type CustomBuilderItem,
  type SlotAssignments,
} from './packageBuilder'
import { getConfiguration } from './audioConfigs'
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
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  }
}

const catalog: CatalogItem[] = [
  makeCatalogItem({ id: 'sub-1', category: 'subwoofer', defaultPriceCents: 9900 }),
  makeCatalogItem({ id: 'sub-2', category: 'subwoofer', name: '8" other sub', defaultPriceCents: 12900 }),
  makeCatalogItem({ id: 'sub-inactive', category: 'subwoofer', active: false }),
  makeCatalogItem({ id: 'sub-pending', category: 'subwoofer', approvalStatus: 'pending_review' }),
  makeCatalogItem({ id: 'enc-1', category: 'enclosure', name: 'Sealed dual 8" box', brand: null, model: null, defaultPriceCents: 8900 }),
  makeCatalogItem({ id: 'amp-1', category: 'mono_amp', name: 'Mono amplifier', defaultPriceCents: 19900 }),
  makeCatalogItem({ id: 'wire-1', category: 'wiring_kit', name: 'Wiring kit', defaultPriceCents: 5900 }),
  makeCatalogItem({ id: 'labor-1', category: 'labor', name: 'Install labor', brand: null, model: null, defaultPriceCents: 15000 }),
  makeCatalogItem({ id: 'other-1', category: 'door_speaker', name: 'Door speaker', defaultPriceCents: 12900 }),
]

const truck2x8 = getConfiguration('truck_2x8')!

describe('catalogItemsForSlot', () => {
  it('returns only active, approved products in the slot category', () => {
    const subSlot = truck2x8.slots.find((s) => s.category === 'subwoofer')!
    const eligible = catalogItemsForSlot(catalog, subSlot)
    expect(eligible.map((i) => i.id).sort()).toEqual(['sub-1', 'sub-2'])
  })

  it('never suggests a product from another category', () => {
    const encSlot = truck2x8.slots.find((s) => s.category === 'enclosure')!
    expect(catalogItemsForSlot(catalog, encSlot).map((i) => i.id)).toEqual(['enc-1'])
  })
})

describe('addToSlot / setSlotQuantity / removeFromSlot', () => {
  it('adds a fresh assignment at quantity 1', () => {
    const result = addToSlot({}, 'subwoofer', 'sub-1')
    expect(result.subwoofer).toEqual([{ catalogItemId: 'sub-1', quantity: 1 }])
  })

  it('increments quantity when the same item is added again', () => {
    let assignments: SlotAssignments = {}
    assignments = addToSlot(assignments, 'subwoofer', 'sub-1')
    assignments = addToSlot(assignments, 'subwoofer', 'sub-1')
    expect(assignments.subwoofer).toEqual([{ catalogItemId: 'sub-1', quantity: 2 }])
  })

  it('sets an exact quantity, removing the row entirely at 0', () => {
    let assignments = addToSlot({}, 'subwoofer', 'sub-1')
    assignments = setSlotQuantity(assignments, 'subwoofer', 'sub-1', 5)
    expect(assignments.subwoofer).toEqual([{ catalogItemId: 'sub-1', quantity: 5 }])
    assignments = setSlotQuantity(assignments, 'subwoofer', 'sub-1', 0)
    expect(assignments.subwoofer).toEqual([])
  })

  it('removes one assignment without touching others in the same slot', () => {
    let assignments = addToSlot({}, 'subwoofer', 'sub-1')
    assignments = addToSlot(assignments, 'subwoofer', 'sub-2')
    assignments = removeFromSlot(assignments, 'subwoofer', 'sub-1')
    expect(assignments.subwoofer).toEqual([{ catalogItemId: 'sub-2', quantity: 1 }])
  })
})

describe('assignmentsToSlottableItems / isBuilderComplete', () => {
  it('is incomplete with nothing assigned', () => {
    expect(isBuilderComplete(truck2x8, {}, catalog)).toBe(false)
  })

  it('becomes complete once every required slot is filled to its minimum', () => {
    let assignments: SlotAssignments = {}
    assignments = setSlotQuantity(assignments, 'subwoofer', 'sub-1', 2) // truck_2x8 needs 2
    assignments = addToSlot(assignments, 'enclosure', 'enc-1')
    assignments = addToSlot(assignments, 'mono_amp', 'amp-1')
    assignments = addToSlot(assignments, 'wiring_kit', 'wire-1')
    assignments = addToSlot(assignments, 'labor', 'labor-1')
    expect(isBuilderComplete(truck2x8, assignments, catalog)).toBe(true)
  })

  it('stays incomplete when a required slot is under-filled', () => {
    let assignments: SlotAssignments = {}
    assignments = addToSlot(assignments, 'subwoofer', 'sub-1') // only 1 of 2 needed
    assignments = addToSlot(assignments, 'enclosure', 'enc-1')
    assignments = addToSlot(assignments, 'mono_amp', 'amp-1')
    assignments = addToSlot(assignments, 'wiring_kit', 'wire-1')
    assignments = addToSlot(assignments, 'labor', 'labor-1')
    expect(isBuilderComplete(truck2x8, assignments, catalog)).toBe(false)
  })

  it('never lets a dangling assignment (deleted catalog item) fill a slot', () => {
    const assignments = addToSlot({}, 'subwoofer', 'sub-1')
    const items = assignmentsToSlottableItems(assignments, [])
    expect(items).toEqual([{ category: null, quantity: 1 }])
  })
})

describe('assignmentsToQuoteItems', () => {
  it('maps assigned catalog items into the option line-item shape', () => {
    let assignments: SlotAssignments = {}
    assignments = setSlotQuantity(assignments, 'subwoofer', 'sub-1', 2)
    assignments = addToSlot(assignments, 'enclosure', 'enc-1')
    const items = assignmentsToQuoteItems(assignments, catalog)
    expect(items).toEqual(
      expect.arrayContaining([
        { brand: 'Kicker', model: 'CWRT8', name: '8" shallow subwoofer', quantity: 2, description: null, category: 'subwoofer' },
        { brand: null, model: null, name: 'Sealed dual 8" box', quantity: 1, description: null, category: 'enclosure' },
      ]),
    )
  })
})

describe('assignmentsToPackageItems', () => {
  it('mirrors assignmentsToQuoteItems but also carries imageUrl, for saving a reusable package', () => {
    const withImage = makeCatalogItem({ id: 'sub-img', category: 'subwoofer', name: 'Imaged sub', imageUrl: 'https://example.com/sub.jpg' })
    const assignments = addToSlot({}, 'subwoofer', 'sub-img')
    const items = assignmentsToPackageItems(assignments, [...catalog, withImage])
    expect(items).toEqual([
      { brand: 'Kicker', model: 'CWRT8', name: 'Imaged sub', quantity: 1, description: null, category: 'subwoofer', imageUrl: 'https://example.com/sub.jpg' },
    ])
  })
})

describe('computeComponentSubtotalCents', () => {
  it('sums price times quantity across every assigned slot', () => {
    let assignments: SlotAssignments = {}
    assignments = setSlotQuantity(assignments, 'subwoofer', 'sub-1', 2) // 9900 * 2
    assignments = addToSlot(assignments, 'enclosure', 'enc-1') // 8900
    assignments = addToSlot(assignments, 'mono_amp', 'amp-1') // 19900
    expect(computeComponentSubtotalCents(assignments, catalog)).toBe(9900 * 2 + 8900 + 19900)
  })

  it('is zero with nothing assigned', () => {
    expect(computeComponentSubtotalCents({}, catalog)).toBe(0)
  })
})

describe('requiresCompatibilityConfirmation', () => {
  it('is always true — no verified compatibility ruleset exists yet', () => {
    expect(requiresCompatibilityConfirmation()).toBe(true)
  })
})

describe('resolveBuilderCatalog', () => {
  const laborSlot = truck2x8.slots.find((s) => s.category === 'labor')!

  it('adds a synthetic labor catalog item filling the labor slot when a price is set', () => {
    const resolved = resolveBuilderCatalog(truck2x8, catalog, {}, 15000)
    const laborItem = resolved.catalog.find((i) => i.id === LABOR_CATALOG_ITEM_ID)
    expect(laborItem?.defaultPriceCents).toBe(15000)
    expect(resolved.assignments[laborSlot.key]).toEqual([{ catalogItemId: LABOR_CATALOG_ITEM_ID, quantity: 1 }])
  })

  it('never fabricates a labor entry when no price (or a zero/negative one) is set', () => {
    expect(resolveBuilderCatalog(truck2x8, catalog, {}, null).assignments[laborSlot.key]).toBeUndefined()
    expect(resolveBuilderCatalog(truck2x8, catalog, {}, 0).assignments[laborSlot.key]).toBeUndefined()
  })

  it('clears a previously-set labor assignment if the price is removed', () => {
    const assignments: SlotAssignments = { [laborSlot.key]: [{ catalogItemId: LABOR_CATALOG_ITEM_ID, quantity: 1 }] }
    const resolved = resolveBuilderCatalog(truck2x8, catalog, assignments, null)
    expect(resolved.assignments[laborSlot.key]).toBeUndefined()
  })

  it('is a no-op when there is no configuration yet', () => {
    expect(resolveBuilderCatalog(null, catalog, {}, 15000)).toEqual({ catalog, assignments: {} })
  })
})

describe('custom items (one-off items with no catalog product or slot)', () => {
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
