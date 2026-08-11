import { describe, expect, it } from 'vitest'
import {
  computeWindowTintTotalCents,
  createDefaultWindowTintFormValues,
  summarizeWindowTint,
  windowsForBodyStyle,
  windowTintConfigToFormValues,
  windowTintFormValuesToConfig,
} from './windowTint'
import type { WindowTintConfig } from '../types'

describe('createDefaultWindowTintFormValues', () => {
  it('produces 5 windows for a sedan, all included with no percent yet', () => {
    const form = createDefaultWindowTintFormValues('sedan')
    expect(form.windows).toHaveLength(5)
    expect(form.windows.every((w) => w.included && w.vltPercent === null)).toBe(true)
    expect(form.name).toBe('')
    expect(form.tintType).toBe('normal')
    expect(form.price).toBe('')
    expect(form.removeOldTint).toBe(false)
    expect(form.windshieldIncluded).toBe(false)
  })

  it('produces 7 windows for a 6-window SUV', () => {
    const form = createDefaultWindowTintFormValues('suv_6_window')
    expect(form.windows).toHaveLength(7)
    expect(form.windows.map((w) => w.position)).toContain('rear_quarter_left')
  })

  it('accepts a name for the entry', () => {
    const form = createDefaultWindowTintFormValues('sedan', 'Front two only')
    expect(form.name).toBe('Front two only')
  })
})

describe('windowsForBodyStyle', () => {
  it('resets to a fresh window list for the given body style, independent of any existing entry', () => {
    expect(windowsForBodyStyle('sedan')).toHaveLength(5)
    expect(windowsForBodyStyle('suv_6_window')).toHaveLength(7)
    expect(windowsForBodyStyle('sedan').every((w) => w.included && w.vltPercent === null)).toBe(true)
  })
})

describe('windowTintFormValuesToConfig', () => {
  it('parses dollar strings to cents for every priced situation', () => {
    const form = {
      ...createDefaultWindowTintFormValues('sedan', '  Full vehicle  '),
      tintType: 'ceramic' as const,
      price: '450',
      removeOldTint: true,
      removeOldTintPrice: '50',
      windshieldIncluded: true,
      windshieldVltPercent: 70,
      windshieldPrice: '120.50',
    }
    const config = windowTintFormValuesToConfig(form)
    expect(config.name).toBe('Full vehicle')
    expect(config.priceCents).toBe(45000)
    expect(config.removeOldTintPriceCents).toBe(5000)
    expect(config.windshieldPriceCents).toBe(12050)
    expect(config.tintType).toBe('ceramic')
  })

  it('leaves a price null when blank, and ignores prices for unchecked add-ons', () => {
    const form = createDefaultWindowTintFormValues('sedan')
    const config = windowTintFormValuesToConfig({ ...form, removeOldTintPrice: '50', windshieldPrice: '80' })
    expect(config.priceCents).toBeNull()
    // removeOldTint/windshieldIncluded are both false, so their prices are dropped even though typed
    expect(config.removeOldTintPriceCents).toBeNull()
    expect(config.windshieldPriceCents).toBeNull()
  })
})

describe('windowTintConfigToFormValues', () => {
  it('round-trips through form values and back to an equivalent config', () => {
    const original: WindowTintConfig = {
      name: 'Full vehicle',
      bodyStyle: 'suv_6_window',
      tintType: 'ceramic',
      windows: createDefaultWindowTintFormValues('suv_6_window').windows.map((w) => ({ ...w, vltPercent: 20 })),
      priceCents: 45000,
      removeOldTint: true,
      removeOldTintPriceCents: 5000,
      windshieldIncluded: true,
      windshieldVltPercent: 70,
      windshieldPriceCents: 12000,
      sunroofIncluded: true,
      sunroofType: 'double',
      sunroofVltPercent: 20,
      sunroofPriceCents: 9000,
    }
    const form = windowTintConfigToFormValues(original)
    expect(form.price).toBe('450')
    expect(form.removeOldTintPrice).toBe('50')
    expect(form.windshieldPrice).toBe('120')
    expect(form.sunroofPrice).toBe('90')
    expect(form.sunroofType).toBe('double')
    const roundTripped = windowTintFormValuesToConfig(form)
    expect(roundTripped).toEqual(original)
  })

  it('defaults name, tintType, and removeOldTint for a pre-pricing config missing those keys', () => {
    const legacy = { bodyStyle: 'sedan', windows: [], windshieldIncluded: false, windshieldVltPercent: null } as unknown as WindowTintConfig
    const form = windowTintConfigToFormValues(legacy)
    expect(form.name).toBe('')
    expect(form.tintType).toBe('normal')
    expect(form.removeOldTint).toBe(false)
  })
})

