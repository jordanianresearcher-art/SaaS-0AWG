// Instant, offline-first product search over the shop's OWN catalog, plus
// the ranking/merging rules that let a slow web result join it later
// without reordering what staff are already looking at.
//
// Why this exists: a shop carrying a brand whose UPCs were never published
// (Nemesis Audio is the case that drove this) can never resolve those codes
// from a barcode database or a web search — the number isn't tied to
// anything online. The only thing that can identify the box is the person
// holding it, so the job is to make that one identification as cheap as
// possible and then never ask again:
//
//   1. Match what the shop already has, instantly and with no network, so
//      the second and later units of a product cost zero lookups.
//   2. Rank a locked/known brand's products first, so typing "12" while
//      receiving a Nemesis shipment surfaces Nemesis first.
//   3. Let a web result merge in behind the local ones when it arrives,
//      deduped against them, rather than replacing the list.

import type { CatalogItem } from '../types'

/** One row in the autocomplete: either something this shop already stocks, or a web/AI candidate. */
export interface ProductSearchHit {
  key: string
  source: 'catalog' | 'web'
  brand: string | null
  model: string | null
  name: string
  /** Shop's own selling price for a catalog hit; a reference price for a web hit. */
  priceCents: number | null
  imageUrl: string | null
  /** Only set for `source: 'catalog'` — lets the caller bind a scanned UPC straight onto an existing item. */
  catalogItemId?: string
  /** Only set for `source: 'catalog'`. */
  upc?: string | null
  quantityOnHand?: number
  score: number
}

/** Collapses spacing/punctuation so "NA-12F", "na 12 f" and "na12f" all compare equal. */
export function normalizeModelKey(raw: string): string {
  return raw.toLowerCase().replace(/[^a-z0-9]+/g, '')
}

/**
 * How well one catalog item matches a typed query. Higher is better; 0 means
 * "don't show it". Deliberately simple and explainable — staff typing a model
 * fragment want the obvious answer first, not fuzzy cleverness that surfaces
 * a subwoofer when they typed an amp's SKU.
 */
export function scoreCatalogMatch(item: CatalogItem, query: string): number {
  const q = normalizeModelKey(query)
  if (!q) return 0

  const model = normalizeModelKey(item.model ?? '')
  const name = normalizeModelKey(item.name)
  const brand = normalizeModelKey(item.brand ?? '')
  const sku = normalizeModelKey(item.sku ?? '')
  const upc = normalizeModelKey(item.upc ?? '')
  const brandModel = brand + model

  // Exact identifiers win outright — scanning or typing a full code should
  // never be beaten by a partial name match.
  if (upc && upc === q) return 1000
  if (sku && sku === q) return 950
  if (model && model === q) return 900
  if (brandModel && brandModel === q) return 880

  if (model && model.startsWith(q)) return 700
  if (sku && sku.startsWith(q)) return 650
  if (brandModel && brandModel.startsWith(q)) return 600
  if (name.startsWith(q)) return 500

  if (model && model.includes(q)) return 400
  if (name.includes(q)) return 300
  if (brand && brand.startsWith(q)) return 200

  return 0
}

function catalogHit(item: CatalogItem, score: number): ProductSearchHit {
  return {
    key: `catalog:${item.id}`,
    source: 'catalog',
    brand: item.brand,
    model: item.model,
    name: item.name,
    priceCents: item.defaultPriceCents,
    imageUrl: item.imageUrl,
    catalogItemId: item.id,
    upc: item.upc,
    quantityOnHand: item.quantityOnHand,
    score,
  }
}

/**
 * Ranked matches from the shop's own catalog. `brandHint` (the locked brand
 * while receiving a shipment) boosts rather than filters — a locked brand
 * should float its products to the top without hiding a genuine match from
 * another brand, since staff do occasionally scan the wrong box.
 */
export function searchLocalCatalog(
  items: CatalogItem[],
  query: string,
  brandHint?: string | null,
  limit = 8,
): ProductSearchHit[] {
  const hintKey = brandHint ? normalizeModelKey(brandHint) : ''
  return items
    .map((item) => {
      const base = scoreCatalogMatch(item, query)
      if (base === 0) return null
      const brandMatches = hintKey && normalizeModelKey(item.brand ?? '') === hintKey
      return catalogHit(item, brandMatches ? base + 50 : base)
    })
    .filter((hit): hit is ProductSearchHit => hit !== null)
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
    .slice(0, limit)
}

