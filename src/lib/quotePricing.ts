// Pure pricing math for the main-package + add-ons quote shape (replaces
// the old good/better/insane tier system — see OptionKind in types.ts).
//
// A quote has exactly one 'main' option (the base price) and zero or more
// 'addon' options. An add-on's priceCents is the *incremental* cost to add
// it on top of the main package — not a full alternative price the way a
// tier used to be. This module is the one place that turns that raw shape
// into the three numbers a shop actually wants to show a customer:
//   - the main package price
//   - each add-on's own price, and what the total becomes with just that
//     one add-on added
//   - (opt-in, see Quote.showFullAddonTotal) one grand total if the
//     customer takes the main package plus every add-on
//
// No JSX here — used by NewQuotePage, QuoteDetailPage, PublicQuotePage,
// emailTemplates.ts, and the send-quote-email Edge Function (a duplicated
// copy there, same convention as emailTemplates.ts itself).

import type { OptionKind } from '../types'

export interface PricedOption {
  id: string
  optionKind: OptionKind
  priceCents: number
}

/** The single main option, if one exists. Falls back to the first option when nothing is explicitly marked 'main' — defensive only; every write path (NewQuotePage, ScanWorkspacePage, demo seeds) always sets exactly one. */
export function mainOption<T extends PricedOption>(options: T[]): T | undefined {
  return options.find((o) => o.optionKind === 'main') ?? options[0]
}

/** Every option that isn't the main one, in their given order. */
export function addonOptions<T extends PricedOption>(options: T[]): T[] {
  const main = mainOption(options)
  return options.filter((o) => o !== main)
}

export interface AddonLine<T extends PricedOption> {
  option: T
  /** The add-on's own incremental price. */
  addonPriceCents: number
  /** Main package price + just this one add-on. */
  totalWithAddonCents: number
}

/** Per-add-on breakdown: each add-on's own price, and the running total if a customer took the main package plus just that one add-on — computed independently per add-on, never stacked with the others (see fullTotalCents for that). */
export function computeAddonBreakdown<T extends PricedOption>(options: T[]): AddonLine<T>[] {
  const main = mainOption(options)
  const basePriceCents = main?.priceCents ?? 0
  return addonOptions(options).map((option) => ({
    option,
    addonPriceCents: option.priceCents,
    totalWithAddonCents: basePriceCents + option.priceCents,
  }))
}

/** Main package price alone (0 if there's no main option yet). */
export function basePriceCents<T extends PricedOption>(options: T[]): number {
  return mainOption(options)?.priceCents ?? 0
}

/** Main package + every add-on stacked — the "everything included" number shown only when Quote.showFullAddonTotal is on. */
export function fullTotalCents<T extends PricedOption>(options: T[]): number {
  return options.reduce((sum, o) => sum + o.priceCents, 0)
}
