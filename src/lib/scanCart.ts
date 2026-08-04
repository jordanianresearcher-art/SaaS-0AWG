// Pure logic for the scan-to-invoice cart: the running list of items a
// staff member builds up by scanning a barcode, searching the catalog, or
// typing in a one-off item — before deciding what document type it
// becomes. This phase only wires the cart through to an invoice; see
// src/components/ScanWorkspacePage.tsx for the UI and
// docs/INVENTORY_AND_SCANNING.md for the overall plan.

import type { InvoiceItem, ProductCategory } from '../types'

/** One row in the scan cart. Mirrors the shape an invoice_item ultimately needs. */
export interface ScannedCartItem {
  /** Local cart-row id (not a catalog item id — see addOrIncrementCartItem for why a catalog item can only ever have one row). */
  id: string
  /** Null for a one-off/custom item with no catalog product behind it (a fee, misc part). */
  catalogItemId: string | null
  name: string
  brand: string | null
  model: string | null
  imageUrl: string | null
  unitPriceCents: number
  quantity: number
  category: ProductCategory | null
}

/**
 * Adds a scanned/looked-up item to the cart. If it's tied to a catalog
 * item already in the cart (scanning the same barcode twice, or tapping
 * the same search result again), bumps that row's quantity instead of
 * adding a duplicate — matches how a real point-of-sale scan behaves.
 * Custom items (catalogItemId null) always get their own new row, since
 * two one-off entries aren't guaranteed to be "the same thing."
 */
export function addOrIncrementCartItem(cart: ScannedCartItem[], item: ScannedCartItem): ScannedCartItem[] {
  if (item.catalogItemId) {
    const existingIndex = cart.findIndex((c) => c.catalogItemId === item.catalogItemId)
    if (existingIndex !== -1) {
      return cart.map((c, i) => (i === existingIndex ? { ...c, quantity: c.quantity + item.quantity } : c))
    }
  }
  return [...cart, item]
}

/** Sets a row's quantity directly (e.g. from a stepper); removes it entirely at 0 or below. */
export function setCartItemQuantity(cart: ScannedCartItem[], rowId: string, quantity: number): ScannedCartItem[] {
  if (quantity <= 0) return cart.filter((c) => c.id !== rowId)
  return cart.map((c) => (c.id === rowId ? { ...c, quantity } : c))
}

/** Edits any other field on a row (name/brand/price/etc — the "pencil" edit). */
export function updateCartItem(cart: ScannedCartItem[], rowId: string, patch: Partial<ScannedCartItem>): ScannedCartItem[] {
  return cart.map((c) => (c.id === rowId ? { ...c, ...patch } : c))
}

export function removeCartItem(cart: ScannedCartItem[], rowId: string): ScannedCartItem[] {
  return cart.filter((c) => c.id !== rowId)
}

export function cartSubtotalCents(cart: ScannedCartItem[]): number {
  return cart.reduce((sum, item) => sum + item.unitPriceCents * item.quantity, 0)
}

/** Flattens the cart into the shape createInvoice's input expects, dropping the local row id (cartToInvoiceItems is order-preserving — position is assigned by index). */
export function cartToInvoiceItemInputs(
  cart: ScannedCartItem[],
): Array<Pick<InvoiceItem, 'catalogItemId' | 'brand' | 'model' | 'name' | 'quantity' | 'unitPriceCents' | 'category'>> {
  return cart.map((item) => ({
    catalogItemId: item.catalogItemId,
    brand: item.brand,
    model: item.model,
    name: item.name,
    quantity: item.quantity,
    unitPriceCents: item.unitPriceCents,
    category: item.category,
  }))
}