describe('computeWindowTintTotalCents', () => {
  const base: WindowTintConfig = {
    name: 'Full vehicle',
    bodyStyle: 'sedan',
    tintType: 'normal',
    windows: [],
    priceCents: 25000,
    removeOldTint: false,
    removeOldTintPriceCents: null,
    windshieldIncluded: false,
    windshieldVltPercent: null,
    windshieldPriceCents: null,
    sunroofIncluded: false,
    sunroofType: null,
    sunroofVltPercent: null,
    sunroofPriceCents: null,
  }

  it('sums only the base price when no add-ons are active', () => {
    expect(computeWindowTintTotalCents(base)).toBe(25000)
  })

  it('adds removal price only when removeOldTint is true', () => {
    expect(computeWindowTintTotalCents({ ...base, removeOldTintPriceCents: 5000 })).toBe(25000)
    expect(computeWindowTintTotalCents({ ...base, removeOldTint: true, removeOldTintPriceCents: 5000 })).toBe(30000)
  })

  it('adds windshield price only when windshieldIncluded is true', () => {
    expect(computeWindowTintTotalCents({ ...base, windshieldPriceCents: 12000 })).toBe(25000)
    expect(computeWindowTintTotalCents({ ...base, windshieldIncluded: true, windshieldPriceCents: 12000 })).toBe(37000)
  })

  it('adds sunroof price only when sunroofIncluded is true', () => {
    expect(computeWindowTintTotalCents({ ...base, sunroofPriceCents: 9000 })).toBe(25000)
    expect(computeWindowTintTotalCents({ ...base, sunroofIncluded: true, sunroofPriceCents: 9000 })).toBe(34000)
  })

  it('sums everything when every add-on is active', () => {
    expect(
      computeWindowTintTotalCents({
        ...base,
        removeOldTint: true,
        removeOldTintPriceCents: 5000,
        windshieldIncluded: true,
        windshieldPriceCents: 12000,
        sunroofIncluded: true,
        sunroofPriceCents: 9000,
      }),
    ).toBe(51000)
  })

  it('treats missing/null prices as zero, never throwing', () => {
    expect(
      computeWindowTintTotalCents({ ...base, priceCents: null, removeOldTint: true, windshieldIncluded: true, sunroofIncluded: true }),
    ).toBe(0)
  })
})

describe('summarizeWindowTint', () => {
  it('collapses to a uniform percent when every included window shares one', () => {
    const form = createDefaultWindowTintFormValues('sedan')
    const config = windowTintFormValuesToConfig({
      ...form,
      windows: form.windows.map((w) => ({ ...w, vltPercent: 20 })),
    })
    const summary = summarizeWindowTint(config)
    expect(summary.uniformPercent).toBe(20)
    // A sedan's 5 physical windows (front L/R, rear L/R, back glass) group
    // into 3 visual slots (front, rear, back glass) — left/right no longer
    // get their own line since they're tinted identically here.
    expect(summary.windowLines).toHaveLength(3)
    expect(summary.windowLines.map((w) => w.label)).toEqual(['Front windows', 'Rear windows', 'Back glass'])
  })

  it('returns per-window lines only for a slot whose two sides genuinely differ', () => {
    const form = createDefaultWindowTintFormValues('sedan')
    const config = windowTintFormValuesToConfig({
      ...form,
      // front_left and front_right disagree -> that slot splits back into
      // two lines; rear stays collapsed since both sides match.
      windows: form.windows.map((w) => ({
        ...w,
        vltPercent: w.position === 'front_left' ? 5 : w.position === 'front_right' ? 35 : 35,
      })),
    })
    const summary = summarizeWindowTint(config)
    expect(summary.uniformPercent).toBeNull()
    expect(summary.windowLines.map((w) => w.label)).toEqual(['Front left', 'Front right', 'Rear windows', 'Back glass'])
  })

  it('includes name, tint type, base price, removal, windshield, sunroof, and a total', () => {
    const config = windowTintFormValuesToConfig({
      ...createDefaultWindowTintFormValues('suv_6_window', 'Full vehicle'),
      tintType: 'ceramic',
      price: '450',
      removeOldTint: true,
      removeOldTintPrice: '50',
      windshieldIncluded: true,
      windshieldVltPercent: 70,
      windshieldPrice: '120',
      sunroofIncluded: true,
      sunroofType: 'double',
      sunroofVltPercent: 20,
      sunroofPrice: '90',
    })
    const summary = summarizeWindowTint(config)
    expect(summary.name).toBe('Full vehicle')
    expect(summary.tintTypeLabel).toBe('Ceramic')
    expect(summary.priceCents).toBe(45000)
    expect(summary.removeOldTint).toEqual({ priceCents: 5000 })
    expect(summary.windshield).toEqual({ vltPercent: 70, priceCents: 12000 })
    expect(summary.sunroof).toEqual({ typeLabel: 'Panoramic / double sunroof', vltPercent: 20, priceCents: 9000 })
    expect(summary.totalCents).toBe(45000 + 5000 + 12000 + 9000)
  })

  it('omits removal, windshield, and sunroof summaries when none are active', () => {
    const config = windowTintFormValuesToConfig(createDefaultWindowTintFormValues('sedan'))
    const summary = summarizeWindowTint(config)
    expect(summary.removeOldTint).toBeNull()
    expect(summary.windshield).toBeNull()
    expect(summary.sunroof).toBeNull()
    expect(summary.totalCents).toBe(0)
  })
})
