import { describe, expect, it } from 'vitest'
import { extractJsonBlock, parseLooseJson } from './aiJson'

describe('parseLooseJson', () => {
  it('passes a clean reply straight through', () => {
    expect(parseLooseJson('{"candidates":[]}')).toEqual({ candidates: [] })
  })

  it('unwraps a fenced block', () => {
    const raw = '```json\n{"candidates":[{"name":"Kicker CompR 12"}]}\n```'
    expect(parseLooseJson(raw)).toEqual({ candidates: [{ name: 'Kicker CompR 12' }] })
  })

  it('unwraps a fence with no language tag', () => {
    expect(parseLooseJson('```\n{"ok":true}\n```')).toEqual({ ok: true })
  })

  it('ignores prose on either side', () => {
    const raw = 'Here are the products I found:\n{"candidates":[]}\nLet me know if you need more.'
    expect(parseLooseJson(raw)).toEqual({ candidates: [] })
  })

  it('does not end the object on a brace inside a product name', () => {
    // The naive "first { to last }" approach survives this one, but the naive
    // "first { to first }" does not — and product names really do carry
    // braces and brackets.
    const raw = '{"candidates":[{"name":"JL Audio 12W6v3 {open box}"}]}'
    expect(parseLooseJson(raw)).toEqual({ candidates: [{ name: 'JL Audio 12W6v3 {open box}' }] })
  })

  it('handles an escaped quote inside a name', () => {
    const raw = 'Result:\n{"candidates":[{"name":"12\\" subwoofer"}]}'
    expect(parseLooseJson<{ candidates: Array<{ name: string }> }>(raw)?.candidates[0].name).toBe('12" subwoofer')
  })

  it('parses a bare array reply', () => {
    expect(parseLooseJson('[{"name":"TS 400X4"}]')).toEqual([{ name: 'TS 400X4' }])
  })

  it('returns null rather than guessing at a truncated reply', () => {
    // A repaired parse would invent a product, which is far worse for a shop
    // than no result at all.
    expect(parseLooseJson('{"candidates":[{"name":"Taramps TS 400X4"')).toBeNull()
  })

  it('returns null for a reply with no JSON in it', () => {
    expect(parseLooseJson("I couldn't find that product.")).toBeNull()
    expect(parseLooseJson('')).toBeNull()
    expect(parseLooseJson(null)).toBeNull()
    expect(parseLooseJson(undefined)).toBeNull()
  })

  it('returns null for malformed JSON rather than half-reading it', () => {
    expect(parseLooseJson('{"candidates": [oops]}')).toBeNull()
  })
})

describe('extractJsonBlock', () => {
  it('finds the balanced object and stops at its true end', () => {
    expect(extractJsonBlock('prefix {"a":{"b":1}} suffix')).toBe('{"a":{"b":1}}')
  })

  it('is not fooled by a closing brace inside a string', () => {
    expect(extractJsonBlock('{"a":"}"}')).toBe('{"a":"}"}')
  })

  it('prefers the fenced contents when a fence is present', () => {
    expect(extractJsonBlock('{"outside":1}\n```json\n{"inside":2}\n```')).toBe('{"inside":2}')
  })

  it('returns null when nothing balances', () => {
    expect(extractJsonBlock('{"a":1')).toBeNull()
    expect(extractJsonBlock('no json here')).toBeNull()
  })
})
