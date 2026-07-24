import { describe, expect, it } from 'vitest'
import {
  computeWindowTintTotalCents,
  createDefaultWindowTintFormValues,
  summarizeWindowTint,
  windowTintConfigToFormValues,
  windowTintFormValuesToConfig,
} from './windowTint'
import type { WindowTintConfig } from '../types'

describe('createDefaultWindowTintFormValues', () => {
  it('produces 5 windows for sedan/coupe, all included with no percent yet', () => {
    const form = createDefaultWindowTintFormValues('sedan_coupe')
    expect(form.windows).toHaveLength(5)
    expect(form.windows.every((w) => w.included && w.vltPercent === null)).toBe(true)
    expect(form.tintType).toBe('normal')
    expect(form.price).toBe('')
    expect(form.removeOldTint).toBe(false)
    expect(form.windshieldIncluded).toBe(false)
  })

  it('produces 7 windows for suv/wagon/van', () => {
    const form = createDefaultWindowTintFormValues('suv_wagon_van')
    expect(form.windows).toHaveLength(7)
    expect(form.windows.map((w) => w.position)).toContain('rear_quarter_left')
  })
})

describe('windowTintFormValuesToConfig', () => {
  it('parses dollar strings to cents for every priced situation', () => {
    const form = {
      ...createDefaultWindowTintFormValues('sedan_coupe'),
      tintType: 'ceramic' as const,
      price: '450',
      removeOldTint: true,
      removeOldTintPrice: '50',
      windshieldIncluded: true,
      windshieldVltPercent: 70,
      windshieldPrice: '120.50',
    }
    const config = windowTintFormValuesToConfig(form)
    expect(config.priceCents).toBe(45000)
    expect(config.removeOldTintPriceCents).toBe(5000)
    expect(config.windshieldPriceCents).toBe(12050)
    expect(config.tintType).toBe('ceramic')
  })

  it('leaves a price null when blank, and ignores prices for unchecked add-ons', () => {
    const form = createDefaultWindowTintFormValues('sedan_coupe')
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
      bodyStyle: 'suv_wagon_van',
      tintType: 'ceramic',
      windows: createDefaultWindowTintFormValues('suv_wagon_van').windows.map((w) => ({ ...w, vltPercent: 20 })),
      priceCents: 45000,
      removeOldTint: true,
      removeOldTintPriceCents: 5000,
      windshieldIncluded: true,
      windshieldVltPercent: 70,
      windshieldPriceCents: 12000,
    }
    const form = windowTintConfigToFormValues(original)
    expect(form.price).toBe('450')
    expect(form.removeOldTintPrice).toBe('50')
    expect(form.windshieldPrice).toBe('120')
    const roundTripped = windowTintFormValuesToConfig(form)
    expect(roundTripped).toEqual(original)
  })

  it('defaults tintType and removeOldTint for a pre-pricing config missing those keys', () => {
    const legacy = { bodyStyle: 'sedan_coupe', windows: [], windshieldIncluded: false, windshieldVltPercent: null } as unknown as WindowTintConfig
    const form = windowTintConfigToFormValues(legacy)
    expect(form.tintType).toBe('normal')
    expect(form.removeOldTint).toBe(false)
  })
})

describe('computeWindowTintTotalCents', () => {
  const base: WindowTintConfig = {
    bodyStyle: 'sedan_coupe',
    tintType: 'normal',
    windows: [],
    priceCents: 25000,
    removeOldTint: false,
    removeOldTintPriceCents: null,
    windshieldIncluded: false,
    windshieldVltPercent: null,
    windshieldPriceCents: null,
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

  it('sums all three when everything is active', () => {
    expect(
      computeWindowTintTotalCents({
        ...base,
        removeOldTint: true,
        removeOldTintPriceCents: 5000,
        windshieldIncluded: true,
        windshieldPriceCents: 12000,
      }),
    ).toBe(42000)
  })

  it('treats missing/null prices as zero, never throwing', () => {
    expect(computeWindowTintTotalCents({ ...base, priceCents: null, removeOldTint: true, windshieldIncluded: true })).toBe(0)
  })
})

describe('summarizeWindowTint', () => {
  it('collapses to a uniform percent when every included window shares one', () => {
    const form = createDefaultWindowTintFormValues('sedan_coupe')
    const config = windowTintFormValuesToConfig({
      ...form,
      windows: form.windows.map((w) => ({ ...w, vltPercent: 20 })),
    })
    const summary = summarizeWindowTint(config)
    expect(summary.uniformPercent).toBe(20)
    expect(summary.windowLines).toHaveLength(5)
  })

  it('returns per-window lines when percentages differ', () => {
    const form = createDefaultWindowTintFormValues('sedan_coupe')
    const config = windowTintFormValuesToConfig({
      ...form,
      windows: form.windows.map((w, i) => ({ ...w, vltPercent: i === 0 ? 5 : 35 })),
    })
    const summary = summarizeWindowTint(config)
    expect(summary.uniformPercent).toBeNull()
    expect(summary.windowLines).toHaveLength(5)
  })

  it('includes tint type, base price, removal, windshield, and a total', () => {
    const config = windowTintFormValuesToConfig({
      ...createDefaultWindowTintFormValues('suv_wagon_van'),
      tintType: 'ceramic',
      price: '450',
      removeOldTint: true,
      removeOldTintPrice: '50',
      windshieldIncluded: true,
      windshieldVltPercent: 70,
      windshieldPrice: '120',
    })
    const summary = summarizeWindowTint(config)
    expect(summary.tintTypeLabel).toBe('Ceramic')
    expect(summary.priceCents).toBe(45000)
    expect(summary.removeOldTint).toEqual({ priceCents: 5000 })
    expect(summary.windshield).toEqual({ vltPercent: 70, priceCents: 12000 })
    expect(summary.totalCents).toBe(45000 + 5000 + 12000)
  })

  it('omits removal and windshield summaries when neither is active', () => {
    const config = windowTintFormValuesToConfig(createDefaultWindowTintFormValues('sedan_coupe'))
    const summary = summarizeWindowTint(config)
    expect(summary.removeOldTint).toBeNull()
    expect(summary.windshield).toBeNull()
    expect(summary.totalCents).toBe(0)
  })
})
