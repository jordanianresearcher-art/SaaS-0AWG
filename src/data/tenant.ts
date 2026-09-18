import { getSupabase } from './supabaseClient'
import { supabaseConfigured } from '../lib/env'
import { isPlatformHost, normalizeHost, type TenantBranding } from '../lib/tenantDomain'

// Resolves the front door once per page load.
//
// Cached in module scope because the hostname cannot change without a
// navigation, and a login screen that re-queries on every render would flash
// the platform's branding before settling on the shop's.

let cached: Promise<TenantBranding | null> | null = null

export function resolveTenant(host?: string): Promise<TenantBranding | null> {
  if (cached) return cached
  const hostname = normalizeHost(host ?? (typeof window !== 'undefined' ? window.location.hostname : ''))
  if (isPlatformHost(hostname) || !supabaseConfigured) {
    cached = Promise.resolve(null)
    return cached
  }
  // A failed lookup falls back to the platform rather than an error screen.
  // Somebody trying to sign in should always get a login form.
  const pending: Promise<TenantBranding | null> = (async () => {
    try {
      const { data, error } = await getSupabase().rpc('get_shop_branding_by_domain', { p_host: hostname })
      if (error) return null
      return (data as TenantBranding | null) ?? null
    } catch {
      return null
    }
  })()
  cached = pending
  return pending
}

/** Test seam only — the cache is per page load in a browser. */
export function resetTenantCache(): void {
  cached = null
}
