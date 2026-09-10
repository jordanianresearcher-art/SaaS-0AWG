// What actually brought a won job back.
//
// The app's recovered-revenue total is its whole claim, and today that total
// rests on nothing but "somebody tapped Mark won." Five weeks into the pilot,
// eight jobs are recorded as won and there is no field anywhere that says why.
// So the number cannot survive the one question every prospect asks at day 30:
//
//   "No — I closed those on the phone. I'd have gotten them anyway."
//
// There is no way to answer that after the fact. The person who closed the
// deal knew the answer at the moment they marked it won, and the app never
// asked. This module is the vocabulary for asking, once, in one tap.
//
// Two rules shape the option list:
//
// 1. **It has to be answerable while standing at a counter.** Six choices, no
//    typing, and "Not sure" is a real answer rather than a failure to answer.
//    (No required fields anywhere — a win with no source is still a win.)
// 2. **The attribution buckets are deliberately conservative.** A source only
//    counts as `app` when the customer came back through something the app
//    put in front of them. Staff picking up the phone counts as `shop`, even
//    though the app's follow-up list is often what prompted the call — because
//    a number that survives the objection is worth more than a number that
//    flatters the product. If the honest split is bad, report the bad split.

import type { WinSource } from '../types'

export type { WinSource }

/** Who gets the credit. `unknown` covers both "not sure" and never asked. */
export type WinAttribution = 'app' | 'shop' | 'unknown'

export interface WinSourceOption {
  value: WinSource
  /** What the button says. Written for a phone held between customers. */
  label: string
  attribution: WinAttribution
}

/**
 * Display order, most-to-least app-attributable. The first three are the ones
 * that make the recovered-revenue claim; putting them first is not a thumb on
 * the scale, it is the order staff will recognise a customer in.
 */
export const WIN_SOURCE_OPTIONS: readonly WinSourceOption[] = [
  { value: 'quote_reply', label: 'They replied to the quote', attribution: 'app' },
  { value: 'follow_up', label: 'A follow-up email brought them in', attribution: 'app' },
  { value: 'financing', label: 'They used the financing link', attribution: 'app' },
  { value: 'we_reached_out', label: 'We called or texted them', attribution: 'shop' },
  { value: 'walked_in', label: 'They just showed up', attribution: 'shop' },
  { value: 'unsure', label: 'Not sure', attribution: 'unknown' },
]

export const WIN_SOURCES: readonly WinSource[] = WIN_SOURCE_OPTIONS.map((o) => o.value)

export function isWinSource(value: unknown): value is WinSource {
  return typeof value === 'string' && WIN_SOURCES.includes(value as WinSource)
}

/** The option record, or null when the value is absent or not one of ours. */
export function winSourceOption(value: string | null | undefined): WinSourceOption | null {
  if (!isWinSource(value)) return null
  return WIN_SOURCE_OPTIONS.find((o) => o.value === value) ?? null
}

/** The button text, or null when nothing was recorded. Never invents a label. */
export function winSourceLabel(value: string | null | undefined): string | null {
  return winSourceOption(value)?.label ?? null
}

export function winSourceAttribution(value: string | null | undefined): WinAttribution {
  return winSourceOption(value)?.attribution ?? 'unknown'
}

export interface WinSourceSummary {
  /** Wins the customer came back for through something the app sent. */
  app: number
  /** Wins the shop closed itself. */
  shop: number
  /** Asked, and staff said they weren't sure. */
  unsure: number
  /** Never asked — wins recorded before the question existed. */
  unrecorded: number
  total: number
}

/**
 * Count a set of wins by who gets the credit.
 *
 * `unsure` and `unrecorded` are kept apart on purpose. "We asked and nobody
 * knew" and "we never asked" look identical in a single bucket, and only the
 * second one gets better on its own as the pilot runs.
 */
export function summarizeWinSources(values: readonly (string | null | undefined)[]): WinSourceSummary {
  const summary: WinSourceSummary = { app: 0, shop: 0, unsure: 0, unrecorded: 0, total: values.length }
  for (const value of values) {
    const option = winSourceOption(value)
    if (!option) summary.unrecorded += 1
    else if (option.attribution === 'app') summary.app += 1
    else if (option.attribution === 'shop') summary.shop += 1
    else summary.unsure += 1
  }
  return summary
}