/**
 * Brands this shop actually stocks, most-stocked first — the picker for the
 * brand lock. Built from the catalog rather than a hardcoded list so a shop
 * that carries an obscure brand gets it offered as soon as they enter one
 * product under it.
 */
export function knownBrands(items: CatalogItem[]): string[] {
  const counts = new Map<string, { label: string; count: number }>()
  for (const item of items) {
    const brand = item.brand?.trim()
    if (!brand) continue
    const key = normalizeModelKey(brand)
    const existing = counts.get(key)
    if (existing) existing.count++
    else counts.set(key, { label: brand, count: 1 })
  }
  return [...counts.values()]
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
    .map((b) => b.label)
}

/**
 * Merges late-arriving web/AI results in behind the local ones, dropping any
 * that duplicate a product the shop already has (matched on brand+model, so a
 * web listing for a product already stocked never appears twice). Local hits
 * always keep their order — staff may already be reaching for one when the
 * web results land, and reshuffling under their finger is how a wrong product
 * gets tapped.
 */
export function mergeSearchHits(local: ProductSearchHit[], web: ProductSearchHit[], limit = 8): ProductSearchHit[] {
  const seen = new Set(
    local.map((h) => normalizeModelKey(`${h.brand ?? ''}${h.model ?? h.name}`)),
  )
  const merged = [...local]
  for (const hit of web) {
    const key = normalizeModelKey(`${hit.brand ?? ''}${hit.model ?? hit.name}`)
    if (seen.has(key)) continue
    seen.add(key)
    merged.push(hit)
  }
  return merged.slice(0, limit)
}

// ---------------------------------------------------------------------------
// Suggestion ranking across the three sources that can answer a typed query.
//
// The three arrive at wildly different speeds — the shop's own catalog is in
// memory, the shared catalog is one indexed RPC, and the web resolver is a
// grounded model call measured in seconds. Rendering them in arrival order
// would reorder the list under the user's finger; rendering them only when
// all three are in makes every search as slow as the slowest one.
//
// So arrival order is decoupled from display order: whatever has landed is
// ranked by *source authority* and shown immediately. A later phase can only
// append.
//
// Authority order, and why:
//   1. catalog — the shop's own stock. If they have it, that IS the answer,
//      including their real price. Nothing outranks it.
//   2. shared  — several shops independently identified this product. That
//      beats one model's opinion about it.
//   3. web     — a fresh guess. Useful, least trustworthy, last.

/** The shared shape the ranker needs; both ProductSuggestion and a catalog row satisfy it. */
export interface RankableSuggestion {
  name: string
  brand: string | null
  model: string | null
}

/**
 * The identity two rows are considered "the same product" on.
 *
 * brand+model when a model is known, because that is what actually identifies
 * a product across sources — the same amp is "JP-284" at one retailer and
 * "JP284 (2-Channel)" at another, and both normalize equal. Falls back to the
 * name only when no model exists, which is the weaker comparison but the only
 * one available for accessories that genuinely have no model number.
 */
export function suggestionIdentity(s: RankableSuggestion): string {
  const brand = normalizeModelKey(s.brand ?? '')
  const model = normalizeModelKey(s.model ?? '')
  return model ? `${brand}|${model}` : `${brand}|~${normalizeModelKey(s.name)}`
}

/**
 * Concatenates source groups in authority order, dropping any row that
 * repeats a product an earlier (more authoritative) group already offered.
 *
 * Callers pass groups most-authoritative-first. Deduping forward rather than
 * backward is what makes this safe to re-run as later phases arrive: adding a
 * web group to an already-rendered [catalog, shared] list cannot disturb the
 * rows above it, so the list only ever grows downward.
 */
export function dedupeSuggestions<T extends RankableSuggestion>(groups: T[][], limit = 8): T[] {
  const seen = new Set<string>()
  const out: T[] = []
  for (const group of groups) {
    for (const row of group) {
      if (out.length >= limit) return out
      const key = suggestionIdentity(row)
      if (seen.has(key)) continue
      seen.add(key)
      out.push(row)
    }
  }
  return out
}
