import { describe, it, expect } from 'vitest'
import { logoSlug } from './LogoTile'

describe('logoSlug', () => {
  it('lowercases and hyphenates', () => {
    expect(logoSlug('JL Audio')).toBe('jl-audio')
    expect(logoSlug('Rockford Fosgate')).toBe('rockford-fosgate')
  })

  it('collapses punctuation rather than emitting it into a filename', () => {
    expect(logoSlug('Mercedes-Benz')).toBe('mercedes-benz')
    expect(logoSlug('Land Rover')).toBe('land-rover')
    expect(logoSlug('B2 Audio')).toBe('b2-audio')
  })

  it('never leaves a leading or trailing separator', () => {
    expect(logoSlug('  Kicker  ')).toBe('kicker')
    expect(logoSlug('-Kicker-')).toBe('kicker')
  })

  it('keeps digits, which several real brands need', () => {
    expect(logoSlug('DS18')).toBe('ds18')
  })

  it('is stable for the same input regardless of case', () => {
    expect(logoSlug('KICKER')).toBe(logoSlug('kicker'))
  })
})
