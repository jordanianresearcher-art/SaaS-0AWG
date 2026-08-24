import { describe, expect, it } from 'vitest'
import {
  addScan,
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
