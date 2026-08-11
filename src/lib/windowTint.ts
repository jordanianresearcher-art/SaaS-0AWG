// Window tint configuration. A quote can carry several named tint entries
// (e.g. "Full vehicle", "Front two only"), the same way it carries several
// pricing options. A small manual body-style picker per entry drives which
// windows are tintable, since NHTSA's free vehicle API can't reliably
// determine body class/window count from year+make+model alone (confirmed
// via direct testing — only a VIN-based lookup gives that, and this app
// doesn't collect VINs). Pricing is its own separate total shown alongside
// the Good/Better/Insane options — it never folds into quoteValueCents.

import { TINT_VISUAL_SLOT_POSITIONS, type TintVisualSlot } from './carDiagrams'
import { parseDollarsToCents } from './format'
import type { SunroofType, TintBodyStyle, TintType, TintWindowPosition, WindowTintConfig, WindowTintWindow } from '../types'

export const TINT_VLT_PERCENTS = [5, 20, 35, 50, 70] as const

// 7 real body shapes (was a coarse 2-way sedan_coupe/suv_wagon_van split) —
// each maps to its own diagram in src/lib/carDiagrams.ts and its own real
// window layout, so the checklist actually matches what's parked outside.
export const BODY_STYLE_INFO: Record<
  TintBodyStyle,
  { label: string; windowCountLabel: string; windows: TintWindowPosition[] }
> = {
  coupe: {
    label: 'Coupe',
    windowCountLabel: '5 windows',
    windows: ['front_left', 'front_right', 'rear_quarter_left', 'rear_quarter_right', 'back_glass'],
  },
  sedan: {
    label: 'Sedan',
    windowCountLabel: '5 windows',
    windows: ['front_left', 'front_right', 'rear_left', 'rear_right', 'back_glass'],
  },
  truck_single_cab: {
    label: 'Truck — single cab',
    windowCountLabel: '3 windows',
    windows: ['front_left', 'front_right', 'back_glass'],
  },
  truck_crew_cab: {
    label: 'Truck — crew/ext. cab',
    windowCountLabel: '5 windows',
    windows: ['front_left', 'front_right', 'rear_left', 'rear_right', 'back_glass'],
  },
  suv_4_window: {
    label: 'SUV — 4 window',
    windowCountLabel: '4 door windows + rear glass',
    windows: ['front_left', 'front_right', 'rear_left', 'rear_right', 'back_glass'],
  },
  suv_6_window: {
    label: 'SUV — 6 window',
    windowCountLabel: '6 door windows + rear glass',
    windows: [
      'front_left',
      'front_right',
      'rear_left',
      'rear_right',
      'rear_quarter_left',
      'rear_quarter_right',
      'back_glass',
    ],
  },
  minivan: {
    label: 'Minivan',
    windowCountLabel: '6 windows + rear glass',
    windows: [
      'front_left',
      'front_right',
      'rear_left',
      'rear_right',
      'rear_quarter_left',
      'rear_quarter_right',
      'back_glass',
    ],
  },
}

/** Ordered for the body-style picker — roughly small-to-large, grouped by silhouette family. */
export const BODY_STYLE_ORDER: TintBodyStyle[] = [
  'coupe',
  'sedan',
  'truck_single_cab',
  'truck_crew_cab',
  'suv_4_window',
  'suv_6_window',
  'minivan',
]

/** Friendly names for the *visual* slot a window belongs to (see TintVisualSlot in carDiagrams.ts) — driver/passenger sides collapse into one label since a shop almost always tints them identically. Used for both the editable checklist and the display summary. */
export const TINT_SLOT_LABEL: Record<TintVisualSlot, string> = {
  front: 'Front windows',
  rear: 'Rear windows',
  quarter: 'Rear quarter windows',
  back_glass: 'Back glass',
}

/** Display order for the visual slots wherever they're listed. */
export const TINT_SLOT_ORDER: TintVisualSlot[] = ['front', 'rear', 'quarter', 'back_glass']

export const SUNROOF_TYPE_INFO: Record<SunroofType, { label: string }> = {
  single: { label: 'Single sunroof' },
  double: { label: 'Panoramic / double sunroof' },
}

