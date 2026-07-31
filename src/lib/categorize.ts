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

import type { ProductCategory } from '../types'

const NAME_CATEGORY_HINTS: Array<{ pattern: RegExp; category: ProductCategory }> = [
  // Enclosure checked before the generic subwoofer pattern — "Sub Box"/"Ported Sub
  // Enclosure" would otherwise match \bsub\b first and land as subwoofer, not enclosure.
  { pattern: /enclosure|\bbox\b|ported|bandpass/i, category: 'enclosure' },
  { pattern: /subwoofer|\bsub\b/i, category: 'subwoofer' },
  // Wiring/amp kits checked before the bare "amp" pattern — "Amp Wiring Kit" would
  // otherwise match amp(lifier)? first and land as multi_amp, not wiring_kit.
  { pattern: /wiring kit|amp kit|wire kit/i, category: 'wiring_kit' },
  { pattern: /mono.?block|mono.*amp/i, category: 'mono_amp' },
  { pattern: /amp(lifier)?/i, category: 'multi_amp' },
  { pattern: /line output converter|\bloc\b/i, category: 'integration' },
  { pattern: /bass knob|bass control|bass remote/i, category: 'bass_control' },
  { pattern: /\bbattery\b/i, category: 'battery' },
  { pattern: /big.?three|big.?3\b/i, category: 'big_three' },
  { pattern: /epicenter|bass restoration/i, category: 'epicenter' },
  { pattern: /integration module|steering wheel control|\bswc\b|oem.*bypass/i, category: 'integration_module' },
  { pattern: /sound deaden|dampen|damping mat|sound treatment/i, category: 'sound_treatment' },
  { pattern: /ofc wir|oxygen.?free copper/i, category: 'ofc_wiring' },
  { pattern: /tweeter/i, category: 'tweeter' },
  { pattern: /coax|component|door speaker|rear deck|midrange|\bspeaker/i, category: 'door_speaker' },
  { pattern: /head unit|receiver|\bradio\b|\bstereo\b/i, category: 'radio' },
  { pattern: /\bdsp\b|processor/i, category: 'dsp' },
  { pattern: /camera|backup cam|dash cam/i, category: 'camera' },
  { pattern: /fiberglass|fabrication|\bmdf\b|carpet kit/i, category: 'fabrication' },
  { pattern: /\blabor\b|installation fee/i, category: 'labor' },
]

export function guessCategoryFromName(name: string, description?: string | null): ProductCategory | null {
  const haystack = `${name} ${description ?? ''}`
  for (const { pattern, category } of NAME_CATEGORY_HINTS) {
    if (pattern.test(haystack)) return category
  }
  return null
}
