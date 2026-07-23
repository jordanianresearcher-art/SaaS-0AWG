// Window tint configuration — purely descriptive (no price attached). A
// small manual body-style picker drives which windows are tintable, since
// NHTSA's free vehicle API can't reliably determine body class/window
// count from year+make+model alone (confirmed via direct testing — only a
// VIN-based lookup gives that, and this app doesn't collect VINs).

import type { TintBodyStyle, TintWindowPosition, WindowTintConfig } from '../types'

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

export function createDefaultWindowTintConfig(bodyStyle: TintBodyStyle): WindowTintConfig {
  return {
    bodyStyle,
    windows: BODY_STYLE_INFO[bodyStyle].windows.map((position) => ({
      position,
      included: true,
      vltPercent: null,
    })),
    windshieldIncluded: false,
    windshieldVltPercent: null,
  }
}

export interface WindowTintSummary {
  bodyStyleLabel: string
  windowLines: Array<{ label: string; vltPercent: number }>
  /** Set when every included window shares one percentage, for a collapsed display. */
  uniformPercent: number | null
  windshield: { vltPercent: number } | null
}

/** Pure display-ready summary — no JSX, used by quote detail, public page, and the email teaser line. */
export function summarizeWindowTint(config: WindowTintConfig): WindowTintSummary {
  const windowLines = config.windows
    .filter((w): w is typeof w & { vltPercent: number } => w.included && w.vltPercent !== null)
    .map((w) => ({ label: TINT_WINDOW_LABELS[w.position], vltPercent: w.vltPercent }))

  const percents = new Set(windowLines.map((w) => w.vltPercent))
  const uniformPercent = windowLines.length > 0 && percents.size === 1 ? windowLines[0].vltPercent : null

  return {
    bodyStyleLabel: BODY_STYLE_INFO[config.bodyStyle].label,
    windowLines,
    uniformPercent,
    windshield:
      config.windshieldIncluded && config.windshieldVltPercent !== null
        ? { vltPercent: config.windshieldVltPercent }
        : null,
  }
}
