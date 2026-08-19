import { describe, it, expect } from 'vitest'
import {
  buildDescriptorFromSpecs,
  canonicalizeBrand,
  canonicalizeModel,
  canonicalizeProductFields,
  formatItemDisplayName,
  formatItemShortName,
} from './productNaming'

describe('canonicalizeBrand', () => {
  it('fixes the casing people actually type', () => {
    expect(canonicalizeBrand('kicker')).toBe('Kicker')
    expect(canonicalizeBrand('KICKER')).toBe('Kicker')
    expect(canonicalizeBrand('  KiCkEr  ')).toBe('Kicker')
  })

  it('resolves multi-word brands regardless of spacing or punctuation', () => {
    expect(canonicalizeBrand('jl audio')).toBe('JL Audio')
    expect(canonicalizeBrand('JLAUDIO')).toBe('JL Audio')
    expect(canonicalizeBrand('rockford fosgate')).toBe('Rockford Fosgate')
  })

  it('resolves the shorthand shops use out loud', () => {
    expect(canonicalizeBrand('rockford')).toBe('Rockford Fosgate')
    expect(canonicalizeBrand('RF')).toBe('Rockford Fosgate')
    expect(canonicalizeBrand('skar')).toBe('Skar Audio')
    expect(canonicalizeBrand('sundown')).toBe('Sundown Audio')
  })

  it('preserves all-caps brands rather than title-casing them into nonsense', () => {
    expect(canonicalizeBrand('DS18')).toBe('DS18')
    expect(canonicalizeBrand('ds18')).toBe('DS18')
    expect(canonicalizeBrand('MTX')).toBe('MTX')
  })

  it('title-cases an unknown brand instead of leaving raw input', () => {
    expect(canonicalizeBrand('some new brand')).toBe('Some New Brand')
    expect(canonicalizeBrand('SOME NEW BRAND')).toBe('SOME NEW BRAND') // already an initialism-looking string
  })

  it('returns null for nothing usable', () => {
    expect(canonicalizeBrand(null)).toBeNull()
    expect(canonicalizeBrand(undefined)).toBeNull()
    expect(canonicalizeBrand('   ')).toBeNull()
  })

  it('is idempotent — canonical in, canonical out', () => {
    for (const b of ['Kicker', 'JL Audio', 'DS18', 'Rockford Fosgate']) {
      expect(canonicalizeBrand(canonicalizeBrand(b))).toBe(b)
    }
  })
})

describe('canonicalizeModel', () => {
  it('keeps model punctuation intact — it is an identifier, not prose', () => {
    expect(canonicalizeModel('P3D4-12')).toBe('P3D4-12')
    expect(canonicalizeModel('KEY200.4')).toBe('KEY200.4')
  })

  it('collapses stray whitespace', () => {
    expect(canonicalizeModel('  CompR   12  ')).toBe('CompR 12')
  })

  it('strips a brand repeated inside the model', () => {
    expect(canonicalizeModel('Kicker CompR', 'Kicker')).toBe('CompR')
    expect(canonicalizeModel('kicker CompR', 'KICKER')).toBe('CompR')
  })

  it('leaves a model that merely starts with similar letters alone', () => {
    expect(canonicalizeModel('Kickstart 12', 'Kicker')).toBe('Kickstart 12')
  })

  it('returns null for nothing usable', () => {
    expect(canonicalizeModel(null)).toBeNull()
    expect(canonicalizeModel('  ')).toBeNull()
  })
})

describe('formatItemDisplayName', () => {
  it('renders the canonical Brand Model — Descriptor form', () => {
    expect(
      formatItemDisplayName({ brand: 'kicker', model: 'CompR 12', name: '12" Subwoofer, Dual 2Ω, 500W RMS' }),
    ).toBe('Kicker CompR 12 — 12" Subwoofer, Dual 2Ω, 500W RMS')
  })

  it('never repeats the brand or model inside the descriptor', () => {
    expect(formatItemDisplayName({ brand: 'Kicker', model: 'CompR', name: 'Kicker CompR 12 inch sub' })).toBe(
      'Kicker CompR — 12 inch sub',
    )
  })

  it('degrades gracefully when fields are missing — the quote form requires nothing', () => {
    expect(formatItemDisplayName({ brand: 'Kicker', model: null, name: null })).toBe('Kicker')
    expect(formatItemDisplayName({ brand: null, model: null, name: 'Custom fab work' })).toBe('Custom fab work')
    expect(formatItemDisplayName({ brand: null, model: 'CompR', name: null })).toBe('CompR')
    expect(formatItemDisplayName({})).toBe('Item')
    expect(formatItemDisplayName({ brand: null, model: null, name: '   ' })).toBe('Item')
  })

  it('converges the parts it can safely normalize: brand casing and stray whitespace', () => {
    const a = formatItemDisplayName({ brand: 'kicker', model: 'CompR 12', name: '12" subwoofer' })
    const b = formatItemDisplayName({ brand: 'KICKER', model: '  CompR   12', name: ' 12" subwoofer ' })
    const c = formatItemDisplayName({ brand: ' Kicker ', model: 'CompR 12', name: '12" subwoofer' })
    expect(a).toBe(b)
    expect(b).toBe(c)
  })

  it('leaves model casing alone on purpose — a model is a part number, not prose', () => {
    // "CompR", "P3D4-12" and "KEY200.4" all carry meaningful case that
    // upper/lower-casing would destroy. Two staff typing different case
    // converge instead through case-insensitive catalog matching (see
    // normalizeModelKey in productSearch.ts), not by rewriting here.
    expect(formatItemDisplayName({ brand: 'Kicker', model: 'CompR 12', name: null })).toBe('Kicker CompR 12')
    expect(formatItemDisplayName({ brand: 'Rockford Fosgate', model: 'P3D4-12', name: null })).toBe(
      'Rockford Fosgate P3D4-12',
    )
  })
})

