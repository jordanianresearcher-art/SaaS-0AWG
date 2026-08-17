// Third-party financing offers a shop attaches to its quotes.
//
// Shops in this space almost never take payment plans themselves — they hand
// the customer off to Snap, Acima, Progressive, etc. Those providers give the
// shop a store-specific application link, usually printed on a counter card as
// a QR code. So the fastest way for an owner to get their real link into the
// app is to point the camera at that card: see parseScannedFinancingCode().
//
// Offers live as JSONB on shops.financing_offers (migration 0019) rather than
// their own table — the list is tiny, always fetched with the shop, and needs
// no RLS of its own.

import type { FinancingOffer } from '../types'
import { newId } from './ids'

/** A shop can't paste in an unbounded wall of links — the email block has to stay scannable. */
export const MAX_FINANCING_OFFERS = 6

/**
 * Hostname (registrable part) -> the name customers recognize. Used to
 * pre-fill the provider name after a QR scan so the owner usually only has to
 * confirm. Not exhaustive and not authoritative — an unknown host just means
 * the owner types the name themselves.
 */
const PROVIDER_NAMES_BY_HOST: Record<string, string> = {
  'snapfinance.com': 'Snap Finance',
  'snapf.co': 'Snap Finance',
  'acima.com': 'Acima',
  'acimacredit.com': 'Acima',
  'progleasing.com': 'Progressive Leasing',
  'progressiveleasing.com': 'Progressive Leasing',
  'katapult.com': 'Katapult',
  'affirm.com': 'Affirm',
  'klarna.com': 'Klarna',
  'synchrony.com': 'Synchrony',
  'americanfirstfinance.com': 'American First Finance',
  'aff.com': 'American First Finance',
  'uown.com': 'Uown Leasing',
  'uownleasing.com': 'Uown Leasing',
  'flexshopper.com': 'FlexShopper',
  'sunbit.com': 'Sunbit',
  'wisetack.com': 'Wisetack',
  'genesis-fs.com': 'Genesis Credit',
  'westcreekfin.com': 'West Creek Financial',
  'okinus.com': 'Okinus',
}

/** Providers offered as one-tap starting points in Settings, in rough order of how often auto shops use them. */
export const COMMON_FINANCING_PROVIDERS = [
  'Snap Finance',
  'Acima',
  'Progressive Leasing',
  'Katapult',
  'American First Finance',
  'Affirm',
] as const

function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, '')
  } catch {
    return null
  }
}

/**
 * Best guess at the provider's customer-facing name from its application URL.
 * Matches the host itself or any parent domain, so store-specific subdomains
 * like `apply.snapfinance.com` or `dealer.acima.com` still resolve. Returns
 * null when nothing matches — the caller should leave the name field empty
 * rather than guess something wrong onto a customer-facing button.
 */
export function guessProviderName(url: string): string | null {
  const host = hostOf(url)
  if (!host) return null
  const parts = host.split('.')
  for (let i = 0; i < parts.length - 1; i += 1) {
    const candidate = parts.slice(i).join('.')
    const known = PROVIDER_NAMES_BY_HOST[candidate]
    if (known) return known
  }
  return null
}

/**
 * Turn what someone typed or scanned into a URL we're willing to put in a
 * customer email, or null if we can't. Adds a missing scheme (owners type
 * `snapfinance.com/apply`, not the protocol) and refuses anything that isn't
 * http/https — a `javascript:` or `data:` payload from a hostile QR code must
 * never reach an anchor href.
 */
export function normalizeFinancingUrl(raw: string): string | null {
  const trimmed = raw.trim()
  if (!trimmed) return null
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(trimmed) ? trimmed : `https://${trimmed}`
  let parsed: URL
  try {
    parsed = new URL(withScheme)
  } catch {
    return null
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null
  // A bare scheme with no host ("https://") parses fine but is not a link.
  if (!parsed.hostname || !parsed.hostname.includes('.')) return null
  return parsed.toString()
}

/**
 * Pull an application URL out of whatever a scanned QR code decoded to.
 *
 * Provider counter cards are inconsistent: some encode a bare URL, some wrap
 * it in vCard/MECARD-ish text, some prefix `URL:`. So we take the first
 * http(s) URL found anywhere in the payload and fall back to treating the
 * whole string as a URL candidate (covers codes encoding `snapf.co/ab12`
 * with no scheme).
 */
export function parseScannedFinancingCode(text: string): string | null {
  const match = text.match(/https?:\/\/[^\s"'<>]+/i)
  if (match) return normalizeFinancingUrl(match[0])
  return normalizeFinancingUrl(text)
}

/**
 * Coerce whatever came back from the JSONB column into offers we can render.
 * Anything malformed is dropped rather than thrown on — a bad row in one
 * shop's settings must not blank out their quote emails.
 */
export function sanitizeFinancingOffers(value: unknown): FinancingOffer[] {
  if (!Array.isArray(value)) return []
  const offers: FinancingOffer[] = []
  for (const entry of value) {
    if (!entry || typeof entry !== 'object') continue
    const row = entry as Record<string, unknown>
    const name = typeof row.name === 'string' ? row.name.trim() : ''
    const url = typeof row.applicationUrl === 'string' ? normalizeFinancingUrl(row.applicationUrl) : null
    if (!name || !url) continue
    offers.push({
      id: typeof row.id === 'string' && row.id ? row.id : newId(),
      name,
      applicationUrl: url,
    })
    if (offers.length >= MAX_FINANCING_OFFERS) break
  }
  return offers
}

/** Build a storable offer from raw form input, or null if either field is unusable. */
export function makeFinancingOffer(name: string, applicationUrl: string, id?: string): FinancingOffer | null {
  const cleanName = name.trim()
  const cleanUrl = normalizeFinancingUrl(applicationUrl)
  if (!cleanName || !cleanUrl) return null
  return { id: id ?? newId(), name: cleanName, applicationUrl: cleanUrl }
}
