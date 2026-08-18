// The naming contract: one canonical way to write a product's name.
//
// The problem this solves is consistency, and the insight is that consistency
// comes from *structure*, not from discipline. Catalogs rot because every
// listing is a free-text field filled in by whoever was at the counter that
// day — "kicker cvr 12", "KICKER 12 inch sub", "Kicker CompVR 12in DVC". The
// same box ends up in the catalog three times under three names, so search
// misses it, invoices read inconsistently, and nobody trusts the numbers.
//
// So the fix isn't to ask people (or a model) to "be consistent". It's to keep
// brand / model / descriptor as separate structured fields, canonicalize the
// brand on the way in, and render every surface — quotes, invoices, labels,
// emails, the public quote page — through one function here.
//
// A useful side effect: "Brand Model — Descriptor" is also close to what a
// buyer types into Google, so a catalog built this way is already SEO-shaped
// if the shop later launches a storefront.

import type { CatalogItem } from '../types'

/**
 * Brands whose official casing we know. Anything not listed falls back to
 * title-casing, which is right far more often than leaving raw input alone.
 *
 * Not exhaustive and not meant to be — it covers the brands these shops
 * actually stock, and grows as pilots reveal more.
 */
const KNOWN_BRANDS = [
  'Kicker',
  'JL Audio',
  'Rockford Fosgate',
  'Alpine',
  'Pioneer',
  'Sony',
  'Kenwood',
  'JVC',
  'Skar Audio',
  'DS18',
  'Sundown Audio',
  'American Bass',
  'Nemesis Audio',
  'Soundstream',
  'Hifonics',
  'MTX',
  'Memphis Audio',
  'Focal',
  'Morel',
  'Hertz',
  'Audison',
  'Infinity',
  'Polk Audio',
  'Boss Audio',
  'Planet Audio',
  'Pyle',
  'Orion',
  'Massive Audio',
  'Crunch',
  'Kole Audio',
  'Down4Sound',
  'SoundQubed',
  'Taramps',
  'Stetsom',
  'B2 Audio',
  'Deaf Bonce',
  'Gravity Audio',
  'AudioControl',
  'Wet Sounds',
  'Kicker Marine',
  'Metra',
  'Scosche',
  'PAC',
  'iDatalink',
  'Stinger',
  'KnuKonceptz',
  'XS Power',
  'Kinetik',
  'Second Skin',
  'Dynamat',
  'Noico',
  'AudioPipe',
  'Cerwin Vega',
  'Rainbow',
  'Diamond Audio',
  'Elemental Designs',
  'Digital Designs',
  'Fi Car Audio',
  'Incriminator Audio',
  'Resilient Sounds',
  'SSA',
]

/** Lowercased, punctuation-stripped brand key -> official casing. */
const BRAND_BY_KEY = new Map<string, string>()
for (const brand of KNOWN_BRANDS) {
  BRAND_BY_KEY.set(normalizeBrandKey(brand), brand)
}

/**
 * Aliases people actually type. Maps to the same key space as above, so
 * "kicker audio" and "rockford" land on the canonical brand.
 */
const BRAND_ALIASES: Record<string, string> = {
  kickeraudio: 'Kicker',
  rockford: 'Rockford Fosgate',
  rf: 'Rockford Fosgate',
  jl: 'JL Audio',
  jlaudioinc: 'JL Audio',
  skar: 'Skar Audio',
  sundown: 'Sundown Audio',
  ds18audio: 'DS18',
  memphis: 'Memphis Audio',
  nemesis: 'Nemesis Audio',
  americanbassusa: 'American Bass',
  massive: 'Massive Audio',
  wetsounds: 'Wet Sounds',
  audiocontrolinc: 'AudioControl',
  polk: 'Polk Audio',
  boss: 'Boss Audio',
  dd: 'Digital Designs',
  fi: 'Fi Car Audio',
}

function normalizeBrandKey(raw: string): string {
  return raw.toLowerCase().replace(/[^a-z0-9]/g, '')
}

/** Title-case a brand we don't know, preserving all-caps tokens like DS18 or MTX. */
function titleCaseBrand(raw: string): string {
  return raw
    .trim()
    .split(/\s+/)
    .map((word) => {
      // A token that is already all-caps (or mixes caps and digits) is almost
      // always an initialism or a model-style brand — leave it alone.
      if (/^[A-Z0-9][A-Z0-9.&-]*$/.test(word) && /[A-Z]/.test(word)) return word
      return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()
    })
    .join(' ')
}

/**
 * The single place a brand string becomes canonical. Runs on manual entry AND
 * on AI/import output, so the same brand can never render two ways in one
 * catalog.
 */
export function canonicalizeBrand(raw: string | null | undefined): string | null {
  const trimmed = raw?.trim()
  if (!trimmed) return null
  const key = normalizeBrandKey(trimmed)
  if (!key) return null
  const alias = BRAND_ALIASES[key]
  if (alias) return alias
  return BRAND_BY_KEY.get(key) ?? titleCaseBrand(trimmed)
}

