import { describe, expect, it } from 'vitest'
import { formatCurrency, formatWiringKitSpec, parseDollarsToCents, formatVehicle, quoteValueCents, customerDisplayName } from './format'

describe('formatCurrency', () => {
  it('formats whole dollars without cents', () => {
    expect(formatCurrency(289900)).toBe('$2,899')
  })
  it('formats fractional dollars with cents', () => {
    expect(formatCurrency(289950)).toBe('$2,899.50')
  })
  it('formats zero', () => {
    expect(formatCurrency(0)).toBe('$0')
  })
})

describe('parseDollarsToCents', () => {
  it('parses plain numbers', () => {
    expect(parseDollarsToCents('2899')).toBe(289900)
  })
  it('parses currency formatting', () => {
    expect(parseDollarsToCents('$2,899.50')).toBe(289950)
  })
  it('rejects garbage', () => {
    expect(parseDollarsToCents('abc')).toBeNull()
  })
  it('rejects negatives', () => {
    expect(parseDollarsToCents('-5')).toBeNull()
  })
  it('rejects empty', () => {
    expect(parseDollarsToCents('')).toBeNull()
  })
  it('rounds fractional cents', () => {
    expect(parseDollarsToCents('10.999')).toBe(1100)
  })
})

describe('formatWiringKitSpec', () => {
  it('combines gauge and material', () => {
    expect(formatWiringKitSpec({ gaugeAwg: 4, wireMaterial: 'cca' })).toBe('4GA · CCA')
    expect(formatWiringKitSpec({ gaugeAwg: 0, wireMaterial: 'ofc' })).toBe('0GA · OFC')
  })

  it('handles just one of the two fields being present', () => {
    expect(formatWiringKitSpec({ gaugeAwg: 8 })).toBe('8GA')
    expect(formatWiringKitSpec({ wireMaterial: 'cca' })).toBe('CCA')
  })

  it('returns null for null/empty specs or unrecognized values', () => {
    expect(formatWiringKitSpec(null)).toBeNull()
    expect(formatWiringKitSpec({})).toBeNull()
    expect(formatWiringKitSpec({ wireMaterial: 'copper-clad' })).toBeNull()
  })
})

describe('formatVehicle', () => {
  it('includes trim when present', () => {
    expect(
      formatVehicle({ vehicleYear: 2022, vehicleMake: 'Ford', vehicleModel: 'F-150', vehicleTrim: 'Lariat' }),
    ).toBe('2022 Ford F-150 Lariat')
  })
  it('omits missing trim', () => {
    expect(
      formatVehicle({ vehicleYear: 2018, vehicleMake: 'Chevrolet', vehicleModel: 'Tahoe', vehicleTrim: null }),
    ).toBe('2018 Chevrolet Tahoe')
  })
  it('returns null when no vehicle info is on file', () => {
    expect(formatVehicle({ vehicleYear: null, vehicleMake: null, vehicleModel: null, vehicleTrim: null })).toBeNull()
  })
  it('handles a defensive partial case (year missing)', () => {
    expect(formatVehicle({ vehicleYear: null, vehicleMake: 'Ford', vehicleModel: 'F-150', vehicleTrim: null })).toBe(
      'Ford F-150',
    )
  })
})

describe('customerDisplayName', () => {
  it('joins first and last', () => {
    expect(customerDisplayName({ firstName: 'Marcus', lastName: 'Bell' })).toBe('Marcus Bell')
  })
  it('falls back to first name only', () => {
    expect(customerDisplayName({ firstName: 'Renee', lastName: null })).toBe('Renee')
  })
  it('falls back to a generic label for a bare lead with no name', () => {
    expect(customerDisplayName({ firstName: '', lastName: null })).toBe('New lead')
  })
})

describe('quoteValueCents', () => {
  it('uses the main option, ignoring addon prices', () => {
    expect(
      quoteValueCents([
        { priceCents: 200, optionKind: 'main' },
        { priceCents: 500, optionKind: 'addon' },
      ]),
    ).toBe(200)
  })
  it('falls back to the first option when nothing is marked main', () => {
    expect(
      quoteValueCents([
        { priceCents: 100, optionKind: 'addon' },
        { priceCents: 500, optionKind: 'addon' },
      ]),
    ).toBe(100)
  })
  it('returns 0 for no options', () => {
    expect(quoteValueCents([])).toBe(0)
  })
})
