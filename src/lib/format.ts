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

export function formatVehicle(v: {
  vehicleYear: number
  vehicleMake: string
  vehicleModel: string
  vehicleTrim?: string | null
}): string {
  const parts = [String(v.vehicleYear), v.vehicleMake, v.vehicleModel]
  if (v.vehicleTrim) parts.push(v.vehicleTrim)
  return parts.join(' ')
}

export function customerDisplayName(c: { firstName: string; lastName?: string | null }): string {
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
