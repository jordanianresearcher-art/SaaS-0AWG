// Pure logic for importing a shop's Shopify catalog into 0Gauge's
// catalog_items. The paginated Admin API fetch and the actual database
// upsert live in the `shopify-import-catalog` Edge Function (server-side
// only — needs the shop's own Shopify Admin API token as a secret, never
// client-reachable). This file holds everything that can be reasoned about
// and tested without a live Shopify connection: the category-guessing
// heuristic, the product/variant -> catalog-item mapping, and the "don't
// clobber a manual price edit" re-sync decision.

import type { NewCatalogItemInput } from '../data/repository'
import type { CatalogItem, ProductCategory } from '../types'

export interface ShopifyVariant {
  /** GID, e.g. "gid://shopify/ProductVariant/123" — globally unique, used as the identity key. */
  id: string
  title: string
  sku: string | null
  barcode: string | null
  /** Decimal string as Shopify returns it, e.g. "149.99". */
  price: string
  compareAtPrice: string | null
  inventoryQuantity: number | null
  imageUrl: string | null
}

export interface ShopifyProduct {
  id: string
  title: string
  handle: string
  vendor: string | null
  productType: string | null
  description: string | null
  status: 'ACTIVE' | 'DRAFT' | 'ARCHIVED'
  featuredImageUrl: string | null
  variants: ShopifyVariant[]
}

// Best-effort only, never an authoritative or verified compatibility claim
// — staff can always recategorize afterward. Shopify's free-text
// `productType` is fairly consistent per-vendor in practice (confirmed
// against Super Car Audio's real catalog: "Subwoofer", "Coaxial Speaker",
// "Midrange Speaker", etc.), so a small pattern table meaningfully reduces
// how much of a freshly-imported catalog starts out uncategorized, without
// pretending to any certainty the data doesn't support.
const PRODUCT_TYPE_CATEGORY_HINTS: Array<{ pattern: RegExp; category: ProductCategory }> = [
  { pattern: /subwoofer/i, category: 'subwoofer' },
  { pattern: /enclosure|\bbox\b/i, category: 'enclosure' },
  { pattern: /mono.*amp/i, category: 'mono_amp' },
  { pattern: /amp(lifier)?/i, category: 'multi_amp' },
  { pattern: /wiring|wire kit/i, category: 'wiring_kit' },
  { pattern: /coax|component|midrange|tweeter|door speaker|\bspeaker/i, category: 'door_speaker' },
  { pattern: /head unit|receiver|\bradio\b/i, category: 'radio' },
  { pattern: /\bdsp\b|processor/i, category: 'dsp' },
  { pattern: /camera/i, category: 'camera' },
  { pattern: /battery/i, category: 'battery' },
  { pattern: /bass control|bass knob/i, category: 'bass_control' },
]

export function guessCategoryFromProductType(productType: string | null): ProductCategory | null {
  if (!productType) return null
  for (const { pattern, category } of PRODUCT_TYPE_CATEGORY_HINTS) {
    if (pattern.test(productType)) return category
  }
  return null
}

function parseDecimalToCents(value: string | null): number | null {
  if (!value) return null
  const n = Number(value)
  if (!Number.isFinite(n) || n < 0) return null
  return Math.round(n * 100)
}

function mapAvailability(inventoryQuantity: number | null): NonNullable<NewCatalogItemInput['availability']> {
  if (inventoryQuantity === null) return 'not_tracked'
  if (inventoryQuantity <= 0) return 'out_of_stock'
  if (inventoryQuantity <= 3) return 'low_stock'
  return 'available'
}

/**
 * Maps one Shopify product+variant pair to a NewCatalogItemInput. Each
 * variant becomes its own catalog item — 0Gauge's catalog has no variant
 * concept — using the variant's own GID as the identity key (already
 * globally unique, so no composite key is needed).
 */