describe('formatItemShortName', () => {
  it('is brand + model when there is an identity', () => {
    expect(formatItemShortName({ brand: 'kicker', model: 'CompR 12', name: 'a long descriptor' })).toBe(
      'Kicker CompR 12',
    )
  })

  it('falls back to the typed name for a one-off line item', () => {
    expect(formatItemShortName({ brand: null, model: null, name: 'Custom fab work' })).toBe('Custom fab work')
  })
})

describe('buildDescriptorFromSpecs', () => {
  it('builds a consistent spec line in a fixed order', () => {
    expect(
      buildDescriptorFromSpecs({ size_in: 12, type: 'Subwoofer', impedance: 'Dual 2Ω', rms_watts: 500 }),
    ).toBe('12", Subwoofer, Dual 2Ω, 500W RMS')
  })

  it('handles amplifier-shaped specs', () => {
    expect(buildDescriptorFromSpecs({ type: 'Amplifier', channels: 4, rms_watts: 800 })).toBe(
      'Amplifier, 4-channel, 800W RMS',
    )
  })

  it('falls back to the given name when specs carry nothing useful', () => {
    expect(buildDescriptorFromSpecs({}, 'Wiring kit')).toBe('Wiring kit')
    expect(buildDescriptorFromSpecs(null, 'Wiring kit')).toBe('Wiring kit')
    expect(buildDescriptorFromSpecs(null, null)).toBeNull()
  })

  it('ignores junk values rather than rendering them', () => {
    expect(buildDescriptorFromSpecs({ channels: 0, rms_watts: 0 }, 'Amp')).toBe('Amp')
  })
})

describe('canonicalizeProductFields', () => {
  it('normalizes AI/import output the same way manual entry is normalized', () => {
    const out = canonicalizeProductFields({
      brand: 'kicker',
      model: 'Kicker CompR 12',
      name: 'Kicker CompR 12 subwoofer',
      specs: { size_in: 12, type: 'Subwoofer', impedance: 'Dual 2Ω', rms_watts: 500 },
    })
    expect(out.brand).toBe('Kicker')
    expect(out.model).toBe('CompR 12')
    // The descriptor is built from specs and carries no brand/model repetition.
    expect(out.name).toBe('12", Subwoofer, Dual 2Ω, 500W RMS')
    expect(formatItemDisplayName(out)).toBe('Kicker CompR 12 — 12", Subwoofer, Dual 2Ω, 500W RMS')
  })

  it('keeps a usable name when there are no specs at all', () => {
    const out = canonicalizeProductFields({ brand: 'ds18', model: 'SLC-8S', name: '8 inch speaker' })
    expect(out.brand).toBe('DS18')
    expect(out.model).toBe('SLC-8S')
    expect(out.name).toBe('8 inch speaker')
  })

  it('never produces an empty name', () => {
    expect(canonicalizeProductFields({ brand: null, model: null, name: null }).name).toBe('Item')
  })
  it('does not restore a brand+model name as the descriptor — the intake duplication bug', () => {
    // Rapid intake used to build name as brand + query, so a DS18 Project 360
    // arrived as brand "DS18", model "DS18 Project 360", name "DS18 DS18
    // Project 360". The descriptor correctly collapses to nothing; the old
    // fallback then put the whole string back and the tape read
    // "DS18 Project 360 DS18 Project 360".
    const out = canonicalizeProductFields({
      brand: 'DS18',
      model: 'DS18 Project 360',
      name: 'DS18 DS18 Project 360',
    })
    expect(out.brand).toBe('DS18')
    expect(out.model).toBe('Project 360')
    expect(out.name).toBe('')
    expect(formatItemDisplayName(out)).toBe('DS18 Project 360')
  })

  it('leaves an empty descriptor empty whenever there is a brand or model to carry the name', () => {
    expect(canonicalizeProductFields({ brand: 'Kicker', model: 'CompR 12', name: 'Kicker CompR 12' }).name).toBe('')
    expect(canonicalizeProductFields({ brand: 'Kicker', model: null, name: 'Kicker' }).name).toBe('')
    expect(canonicalizeProductFields({ brand: null, model: 'CompR 12', name: 'CompR 12' }).name).toBe('')
  })

  it('still falls back to something readable when there is no identity at all', () => {
    expect(canonicalizeProductFields({ brand: null, model: null, name: 'Custom fab work' }).name).toBe(
      'Custom fab work',
    )
    expect(canonicalizeProductFields({ brand: null, model: null, name: null }).name).toBe('Item')
  })

  it('round-trips: canonicalize then display never repeats a word', () => {
    for (const input of [
      { brand: 'DS18', model: 'DS18 Project 360', name: 'DS18 DS18 Project 360' },
      { brand: 'kicker', model: 'Kicker CompR 12', name: 'Kicker CompR 12' },
      { brand: 'Skar', model: 'SDR-12', name: 'Skar SDR-12 subwoofer' },
    ]) {
      const display = formatItemDisplayName(canonicalizeProductFields(input))
      const words = display.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter(Boolean)
      expect(new Set(words).size).toBe(words.length)
    }
  })
})
