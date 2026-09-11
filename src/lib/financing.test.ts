import { describe, it, expect } from 'vitest'
import {
  MAX_FINANCING_OFFERS,
  sanitizePayoffDays,
  guessProviderName,
  makeFinancingOffer,
  normalizeFinancingUrl,
  parseScannedFinancingCode,
  sanitizeFinancingOffers,
} from './financing'

describe('normalizeFinancingUrl', () => {
  it('adds the scheme an owner leaves off', () => {
    expect(normalizeFinancingUrl('snapfinance.com/apply/big-tex')).toBe('https://snapfinance.com/apply/big-tex')
  })

  it('keeps an explicit http/https URL', () => {
    expect(normalizeFinancingUrl('http://acima.com/apply')).toBe('http://acima.com/apply')
    expect(normalizeFinancingUrl('  https://acima.com/apply  ')).toBe('https://acima.com/apply')
  })

  it('refuses non-http schemes so a hostile QR code cannot become an href', () => {
    expect(normalizeFinancingUrl('javascript:alert(1)')).toBeNull()
    expect(normalizeFinancingUrl('data:text/html,<script>alert(1)</script>')).toBeNull()
    expect(normalizeFinancingUrl('mailto:someone@example.com')).toBeNull()
  })

  it('rejects empty and hostless input', () => {
    expect(normalizeFinancingUrl('')).toBeNull()
    expect(normalizeFinancingUrl('   ')).toBeNull()
    expect(normalizeFinancingUrl('https://')).toBeNull()
    expect(normalizeFinancingUrl('localhost')).toBeNull()
  })
})

describe('guessProviderName', () => {
  it('names the providers auto shops actually use', () => {
    expect(guessProviderName('https://snapfinance.com/apply')).toBe('Snap Finance')
    expect(guessProviderName('https://www.acima.com/apply')).toBe('Acima')
    expect(guessProviderName('https://progleasing.com/x')).toBe('Progressive Leasing')
  })

  it('resolves store-specific subdomains to the parent brand', () => {
    expect(guessProviderName('https://apply.snapfinance.com/store/1234')).toBe('Snap Finance')
    expect(guessProviderName('https://dealer.acima.com/big-tex')).toBe('Acima')
  })

  it('follows a shortlink host to its brand', () => {
    expect(guessProviderName('https://snapf.co/ab12')).toBe('Snap Finance')
  })

  it('returns null rather than guessing a wrong name onto a customer button', () => {
    expect(guessProviderName('https://some-local-credit-union.example/apply')).toBeNull()
    expect(guessProviderName('not a url')).toBeNull()
  })
})

describe('parseScannedFinancingCode', () => {
  it('reads a bare URL payload', () => {
    expect(parseScannedFinancingCode('https://snapfinance.com/apply/1234')).toBe('https://snapfinance.com/apply/1234')
  })

  it('pulls the URL out of a wrapped payload', () => {
    expect(parseScannedFinancingCode('URL:https://acima.com/apply')).toBe('https://acima.com/apply')
    expect(parseScannedFinancingCode('Apply now: https://acima.com/apply — Big Tex Audio')).toBe('https://acima.com/apply')
  })

  it('handles a schemeless code', () => {
    expect(parseScannedFinancingCode('snapf.co/ab12')).toBe('https://snapf.co/ab12')
  })

  it('returns null for a code that is not a link', () => {
    expect(parseScannedFinancingCode('SNAP-STORE-4471')).toBeNull()
    expect(parseScannedFinancingCode('')).toBeNull()
  })

  it('refuses a javascript: payload embedded in a code', () => {
    expect(parseScannedFinancingCode('javascript:fetch("/steal")')).toBeNull()
  })
})