export const TINT_WINDOW_LABELS: Record<TintWindowPosition, string> = {
  front_left: 'Front left',
  front_right: 'Front right',
  rear_left: 'Rear left',
  rear_right: 'Rear right',
  rear_quarter_left: 'Rear quarter left',
  rear_quarter_right: 'Rear quarter right',
  back_glass: 'Back glass',
}

export const TINT_TYPE_INFO: Record<TintType, { label: string; hint: string }> = {
  normal: { label: 'Normal', hint: 'Standard dyed film.' },
  ceramic: { label: 'Ceramic', hint: 'Better heat rejection — costs more.' },
}

/**
 * Form-editing shape — money fields are dollar strings (blank = not priced
 * yet), matching how option price/deposit fields work elsewhere on the
 * Create Quote page. Converted to/from WindowTintConfig (cents, persisted)
 * at the form boundary.
 */
export interface WindowTintFormValues {
  name: string
  bodyStyle: TintBodyStyle
  tintType: TintType
  windows: WindowTintWindow[]
  price: string
  removeOldTint: boolean
  removeOldTintPrice: string
  windshieldIncluded: boolean
  windshieldVltPercent: number | null
  windshieldPrice: string
  sunroofIncluded: boolean
  sunroofType: SunroofType | null
  sunroofVltPercent: number | null
  sunroofPrice: string
}

/** Fresh window list for a body style — used both for a brand-new entry and when an existing entry switches body style (name/price/tintType carry over, only the windows reset). */
export function windowsForBodyStyle(bodyStyle: TintBodyStyle): WindowTintWindow[] {
  return BODY_STYLE_INFO[bodyStyle].windows.map((position) => ({
    position,
    included: true,
    vltPercent: null,
  }))
}

export function createDefaultWindowTintFormValues(bodyStyle: TintBodyStyle, name = ''): WindowTintFormValues {
  return {
    name,
    bodyStyle,
    tintType: 'normal',
    windows: windowsForBodyStyle(bodyStyle),
    price: '',
    removeOldTint: false,
    removeOldTintPrice: '',
    windshieldIncluded: false,
    windshieldVltPercent: null,
    windshieldPrice: '',
    sunroofIncluded: false,
    sunroofType: null,
    sunroofVltPercent: null,
    sunroofPrice: '',
  }
}

export function windowTintFormValuesToConfig(form: WindowTintFormValues): WindowTintConfig {
  return {
    name: form.name.trim(),
    bodyStyle: form.bodyStyle,
    tintType: form.tintType,
    windows: form.windows,
    priceCents: form.price.trim() ? parseDollarsToCents(form.price) : null,
    removeOldTint: form.removeOldTint,
    removeOldTintPriceCents:
      form.removeOldTint && form.removeOldTintPrice.trim() ? parseDollarsToCents(form.removeOldTintPrice) : null,
    windshieldIncluded: form.windshieldIncluded,
    windshieldVltPercent: form.windshieldVltPercent,
    windshieldPriceCents:
      form.windshieldIncluded && form.windshieldPrice.trim() ? parseDollarsToCents(form.windshieldPrice) : null,
    sunroofIncluded: form.sunroofIncluded,
    sunroofType: form.sunroofIncluded ? form.sunroofType : null,
    sunroofVltPercent: form.sunroofIncluded ? form.sunroofVltPercent : null,
    sunroofPriceCents: form.sunroofIncluded && form.sunroofPrice.trim() ? parseDollarsToCents(form.sunroofPrice) : null,
  }
}

export function windowTintConfigToFormValues(config: WindowTintConfig): WindowTintFormValues {
  return {
    name: config.name ?? '',
    bodyStyle: config.bodyStyle,
    tintType: config.tintType ?? 'normal',
    windows: config.windows,
    price: config.priceCents != null ? (config.priceCents / 100).toString() : '',
    removeOldTint: config.removeOldTint ?? false,
    removeOldTintPrice: config.removeOldTintPriceCents != null ? (config.removeOldTintPriceCents / 100).toString() : '',
    windshieldIncluded: config.windshieldIncluded,
    windshieldVltPercent: config.windshieldVltPercent,
    windshieldPrice: config.windshieldPriceCents != null ? (config.windshieldPriceCents / 100).toString() : '',
    sunroofIncluded: config.sunroofIncluded ?? false,
    sunroofType: config.sunroofType ?? null,
    sunroofVltPercent: config.sunroofVltPercent ?? null,
    sunroofPrice: config.sunroofPriceCents != null ? (config.sunroofPriceCents / 100).toString() : '',
  }
}

