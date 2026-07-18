import { describe, expect, it } from 'vitest'
import { checkSendEligibility } from './eligibility'

const okCustomer = {
  email: 'test@example.com',
  emailContactPermissionConfirmed: true,
  emailOptOutAt: null,
}

const okQuote = {
  status: 'emailed' as const,
  emailFollowUpAllowed: true,
}

describe('checkSendEligibility', () => {
  it('allows a normal send', () => {
    expect(checkSendEligibility(okCustomer, okQuote)).toEqual({ allowed: true, reason: null })
  })
  it('blocks when the customer has no email', () => {
    const result = checkSendEligibility({ ...okCustomer, email: '' }, okQuote)
    expect(result.allowed).toBe(false)
    expect(result.reason).toMatch(/no email/i)
  })
  it('blocks when permission was never confirmed', () => {
    const result = checkSendEligibility({ ...okCustomer, emailContactPermissionConfirmed: false }, okQuote)
    expect(result.allowed).toBe(false)
    expect(result.reason).toMatch(/permission/i)
  })
  it('blocks after the customer opted out', () => {
    const result = checkSendEligibility({ ...okCustomer, emailOptOutAt: '2026-07-01T00:00:00Z' }, okQuote)
    expect(result.allowed).toBe(false)
    expect(result.reason).toMatch(/stop/i)
  })
  it('blocks when follow-up is turned off for the quote', () => {
    const result = checkSendEligibility(okCustomer, { ...okQuote, emailFollowUpAllowed: false })
    expect(result.allowed).toBe(false)
  })
  it('blocks closed quotes', () => {
    expect(checkSendEligibility(okCustomer, { ...okQuote, status: 'won' }).allowed).toBe(false)
    expect(checkSendEligibility(okCustomer, { ...okQuote, status: 'lost' }).allowed).toBe(false)
  })
})
