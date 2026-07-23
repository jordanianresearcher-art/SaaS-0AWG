import { describe, expect, it } from 'vitest'
import { createDefaultWindowTintConfig, summarizeWindowTint } from './windowTint'

describe('createDefaultWindowTintConfig', () => {
  it('produces 5 windows for sedan/coupe', () => {
    const config = createDefaultWindowTintConfig('sedan_coupe')
    expect(config.windows).toHaveLength(5)
    expect(config.windows.every((w) => w.included && w.vltPercent === null)).toBe(true)
    expect(config.windshieldIncluded).toBe(false)
  })

  it('produces 7 windows for suv/wagon/van', () => {
    const config = createDefaultWindowTintConfig('suv_wagon_van')
    expect(config.windows).toHaveLength(7)
    expect(config.windows.map((w) => w.position)).toContain('rear_quarter_left')
  })
})

describe('summarizeWindowTint', () => {
  it('collapses to a uniform percent when every included window shares one', () => {
    const config = createDefaultWindowTintConfig('sedan_coupe')
    config.windows = config.windows.map((w) => ({ ...w, vltPercent: 20 }))
    const summary = summarizeWindowTint(config)
    expect(summary.uniformPercent).toBe(20)
    expect(summary.windowLines).toHaveLength(5)
  })

  it('returns per-window lines when percentages differ', () => {
    const config = createDefaultWindowTintConfig('sedan_coupe')
    config.windows = config.windows.map((w, i) => ({ ...w, vltPercent: i === 0 ? 5 : 35 }))
    const summary = summarizeWindowTint(config)
    expect(summary.uniformPercent).toBeNull()
    expect(summary.windowLines).toHaveLength(5)
  })

  it('omits excluded windows and windows with no percentage chosen yet', () => {
    const config = createDefaultWindowTintConfig('sedan_coupe')
    config.windows = config.windows.map((w, i) => {
      if (i === 0) return { ...w, included: false, vltPercent: null }
      if (i === 1) return { ...w, included: true, vltPercent: null }
      return { ...w, vltPercent: 35 }
    })
    const summary = summarizeWindowTint(config)
    expect(summary.windowLines).toHaveLength(3)
  })

  it('omits the windshield when not included', () => {
    const config = createDefaultWindowTintConfig('sedan_coupe')
    const summary = summarizeWindowTint(config)
    expect(summary.windshield).toBeNull()
  })

  it('includes the windshield summary when included with a percentage', () => {
    const config = { ...createDefaultWindowTintConfig('sedan_coupe'), windshieldIncluded: true, windshieldVltPercent: 70 }
    const summary = summarizeWindowTint(config)
    expect(summary.windshield).toEqual({ vltPercent: 70 })
  })
})
