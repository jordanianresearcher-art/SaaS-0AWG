// Window tint configuration. A quote can carry several named tint entries
// (e.g. "Full vehicle", "Front two only"), the same way it carries several
// pricing options. A small manual body-style picker per entry drives which
// windows are tintable, since NHTSA's free vehicle API can't reliably
// determine body class/window count from year+make+model alone (confirmed
// via direct testing — only a VIN-based lookup gives that, and this app
// doesn't collect VINs). Pricing is its own separate total shown alongside
// the Good/Better/Insane options — it never folds into quoteValueCents.

import { parseDollarsToCents } from './format'
import type { TintBodyStyle, TintType, TintWindowPosition, WindowTintConfig, WindowTintWindow } from '../types'

export const TINT_VLT_PERCENTS = [5, 20, 35, 50, 70] as const

export const BODY_STYLE_INFO: Record<
  TintBodyStyle,
  { label: string; windowCountLabel: string; windows: TintWindowPosition[] }
> = {
  sedan_coupe: {
    label: 'Sedan / Coupe',
    windowCountLabel: '5 windows',
    windows: ['front_left', 'front_right', 'rear_left', 'rear_right', 'back_glass'],
  },
  suv_wagon_van: {
    label: 'SUV / Wagon / Van / Ext. cab',
    windowCountLabel: '7 windows',
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
  totalCents: number
}

/** Pure display-ready summary — no JSX, used by quote detail, public page, and the email teaser line. */
export function summarizeWindowTint(config: WindowTintConfig): WindowTintSummary {
  const windowLines = config.windows
    .filter((w): w is typeof w & { vltPercent: number } => w.included && w.vltPercent !== null)
    .map((w) => ({ label: TINT_WINDOW_LABELS[w.position], vltPercent: w.vltPercent }))

  const percents = new Set(windowLines.map((w) => w.vltPercent))
  const uniformPercent = windowLines.length > 0 && percents.size === 1 ? windowLines[0].vltPercent : null

  return {
    name: config.name ?? '',
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
    totalCents: computeWindowTintTotalCents(config),
  }
}
