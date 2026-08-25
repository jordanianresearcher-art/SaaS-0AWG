// The persisted rapid-intake batch, readable and appendable from anywhere.
//
// Originally this lived inline in RapidIntakePage, which made the batch that
// page's private property. But "scan first, sort it out later" only works as
// a habit if a scan is never the wrong move — and scanning an unknown code on
// the inventory list used to be exactly that: a dead end ("not found") with
// the code discarded. Now any page can drop a code into the stash and send
// the operator to intake, where it is already waiting, already resolving.
//
// localStorage rather than app state on purpose: the batch must survive a
// reload mid-pallet (forty scans lost to a stray refresh is how staff stop
// trusting a tool), and it is small enough that storing it costs nothing.

import { addScan, type IntakeBatchLine } from './intakeBatch'

export const INTAKE_BATCH_STORAGE_KEY = '0gauge-intake-batch'

export function loadIntakeBatch(): IntakeBatchLine[] {
  try {
    const raw = window.localStorage.getItem(INTAKE_BATCH_STORAGE_KEY)
    const parsed = raw ? JSON.parse(raw) : null
    if (!Array.isArray(parsed)) return []
    // Lines saved before `entry`/`alternates` existed: every line back then
    // came from a scanner, and there were no kept alternates.
    return (parsed as IntakeBatchLine[]).map((l) => ({
      ...l,
      entry: l.entry === 'typed' ? ('typed' as const) : ('scan' as const),
      alternates: Array.isArray(l.alternates) ? l.alternates : [],
    }))
  } catch {
    return []
  }
}

export function saveIntakeBatch(lines: IntakeBatchLine[]): void {
  try {
    window.localStorage.setItem(INTAKE_BATCH_STORAGE_KEY, JSON.stringify(lines))
  } catch {
    // A full or blocked storage quota must not break intake — the batch just
    // stops surviving reloads, which is the pre-existing behaviour anyway.
  }
}

/**
 * Drop one scanned code into the stashed batch from outside the intake page.
 * Same merge rule as scanning there: a repeat of an existing code is another
 * unit, not a duplicate row.
 */
export function stashScanForIntake(code: string): void {
  saveIntakeBatch(addScan(loadIntakeBatch(), code))
}
