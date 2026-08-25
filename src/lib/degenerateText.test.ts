import { describe, expect, it } from 'vitest'
import { candidateLooksDegenerate, looksDegenerate } from './degenerateText'
import fixture from './__fixtures__/shopProducts.json'

describe('looksDegenerate — the real failure', () => {
  it('catches the exact output that reached a shop', () => {
    // Verbatim from rapid intake after typing "jp234 purple".
    expect(looksDegenerate('A100-P-P-P-P-P-P-P-P-P-cd-cd-cd-corp')).toBe(true)
    expect(looksDegenerate('JBL-A100-P-P-P-P-P-P-P-monolith-monolith')).toBe(true)
  })

  it('catches a repeated character run', () => {
    expect(looksDegenerate('KickerAAAAAAAAAA')).toBe(true)
  })

  it('catches absurd length', () => {
    expect(looksDegenerate('amplifier '.repeat(20))).toBe(true)
  })

  it('ignores empty and non-string input rather than guessing', () => {
    expect(looksDegenerate('')).toBe(false)
    expect(looksDegenerate(null)).toBe(false)
    expect(looksDegenerate(undefined)).toBe(false)
  })
})

describe('looksDegenerate — must not eat real products', () => {
  // The whole risk of this filter is false positives: car-audio SKUs look
  // like line noise, and discarding a real one is worse than showing an ugly
  // name, because the shop is left with nothing at all.
  it('keeps every product in the pilot shop\'s real catalog', () => {
    const rejected = (fixture as { model: string; name: string }[])
      .filter((r) => looksDegenerate(r.model) || looksDegenerate(r.name))
      .map((r) => `${r.model} / ${r.name}`)
    expect(rejected).toEqual([])
  })

  it('keeps the awkward-looking models this trade actually sells', () => {
    for (const real of [
      'EZY-RCA110-GX',
      'FR-M800.4D',
      'T400X4ad',
      'TS 400X4',
      'XD600/6v2',
      'SAE-1200D',
      'P3-1X12',
      'Forza AF M8.14 bit',
      'DOWN4SOUND | BIG 3 - 0 GAUGE CCA ( LIME GREEN /BLACK )',
      '1/0 Gauge OFC Wire - By the Foot',
    ]) {
      expect(looksDegenerate(real), real).toBe(false)
    }
  })

  it('allows a short run that occurs legitimately', () => {
    // "2-2-2" appears in wiring and impedance descriptions; three repeats is
    // reachable in real text, which is why the threshold is four.
    expect(looksDegenerate('2-2-2 ohm wiring kit')).toBe(false)
  })
})

describe('candidateLooksDegenerate', () => {
  it('rejects a candidate whose model collapsed even when the brand is clean', () => {
    expect(
      candidateLooksDegenerate({ brand: 'JBL', model: 'A100-P-P-P-P-P-P', name: 'Amplifier' }),
    ).toBe(true)
  })

  it('accepts an ordinary candidate', () => {
    expect(
      candidateLooksDegenerate({ brand: 'Down4Sound', model: 'JP234', name: '4-channel amplifier' }),
    ).toBe(false)
  })

  it('accepts a candidate with missing fields', () => {
    expect(candidateLooksDegenerate({ name: 'Speaker wire' })).toBe(false)
    expect(candidateLooksDegenerate({})).toBe(false)
  })
})
