import { describe, expect, it } from 'vitest'
import {
  addScan,
  addTypedEntry,
  chooseAlternate,
  applyResolution,
  editLine,
  markResolving,
  nextPending,
  removeLine,
  setQuantity,
  summarize,
  type IntakeBatchLine,
} from './intakeBatch'

const scan = (codes: string[]) => codes.reduce<IntakeBatchLine[]>((lines, c) => addScan(lines, c), [])
const find = (lines: IntakeBatchLine[], code: string) => lines.find((l) => l.code === code)!

describe('addScan', () => {
  it('adds one to the quantity when the same box is scanned again', () => {
    // The speed win on a case of six: six beeps, no typing, one line.
    const lines = scan(['AAA', 'AAA', 'AAA'])
    expect(lines).toHaveLength(1)
    expect(find(lines, 'AAA').quantity).toBe(3)
  })

  it('shows the newest scan first', () => {
    expect(scan(['AAA', 'BBB']).map((l) => l.code)).toEqual(['BBB', 'AAA'])
  })

  it('ignores an empty scan rather than making a blank row', () => {
    expect(addScan([], '   ')).toHaveLength(0)
  })

  it('starts a line ready to be looked up, not looked up', () => {
    // Scanning must never block on the network — the whole point of a batch.
    expect(find(scan(['AAA']), 'AAA').status).toBe('pending')
  })
})

describe('applyResolution — the async hazard', () => {
  it('fills in a line whose lookup finishes normally', () => {
    let lines = scan(['AAA'])
    const rev = find(lines, 'AAA').revision
    lines = markResolving(lines, 'AAA')
    lines = applyResolution(lines, 'AAA', { status: 'resolved', brand: 'Kicker', model: 'CompR 12' }, rev)
    expect(find(lines, 'AAA').brand).toBe('Kicker')
    expect(find(lines, 'AAA').status).toBe('resolved')
  })

  it('never overwrites a correction the operator made while it was in flight', () => {
    // The outcome that would make staff distrust the whole screen: they fix a
    // name, and seconds later a machine guess replaces it.
    let lines = scan(['AAA'])
    const rev = find(lines, 'AAA').revision
    lines = markResolving(lines, 'AAA')
    lines = editLine(lines, 'AAA', { brand: 'Sundown Audio', model: 'SA-12' })
    lines = applyResolution(lines, 'AAA', { status: 'resolved', brand: 'Kicker', model: 'CompR 12' }, rev)

    expect(find(lines, 'AAA').brand).toBe('Sundown Audio')
    expect(find(lines, 'AAA').model).toBe('SA-12')
  })

  it('does not resurrect a line the operator deleted', () => {
    let lines = scan(['AAA'])
    const rev = find(lines, 'AAA').revision
    lines = removeLine(lines, 'AAA')
    lines = applyResolution(lines, 'AAA', { status: 'resolved', brand: 'Kicker' }, rev)
    expect(lines).toHaveLength(0)
  })

  it('ignores a resolution that lost a race with a quantity change', () => {
    // Changing quantity bumps the revision too — a lookup started before the
    // edit no longer describes the line the operator is looking at.
    let lines = scan(['AAA'])
    const rev = find(lines, 'AAA').revision
    lines = setQuantity(lines, 'AAA', 4)
    lines = applyResolution(lines, 'AAA', { status: 'resolved', brand: 'Kicker' }, rev)
    expect(find(lines, 'AAA').brand).toBeNull()
    expect(find(lines, 'AAA').quantity).toBe(4)
  })

  it('leaves quantity alone — that number is the operator’s, never the lookup’s', () => {
    let lines = scan(['AAA', 'AAA'])
    const rev = find(lines, 'AAA').revision
    lines = applyResolution(lines, 'AAA', { status: 'resolved', brand: 'Kicker' }, rev)
    expect(find(lines, 'AAA').quantity).toBe(2)
  })

  it('keeps a line that could not be identified, for naming by hand', () => {
    let lines = scan(['AAA'])
    const rev = find(lines, 'AAA').revision
    lines = applyResolution(lines, 'AAA', { status: 'unidentified' }, rev)
    expect(lines).toHaveLength(1)
    expect(find(lines, 'AAA').status).toBe('unidentified')
  })
})

describe('setQuantity', () => {
  it('removes the line when a miscount is corrected to zero', () => {
    expect(setQuantity(scan(['AAA']), 'AAA', 0)).toHaveLength(0)
    expect(setQuantity(scan(['AAA']), 'AAA', -3)).toHaveLength(0)
  })

  it('floors a fractional count rather than storing half a subwoofer', () => {
    expect(find(setQuantity(scan(['AAA']), 'AAA', 2.7), 'AAA').quantity).toBe(2)
  })
})

describe('nextPending', () => {
  it('works oldest-first, even though the display is newest-first', () => {
    // Resolution should follow the order things were scanned; only the list is
    // reversed, for the operator's benefit.
    expect(nextPending(scan(['AAA', 'BBB', 'CCC']))!.code).toBe('AAA')
  })

  it('skips lines already in flight or finished', () => {
    let lines = scan(['AAA', 'BBB'])
    lines = markResolving(lines, 'AAA')
    expect(nextPending(lines)!.code).toBe('BBB')
  })

  it('reports nothing left to do', () => {
    let lines = scan(['AAA'])
    lines = applyResolution(lines, 'AAA', { status: 'resolved' }, 0)
    expect(nextPending(lines)).toBeNull()
  })
})

