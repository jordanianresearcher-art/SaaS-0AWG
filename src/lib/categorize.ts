// Best-effort category guessing from a product's own name/description text —
// used for auto-categorizing catalog items that have no Shopify productType
// to go on (manually-entered products, or ones Shopify import left
// uncategorized). Mirrors the approach in shopifyImport.ts's
// guessCategoryFromProductType, but matches against free-text name/
// description instead of a structured productType field, since that's the
// only signal available for a manually-added product.
//
// Never an authoritative compatibility/classification claim — just a
// labeling convenience staff can always correct (in the catalog edit modal
// or the drag-and-drop organizer). A miss leaves category: null rather than
// guessing wrong.
//
// Order matters: more specific patterns are checked before broader ones
// that would otherwise shadow them (e.g. "Amp Wiring Kit" must hit
// wiring_kit, not multi_amp, so wiring_kit is checked first).

import type { ProductCategory } from '../types'

const NAME_CATEGORY_HINTS: Array<{ pattern: RegExp; category: ProductCategory }> = [
  // Enclosure before the generic subwoofer pattern — "Sub Box"/"Ported Sub
  // Enclosure"/"Loaded Sub" would otherwise match \bsub\b first.
  { pattern: /enclosure|\bbox\b|ported|sealed (sub|box)|bandpass|\bloaded\b/i, category: 'enclosure' },
  { pattern: /subwoofer|\bsubs?\b/i, category: 'subwoofer' },
  // Wiring/amp kits before the bare "amp" patterns — "Amp Wiring Kit"/"4 Gauge Amp
  // Kit" would otherwise match amp(lifier)? first and land as multi_amp.
  { pattern: /wiring kit|amp kit|wire kit|install(ation)? kit|\d[\s-]?gauge kit|power kit/i, category: 'wiring_kit' },
  { pattern: /mono.?block|mono.*amp/i, category: 'mono_amp' },
  { pattern: /amp(lifier)?\b/i, category: 'multi_amp' },
  { pattern: /line output converter|\bloc\b/i, category: 'integration' },
  { pattern: /bass knob|bass control|bass remote|remote level control|\brlc\b/i, category: 'bass_control' },
  { pattern: /\bbatter(y|ies)\b|\bagm\b battery|lithium battery/i, category: 'battery' },
  { pattern: /big.?three|big.?3\b/i, category: 'big_three' },
  { pattern: /epicenter|bass restoration|bass reconstruction/i, category: 'epicenter' },
  { pattern: /integration module|steering wheel control|\bswc\b|oem.*bypass|\bcan.?bus\b/i, category: 'integration_module' },
  { pattern: /sound deaden|dampen|damping mat|sound treatment|\bbutyl\b|\bmlv\b|jute pad/i, category: 'sound_treatment' },
  { pattern: /\bofc\b wir|oxygen.?free copper/i, category: 'ofc_wiring' },
  { pattern: /tweeter/i, category: 'tweeter' },
  {
    pattern: /coax(ial)?|component|door speaker|rear deck|midrange|full.?range|\bspeakers?\b/i,
    category: 'door_speaker',
  },
  {
    pattern: /head unit|receiver|\bradio\b|\bstereo\b|multimedia|carplay|android auto|touchscreen/i,
    category: 'radio',
  },
  { pattern: /\bdsp\b|sound processor|digital signal processor/i, category: 'dsp' },
  { pattern: /\bcamera\b|backup cam|dash ?cam|rear.?view/i, category: 'camera' },
  { pattern: /fiberglass|fabrication|\bmdf\b|carpet kit/i, category: 'fabrication' },
  { pattern: /\blabor\b|installation fee/i, category: 'labor' },
  // Broad accessory catch-alls last — least specific, checked only once nothing
  // more precise above has already matched.
  {
    pattern: /capacitor|fuse holder|\banl fuse\b|distribution block|rca cable|remote turn.?on|\bantenna\b|mounting bracket|dash kit/i,
    category: 'accessory',
  },
]

export function guessCategoryFromName(name: string, description?: string | null): ProductCategory | null {
  const haystack = `${name} ${description ?? ''}`
  for (const { pattern, category } of NAME_CATEGORY_HINTS) {
    if (pattern.test(haystack)) return category
  }
  return null
}
