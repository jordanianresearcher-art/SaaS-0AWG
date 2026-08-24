// What a shop contributes to the shared product catalog — and, more
// importantly, what it never does.
//
// The shared catalog exists so that the second shop to scan a Kicker CompR 12
// doesn't pay for the same AI lookup the first shop already paid for. That
// only works if shops are willing to contribute, and they are only willing if
// the boundary is obvious and narrow: **public facts about a product, and
// nothing about the business.**
//
// So this is an allowlist, never a denylist. A new column on catalog_items
// must be added here deliberately to be shared; forgetting is the safe
// direction. The test file pins that by filling every private field with a
// sentinel and asserting none of them survive the conversion — which catches a
// leak introduced by a future column without anyone remembering this file
// exists.
//
// Specifically excluded, and why:
//
//   defaultPriceCents   what this shop charges — its margin, its business
//   costCents           what this shop paid — its supplier terms
//   minStaffPriceCents  its discount floor
//   promoPriceCents     its current promotion
//   quantityOnHand      its stock position
//   sku                 shop-generated, meaningless elsewhere (see below)
//   shopId, id          identity of the contributor
//
// msrpCents DOES cross: manufacturer list price is a published fact about the
// product, not about the shop. That is the "original price from the web
// search" the shared record is meant to carry.

import type { CatalogItem, PriceKind, ProductCategory } from '../types'
import { canonicalizeProductFields } from './productNaming'
import { classifyBarcode } from './barcodeIdentity'

/** The complete set of fields that may leave a shop. Nothing else is shared. */
export interface GlobalProductDraft {
  /** Only a real, manufacturer-issued retail barcode — see shareableBarcode. */
  barcode: string | null
  brand: string | null
  model: string | null
  /** Descriptor half only; brand and model live in their own fields. */
  name: string
  category: ProductCategory | null
  specs: Record<string, unknown> | null
  /** Manufacturer/web reference price. Never what the shop charges or paid. */
  referencePriceCents: number | null
  priceKind: PriceKind | null
  imageUrl: string | null
  sourceUrl: string | null
}

/**
 * The barcode, but only when it identifies the product globally.
 *
 * A generated code is this shop's own invention — "KICKER-CWRT8" means nothing
 * on anyone else's shelf, and worse, two shops would generate colliding codes
 * for different products. A store-assigned GS1 prefix (2) is the same problem
 * wearing a real barcode's clothes: structurally valid, locally meaningful,
 * globally noise. Both are dropped, and the record is still worth sharing on
 * brand + model alone.
 */
export function shareableBarcode(item: Pick<CatalogItem, 'upc' | 'upcIsGenerated'>): string | null {
  const upc = item.upc?.trim()
  if (!upc || item.upcIsGenerated) return null

  const identity = classifyBarcode(upc)
  if (identity.storeAssigned || identity.kind === 'item_number' || identity.kind === 'alphanumeric') return null
  if (identity.checkDigitValid === false) return null
  return identity.code
}

/**
 * Reduce a shop's catalog row to the shareable facts, or null when there is
 * nothing worth sharing.
 *
 * Null happens when the row carries no identity at all — a hand-typed line
 * like "custom fab work" is real work but not a product anyone else can match
 * against, and putting it in a shared index only makes search worse for
 * everyone.
 */
export function toGlobalProductDraft(item: CatalogItem): GlobalProductDraft | null {
  // Same canonicalization the local catalog uses, so a contributed record
  // matches on the same keys everything else does.
  const canonical = canonicalizeProductFields({
    brand: item.brand,
    model: item.model,
    name: item.name,
    specs: item.specs,
  })

  const barcode = shareableBarcode(item)
  const hasIdentity = Boolean(canonical.brand || canonical.model || barcode)
  if (!hasIdentity) return null

  return {
    barcode,
    brand: canonical.brand,
    model: canonical.model,
    name: canonical.name,
    category: item.category,
    specs: item.specs,
    // Manufacturer list price only. defaultPriceCents and costCents are the
    // shop's business and are never read here.
    referencePriceCents: item.msrpCents,
    priceKind: item.priceKind,
    imageUrl: item.imageUrl,
    sourceUrl: item.sourceUrl ?? item.priceSourceUrl,
  }
}

/**
 * The match key for a shared record.
 *
 * A real barcode is exact and wins. Otherwise brand + model, case- and
 * punctuation-folded, because "P3D4-12" and "p3d4 12" are one product and two
 * shops will spell it both ways.
 */
export function globalMatchKey(draft: Pick<GlobalProductDraft, 'barcode' | 'brand' | 'model'>): string | null {
  if (draft.barcode) return `upc:${draft.barcode}`
  const brand = draft.brand?.toLowerCase().replace(/[^a-z0-9]/g, '') ?? ''
  const model = draft.model?.toLowerCase().replace(/[^a-z0-9]/g, '') ?? ''
  if (!brand && !model) return null
  return `bm:${brand}:${model}`
}
