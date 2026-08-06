import { describe, expect, it } from 'vitest'
import { dedupeCandidates, normalizeBarcode, normalizeQuery, rankCandidates, type RankableCandidate } from './productResolver'

function candidate(overrides: Partial<RankableCandidate>): RankableCandidate {
  return {
    id: 'c1',
    brand: null,
    model: null,
    name: 'Unnamed',
    upc: null,
    confidence: 0.5,
    evidence: [],
    ...overrides,
  }
}

describe('normalizeBarcode', () => {
  it('preserves leading zeros — never treats a barcode as a number', () => {
    expect(normalizeBarcode('012345678905')).toBe('012345678905')
  })

  it('trims whitespace and strips scanner-added dashes', () => {
    expect(normalizeBarcode(' 012-345-678905 ')).toBe('012345678905')
  })
})

describe('normalizeQuery', () => {
  it('lowercases, trims, and collapses whitespace', () => {
    expect(normalizeQuery('  NA-12F   Loaded Box ')).toBe('na-12f loaded box')
  })
})

describe('rankCandidates', () => {
  it('ranks an exact model-token match ahead of a higher-confidence generic result', () => {
    const generic = candidate({ id: 'generic', brand: 'Kicker', model: 'CompR', name: 'CompR subwoofer', confidence: 0.9 })
    const exact = candidate({ id: 'exact', brand: 'Alpine', model: 'NA-12F', name: 'NA-12F loaded enclosure', confidence: 0.4 })
    const ranked = rankCandidates([generic, exact], 'NA-12F')
    expect(ranked[0].id).toBe('exact')
  })

  it('falls back to confidence when neither candidate has an exact token match', () => {
    const lower = candidate({ id: 'lower', name: 'Some amp', confidence: 0.3 })
    const higher = candidate({ id: 'higher', name: 'Another amp', confidence: 0.8 })
    const ranked = rankCandidates([lower, higher], 'zzz-not-present')
    expect(ranked[0].id).toBe('higher')
  })

  it('does not mutate the input array', () => {
    const a = candidate({ id: 'a', confidence: 0.2 })
    const b = candidate({ id: 'b', confidence: 0.9 })
    const input = [a, b]
    rankCandidates(input, 'query')
    expect(input[0].id).toBe('a')
  })

  it('ranking a barcode query (no textual token overlap possible) falls back to confidence', () => {
    const lower = candidate({ id: 'lower', brand: 'Kicker', model: 'CompR', confidence: 0.3 })
    const higher = candidate({ id: 'higher', brand: 'Alpine', model: 'X-Sport', confidence: 0.7 })
    const ranked = rankCandidates([lower, higher], '012345678905')
    expect(ranked[0].id).toBe('higher')
  })
})

describe('dedupeCandidates', () => {
  it('merges two candidates with the exact same UPC', () => {
    const a = candidate({ id: 'a', upc: '012345678905', confidence: 0.5, evidence: ['from cache'] })
    const b = candidate({ id: 'b', upc: '012345678905', confidence: 0.8, evidence: ['from web search'] })
    const result = dedupeCandidates([a, b])
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe('b') // higher confidence wins
    expect(result[0].evidence).toEqual(['from web search', 'from cache'])
  })

  it('merges two candidates with the exact same normalized brand + model', () => {
    const a = candidate({ id: 'a', brand: 'Kicker', model: 'CompR', confidence: 0.4 })
    const b = candidate({ id: 'b', brand: '  KICKER ', model: 'compr', confidence: 0.6 })
    const result = dedupeCandidates([a, b])
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe('b')
  })

  it('never merges on name similarity alone', () => {
    const a = candidate({ id: 'a', name: 'Kicker CompR 12-inch subwoofer' })
    const b = candidate({ id: 'b', name: 'Kicker CompR 12 inch sub' })
    const result = dedupeCandidates([a, b])
    expect(result).toHaveLength(2)
  })

  it('keeps candidates separate when brand or model is missing on either side', () => {
    const a = candidate({ id: 'a', brand: 'Kicker', model: null })
    const b = candidate({ id: 'b', brand: 'Kicker', model: null })
    const result = dedupeCandidates([a, b])
    expect(result).toHaveLength(2)
  })
})
