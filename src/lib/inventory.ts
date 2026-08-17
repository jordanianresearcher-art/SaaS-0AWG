// Pure inventory-list helpers — low-stock threshold math and the dashboard
// summary tile, both computed client-side from data already fetched
// (listCatalogItems), same "no dedicated summary round-trip" pattern
// src/lib/metrics.ts uses for quote dashboard stats. Threshold logic
// mirrors car-audio-inventory's src/lib/items.ts effectiveThreshold.

import type { CatalogItem } from '../types'

/** A catalog item's own lowStockThreshold if set, else the shop's default. */
export function effectiveThreshold(item: Pick<CatalogItem, 'lowStockThreshold'>, defaultThreshold: number): number {
  return item.lowStockThreshold ?? defaultThreshold
}

/** True when quantityOnHand has dropped below the effective threshold. Equal to the threshold is NOT low — matches car-audio-inventory's `quantity < threshold` (strictly less than). */
export function isLowStock(item: Pick<CatalogItem, 'quantityOnHand' | 'lowStockThreshold'>, defaultThreshold: number): boolean {
  return item.quantityOnHand < effectiveThreshold(item, defaultThreshold)
}

/** A catalog item with no barcode at all — batched into the "generate SKUs" action (src/lib/sku.ts) and worth flagging in the list. */
export function needsUpc(item: Pick<CatalogItem, 'upc'>): boolean {
  return !item.upc
}

export interface InventorySummary {
  totalSkus: number
  totalUnits: number
  totalValueCents: number
  lowStockCount: number
  needsUpcCount: number
}

/** The inventory dashboard tile's numbers — computed from an already-fetched catalog list, never a separate fetch. */
export function computeInventorySummary(items: CatalogItem[], defaultThreshold: number): InventorySummary {
  let totalUnits = 0
  let totalValueCents = 0
  let lowStockCount = 0
  let needsUpcCount = 0
  for (const item of items) {
    totalUnits += item.quantityOnHand
    totalValueCents += item.quantityOnHand * (item.defaultPriceCents ?? 0)
    if (isLowStock(item, defaultThreshold)) lowStockCount++
    if (needsUpc(item)) needsUpcCount++
  }
  return {
    totalSkus: items.length,
    totalUnits,
    totalValueCents,
    lowStockCount,
    needsUpcCount,
  }
}

/**
 * Ordering for the spot-check flow (/app/inventory/check): most-overdue
 * first (never-counted sorts before any real date), then picks randomly
 * among the N most overdue so repeated use doesn't feel like a fixed list
 * — mirrors car-audio-inventory's pickOverdueItem.
 */
export function pickOverdueItem<T extends { lastCountedAt: string | null }>(items: T[], poolSize = 5): T | null {
  if (items.length === 0) return null
  const sorted = [...items].sort((a, b) => {
    const at = a.lastCountedAt ? new Date(a.lastCountedAt).getTime() : -Infinity
    const bt = b.lastCountedAt ? new Date(b.lastCountedAt).getTime() : -Infinity
    return at - bt
  })
  const pool = sorted.slice(0, Math.min(poolSize, sorted.length))
  return pool[Math.floor(Math.random() * pool.length)]
}
