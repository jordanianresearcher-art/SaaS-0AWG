import { describe, expect, it } from 'vitest'
import {
  brandNeedsFitment,
  describeFitmentRange,
  fitmentFromSpecs,
  fitmentMakes,
  fitmentMatches,
  parseFitmentList,
  specsWithFitment,
} from './fitment'

describe('brandNeedsFitment', () => {
  it('recognises the integration brands in the spellings shops type', () => {
    for (const b of ['PAC', 'Metra', 'SCOSCHE', 'metra ', 'Axxess', 'iDatalink', 'Maestro']) {
      expect(brandNeedsFitment(b), b).toBe(true)
    }
  })

  it('does not fire on ordinary audio brands', () => {
    for (const b of ['Kicker', 'Down4Sound', 'Sundown', 'JL Audio', null, '']) {
      expect(brandNeedsFitment(b), String(b)).toBe(false)
    }
  })
})

describe('parseFitmentList', () => {
  it('reads the clean shape', () => {
    const out = parseFitmentList([
      { make: 'Toyota', model: 'Tacoma', year_start: 2005, year_end: 2015, note: null },
    ])
    expect(out).toEqual([{ make: 'Toyota', model: 'Tacoma', yearStart: 2005, yearEnd: 2015, note: null }])
  })

  it('tolerates string years and a packed "2015-2021" range', () => {
    const out = parseFitmentList([
      { make: 'Ford', model: 'F-150', year_start: '2015-2021', year_end: null },
      { make: 'Honda', model: 'Civic', year_start: '2016', year_end: '2021' },
    ])
    expect(out[0]).toMatchObject({ yearStart: 2015, yearEnd: 2021 })
    expect(out[1]).toMatchObject({ yearStart: 2016, yearEnd: 2021 })
  })

  it('swaps a reversed range instead of matching nothing', () => {
    expect(parseFitmentList([{ make: 'Ram', model: '1500', year_start: 2018, year_end: 2013 }])[0]).toMatchObject({
      yearStart: 2013,
      yearEnd: 2018,
    })
  })

  it('drops entries without a make, and absurd years', () => {
    const out = parseFitmentList([
      { model: 'Tacoma' },
      { make: 'Toyota', model: 'Tundra', year_start: 1902, year_end: 2099 },
    ])
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({ make: 'Toyota', yearStart: null, yearEnd: null })
  })

  it('caps a runaway list', () => {
    const raw = Array.from({ length: 200 }, (_, i) => ({ make: `Make${i}` }))
    expect(parseFitmentList(raw)).toHaveLength(60)
  })

  it('returns [] for garbage', () => {
    expect(parseFitmentList(null)).toEqual([])
    expect(parseFitmentList('Toyota Tacoma')).toEqual([])
  })
})

describe('fitmentMatches', () => {
  const ranges = parseFitmentList([
    { make: 'Toyota', model: 'Tacoma', year_start: 2005, year_end: 2015 },
    { make: 'Ford', model: 'F-150', year_start: 2015, year_end: null },
    { make: 'Chrysler', model: null, year_start: 2007, year_end: 2017, note: 'CAN-bus models' },
  ])

  it('matches make + model + in-range year', () => {
    expect(fitmentMatches(ranges, { make: 'Toyota', model: 'Tacoma', year: 2010 })).toBe(true)
  })

  it('rejects a year outside the range', () => {
    expect(fitmentMatches(ranges, { make: 'Toyota', model: 'Tacoma', year: 2019 })).toBe(false)
  })

  it('treats an open-ended range as running to the present', () => {
    expect(fitmentMatches(ranges, { make: 'Ford', model: 'F150', year: 2024 })).toBe(true)
  })

  it('matches model as contains, both directions, punctuation-blind', () => {
    // Staff type "F150 Lariat"; the range says "F-150".
    expect(fitmentMatches(ranges, { make: 'Ford', model: 'F150 Lariat', year: 2020 })).toBe(true)
  })

  it('a make-wide range matches any model of that make', () => {
    expect(fitmentMatches(ranges, { make: 'Chrysler', model: '300', year: 2012 })).toBe(true)
  })

  it('never matches across makes', () => {
    expect(fitmentMatches(ranges, { make: 'Honda', model: 'Tacoma', year: 2010 })).toBe(false)
  })

  it('a query with only a make matches any range of that make', () => {
    expect(fitmentMatches(ranges, { make: 'Toyota' })).toBe(true)
  })
})

describe('describeFitmentRange', () => {
  it('renders the shapes that occur', () => {
    const [a, b, c] = parseFitmentList([
      { make: 'Toyota', model: 'Tacoma', year_start: 2005, year_end: 2015 },
      { make: 'Ford', model: 'F-150', year_start: 2015 },
      { make: 'Chrysler', model: null, note: 'CAN-bus models' },
    ])
    expect(describeFitmentRange(a)).toBe('Toyota Tacoma 2005–2015')
    expect(describeFitmentRange(b)).toBe('Ford F-150 2015+')
    expect(describeFitmentRange(c)).toBe('Chrysler · CAN-bus models')
  })
})

describe('specs round-trip', () => {
  it('stores under vehicleFitment without disturbing other specs', () => {
    const ranges = parseFitmentList([{ make: 'Toyota', model: 'Tacoma' }])
    const specs = specsWithFitment({ subwooferSizeInches: 12 }, ranges)
    expect(specs.subwooferSizeInches).toBe(12)
    expect(fitmentFromSpecs(specs)).toEqual(ranges)
  })

  it('reads [] from an item with no specs at all', () => {
    expect(fitmentFromSpecs(null)).toEqual([])
  })
})

describe('fitmentMakes', () => {
  it('collects unique makes across items, sorted', () => {
    const item = (make: string) => ({ specs: specsWithFitment(null, parseFitmentList([{ make }])) })
    expect(fitmentMakes([item('Toyota'), item('Ford'), item('toyota'), { specs: null }])).toEqual([
      'Ford',
      'Toyota',
    ])
  })
})
