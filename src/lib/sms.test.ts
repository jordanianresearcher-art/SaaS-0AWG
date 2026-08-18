import { describe, it, expect } from 'vitest'
import {
  buildBookingConfirmationSmsBody,
  buildBookingReminderSmsBody,
  buildQuoteSmsBody,
  buildSmsLink,
  normalizePhoneForSms,
} from './sms'

describe('normalizePhoneForSms', () => {
  it('strips the formatting people actually type', () => {
    expect(normalizePhoneForSms('214-555-0100')).toBe('2145550100')
    expect(normalizePhoneForSms('(214) 555 0100')).toBe('2145550100')
    expect(normalizePhoneForSms('214.555.0100')).toBe('2145550100')
  })

  it('drops a US country code', () => {
    expect(normalizePhoneForSms('+1 214 555 0100')).toBe('2145550100')
    expect(normalizePhoneForSms('12145550100')).toBe('2145550100')
  })

  it('keeps a non-US number as dialed rather than mangling it', () => {
    expect(normalizePhoneForSms('+44 20 7946 0958')).toBe('442079460958')
  })

  it('refuses input that cannot be dialed', () => {
    expect(normalizePhoneForSms('')).toBeNull()
    expect(normalizePhoneForSms('call me')).toBeNull()
    expect(normalizePhoneForSms('555')).toBeNull()
  })
})

describe('buildSmsLink', () => {
  it('uses the ?&body= form that works on both iOS and Android', () => {
    const link = buildSmsLink('214-555-0100', 'Hi Marcus')
    expect(link).toBe('sms:2145550100?&body=Hi%20Marcus')
  })

  it('encodes a body containing a URL and punctuation', () => {
    const link = buildSmsLink('2145550100', 'Your quote: https://app.example.com/q/abc?d=1 — take a look')
    expect(link).toContain('sms:2145550100?&body=')
    expect(link).not.toContain(' ')
    // The URL's own ? and & must not leak out as link syntax.
    expect(link?.split('?&body=')[1]).not.toContain('&d=')
  })

  it('returns null for a missing or unusable number so the caller can hide the button', () => {
    expect(buildSmsLink(null, 'x')).toBeNull()
    expect(buildSmsLink(undefined, 'x')).toBeNull()
    expect(buildSmsLink('', 'x')).toBeNull()
    expect(buildSmsLink('nope', 'x')).toBeNull()
  })
})

describe('quote SMS templates', () => {
  const ctx = {
    firstName: 'Marcus',
    shopName: 'Big Tex Audio',
    vehicle: '2021 Ford F-150',
    quoteUrl: 'https://app.example.com/q/tok',
  }

  it('greets by name and carries the quote link', () => {
    const body = buildQuoteSmsBody('check_in', ctx)
    expect(body).toContain('Hi Marcus')
    expect(body).toContain('Big Tex Audio')
    expect(body).toContain('2021 Ford F-150')
    expect(body).toContain(ctx.quoteUrl)
  })

  it('never renders a null name or vehicle into the message', () => {
    const body = buildQuoteSmsBody('check_in', { ...ctx, firstName: null, vehicle: null })
    expect(body).toContain('Hi there')
    expect(body).not.toContain('null')
    expect(body).not.toContain('undefined')
    expect(body).not.toContain('for your ,')
  })

  it('treats a whitespace-only name as no name', () => {
    const body = buildQuoteSmsBody('check_in', { ...ctx, firstName: '   ' })
    expect(body).toContain('Hi there')
  })

  it('gives each follow-up stage its own angle', () => {
    const financing = buildQuoteSmsBody('financing_option', ctx)
    const final = buildQuoteSmsBody('final_check_in', ctx)
    expect(financing).toMatch(/financing/i)
    expect(final).toMatch(/last note/i)
    expect(financing).not.toBe(final)
  })
})

describe('booking SMS templates', () => {
  const ctx = {
    firstName: 'Marcus',
    shopName: 'Big Tex Audio',
    serviceName: 'window tint',
    whenLabel: 'tomorrow at 2:00 PM',
    manageUrl: 'https://app.example.com/booking/tok',
  }

  it('reminder names the service, the time, and how to change it', () => {
    const body = buildBookingReminderSmsBody(ctx)
    expect(body).toContain('Hi Marcus')
    expect(body).toContain('window tint')
    expect(body).toContain('tomorrow at 2:00 PM')
    expect(body).toContain(ctx.manageUrl)
  })

  it('falls back to "your appointment" when no service is named', () => {
    const body = buildBookingReminderSmsBody({ ...ctx, serviceName: null })
    expect(body).toContain('your appointment')
    expect(body).not.toContain('null')
  })

  it('confirmation reads as a just-booked message, not a reminder', () => {
    const body = buildBookingConfirmationSmsBody(ctx)
    expect(body).toMatch(/booked/i)
    expect(body).toContain(ctx.manageUrl)
  })
})
