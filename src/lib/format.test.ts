import { describe, expect, it } from 'vitest'
import { formatCurrency, parseDollarsToCents, formatVehicle, quoteValueCents, customerDisplayName } from './format'

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
  it('uses the recommended option', () => {
    expect(
      quoteValueCents([
        { priceCents: 100, recommended: false },
        { priceCents: 200, recommended: true },
        { priceCents: 500, recommended: false },
      ]),
    ).toBe(200)
  })
  it('falls back to the highest price when nothing is recommended', () => {
    expect(
      quoteValueCents([
        { priceCents: 100, recommended: false },
        { priceCents: 500, recommended: false },
      ]),
    ).toBe(500)
  })
  it('returns 0 for no options', () => {
    expect(quoteValueCents([])).toBe(0)
  })
})