export function mapShopifyVariantToCatalogItem(
  product: ShopifyProduct,
  variant: ShopifyVariant,
  shopDomain: string,
): NewCatalogItemInput {
  const isOnlyVariant = product.variants.length === 1
  const name = isOnlyVariant || variant.title === 'Default Title' ? product.title : `${product.title} — ${variant.title}`
  const priceCents = parseDecimalToCents(variant.price)
  const compareAtCents = parseDecimalToCents(variant.compareAtPrice)

  return {
    brand: product.vendor,
    model: variant.sku,
    name,
    category: guessCategoryFromProductType(product.productType),
    description: product.description,
    sku: variant.sku,
    upc: variant.barcode,
    defaultPriceCents: priceCents,
    // Shopify's compareAtPrice is the "was" price shown crossed out — the
    // closest real-world equivalent to a regular-retail reference price,
    // kept distinct from what the shop currently charges.
    msrpCents: compareAtCents !== null && priceCents !== null && compareAtCents > priceCents ? compareAtCents : null,
    priceSourceName: 'Shopify',
    priceKind: 'retail',
    imageUrl: variant.imageUrl ?? product.featuredImageUrl,
    sourceUrl: `https://${shopDomain}/products/${product.handle}`,
    active: product.status === 'ACTIVE',
    availability: mapAvailability(variant.inventoryQuantity),
    importSource: 'shopify',
    externalSourceProductId: variant.id,
    // Already a real, shop-curated, currently-live listing — not an
    // uncertain AI guess — so it doesn't need the separate pending_review
    // step an AI-identified product would.
    approvalStatus: 'approved',
  }
}

/**
 * True when a catalog item has plausibly been hand-edited since 0Gauge
 * last synced its price from Shopify — i.e. `updatedAt` moved forward
 * without a matching `priceCheckedAt` bump (which only a price-carrying
 * write, like this importer's own sync, sets — see catalogItemRow() in
 * supabaseRepository.ts). A routine re-import must never silently
 * overwrite that edit; only an explicit "overwrite" pass may.
 */
export function priceLikelyEditedSinceSync(existing: Pick<CatalogItem, 'updatedAt' | 'priceCheckedAt'>): boolean {
  if (!existing.priceCheckedAt) return false // never synced -- nothing to protect yet
  // Small tolerance for the sync's own write landing updatedAt a beat after priceCheckedAt.
  return new Date(existing.updatedAt).getTime() > new Date(existing.priceCheckedAt).getTime() + 1000
}

export type SyncAction = 'create' | 'update' | 'unchanged' | 'skipped'

export interface SyncPlan {
  action: SyncAction
  /** Present for 'create'/'update' — what should actually be written. Omits price/MSRP for an 'update' that's protecting a locally-edited price. */
  input?: NewCatalogItemInput
}

/**
 * Decides what a re-run of the import should do with one mapped Shopify
 * item against whatever 0Gauge already has for that variant (if anything).
 * Never touches a locally-edited price unless the caller explicitly opts
 * into overwriteLocalPrices — but non-price changes (title, image,
 * description, active status) still flow through even then, since only
 * the price/MSRP fields are ever staff-editable today.
 */
export function planCatalogItemSync(
  existing: CatalogItem | undefined,
  mapped: NewCatalogItemInput,
  opts: { overwriteLocalPrices: boolean } = { overwriteLocalPrices: false },
): SyncPlan {
  if (!existing) return { action: 'create', input: mapped }

  const nonPriceChanged =
    existing.brand !== mapped.brand ||
    existing.model !== mapped.model ||
    existing.name !== mapped.name ||
    existing.description !== mapped.description ||
    existing.imageUrl !== mapped.imageUrl ||
    existing.active !== mapped.active ||
    // Lets a shop fix Shopify's productType/tags and re-run the import to
    // actually re-categorize already-imported rows, not just new ones.
    existing.category !== mapped.category

  const priceChanged = existing.defaultPriceCents !== mapped.defaultPriceCents || existing.msrpCents !== mapped.msrpCents

  const protectPrice = priceLikelyEditedSinceSync(existing) && !opts.overwriteLocalPrices

  if (protectPrice && priceChanged) {
    if (!nonPriceChanged) return { action: 'skipped' }
    // Re-affirm the item's current price/MSRP rather than omitting the
    // (required) field — explicit and unambiguous: leave price exactly as
    // the shop staff last set it, don't let Shopify's price win.
    return {
      action: 'update',
      input: { ...mapped, defaultPriceCents: existing.defaultPriceCents, msrpCents: existing.msrpCents },
    }
  }

  if (!nonPriceChanged && !priceChanged) return { action: 'unchanged' }
  return { action: 'update', input: mapped }
}
