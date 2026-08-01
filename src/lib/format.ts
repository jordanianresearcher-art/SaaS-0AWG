// Centralized formatting. All money in the app is integer cents.

export function formatCurrency(cents: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: cents % 100 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(cents / 100)
}

export function parseDollarsToCents(input: string): number | null {
  const cleaned = input.replace(/[$,\s]/g, '')
  if (cleaned === '') return null
  const value = Number(cleaned)
  if (!Number.isFinite(value) || value < 0) return null
  return Math.round(value * 100)
}

/**
 * Compact "0GA · OFC" style label for a wiring-kit product, read from its
 * schemaless `specs` (no dedicated columns/migration for this — specs.gaugeAwg
 * / specs.wireMaterial is just a convention, same pattern as the rest of the
 * catalog's category-varying spec data). Lets staff tell apart the handful of
 * gauge/material variants a shop typically stocks (0/4-gauge, CCA/OFC) without
 * fragmenting the category taxonomy into one category per variant. Returns
 * null when neither field is present, rather than an empty label.
 */
export function formatWiringKitSpec(specs: Record<string, unknown> | null): string | null {
  if (!specs) return null
  const parts: string[] = []
  const gauge = specs.gaugeAwg
  if (typeof gauge === 'number') parts.push(gauge === 0 ? '0GA' : `${gauge}GA`)
  const material = specs.wireMaterial
  if (material === 'cca') parts.push('CCA')
  else if (material === 'ofc') parts.push('OFC')
  return parts.length > 0 ? parts.join(' · ') : null
}

/** Returns null when no vehicle info is on file, rather than a string with blank/undefined parts. */
export function formatVehicle(v: {
  vehicleYear: number | null
  vehicleMake: string | null
  vehicleModel: string | null
  vehicleTrim?: string | null
}): string | null {
  const parts = [v.vehicleYear ? String(v.vehicleYear) : null, v.vehicleMake, v.vehicleModel].filter(
    (p): p is string => Boolean(p),
  )
  if (parts.length === 0) return null
  if (v.vehicleTrim) parts.push(v.vehicleTrim)
  return parts.join(' ')
}

export function customerDisplayName(c: { firstName: string; lastName?: string | null }): string {
  if (!c.firstName) return 'New lead'
  return c.lastName ? `${c.firstName} ${c.lastName}` : c.firstName
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—'
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).format(
    new Date(iso),
  )
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '—'
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(iso))
}

/** Total value of a quote = price of the recommended option, else the highest-priced option. */
export function quoteValueCents(options: Array<{ priceCents: number; recommended: boolean }>): number {
  if (options.length === 0) return 0
  const recommended = options.find((o) => o.recommended)
  if (recommended) return recommended.priceCents
  return Math.max(...options.map((o) => o.priceCents))
}
