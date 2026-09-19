// Which shop is this front door for?
//
// One build serves every domain. The master domain shows the product — the
// marketing page, signup, the founder's admin view. A client domain like
// supercaraudio.com shows that shop's name on the login screen and nothing
// about the platform at all, because a shop's staff should not be reading
// about the software their boss bought while they are trying to sign in.
//
// This file decides that from the hostname alone. It is deliberately the only
// place that reasoning lives: the alternative is a second copy of the app per
// client, which means every fix has to be applied N times and they drift.

/** Hosts that are always the platform, never a client. Checked before any lookup. */
const PLATFORM_HOSTS = new Set(['localhost', '127.0.0.1', '0.0.0.0', '::1'])

/**
 * Suffixes that belong to the hosting provider rather than to a shop.
 *
 * A preview deployment lands on a generated hostname, and one of those must
 * never resolve to a client's branding — a build under review would silently
 * start wearing a real shop's name.
 */
const PLATFORM_SUFFIXES = ['.pages.dev', '.workers.dev', '.vercel.app', '.netlify.app']

/**
 * A bare, comparable hostname: lowercase, no scheme, no port, no path, no
 * leading `www.`
 *
 * Stored domains are held in exactly this shape (see the check constraint in
 * migration 0032), so the lookup is an equality match. Every difference this
 * strips is one that would otherwise read as a different shop:
 * `WWW.SuperCarAudio.com:443` and `supercaraudio.com` are one front door.
 */
export function normalizeHost(raw: string | null | undefined): string {
  if (!raw) return ''
  let host = raw.trim().toLowerCase()
  if (!host) return ''
  // Tolerate a full URL being passed in — callers hand us window.location in
  // several shapes and a wrong one should normalize, not mismatch silently.
  host = host.replace(/^[a-z][a-z0-9+.-]*:\/\//, '')
  host = host.split('/')[0]
  host = host.split('?')[0]
  host = host.split('#')[0]
  // IPv6 literals arrive bracketed; the port strip below would eat them.
  if (host.startsWith('[')) {
    const close = host.indexOf(']')
    return close === -1 ? host : host.slice(1, close)
  }
  host = host.split(':')[0]
  if (host.startsWith('www.')) host = host.slice(4)
  // A trailing dot is a legal fully-qualified name and the same host.
  if (host.endsWith('.')) host = host.slice(0, -1)
  return host
}

/**
 * True when this host is the platform itself, so no lookup is worth making.
 *
 * Returning true is the safe direction: the worst case is a client domain
 * showing the platform's login for a moment, which is ugly. The reverse — a
 * preview build wearing a real shop's branding — is a support call.
 */
export function isPlatformHost(raw: string | null | undefined): boolean {
  const host = normalizeHost(raw)
  if (!host) return true
  if (PLATFORM_HOSTS.has(host)) return true
  if (PLATFORM_SUFFIXES.some((suffix) => host.endsWith(suffix))) return true
  // A bare IP address is never a customer's domain.
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return true
  // No dot means no registrable domain — a LAN name, not a front door.
  if (!host.includes('.')) return true
  return false
}

/** Branding for a client front door. Everything here is already public on a quote. */
export interface TenantBranding {
  shopName: string
  shopSlug: string
  shopLogoUrl: string | null
  shopPrimaryColor: string
}

/**
 * The address to put on a link a customer will see.
 *
 * Staff open this app from whatever bookmark they happen to have. The shop's
 * own domain is the one the customer should read, and it does not depend on
 * which door the staff member came through — a review link handed over the
 * counter has to say the shop's name whether the tablet behind the counter is
 * on the shop domain or on the platform one.
 *
 * So: the shop's stored domain wins, and the current origin is only the
 * fallback for a shop that has not set one. `fallback` is passed in rather
 * than read from `env` here so this stays pure and testable.
 */
export function publicBaseUrl(customDomain: string | null | undefined, fallback: string): string {
  const host = normalizeHost(customDomain)
  // A stored value that is somehow the platform is not a shop address, and
  // sending a customer there would show them the wrong shop's front door.
  if (!host || isPlatformHost(host)) return fallback.replace(/\/+$/, '')
  return `https://${host}`
}