/**
 * Model codes are identifiers, not prose — uppercase them and collapse
 * whitespace, but never touch internal punctuation ("P3D4-12", "KEY200.4").
 * A model that repeats the brand ("Kicker CompR") has the brand stripped so
 * the rendered name doesn't say it twice.
 */
export function canonicalizeModel(raw: string | null | undefined, brand?: string | null): string | null {
  let trimmed = raw?.trim().replace(/\s+/g, ' ')
  if (!trimmed) return null
  const canonicalBrand = canonicalizeBrand(brand)
  if (canonicalBrand) {
    const brandPattern = new RegExp(`^${canonicalBrand.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s+`, 'i')
    trimmed = trimmed.replace(brandPattern, '').trim()
  }
  return trimmed || null
}

/** Strip a leading brand and model from a descriptor so the rendered name doesn't repeat them. */
function cleanDescriptor(descriptor: string, brand: string | null, model: string | null): string {
  let out = descriptor.trim().replace(/\s+/g, ' ')
  for (const prefix of [brand, model]) {
    if (!prefix) continue
    const pattern = new RegExp(`^${prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*[-–—]?\\s*`, 'i')
    out = out.replace(pattern, '').trim()
  }
  return out
}

export interface NameableItem {
  brand?: string | null
  model?: string | null
  name?: string | null
}

/**
 * The canonical display name: **"Brand Model — Descriptor"**.
 *
 * Every part is optional and the separators collapse gracefully, because the
 * quote form has no required fields — a line item may be nothing but a
 * hand-typed phrase, and that still has to render sensibly.
 */
export function formatItemDisplayName(item: NameableItem): string {
  const brand = canonicalizeBrand(item.brand)
  const model = canonicalizeModel(item.model, item.brand)
  const rawName = item.name?.trim() ?? ''
  const descriptor = rawName ? cleanDescriptor(rawName, brand, model) : ''

  const identity = [brand, model].filter(Boolean).join(' ')
  if (identity && descriptor) return `${identity} — ${descriptor}`
  if (identity) return identity
  if (descriptor) return descriptor
  // Nothing structured and nothing typed — better than rendering an empty cell.
  return rawName || 'Item'
}

/** Short form for tight spots (cart rows, chips): brand + model, or the name when there's no identity. */
export function formatItemShortName(item: NameableItem): string {
  const brand = canonicalizeBrand(item.brand)
  const model = canonicalizeModel(item.model, item.brand)
  const identity = [brand, model].filter(Boolean).join(' ')
  return identity || item.name?.trim() || 'Item'
}

/**
 * Build a descriptor from structured specs, so AI-resolved items get a
 * consistent spec line instead of whatever prose the model returned.
 * Order is deliberate: size, then type, then the electrical numbers a
 * car-audio buyer actually compares.
 */
export function buildDescriptorFromSpecs(
  specs: Record<string, unknown> | null | undefined,
  fallback?: string | null,
): string | null {
  if (!specs) return fallback?.trim() || null
  const parts: string[] = []

  const size = specs.size_in ?? specs.sizeIn
  if (typeof size === 'number' || (typeof size === 'string' && size.trim())) parts.push(`${size}"`)

  const type = specs.type ?? specs.product_type
  if (typeof type === 'string' && type.trim()) parts.push(type.trim())

  const impedance = specs.impedance ?? specs.ohms
  if (typeof impedance === 'string' && impedance.trim()) parts.push(impedance.trim())
  else if (typeof impedance === 'number') parts.push(`${impedance}Ω`)

  const channels = specs.channels
  if (typeof channels === 'number' && channels > 0) parts.push(`${channels}-channel`)

  const rms = specs.rms_watts ?? specs.rmsWatts
  if (typeof rms === 'number' && rms > 0) parts.push(`${rms}W RMS`)

  const fitment = specs.fitment
  if (typeof fitment === 'string' && fitment.trim()) parts.push(fitment.trim())

  if (parts.length === 0) return fallback?.trim() || null
  return parts.join(', ')
}

/**
 * Normalize whatever a resolver/import produced into the canonical shape
 * before it is written to the catalog. This is the choke point that keeps
 * AI output as consistent as hand-entered data — both go through here.
 */
export function canonicalizeProductFields(input: {
  brand?: string | null
  model?: string | null
  name?: string | null
  specs?: Record<string, unknown> | null
}): { brand: string | null; model: string | null; name: string } {
  const brand = canonicalizeBrand(input.brand)
  const model = canonicalizeModel(input.model, input.brand)
  const descriptor =
    buildDescriptorFromSpecs(input.specs, input.name) ?? (input.name?.trim() || null)
  const name = descriptor ? cleanDescriptor(descriptor, brand, model) : ''
  return {
    brand,
    model,
    // `name` holds the descriptor half only — the brand and model live in their
    // own columns, and formatItemDisplayName reassembles them. Storing the full
    // string here would reintroduce exactly the duplication this file exists to
    // prevent.
    name: name || input.name?.trim() || 'Item',
  }
}

/** Convenience for catalog rows, which carry the full CatalogItem shape. */
export function formatCatalogItemName(item: Pick<CatalogItem, 'brand' | 'model' | 'name'>): string {
  return formatItemDisplayName(item)
}