/**
 * Total tint price across every priced situation that actually applies.
 * Reads every money field defensively (?? 0) so a pre-existing window_tint
 * JSONB blob from before pricing existed — missing these keys entirely —
 * contributes 0 rather than throwing.
 */
export function computeWindowTintTotalCents(config: WindowTintConfig): number {
  let total = config.priceCents ?? 0
  if (config.removeOldTint) total += config.removeOldTintPriceCents ?? 0
  if (config.windshieldIncluded) total += config.windshieldPriceCents ?? 0
  if (config.sunroofIncluded) total += config.sunroofPriceCents ?? 0
  return total
}

export interface WindowTintSummary {
  name: string
  bodyStyleLabel: string
  tintTypeLabel: string
  windowLines: Array<{ label: string; vltPercent: number }>
  /** Set when every included window shares one percentage, for a collapsed display. */
  uniformPercent: number | null
  priceCents: number | null
  removeOldTint: { priceCents: number | null } | null
  windshield: { vltPercent: number; priceCents: number | null } | null
  sunroof: { typeLabel: string; vltPercent: number; priceCents: number | null } | null
  totalCents: number
}

/**
 * Pure display-ready summary — no JSX, used by quote detail, public page,
 * and the email teaser line. Groups driver/passenger-side windows into one
 * line per visual slot (front/rear/quarter/back glass) since a shop almost
 * always tints both sides the same — only falls back to a per-window line
 * when a slot's two sides genuinely differ, so nothing is ever hidden.
 */
export function summarizeWindowTint(config: WindowTintConfig): WindowTintSummary {
  const windowLines: Array<{ label: string; vltPercent: number }> = []
  for (const slot of TINT_SLOT_ORDER) {
    const positions = TINT_VISUAL_SLOT_POSITIONS[slot]
    const included = config.windows.filter(
      (w): w is typeof w & { vltPercent: number } => positions.includes(w.position) && w.included && w.vltPercent !== null,
    )
    if (included.length === 0) continue
    const percents = new Set(included.map((w) => w.vltPercent))
    if (percents.size === 1) {
      windowLines.push({ label: TINT_SLOT_LABEL[slot], vltPercent: included[0].vltPercent })
    } else {
      for (const w of included) windowLines.push({ label: TINT_WINDOW_LABELS[w.position], vltPercent: w.vltPercent })
    }
  }

  const percents = new Set(windowLines.map((w) => w.vltPercent))
  const uniformPercent = windowLines.length > 0 && percents.size === 1 ? windowLines[0].vltPercent : null

  return {
    name: config.name?.trim() || 'Tint option',
    bodyStyleLabel: BODY_STYLE_INFO[config.bodyStyle].label,
    tintTypeLabel: TINT_TYPE_INFO[config.tintType ?? 'normal'].label,
    windowLines,
    uniformPercent,
    priceCents: config.priceCents ?? null,
    removeOldTint: config.removeOldTint ? { priceCents: config.removeOldTintPriceCents ?? null } : null,
    windshield:
      config.windshieldIncluded && config.windshieldVltPercent !== null
        ? { vltPercent: config.windshieldVltPercent, priceCents: config.windshieldPriceCents ?? null }
        : null,
    sunroof:
      config.sunroofIncluded && config.sunroofVltPercent !== null
        ? {
            typeLabel: SUNROOF_TYPE_INFO[config.sunroofType ?? 'single'].label,
            vltPercent: config.sunroofVltPercent,
            priceCents: config.sunroofPriceCents ?? null,
          }
        : null,
    totalCents: computeWindowTintTotalCents(config),
  }
}