describe('summarize', () => {
  it('counts pieces, not just products — that is what enters stock', () => {
    let lines = scan(['AAA', 'AAA', 'AAA', 'BBB'])
    lines = applyResolution(lines, 'AAA', { status: 'resolved' }, 0)
    const s = summarize(lines)
    expect(s.lines).toBe(2)
    expect(s.units).toBe(4)
    expect(s.identified).toBe(1)
    expect(s.working).toBe(1)
  })

  it('is settled only once every line has had its turn', () => {
    let lines = scan(['AAA', 'BBB'])
    expect(summarize(lines).settled).toBe(false)
    lines = applyResolution(lines, 'AAA', { status: 'resolved' }, 0)
    expect(summarize(lines).settled).toBe(false)
    lines = applyResolution(lines, 'BBB', { status: 'unidentified' }, 0)
    expect(summarize(lines).settled).toBe(true)
  })

  it('an empty batch is not "settled" — there is nothing to review', () => {
    expect(summarize([]).settled).toBe(false)
  })
})

describe('addTypedEntry', () => {
  it('adds a typed line marked as typed, newest first', () => {
    const lines = addTypedEntry(addScan([], '677478807501'), 'nemesis fr-m800')
    expect(lines[0]).toMatchObject({ code: 'nemesis fr-m800', entry: 'typed', status: 'pending', quantity: 1 })
    expect(lines[1].entry).toBe('scan')
  })

  it('counts a re-entered product as another unit, same as a re-scan', () => {
    let lines = addTypedEntry([], 'JP234')
    lines = addTypedEntry(lines, 'JP234')
    expect(lines).toHaveLength(1)
    expect(lines[0].quantity).toBe(2)
  })

  it('ignores a single character — a slip, not a product', () => {
    expect(addTypedEntry([], 'J')).toEqual([])
    expect(addTypedEntry([], '  ')).toEqual([])
  })

  it('keeps typed and scanned identities separate even when the text matches a code', () => {
    // Improbable but cheap to pin: a typed entry that happens to equal an
    // already-scanned code merges into it rather than duplicating the line —
    // the operator is talking about the same box either way.
    let lines = addScan([], '12345678')
    lines = addTypedEntry(lines, '12345678')
    expect(lines).toHaveLength(1)
    expect(lines[0].quantity).toBe(2)
    expect(lines[0].entry).toBe('scan')
  })

  it('resolves and edits like any other line', () => {
    let lines = addTypedEntry([], 'sundown sae-1200')
    lines = applyResolution(
      lines,
      'sundown sae-1200',
      { status: 'resolved', brand: 'Sundown', model: 'SAE-1200D', name: 'Monoblock amplifier', source: 'web' },
      0,
    )
    expect(lines[0].status).toBe('resolved')
    expect(lines[0].entry).toBe('typed')
    lines = editLine(lines, 'sundown sae-1200', { name: 'Mono amp' })
    expect(lines[0].revision).toBe(1)
  })
})

describe('chooseAlternate — a human picks between the machine\'s guesses', () => {
  const alternates = [
    { brand: 'Down4Sound', model: 'JP234', name: '4-channel amp', imageUrl: null, referencePriceCents: 32999, source: 'web' as const },
    { brand: 'Down4Sound', model: 'JP23', name: '2-channel amp', imageUrl: null, referencePriceCents: 19999, source: 'web' as const },
  ]

  function resolvedLine() {
    const lines = addTypedEntry([], 'jp23 amp')
    return applyResolution(
      lines,
      'jp23 amp',
      { status: 'resolved', ...alternates[0], alternates },
      0,
    )
  }

  it('applies the picked alternate\'s fields', () => {
    const lines = chooseAlternate(resolvedLine(), 'jp23 amp', 1)
    expect(lines[0]).toMatchObject({ model: 'JP23', name: '2-channel amp', referencePriceCents: 19999 })
  })

  it('bumps the revision so an in-flight lookup yields to the human choice', () => {
    const before = resolvedLine()
    const after = chooseAlternate(before, 'jp23 amp', 1)
    expect(after[0].revision).toBe(before[0].revision + 1)
    // The stale resolution that was already in flight lands afterwards — and
    // must be discarded, exactly as it would be after a typed edit.
    const clobbered = applyResolution(after, 'jp23 amp', { status: 'resolved', name: 'machine says otherwise' }, before[0].revision)
    expect(clobbered[0].name).toBe('2-channel amp')
  })

  it('keeps the alternates so the operator can flip back', () => {
    let lines = chooseAlternate(resolvedLine(), 'jp23 amp', 1)
    expect(lines[0].alternates).toHaveLength(2)
    lines = chooseAlternate(lines, 'jp23 amp', 0)
    expect(lines[0].model).toBe('JP234')
  })

  it('ignores an index that does not exist', () => {
    const before = resolvedLine()
    expect(chooseAlternate(before, 'jp23 amp', 7)).toEqual(before)
  })
})
