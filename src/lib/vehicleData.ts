// Year -> Make -> Model vehicle picker data. Make is a curated list (NHTSA's
// full make list mixes in ~12,300 entries across trailers, custom shops,
// etc. — not usable as a customer-facing dropdown). Model lookups go
// through NHTSA's free public vPIC API, which does fuzzy substring
// matching on make name (a "ford" query returns "ASHFORD MFG", "BRADFORD
// BUILT", etc. ahead of real Ford results) — filtered here to an exact
// case-insensitive match before use.

const CURRENT_YEAR = new Date().getFullYear()

/** Current year + 1 (new-model-year vehicles sell before the calendar year turns) down to 1990. */
export const VEHICLE_YEARS: number[] = Array.from(
  { length: CURRENT_YEAR + 1 - 1990 + 1 },
  (_, i) => CURRENT_YEAR + 1 - i,
)

export const OTHER_MAKE = 'Other'

/** Common passenger vehicle / truck / SUV makes — the shop's realistic customer base. */
export const COMMON_MAKES: string[] = [
  'Acura', 'Audi', 'BMW', 'Buick', 'Cadillac', 'Chevrolet', 'Chrysler',
  'Dodge', 'Ford', 'GMC', 'Honda', 'Hyundai', 'Infiniti', 'Jeep', 'Kia',
  'Land Rover', 'Lexus', 'Lincoln', 'Mazda', 'Mercedes-Benz', 'Mini',
  'Mitsubishi', 'Nissan', 'Porsche', 'RAM', 'Subaru', 'Tesla', 'Toyota',
  'Volkswagen', 'Volvo', OTHER_MAKE,
]

interface NhtsaModelResult {
  Make_Name?: string
  Model_Name?: string
}

const modelCache = new Map<string, string[]>()

/**
 * Models for a make/year from NHTSA's vPIC API, exact-match filtered on the
 * make name. Never throws — a network hiccup or NHTSA outage should degrade
 * to free text, not block quote creation.
 */
export async function fetchModelsForMakeYear(make: string, year: number): Promise<string[]> {
  const cacheKey = `${make.toLowerCase()}|${year}`
  const cached = modelCache.get(cacheKey)
  if (cached) return cached

  try {
    const url = `https://vpic.nhtsa.dot.gov/api/vehicles/getmodelsformakeyear/make/${encodeURIComponent(make)}/modelyear/${year}?format=json`
    const response = await fetch(url)
    if (!response.ok) return []
    const data = (await response.json()) as { Results?: NhtsaModelResult[] }
    const target = make.trim().toUpperCase()
    const models = (data.Results ?? [])
      .filter((r) => r.Make_Name?.trim().toUpperCase() === target && r.Model_Name)
      .map((r) => r.Model_Name!.trim())
    const unique = Array.from(new Set(models)).sort((a, b) => a.localeCompare(b))
    modelCache.set(cacheKey, unique)
    return unique
  } catch {
    return []
  }
}
