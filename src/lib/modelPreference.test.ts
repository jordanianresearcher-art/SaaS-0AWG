import { describe, expect, it } from 'vitest'
import { isChatModel, modelVersion, pickBestModel } from './modelPreference'

// A realistic Gemini listing, in the order an endpoint tends to return it:
// older generations first. That ordering is what broke the naive
// "first id containing flash" pick — it re-derived the stale model.
const GEMINI_LIST = [
  'models/gemini-2.0-flash',
  'models/gemini-2.5-flash',
  'models/gemini-2.5-pro',
  'models/gemini-3.7-flash',
  'models/gemini-3.7-pro',
  'models/text-embedding-004',
  'models/imagen-3.0-generate-002',
]

describe('pickBestModel', () => {
  it('prefers the newest generation, not the first match in the list', () => {
    // The bug this file exists for: gemini-2.5-flash appears before
    // gemini-3.7-flash, and picking the first "flash" re-derives the id that
    // just 404'd.
    expect(pickBestModel(GEMINI_LIST)).toBe('gemini-3.7-flash')
  })

  it('never returns an id that already failed', () => {
    // Without this the retry is wasted: discovery hands back the same broken
    // answer it was called to replace.
    expect(pickBestModel(['models/gemini-2.5-flash'], ['gemini-2.5-flash'])).toBeNull()
    expect(pickBestModel(GEMINI_LIST, ['gemini-3.7-flash'])).toBe('gemini-3.7-pro')
  })

  it('matches the exclusion regardless of the models/ prefix or case', () => {
    expect(pickBestModel(['models/Gemini-3.7-Flash', 'models/gemini-2.0-flash'], ['gemini-3.7-flash'])).toBe(
      'gemini-2.0-flash',
    )
  })

  it('prefers the cheap fast tier within a generation', () => {
    // Cost is the whole reason for a compatible endpoint; identifying a
    // subwoofer does not need a frontier model.
    expect(pickBestModel(['models/gemini-3.7-pro', 'models/gemini-3.7-flash'])).toBe('gemini-3.7-flash')
    expect(pickBestModel(['gpt-4.1', 'gpt-4.1-mini'])).toBe('gpt-4.1-mini')
  })

  it('never returns something that cannot answer a chat request', () => {
    expect(pickBestModel(['models/text-embedding-004', 'models/imagen-3.0-generate-002'])).toBeNull()
    expect(pickBestModel(['models/text-embedding-004', 'models/gemini-2.0-flash'])).toBe('gemini-2.0-flash')
  })

  it('reaches for a preview only when nothing stable is on offer', () => {
    // Previews get deprecated without notice — exactly the failure mode this
    // whole file is guarding against.
    expect(pickBestModel(['models/gemini-4.0-flash-preview', 'models/gemini-3.7-flash'])).toBe('gemini-3.7-flash')
    expect(pickBestModel(['models/gemini-4.0-flash-preview'])).toBe('gemini-4.0-flash-preview')
  })

  it('is deterministic for the same list', () => {
    const list = ['models/gemini-3.7-flash', 'models/gemini-3.7-flash-lite']
    expect(pickBestModel(list)).toBe(pickBestModel([...list].reverse()))
  })

  it('handles an empty or useless list rather than throwing', () => {
    expect(pickBestModel([])).toBeNull()
    expect(pickBestModel(['', '   '])).toBeNull()
  })

  it('works on a Groq-style list with no version dots', () => {
    const groq = ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant', 'whisper-large-v3']
    expect(pickBestModel(groq)).toBe('llama-3.3-70b-versatile')
  })
})

describe('modelVersion', () => {
  it('sorts 3.10 above 3.7 rather than below it', () => {
    // String comparison would get this backwards, and a "3.10" release is
    // exactly when that would start mattering.
    expect(modelVersion('gemini-3.10-flash')).toBeGreaterThan(modelVersion('gemini-3.7-flash'))
  })

  it('reads a bare generation number', () => {
    expect(modelVersion('gemini-3-flash')).toBe(3)
  })

  it('sorts an unversioned id last rather than first', () => {
    // Guessing that an unversioned alias is newest is how the earlier bugs
    // happened.
    expect(modelVersion('some-model')).toBe(-1)
  })
})

describe('isChatModel', () => {
  it('rejects the families that cannot answer a chat request', () => {
    for (const id of ['text-embedding-004', 'tts-1', 'whisper-large-v3', 'imagen-3.0-generate-002']) {
      expect(isChatModel(id), id).toBe(false)
    }
  })

  it('accepts ordinary chat models', () => {
    for (const id of ['gemini-3.7-flash', 'gpt-4.1-mini', 'llama-3.3-70b-versatile']) {
      expect(isChatModel(id), id).toBe(true)
    }
  })
})
