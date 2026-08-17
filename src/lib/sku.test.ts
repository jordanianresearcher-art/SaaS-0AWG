import { describe, expect, it } from 'vitest'
import { buildSkuBase, nextAvailableSku } from './sku'

describe('buildSkuBase', () => {
  it('joins cleaned brand and model', () => {
    // "DEAFBONCE" is 9 chars — truncated to 8 by MAX_BRAND_CHARS.
    expect(buildSkuBase('Deaf Bonce', '770DSP')).toBe('DEAFBONC-770DSP')
  })

  it('keeps a short brand intact', () => {
    expect(buildSkuBase('DS18', '770DSP')).toBe('DS18-770DSP')
  })

  it('strips non-alphanumeric characters', () => {
    expect(buildSkuBase('DS18', 'PRO-X8.4"')).toBe('DS18-PROX84')
  })

  it('caps brand at 8 chars and model at 12', () => {
    expect(buildSkuBase('Really Long Brand Name', 'ExtremelyLongModelNumber123')).toBe(
      'REALLYLO-EXTREMELYLON',
    )
  })

  it('omits the brand segment when brand is null', () => {
    expect(buildSkuBase(null, '770DSP')).toBe('770DSP')
  })

  it('falls back to ITEM when both are empty after cleaning', () => {
    expect(buildSkuBase('***', '###')).toBe('ITEM')
  })
})

describe('nextAvailableSku', () => {
  it('returns the base when free', () => {
    expect(nextAvailableSku('DS18-PROX84', new Set())).toBe('DS18-PROX84')
  })

  it('suffixes -2 when the base is taken', () => {
    expect(nextAvailableSku('DS18-PROX84', new Set(['DS18-PROX84']))).toBe('DS18-PROX84-2')
  })

  it('finds the first free suffix', () => {
    const taken = new Set(['DS18-PROX84', 'DS18-PROX84-2', 'DS18-PROX84-3'])
    expect(nextAvailableSku('DS18-PROX84', taken)).toBe('DS18-PROX84-4')
  })
})
