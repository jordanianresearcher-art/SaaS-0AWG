import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchModelsForMakeYear } from './vehicleData'

// Fixture reproduces the real NHTSA vPIC response for make=ford, modelyear=2015,
// captured during development: the API does fuzzy substring matching on make
// name, so a "ford" query returns models from unrelated companies whose names
// merely contain "ford" (Ashford, Bradford, Cranford, "Eagle Ford Tanks").
const FORD_2015_FIXTURE = {
  Count: 6,
  Results: [
    { Make_ID: 1237, Make_Name: 'AFFORDABLE ALUMINUM', Model_ID: 4563, Model_Name: 'Affordable Aluminum' },
    { Make_ID: 5697, Make_Name: 'ASHFORD MFG', Model_ID: 14916, Model_Name: 'Travel Park' },
    { Make_ID: 6674, Make_Name: 'BRADFORD BUILT', Model_ID: 18064, Model_Name: 'Bradford Built' },
    { Make_ID: 6579, Make_Name: 'CRANFORD RADIATOR INC.', Model_ID: 17910, Model_Name: 'CRANFORD RADIATOR INC.' },
    { Make_ID: 460, Make_Name: 'FORD', Model_ID: 1779, Model_Name: 'Focus' },
    { Make_ID: 460, Make_Name: 'FORD', Model_ID: 1780, Model_Name: 'Fusion' },
  ],
}

function mockFetchOnce(body: unknown, ok = true) {
  return vi.fn().mockResolvedValue({
    ok,
    json: () => Promise.resolve(body),
  })
}

describe('fetchModelsForMakeYear', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('filters out fuzzy-matched companies, keeping only the exact make', async () => {
    vi.stubGlobal('fetch', mockFetchOnce(FORD_2015_FIXTURE))
    const models = await fetchModelsForMakeYear('Ford', 2015)
    expect(models).toEqual(['Focus', 'Fusion'])
    expect(models).not.toContain('Bradford Built')
    expect(models).not.toContain('Travel Park')
  })

  it('dedupes and sorts model names', async () => {
    vi.stubGlobal(
      'fetch',
      mockFetchOnce({
        Results: [
          { Make_Name: 'TOYOTA', Model_Name: 'Tundra' },
          { Make_Name: 'TOYOTA', Model_Name: 'Camry' },
          { Make_Name: 'TOYOTA', Model_Name: 'Tundra' },
        ],
      }),
    )
    const models = await fetchModelsForMakeYear('Toyota', 2020)
    expect(models).toEqual(['Camry', 'Tundra'])
  })

  it('matches the make case-insensitively', async () => {
    vi.stubGlobal(
      'fetch',
      mockFetchOnce({ Results: [{ Make_Name: 'chevrolet', Model_Name: 'Silverado' }] }),
    )
    const models = await fetchModelsForMakeYear('CHEVROLET', 2021)
    expect(models).toEqual(['Silverado'])
  })

  it('returns an empty array (never throws) when the request fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')))
    await expect(fetchModelsForMakeYear('GMC', 2022)).resolves.toEqual([])
  })

  it('returns an empty array on a non-ok response', async () => {
    vi.stubGlobal('fetch', mockFetchOnce({}, false))
    await expect(fetchModelsForMakeYear('Honda', 2023)).resolves.toEqual([])
  })

  it('caches results so the same make/year is only fetched once', async () => {
    const fetchMock = mockFetchOnce({ Results: [{ Make_Name: 'MAZDA', Model_Name: 'CX-5' }] })
    vi.stubGlobal('fetch', fetchMock)
    await fetchModelsForMakeYear('Mazda', 2024)
    await fetchModelsForMakeYear('Mazda', 2024)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
