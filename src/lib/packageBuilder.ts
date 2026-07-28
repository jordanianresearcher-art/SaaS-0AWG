// Pure logic for the fast visual package builder — pick a vehicle type,
// pick a configuration, drag catalog products into slots. The actual
// drag-and-drop UI lives in components/PackageBuilder.tsx; this file
// holds everything reasoned about and tested without React: which catalog
// products are eligible to fill a slot, how filled slots become quote-item
// rows, and how the installed price is computed.

import { validatePackageSlots, type AudioConfiguration, type ConfigSlot, type SlottableItem } from './audioConfigs'
import { parseDollarsToCents } from './format'
import type { CatalogItem, ProductCategory } from '../types'

/** One catalog product assigned to (part of) a slot, with how many of it are used there. */
export interface SlotAssignment {
  catalogItemId: string
  quantity: number
}

/** Slot key -> the assignments currently filling it. */
export type SlotAssignments = Record<string, SlotAssignment[]>

/**
 * Catalog products eligible to fill a slot: correct category, active, and
 * approved. Deliberately simple filtering — not the fuller "previously
 * won / repeated combination" ranking described in the product spec, which
 * needs a query layer over real quote history that doesn't exist yet (see
 * docs/IMPLEMENTATION_STATUS.md). Better to under-suggest than to surface
 * something staff can't actually sell as-is (inactive, or still pending
 * owner approval).
 */
export function catalogItemsForSlot(catalogItems: CatalogItem[], slot: ConfigSlot): CatalogItem[] {
  return catalogItems.filter((item) => item.category === slot.category && item.active && item.approvalStatus === 'approved')
}

/** Every slot's assignments flattened into audioConfigs' generic {category, quantity} shape, for validatePackageSlots. */
export function assignmentsToSlottableItems(assignments: SlotAssignments, catalogItems: CatalogItem[]): SlottableItem[] {
  const byId = new Map(catalogItems.map((i) => [i.id, i]))
  const items: SlottableItem[] = []
  for (const list of Object.values(assignments)) {
    for (const a of list) {
      items.push({ category: byId.get(a.catalogItemId)?.category ?? null, quantity: a.quantity })
    }
  }
  return items
}

export interface BuilderQuoteItem {
  brand: string | null
  model: string | null
  name: string
  quantity: number
  description: string | null
  category: ProductCategory | null
}

/** Flattens every slot's assignments into the line-item shape a quote option (or package template) actually stores. */
export function assignmentsToQuoteItems(assignments: SlotAssignments, catalogItems: CatalogItem[]): BuilderQuoteItem[] {
  const byId = new Map(catalogItems.map((i) => [i.id, i]))
  const items: BuilderQuoteItem[] = []
  for (const list of Object.values(assignments)) {
    for (const a of list) {
      const catalogItem = byId.get(a.catalogItemId)
      if (!catalogItem) continue
      items.push({
        brand: catalogItem.brand,
        model: catalogItem.model,
        name: catalogItem.name,
        quantity: a.quantity,
        description: null,
        category: catalogItem.category,
      })
    }
  }
  return items
}

export interface BuilderPackageItem extends BuilderQuoteItem {
  imageUrl: string | null
}

/** Same flattening as assignmentsToQuoteItems, but keeping imageUrl — for saving a reusable package_templates row, which stores its own item images. */
export function assignmentsToPackageItems(assignments: SlotAssignments, catalogItems: CatalogItem[]): BuilderPackageItem[] {
  const byId = new Map(catalogItems.map((i) => [i.id, i]))
  const items: BuilderPackageItem[] = []
  for (const list of Object.values(assignments)) {
    for (const a of list) {
      const catalogItem = byId.get(a.catalogItemId)
      if (!catalogItem) continue
      items.push({
        brand: catalogItem.brand,
        model: catalogItem.model,
        name: catalogItem.name,
        quantity: a.quantity,
        description: null,
        category: catalogItem.category,
        imageUrl: catalogItem.imageUrl,
      })
    }
  }
  return items
}

/** Sum of every assigned item's price × quantity — the component subtotal, before labor or any manual override. */
export function computeComponentSubtotalCents(assignments: SlotAssignments, catalogItems: CatalogItem[]): number {
  const byId = new Map(catalogItems.map((i) => [i.id, i]))
  let total = 0
  for (const list of Object.values(assignments)) {
    for (const a of list) {
      total += (byId.get(a.catalogItemId)?.defaultPriceCents ?? 0) * a.quantity
    }
  }
  return total
}

/** True once every required slot is filled to its minimum quantity — reuses the same validation the rest of this app's slot logic relies on. */
export function isBuilderComplete(config: AudioConfiguration, assignments: SlotAssignments, catalogItems: CatalogItem[]): boolean {
  return validatePackageSlots(config, assignmentsToSlottableItems(assignments, catalogItems)).complete
}

/**
 * Always true today: nothing in this system yet holds a real, owner-vetted
 * compatibility ruleset (the product spec's "owner-approved relationships"
 * ranking factor isn't built), and most catalog specs are unpopulated or
 * import-sourced rather than verified. Inferring compatibility from
 * whatever partial spec data happens to exist would risk looking more
 * authoritative than it is — so every builder-assembled package requires
 * explicit staff confirmation rather than a sometimes-right compatibility
 * claim.
 */