describe('sanitizeFinancingOffers', () => {
  it('returns an empty list for anything that is not an array', () => {
    expect(sanitizeFinancingOffers(null)).toEqual([])
    expect(sanitizeFinancingOffers({})).toEqual([])
    expect(sanitizeFinancingOffers('[]')).toEqual([])
  })

  it('keeps well-formed offers and normalizes their URLs', () => {
    const offers = sanitizeFinancingOffers([{ id: 'a', name: 'Snap Finance', applicationUrl: 'snapfinance.com/apply' }])
    expect(offers).toEqual([{ id: 'a', name: 'Snap Finance', applicationUrl: 'https://snapfinance.com/apply', payoffDays: null }])
  })

  it('drops malformed rows instead of throwing, so one bad row cannot blank the email block', () => {
    const offers = sanitizeFinancingOffers([
      { name: '', applicationUrl: 'https://acima.com' },
      { name: 'No URL' },
      { name: 'Bad scheme', applicationUrl: 'javascript:alert(1)' },
      null,
      'nope',
      { id: 'ok', name: 'Acima', applicationUrl: 'https://acima.com/apply' },
    ])
    expect(offers).toEqual([{ id: 'ok', name: 'Acima', applicationUrl: 'https://acima.com/apply', payoffDays: null }])
  })

  it('backfills a missing id', () => {
    const offers = sanitizeFinancingOffers([{ name: 'Acima', applicationUrl: 'https://acima.com' }])
    expect(offers).toHaveLength(1)
    expect(offers[0].id).toBeTruthy()
  })

  it('caps the list so the email block stays scannable', () => {
    const many = Array.from({ length: MAX_FINANCING_OFFERS + 4 }, (_, i) => ({
      id: `id-${i}`,
      name: `Provider ${i}`,
      applicationUrl: `https://provider${i}.com/apply`,
    }))
    expect(sanitizeFinancingOffers(many)).toHaveLength(MAX_FINANCING_OFFERS)
  })
})

describe('makeFinancingOffer', () => {
  it('builds an offer from raw form input', () => {
    const offer = makeFinancingOffer('  Snap Finance ', 'snapfinance.com/apply', 'keep-me')
    expect(offer).toEqual({ id: 'keep-me', name: 'Snap Finance', applicationUrl: 'https://snapfinance.com/apply', payoffDays: null })
  })

  it('returns null when either field is unusable', () => {
    expect(makeFinancingOffer('', 'https://acima.com')).toBeNull()
    expect(makeFinancingOffer('Acima', '')).toBeNull()
    expect(makeFinancingOffer('Acima', 'javascript:alert(1)')).toBeNull()
  })
})

describe('sanitizePayoffDays', () => {
  // This number leaves the building as "Pay back in 100 days" in a real
  // customer's inbox, so every junk value has to become null rather than
  // something that prints.
  it('keeps a real window', () => {
    expect(sanitizePayoffDays(100)).toBe(100)
    expect(sanitizePayoffDays(90)).toBe(90)
    expect(sanitizePayoffDays('100')).toBe(100)
    expect(sanitizePayoffDays(' 90 ')).toBe(90)
    expect(sanitizePayoffDays(1)).toBe(1)
    expect(sanitizePayoffDays(730)).toBe(730)
  })

  it('rounds a fractional window rather than printing "90.5 days"', () => {
    expect(sanitizePayoffDays(90.4)).toBe(90)
    expect(sanitizePayoffDays(90.6)).toBe(91)
  })

  it('refuses zero, which would print as "0 days to pay it off"', () => {
    expect(sanitizePayoffDays(0)).toBeNull()
    expect(sanitizePayoffDays('0')).toBeNull()
    expect(sanitizePayoffDays(0.4)).toBeNull()
  })

  it('refuses negatives and absurd windows', () => {
    expect(sanitizePayoffDays(-30)).toBeNull()
    expect(sanitizePayoffDays(731)).toBeNull()
    expect(sanitizePayoffDays(100000)).toBeNull()
  })

  it('refuses anything that is not a number at all', () => {
    for (const junk of ['soon', '', null, undefined, {}, [], true, Number.NaN, Infinity]) {
      expect(sanitizePayoffDays(junk)).toBeNull()
    }
  })
})
