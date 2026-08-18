// Filtering the shop's own catalog with the words staff actually use.
//
// The problem: every catalog filter in the app was a single `.includes()` of
// the raw query against name/brand/model. That means typing "subwoofer 12 inch"
// found nothing — the whole phrase had to appear verbatim, so `12" Subwoofer`
// and `Kicker CompR 12` both missed. And "epicenter" found nothing unless the
// word happened to be in the product's name, even though it is a real product
// category.
//
// The fix is three things, in order of how much they matter:
//   1. Match tokens independently (AND), not the phrase.
//   2. Search the *category label* too, not just the free-text fields.
//   3. Map the shorthand a counter person says out loud — "sub", "amp", "box"
//      — onto the words the catalog actually contains.
//
// Related but different: productSearch.ts *ranks* candidates for the scan/UPC
// autocomplete, where a slow web result merges in behind local ones. This file
// *filters* list views, where every match is equal and order is chosen by the
// caller. Keep them apart — conflating "which of these is most likely the
// thing I scanned" with "does this row match what I typed" made both worse.

import type { CatalogItem, ProductCategory } from '../types'
import { PRODUCT_CATEGORY_INFO } from './audioConfigs'

/**
 * Words staff say -> words that appear in catalog data (names, or category
 * labels). Values are matched as substrings, so "sub" -> "subwoofer" also
 * covers "subwoofers".
 *
 * Deliberately one-directional and small: this is shop-floor slang, not a
 * thesaurus. Every entry here should be something you'd actually hear shouted
 * across a bay.
 */
const SYNONYMS: Record<string, string[]> = {
  sub: ['subwoofer'],
  subs: ['subwoofer'],
  woofer: ['subwoofer'],
  amp: ['amplifier'],
  amps: ['amplifier'],
  monoblock: ['mono amplifier'],
  mono: ['mono amplifier'],
  box: ['enclosure'],
  boxes: ['enclosure'],
  enclosure: ['enclosure'],
  ported: ['enclosure'],
  sealed: ['enclosure'],
  epi: ['epicenter', 'bass restoration'],
  epicenter: ['epicenter', 'bass restoration'],
  bassknob: ['bass control'],
  knob: ['bass control'],
  loc: ['signal integration'],
  converter: ['signal integration'],
  hu: ['radio', 'head unit'],
  headunit: ['radio', 'head unit'],
  deck: ['radio', 'head unit'],
  stereo: ['radio', 'head unit'],
  speaker: ['door speaker', 'speakers'],
  speakers: ['door speaker', 'speakers'],
  mids: ['door speaker'],
  tweeter: ['tweeter'],
  tweeters: ['tweeter'],
  wire: ['wiring'],
  wiring: ['wiring'],
  kit: ['wiring kit'],
  bigthree: ['big-three'],
  batt: ['battery'],
  battery: ['battery'],
  deadener: ['sound treatment'],
  deadening: ['sound treatment'],
  dampening: ['sound treatment'],
  cam: ['camera'],
  backupcam: ['camera'],
  dsp: ['dsp'],
  install: ['installation labor'],
  labor: ['installation labor'],
}

/**
 * Split a query into comparable tokens.
 *
 * Inch marks and the word "inch" both collapse to a bare number so `12"`,
 * `12in`, `12 inch` and `12` are one token — size is the single most common
 * thing anyone types, and it is written four different ways.
 */
export function tokenizeQuery(raw: string): string[] {
  return raw
    .toLowerCase()
    // 12" / 12in / 12-inch / 12 inch -> 12
    .replace(/(\d+)\s*(?:"|''|-?\s*in\b|-?\s*inch(?:es)?\b)/g, '$1')
    .split(/[^a-z0-9.]+/)
    .map((t) => t.trim())
    .filter(Boolean)
}

/** The searchable text for one item: its own fields plus its category's label. */
export function itemSearchText(item: Pick<CatalogItem, 'brand' | 'model' | 'name' | 'category' | 'sku'>): string {
  const categoryLabel = item.category ? PRODUCT_CATEGORY_INFO[item.category as ProductCategory]?.label ?? '' : ''
  return [item.brand, item.model, item.name, categoryLabel, item.sku]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
    // Normalize size the same way the query is normalized, so `12" Subwoofer`
    // is matched by a bare `12`.
    .replace(/(\d+)\s*(?:"|''|-?\s*in\b|-?\s*inch(?:es)?\b)/g, '$1')
}

/** True when one token matches the haystack, directly or through shop-floor slang. */
function tokenMatches(token: string, haystack: string): boolean {
  if (haystack.includes(token)) return true
  const expansions = SYNONYMS[token]
  if (!expansions) return false
  return expansions.some((word) => haystack.includes(word.toLowerCase()))
}

/**
 * Does this item match everything the user typed?
 *
 * AND across tokens, because narrowing is what people expect as they type more
 * words — "kicker 12" should mean both, not either.
 */
export function itemMatchesQuery(
  item: Pick<CatalogItem, 'brand' | 'model' | 'name' | 'category' | 'sku'>,
  query: string,
): boolean {
  const tokens = tokenizeQuery(query)
  if (tokens.length === 0) return true
  const haystack = itemSearchText(item)
  return tokens.every((token) => tokenMatches(token, haystack))
}

/** Filter a catalog list. Order is preserved — callers sort by usage/name/price themselves. */
export function filterCatalog<T extends Pick<CatalogItem, 'brand' | 'model' | 'name' | 'category' | 'sku'>>(
  items: T[],
  query: string,
): T[] {
  const tokens = tokenizeQuery(query)
  if (tokens.length === 0) return items
  return items.filter((item) => {
    const haystack = itemSearchText(item)
    return tokens.every((token) => tokenMatches(token, haystack))
  })
}
