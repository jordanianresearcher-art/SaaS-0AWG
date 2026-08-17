// Generates a scannable SKU for a product with no findable manufacturer
// barcode (the "quick add" path in /app/inventory/new — no UPC lookup or
// AI photo match found anything). Ported from car-audio-inventory's
// src/lib/barcode.ts (see docs/INVENTORY_MERGE_PLAN.md, Slice 7): Code 128,
// not a generated UPC-A — it needs no GS1 company prefix (inventing one
// risks colliding with a real manufacturer's), is alphanumeric, and keeps
// the code human-readable (DEAFBONCE-770DSP) so a printed label means
// something without scanning it. Label *printing* (rendering this as an
// actual barcode graphic) is deferred — see docs/INVENTORY_AND_SCANNING.md.

function clean(s: string): string {
  return s.toUpperCase().replace(/[^A-Z0-9]+/g, '')
}

// Length matters for scannability, not just looks: Code 128 costs ~12
// modules per character. Capping brand/model keeps a printed code
// comfortably scannable on a cheap USB scanner (a much longer code drops
// module width past where those start failing).
const MAX_BRAND_CHARS = 8
const MAX_MODEL_CHARS = 12

/** Brand + model, e.g. ("DS18", "770DSP") -> "DS18-770DSP". Brand is capped at 8 cleaned chars, model at 12. Falls back to "ITEM" if both are empty after cleaning. */
export function buildSkuBase(brand: string | null, model: string): string {
  const brandPart = brand ? clean(brand).slice(0, MAX_BRAND_CHARS) : ''
  const modelPart = clean(model).slice(0, MAX_MODEL_CHARS)
  const joined = [brandPart, modelPart].filter(Boolean).join('-')
  return joined || 'ITEM'
}

/**
 * Given a base code and the set of codes already in use, returns the base
 * itself if free, otherwise the first "-2", "-3", ... suffix that isn't
 * taken. Collisions are expected (same model added twice — a different
 * trim/color/batch) so this never fails or reuses a code already on a
 * printed label; it always finds an unused one.
 */
export function nextAvailableSku(base: string, taken: ReadonlySet<string>): string {
  if (!taken.has(base)) return base
  for (let i = 2; i < 1000; i++) {
    const candidate = `${base}-${i}`
    if (!taken.has(candidate)) return candidate
  }
  // Practically unreachable (999 collisions on one base) — keeps the
  // return type honest rather than throwing mid-scan.
  return `${base}-${Date.now()}`
}
