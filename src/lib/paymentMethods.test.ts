import { describe, expect, it } from 'vitest'
import { buildPaymentUrl, computeDefaultDepositCents, paymentInstructions } from './paymentMethods'

describe('computeDefaultDepositCents', () => {
  it('computes 15% and rounds to the nearest cent', () => {
    expect(computeDefaultDepositCents(189900)).toBe(28485)
    expect(computeDefaultDepositCents(100)).toBe(15)
    expect(computeDefaultDepositCents(1)).toBe(0) // rounds 0.15 down
  })
})

describe('buildPaymentUrl', () => {
  it('returns a raw payment link as-is, ignoring amount', () => {
    expect(buildPaymentUrl('link', 'https://pay.example.com/big-tex-audio', 28485)).toBe(
      'https://pay.example.com/big-tex-audio',
    )
  })

  it('builds a Cash App link, keeping the literal $ unencoded', () => {
    expect(buildPaymentUrl('cashapp', '$BigTexAudio', null)).toBe('https://cash.app/$BigTexAudio')
  })

  it('prepends a missing $ to a Cash App cashtag', () => {
    expect(buildPaymentUrl('cashapp', 'BigTexAudio', null)).toBe('https://cash.app/$BigTexAudio')
  })

  it('appends the deposit amount to a Cash App link', () => {
    expect(buildPaymentUrl('cashapp', '$BigTexAudio', 28485)).toBe('https://cash.app/$BigTexAudio/284.85')
  })

  it('strips a pasted cash.app URL prefix from a Cash App handle', () => {
    expect(buildPaymentUrl('cashapp', 'https://cash.app/$BigTexAudio', null)).toBe('https://cash.app/$BigTexAudio')
  })

  it('builds a PayPal.me link with the amount in the path', () => {
    expect(buildPaymentUrl('paypal', 'BigTexAudio', 28485)).toBe('https://paypal.me/BigTexAudio/284.85')
  })

  it('strips a pasted paypal.me prefix or full URL from a PayPal handle', () => {
    expect(buildPaymentUrl('paypal', 'paypal.me/BigTexAudio', null)).toBe('https://paypal.me/BigTexAudio')
    expect(buildPaymentUrl('paypal', 'https://www.paypal.me/BigTexAudio', null)).toBe(
      'https://paypal.me/BigTexAudio',
    )
  })

  it('builds a Venmo profile link, stripping a leading @', () => {
    expect(buildPaymentUrl('venmo', '@BigTexAudio', null)).toBe('https://venmo.com/u/BigTexAudio')
  })

  it('appends a best-effort amount query string to a Venmo link', () => {
    expect(buildPaymentUrl('venmo', '@BigTexAudio', 28485)).toBe(
      'https://venmo.com/u/BigTexAudio?txn=pay&amount=284.85',
    )
  })

  it('returns null for Zelle — no universal clickable link format exists', () => {
    expect(buildPaymentUrl('zelle', 'shop@example.com', 28485)).toBeNull()
  })

  it('returns null when the handle is blank', () => {
    expect(buildPaymentUrl('cashapp', '   ', null)).toBeNull()
  })
})

describe('paymentInstructions', () => {
  it('returns plain-text instructions only for Zelle', () => {
    expect(paymentInstructions('zelle', 'shop@example.com')).toBe('Send your deposit via Zelle to shop@example.com')
  })

  it('returns null for every method with a clickable link', () => {
    expect(paymentInstructions('link', 'https://pay.example.com/x')).toBeNull()
    expect(paymentInstructions('cashapp', '$BigTexAudio')).toBeNull()
    expect(paymentInstructions('venmo', '@BigTexAudio')).toBeNull()
    expect(paymentInstructions('paypal', 'BigTexAudio')).toBeNull()
  })
})
