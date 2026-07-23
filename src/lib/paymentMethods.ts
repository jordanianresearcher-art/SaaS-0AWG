// Deposit payment methods for shops without a Shopify/Stripe checkout link.
// Handles are stored exactly as the shop typed them — normalization (leading
// $/@, a pasted full URL) happens only here, at link-build time, never
// mutating what's persisted.

import type { PaymentMethod } from '../types'

export const PAYMENT_METHOD_INFO: Record<
  PaymentMethod,
  { label: string; handleLabel: string; placeholder: string; hint: string }
> = {
  link: {
    label: 'Payment link (Stripe, Shopify, etc.)',
    handleLabel: 'Payment link',
    placeholder: 'https://...',
    hint: 'A full checkout URL customers can click.',
  },
  zelle: {
    label: 'Zelle',
    handleLabel: 'Zelle email or phone',
    placeholder: 'shop@example.com',
    hint: "Zelle doesn't support clickable payment links — customers will see these as instructions on the quote.",
  },
  cashapp: {
    label: 'Cash App',
    handleLabel: 'Cashtag',
    placeholder: '$BigTexAudio',
    hint: 'Your $Cashtag.',
  },
  venmo: {
    label: 'Venmo',
    handleLabel: 'Venmo username',
    placeholder: '@BigTexAudio',
    hint: 'Your Venmo username.',
  },
  paypal: {
    label: 'PayPal.me',
    handleLabel: 'PayPal.me username',
    placeholder: 'BigTexAudio',
    hint: 'The name after paypal.me/',
  },
}

export const DEFAULT_DEPOSIT_PERCENT = 15

export function computeDefaultDepositCents(priceCents: number): number {
  return Math.round(priceCents * (DEFAULT_DEPOSIT_PERCENT / 100))
}

function stripUrlPrefix(handle: string, host: RegExp): string {
  return handle
    .trim()
    .replace(/^https?:\/\//i, '')
    .replace(host, '')
    .replace(/\/+$/, '')
}

function amountPath(amountCents: number | null): string {
  return amountCents != null ? `/${(amountCents / 100).toFixed(2)}` : ''
}

/**
 * Builds a clickable payment URL when the method supports one. Returns null
 * for Zelle, which has no universal link format — use paymentInstructions
 * instead for that case.
 */
export function buildPaymentUrl(method: PaymentMethod, handle: string, amountCents: number | null): string | null {
  const trimmed = handle.trim()
  if (!trimmed) return null

  switch (method) {
    case 'link':
      return trimmed
    case 'cashapp': {
      // The leading $ is a required literal in Cash App's URL path (not a
      // query delimiter) — encodeURIComponent would escape it to %24 and
      // break the link, so only whitespace is stripped here.
      const tag = stripUrlPrefix(trimmed, /^(www\.)?cash\.app\//i).replace(/\s+/g, '')
      const withDollar = tag.startsWith('$') ? tag : `$${tag}`
      return `https://cash.app/${withDollar}${amountPath(amountCents)}`
    }
    case 'paypal': {
      const name = stripUrlPrefix(trimmed, /^(www\.)?paypal\.me\//i).replace(/\s+/g, '')
      return `https://paypal.me/${name}${amountPath(amountCents)}`
    }
    case 'venmo': {
      const name = stripUrlPrefix(trimmed, /^(www\.)?venmo\.com\/u\//i)
        .replace(/^@/, '')
        .replace(/\s+/g, '')
      const query = amountCents != null ? `?txn=pay&amount=${(amountCents / 100).toFixed(2)}` : ''
      return `https://venmo.com/u/${name}${query}`
    }
    case 'zelle':
      return null
  }
}

/**
 * Plain-text instructions for methods with no reliable clickable link.
 * Only Zelle needs this today; every other method returns null since
 * buildPaymentUrl already gives a working link for it.
 */
export function paymentInstructions(method: PaymentMethod, handle: string): string | null {
  if (method === 'zelle') return `Send your deposit via Zelle to ${handle.trim()}`
  return null
}
