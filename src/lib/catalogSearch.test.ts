import { describe, it, expect } from 'vitest'
import { filterCatalog, itemMatchesQuery, tokenizeQuery } from './catalogSearch'
import type { CatalogItem } from '../types'

type Row = Pick<CatalogItem, 'brand' | 'model' | 'name' | 'category' | 'sku'>

function row(overrides: Partial<Row> = {}): Row {
  return { brand: null, model: null, name: '', category: null, sku: null, ...overrides }
}

const KICKER_12 = row({ brand: 'Kicker', model: 'CompR 12', name: '12" Subwoofer', category: 'subwoofer' })
const KICKER_AMP = row({ brand: 'Kicker', model: 'KEY200.4', name: '4-channel smart amp', category: 'four_five_channel_amp' })
const EPICENTER = row({ brand: 'AudioControl', model: 'The Epicenter', name: 'Bass restoration processor', category: 'epicenter' })
const PORTED_BOX = row({ brand: null, model: null, name: 'Dual 12 ported box', category: 'enclosure' })
const DS18_SUB = row({ brand: 'DS18', model: 'PRO-X10', name: '10 inch subwoofer', category: 'subwoofer' })

const ALL = [KICKER_12, KICKER_AMP, EPICENTER, PORTED_BOX, DS18_SUB]

describe('tokenizeQuery', () => {
  it('splits on whitespace and punctuation', () => {
    expect(tokenizeQuery('kicker compr 12')).toEqual(['kicker', 'compr', '12'])
  })

  it('collapses the four ways people write a size', () => {
    for (const q of ['12"', '12in', '12 inch', '12-inch', '12 inches']) {
      expect(tokenizeQuery(q)).toEqual(['12'])
    }
  })

  it('returns nothing for an empty query', () => {
    expect(tokenizeQuery('')).toEqual([])
    expect(tokenizeQuery('   ')).toEqual([])
  })
})

describe('itemMatchesQuery — the queries that used to find nothing', () => {
  it('finds a 12-inch sub from "subwoofer 12 inch"', () => {
    expect(itemMatchesQuery(KICKER_12, 'subwoofer 12 inch')).toBe(true)
  })

  it('finds it from "12 sub" using shop-floor shorthand', () => {
    expect(itemMatchesQuery(KICKER_12, '12 sub')).toBe(true)
    expect(itemMatchesQuery(KICKER_12, 'sub 12')).toBe(true)
  })

  it('finds the Epicenter by its category, not just its name', () => {
    expect(itemMatchesQuery(EPICENTER, 'epicenter')).toBe(true)
    // Even an item whose own name never says "epicenter".
    const other = row({ brand: 'AudioControl', model: 'AC-1', name: 'Processor', category: 'epicenter' })
    expect(itemMatchesQuery(other, 'epicenter')).toBe(true)
  })

  it('finds an amp from "amp"', () => {
    expect(itemMatchesQuery(KICKER_AMP, 'amp')).toBe(true)
    expect(itemMatchesQuery(KICKER_AMP, 'kicker amp')).toBe(true)
  })

  it('finds an enclosure from "box"', () => {
    expect(itemMatchesQuery(PORTED_BOX, 'box')).toBe(true)
  })
})

describe('itemMatchesQuery — narrowing', () => {
  it('requires every token to match (AND, not OR)', () => {
    expect(itemMatchesQuery(KICKER_12, 'kicker 12')).toBe(true)
    // DS18 is a 10" sub — "kicker" does not match it.
    expect(itemMatchesQuery(DS18_SUB, 'kicker 12')).toBe(false)
    // Right brand, wrong size.
    expect(itemMatchesQuery(KICKER_12, 'kicker 10')).toBe(false)
  })

  it('matches on model and sku too', () => {
    expect(itemMatchesQuery(KICKER_AMP, 'key200')).toBe(true)
    expect(itemMatchesQuery(row({ name: 'Thing', sku: 'ABC-999' }), 'abc-999')).toBe(true)
  })

  it('is case-insensitive', () => {
    expect(itemMatchesQuery(KICKER_12, 'KICKER')).toBe(true)
    expect(itemMatchesQuery(KICKER_12, 'kIcKeR')).toBe(true)
  })

  it('treats an empty query as matching everything, so a cleared box shows the full list', () => {
    expect(itemMatchesQuery(KICKER_12, '')).toBe(true)
    expect(itemMatchesQuery(KICKER_12, '   ')).toBe(true)
  })
})

describe('filterCatalog', () => {
  it('narrows a real list', () => {
    expect(filterCatalog(ALL, 'sub')).toEqual([KICKER_12, DS18_SUB])
    expect(filterCatalog(ALL, 'kicker')).toEqual([KICKER_12, KICKER_AMP])
    expect(filterCatalog(ALL, '12')).toEqual([KICKER_12, PORTED_BOX])
  })

  it('returns the list untouched for an empty query', () => {
    expect(filterCatalog(ALL, '')).toEqual(ALL)
  })

  it('returns nothing when there is genuinely no match, rather than falling back to everything', () => {
    expect(filterCatalog(ALL, 'zzzznotathing')).toEqual([])
  })

  it('preserves input order so the caller keeps control of sorting', () => {
    const reversed = [...ALL].reverse()
    expect(filterCatalog(reversed, 'sub')).toEqual([DS18_SUB, KICKER_12])
  })

  it('tolerates an item with no category and no identity fields', () => {
    const bare = row({ name: 'Custom fab work' })
    expect(itemMatchesQuery(bare, 'fab')).toBe(true)
    expect(itemMatchesQuery(bare, 'subwoofer')).toBe(false)
  })
})
