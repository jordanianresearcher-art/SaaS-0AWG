// Vehicle fitment for integration parts.
//
// A Kicker sub fits any car with space for it; a Metra 99-8215 dash kit fits
// a 2005-2015 Toyota Tacoma and nothing else. For the integration brands —
// dash kits, harnesses, interfaces — "what vehicle is this for?" IS the
// product question, and a catalog that can't answer it makes staff walk to
// the shelf and read the box.
//
// Fitment lives in the item's `specs` jsonb under `vehicleFitment`, so no
// migration is needed and the inventory list (already fully loaded
// client-side) can filter on it directly. Everything here is pure: the AI
// call that discovers fitment lives in the resolver; this file owns what
// fitment IS — parsing the model's output tolerantly, matching a vehicle
// against ranges, and rendering ranges for humans.

/** One "fits these vehicles" claim, e.g. Toyota Tacoma 2005-2015. */
export interface FitmentRange {
  make: string
  /** Null means the whole make (rare but real — some interfaces are make-wide). */
  model: string | null
  yearStart: number | null
  yearEnd: number | null
  /** The caveat that matters for harnesses: "with amplified JBL system", "non-NAV models". */
  note: string | null
}

/**
 * The brands whose products are vehicle-specific. Deliberately a short,
 * explicit list rather than a heuristic: guessing "integration-ish" from a
 * product name would fire on speaker adapters and miss half of PAC's line.
 * Axxess is Metra's integration sub-brand; iDatalink makes the Maestro.
 */
const FITMENT_BRANDS = ['pac', 'metra', 'scosche', 'axxess', 'idatalink', 'maestro']

export function brandNeedsFitment(brand: string | null | undefined): boolean {
  if (!brand) return false
  const key = brand.toLowerCase().replace(/[^a-z0-9]/g, '')
  return FITMENT_BRANDS.some((b) => key === b || key.startsWith(`${b}audio`) || key === `${b}inc`)
}

function normalizeVehicleToken(raw: string): string {
  return raw.toLowerCase().replace(/[^a-z0-9]/g, '')
}

function clampYear(value: unknown): number | null {
  const n =
    typeof value === 'number' ? value : typeof value === 'string' ? Number.parseInt(value, 10) : NaN
  if (!Number.isFinite(n)) return null
  // Nothing this trade installs into predates in-dash electronics, and a
  // model claiming a 2099 fitment is hallucinating, not forecasting.
  if (n < 1980 || n > 2035) return null
  return n
}

/**
 * The model's fitment JSON, made trustworthy. Tolerates the shapes grounded
 * models actually emit — string years, "2015-2021" packed into one field,
 * swapped range ends — and drops rather than repairs anything without at
 * least a make. Capped: a list longer than 60 vehicles is a model
 * enumerating a catalog page, not describing this part.
 */
export function parseFitmentList(raw: unknown): FitmentRange[] {
  const list = Array.isArray(raw) ? raw : []
  const out: FitmentRange[] = []
  for (const entry of list) {
    if (out.length >= 60) break
    const e = entry as Record<string, unknown>
    const make = typeof e?.make === 'string' ? e.make.trim() : ''
    if (!make) continue

    let yearStart = clampYear(e.year_start ?? e.yearStart)
    let yearEnd = clampYear(e.year_end ?? e.yearEnd)
    // "2015-2021" (or "2015–2021") packed into either year field.
    for (const v of [e.year_start ?? e.yearStart, e.year_end ?? e.yearEnd]) {
      if (typeof v === 'string') {
        const m = v.match(/(\d{4})\s*[-–]\s*(\d{4})/)
        if (m) {
          yearStart = yearStart ?? clampYear(m[1])
          yearEnd = yearEnd ?? clampYear(m[2])
        }
      }
    }
    if (yearStart !== null && yearEnd !== null && yearEnd < yearStart) {
      ;[yearStart, yearEnd] = [yearEnd, yearStart]
    }

    const model = typeof e.model === 'string' && e.model.trim() ? e.model.trim() : null
    const note = typeof e.note === 'string' && e.note.trim() ? e.note.trim().slice(0, 120) : null
    out.push({ make, model, yearStart, yearEnd, note })
  }
  return out
}

/** What the inventory chooser asks with. All fields optional except make. */
export interface VehicleQuery {
  make: string
  model?: string | null
  year?: number | null
}

export function fitmentMatches(ranges: FitmentRange[], query: VehicleQuery): boolean {
  const qMake = normalizeVehicleToken(query.make)
  if (!qMake) return false
  const qModel = query.model ? normalizeVehicleToken(query.model) : null
  return ranges.some((r) => {
    if (normalizeVehicleToken(r.make) !== qMake) return false
    if (qModel) {
      // Contains, both directions: the range may say "Tacoma Double Cab" for
      // a query of "Tacoma", or "F-150" for a query of "F150 Lariat".
      const rModel = r.model ? normalizeVehicleToken(r.model) : null
      if (rModel && !rModel.includes(qModel) && !qModel.includes(rModel)) return false
    }
    if (query.year != null) {
      if (r.yearStart !== null && query.year < r.yearStart) return false
      if (r.yearEnd !== null && query.year > r.yearEnd) return false
    }
    return true
  })
}

/** "Toyota Tacoma 2005–2015 · non-JBL" — one line per range. */
export function describeFitmentRange(r: FitmentRange): string {
  const years =
    r.yearStart !== null && r.yearEnd !== null
      ? r.yearStart === r.yearEnd
        ? String(r.yearStart)
        : `${r.yearStart}–${r.yearEnd}`
      : r.yearStart !== null
        ? `${r.yearStart}+`
        : r.yearEnd !== null
          ? `to ${r.yearEnd}`
          : null
  return [r.make, r.model, years, r.note ? `· ${r.note}` : null].filter(Boolean).join(' ')
}

// --- storage in the item's specs jsonb ---------------------------------------

const SPECS_KEY = 'vehicleFitment'

export function fitmentFromSpecs(specs: Record<string, unknown> | null | undefined): FitmentRange[] {
  return parseFitmentList(specs?.[SPECS_KEY])
}

export function specsWithFitment(
  specs: Record<string, unknown> | null | undefined,
  ranges: FitmentRange[],
): Record<string, unknown> {
  return { ...(specs ?? {}), [SPECS_KEY]: ranges }
}

/** Every make appearing in any item's fitment — the chooser's Make dropdown. */
export function fitmentMakes(items: Array<{ specs: Record<string, unknown> | null }>): string[] {
  const seen = new Map<string, string>()
  for (const item of items) {
    for (const r of fitmentFromSpecs(item.specs)) {
      const key = normalizeVehicleToken(r.make)
      if (key && !seen.has(key)) seen.set(key, r.make)
    }
  }
  return [...seen.values()].sort((a, b) => a.localeCompare(b))
}
