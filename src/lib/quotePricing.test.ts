import { describe, expect, it } from 'vitest'
import { addonOptions, basePriceCents, computeAddonBreakdown, fullTotalCents, mainOption, type PricedOption } from './quotePricing'

function opt(id: string, optionKind: 'main' | 'addon', priceCents: number): PricedOption {
  return { id, optionKind, priceCents }
}

describe('quotePricing', () => {
  const main = opt('main-1', 'main', 250000)
  const addonA = opt('addon-1', 'addon', 15000)
  const addonB = opt('addon-2', 'addon', 30000)
  const options = [main, addonA, addonB]

  it('mainOption finds the option explicitly marked main', () => {
    expect(mainOption(options)).toBe(main)
  })

  it('mainOption falls back to the first option when nothing is marked main', () => {
    const noMain = [opt('a', 'addon', 100), opt('b', 'addon', 200)]
    expect(mainOption(noMain)).toBe(noMain[0])
  })

  it('mainOption returns undefined for an empty list', () => {
    expect(mainOption([])).toBeUndefined()
  })

  it('addonOptions returns every option except main, in order', () => {
    expect(addonOptions(options)).toEqual([addonA, addonB])
  })

  it('addonOptions is empty when there is only a main option', () => {
    expect(addonOptions([main])).toEqual([])
  })

  it('basePriceCents reads the main option price', () => {
    expect(basePriceCents(options)).toBe(250000)
  })

  it('basePriceCents is 0 when there are no options', () => {
    expect(basePriceCents([])).toBe(0)
  })

  it('computeAddonBreakdown returns each addon priced independently against the base', () => {
    const breakdown = computeAddonBreakdown(options)
    expect(breakdown).toEqual([
      { option: addonA, addonPriceCents: 15000, totalWithAddonCents: 265000 },
      { option: addonB, addonPriceCents: 30000, totalWithAddonCents: 280000 },
    ])
  })

  it('computeAddonBreakdown is empty when there are no addons', () => {
    expect(computeAddonBreakdown([main])).toEqual([])
  })

  it('fullTotalCents stacks the main package and every addon', () => {
    expect(fullTotalCents(options)).toBe(295000)
  })

  it('fullTotalCents is just the main price when there are no addons', () => {
    expect(fullTotalCents([main])).toBe(250000)
  })

  it('fullTotalCents is 0 for an empty quote', () => {
    expect(fullTotalCents([])).toBe(0)
  })
})
