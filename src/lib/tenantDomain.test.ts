import { describe, expect, it } from 'vitest'
import { isPlatformHost, normalizeHost } from './tenantDomain'

describe('normalizeHost', () => {
  it('reduces every spelling of one front door to the same string', () => {
    for (const raw of [
      'supercaraudio.com',
      'SuperCarAudio.com',
      'WWW.SUPERCARAUDIO.COM',
      'www.supercaraudio.com',
      '  supercaraudio.com  ',
      'https://supercaraudio.com',
      'https://www.supercaraudio.com/app/quotes',
      'supercaraudio.com:443',
      'supercaraudio.com.',
      'http://supercaraudio.com?x=1',
    ]) {
      expect(normalizeHost(raw)).toBe('supercaraudio.com')
    }
  })

  it('leaves a subdomain alone — it is a different front door', () => {
    expect(normalizeHost('shop.supercaraudio.com')).toBe('shop.supercaraudio.com')
    // Only a LEADING www is stripped.
    expect(normalizeHost('www.www.supercaraudio.com')).toBe('www.supercaraudio.com')
  })

  it('does not eat a domain that merely starts with the letters www', () => {
    expect(normalizeHost('wwwsupercaraudio.com')).toBe('wwwsupercaraudio.com')
  })

  it('keeps an IPv6 literal intact rather than truncating it at a colon', () => {
    expect(normalizeHost('[::1]:4173')).toBe('::1')
  })

  it('returns empty for nothing at all', () => {
    for (const raw of ['', '   ', null, undefined]) expect(normalizeHost(raw)).toBe('')
  })
})

describe('isPlatformHost', () => {
  it('treats local development as the platform', () => {
    for (const host of ['localhost', 'localhost:5173', '127.0.0.1', '[::1]:4173']) {
      expect(isPlatformHost(host)).toBe(true)
    }
  })

  it('treats a preview deployment as the platform', () => {
    // A build under review must never silently wear a real shop's branding.
    for (const host of ['saas-0awg.pages.dev', 'abc123.saas-0awg.pages.dev', 'x.workers.dev']) {
      expect(isPlatformHost(host)).toBe(true)
    }
  })

  it('treats a bare IP or a dotless name as the platform', () => {
    expect(isPlatformHost('192.168.1.40')).toBe(true)
    expect(isPlatformHost('shop-pc')).toBe(true)
  })

  it('treats nothing at all as the platform, which is the safe direction', () => {
    expect(isPlatformHost('')).toBe(true)
    expect(isPlatformHost(null)).toBe(true)
  })

  it('treats a real customer domain as a client front door', () => {
    for (const host of ['supercaraudio.com', 'www.supercaraudio.com', 'app.supercaraudio.com']) {
      expect(isPlatformHost(host)).toBe(false)
    }
  })

  it('does not mistake a domain that merely contains a platform suffix', () => {
    // Endswith, not includes: "pages.dev" inside the name is not the suffix.
    expect(isPlatformHost('pages.dev.supercaraudio.com')).toBe(false)
  })
})
