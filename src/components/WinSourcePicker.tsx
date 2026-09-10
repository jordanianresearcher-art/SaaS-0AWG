import { Check } from 'lucide-react'
import { WIN_SOURCE_OPTIONS } from '../lib/winSource'
import type { WinSource } from '../types'

/**
 * "What brought them back?" as six tappable rows.
 *
 * Asked once, at the moment the sale closes, because nobody can reconstruct
 * the answer a month later — and without it the recovered-revenue total has
 * no defence against "I closed those on the phone."
 *
 * Deliberately optional. Tapping the selected row again clears it, so a
 * mis-tap on a phone at a counter is one more tap to undo rather than a wrong
 * answer stored forever. Full-width rows rather than a wrapped chip cloud:
 * the labels are sentences, and a thumb needs a target it cannot miss.
 */
export function WinSourcePicker({
  value,
  onChange,
  idPrefix = 'win-source',
}: {
  value: WinSource | null
  onChange: (next: WinSource | null) => void
  /** Distinguishes two pickers on one screen — see the DOM id collision noted in docs/MVP_PLAN.md. */
  idPrefix?: string
}) {
  return (
    <div className="grid gap-2" role="group" aria-label="What brought them back?">
      {WIN_SOURCE_OPTIONS.map((option) => {
        const active = option.value === value
        return (
          <button
            key={option.value}
            id={`${idPrefix}-${option.value}`}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(active ? null : option.value)}
            className={`flex items-center justify-between gap-3 rounded-xl border-2 px-3.5 py-3 text-left text-base font-semibold transition-colors ${
              active
                ? 'border-brand bg-brand-tint text-brand'
                : 'border-zinc-200 text-zinc-700 hover:border-zinc-300'
            }`}
          >
            <span>{option.label}</span>
            {active ? <Check className="h-5 w-5 shrink-0" aria-hidden="true" /> : null}
          </button>
        )
      })}
    </div>
  )
}
