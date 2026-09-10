import { describe, expect, it } from 'vitest'
import {
  WIN_SOURCES,
  WIN_SOURCE_OPTIONS,
  isWinSource,
  summarizeWinSources,
  winSourceAttribution,
  winSourceLabel,
} from './winSource'

describe('the option list', () => {
  it('has no duplicate values', () => {
    expect(new Set(WIN_SOURCES).size).toBe(WIN_SOURCES.length)
  })

  it('offers exactly one way to say "I do not know"', () => {
    const unknown = WIN_SOURCE_OPTIONS.filter((o) => o.attribution === 'unknown')
    expect(unknown.map((o) => o.value)).toEqual(['unsure'])
  })

  it('keeps staff-initiated wins out of the app bucket', () => {
    // The conservative split is the whole point: if calling the customer
    // yourself counted as the app recovering the sale, the recovered-revenue
    // number would not survive "I closed those on the phone".
    expect(winSourceAttribution('we_reached_out')).toBe('shop')
    expect(winSourceAttribution('walked_in')).toBe('shop')
    expect(winSourceAttribution('quote_reply')).toBe('app')
    expect(winSourceAttribution('follow_up')).toBe('app')
    expect(winSourceAttribution('financing')).toBe('app')
  })

  it('leads with the app-attributable choices', () => {
    expect(WIN_SOURCE_OPTIONS.slice(0, 3).every((o) => o.attribution === 'app')).toBe(true)
  })

  it('labels every option in words a shop would say out loud', () => {
    for (const option of WIN_SOURCE_OPTIONS) {
      expect(option.label.length).toBeGreaterThan(0)
      expect(option.label).not.toMatch(/_/)
    }
  })
})

describe('reading a stored value', () => {
  it('recognises every option it offers', () => {
    for (const option of WIN_SOURCE_OPTIONS) expect(isWinSource(option.value)).toBe(true)
  })

  it('rejects anything else without guessing', () => {
    for (const junk of ['', 'phone', 'APP', 'quote reply', null, undefined, 7, {}]) {
      expect(isWinSource(junk)).toBe(false)
      expect(winSourceLabel(junk as string | null)).toBeNull()
    }
  })

  it('treats an unrecorded source as unknown, not as a shop win', () => {
    expect(winSourceAttribution(null)).toBe('unknown')
    expect(winSourceAttribution(undefined)).toBe('unknown')
    // A value the app has never heard of must not silently land in a bucket.
    expect(winSourceAttribution('carrier_pigeon')).toBe('unknown')
  })
})

describe('summarizing a pilot', () => {
  it('keeps "asked and unsure" apart from "never asked"', () => {
    // These look the same in one bucket, and only the second improves by
    // itself as staff keep using the app.
    const summary = summarizeWinSources(['unsure', null, undefined])
    expect(summary.unsure).toBe(1)
    expect(summary.unrecorded).toBe(2)
  })

  it('counts the eight-win shape the pilot actually has', () => {
    const summary = summarizeWinSources([
      'quote_reply',
      'financing',
      'follow_up',
      'we_reached_out',
      'we_reached_out',
      'walked_in',
      'unsure',
      null,
    ])
    expect(summary).toEqual({ app: 3, shop: 3, unsure: 1, unrecorded: 1, total: 8 })
  })

  it('always accounts for every win', () => {
    const values = ['quote_reply', 'walked_in', 'nonsense', null, 'unsure']
    const s = summarizeWinSources(values)
    expect(s.app + s.shop + s.unsure + s.unrecorded).toBe(s.total)
    expect(s.total).toBe(values.length)
  })

  it('reports zeroes rather than dividing by nothing', () => {
    expect(summarizeWinSources([])).toEqual({ app: 0, shop: 0, unsure: 0, unrecorded: 0, total: 0 })
  })
})