export function requiresCompatibilityConfirmation(): boolean {
  return true
}

/** Adds a single unit of a catalog item to a slot (used for both drag-drop and tap-to-add). */
export function addToSlot(assignments: SlotAssignments, slotKey: string, catalogItemId: string): SlotAssignments {
  const existing = assignments[slotKey] ?? []
  const already = existing.find((a) => a.catalogItemId === catalogItemId)
  const next = already
    ? existing.map((a) => (a.catalogItemId === catalogItemId ? { ...a, quantity: a.quantity + 1 } : a))
    : [...existing, { catalogItemId, quantity: 1 }]
  return { ...assignments, [slotKey]: next }
}

/** Sets an assignment's quantity directly (e.g. from a stepper); removes it entirely at 0. */
export function setSlotQuantity(assignments: SlotAssignments, slotKey: string, catalogItemId: string, quantity: number): SlotAssignments {
  const existing = assignments[slotKey] ?? []
  if (quantity <= 0) {
    return { ...assignments, [slotKey]: existing.filter((a) => a.catalogItemId !== catalogItemId) }
  }
  const already = existing.some((a) => a.catalogItemId === catalogItemId)
  const next = already
    ? existing.map((a) => (a.catalogItemId === catalogItemId ? { ...a, quantity } : a))
    : [...existing, { catalogItemId, quantity }]
  return { ...assignments, [slotKey]: next }
}

/** Removes one assignment entirely from a slot. */
export function removeFromSlot(assignments: SlotAssignments, slotKey: string, catalogItemId: string): SlotAssignments {
  const existing = assignments[slotKey] ?? []
  return { ...assignments, [slotKey]: existing.filter((a) => a.catalogItemId !== catalogItemId) }
}

// --- Labor: a price field, not a drag target ---------------------------
//
// Labor isn't a real catalog product (no brand/model/image), and the spec
// asks for it to be priced separately. Rather than requiring a shop to
// pre-create a "labor" catalog item, the builder UI offers one plain price
// field; this synthesizes that into the same generic slot-assignment model
// every other calculation already understands, so completeness/subtotal/
// final-line-items logic only has to know about one mechanism.

export const LABOR_CATALOG_ITEM_ID = '__labor_charge__'

export function makeLaborCatalogItem(priceCents: number): CatalogItem {
  return {
    id: LABOR_CATALOG_ITEM_ID,
    shopId: '',
    brand: null,
    model: null,
    name: 'Installation labor',
    category: 'labor',
    description: null,
    sku: null,
    upc: null,
    defaultPriceCents: priceCents,
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
    availability: 'not_tracked',
    importSource: 'manual',
    externalSourceProductId: null,
    identificationConfidence: null,
    approvalStatus: 'approved',
    position: 0,
    createdAt: '',
    updatedAt: '',
  }
}

/**
 * Folds the labor price field into the generic assignment model as a
 * synthetic catalog item filling the configuration's labor slot. Returns
 * the catalog/assignments pair every other builder calculation should use.
 */
export function resolveBuilderCatalog(
  config: AudioConfiguration | null,
  catalogItems: CatalogItem[],
  assignments: SlotAssignments,
  laborPriceCents: number | null,
): { catalog: CatalogItem[]; assignments: SlotAssignments } {
  const laborSlot = config?.slots.find((s) => s.category === 'labor') ?? null
  if (!laborSlot) return { catalog: catalogItems, assignments }
  if (laborPriceCents === null || laborPriceCents <= 0) {
    const { [laborSlot.key]: _drop, ...rest } = assignments
    void _drop
    return { catalog: catalogItems, assignments: rest }
  }
  return {
    catalog: [...catalogItems, makeLaborCatalogItem(laborPriceCents)],
    assignments: { ...assignments, [laborSlot.key]: [{ catalogItemId: LABOR_CATALOG_ITEM_ID, quantity: 1 }] },
  }
}

// --- Extra / custom items: one-off items outside any config slot -------
//
// A configuration's slots only cover the categories that configuration
// defines. Real jobs sometimes need something that isn't one of those —
// a misc hardware charge, a shop-supplies fee, a part not worth adding to
// the permanent catalog. These are plain name+price+quantity lines with no
// catalog product or category behind them at all, kept separate from the
// slot-assignment model (they never fill a slot, never affect
// completeness) and merged in only at quote-item/subtotal time.

export interface CustomBuilderItem {
  id: string
  name: string
  /** Dollar string — same form-values convention as labor/price-override fields. */
  price: string
  quantity: number
}

export function customItemsSubtotalCents(items: CustomBuilderItem[]): number {
  return items.reduce((sum, item) => sum + (parseDollarsToCents(item.price) ?? 0) * item.quantity, 0)
}

function customItemsToBuilderItems(items: CustomBuilderItem[]): BuilderQuoteItem[] {
  return items
    .filter((item) => item.name.trim())
    .map((item) => ({ brand: null, model: null, name: item.name.trim(), quantity: item.quantity, description: null, category: null }))
}

export function customItemsToQuoteItems(items: CustomBuilderItem[]): BuilderQuoteItem[] {
  return customItemsToBuilderItems(items)
}

export function customItemsToPackageItems(items: CustomBuilderItem[]): BuilderPackageItem[] {
  return customItemsToBuilderItems(items).map((item) => ({ ...item, imageUrl: null }))
}
