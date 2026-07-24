import type { TintBodyStyle, TintType, TintWindowPosition, WindowTintWindow } from '../types'
import {
  BODY_STYLE_INFO,
  TINT_TYPE_INFO,
  TINT_VLT_PERCENTS,
  TINT_WINDOW_LABELS,
  computeWindowTintTotalCents,
  windowTintFormValuesToConfig,
  windowsForBodyStyle,
  type WindowTintFormValues,
} from '../lib/windowTint'
import { formatCurrency } from '../lib/format'
import { Field, Input } from './ui'

interface WindowTintEditorProps {
  /** Scopes this entry's DOM ids when a quote carries several tint options. */
  index: number
  value: WindowTintFormValues
  onChange: (next: WindowTintFormValues) => void
}

const BODY_STYLES = Object.keys(BODY_STYLE_INFO) as TintBodyStyle[]
const TINT_TYPES = Object.keys(TINT_TYPE_INFO) as TintType[]

// Rough, illustrative top-down outlines — not to scale. Purely a visual
// backdrop for the window tiles, so the diagram reads as "a car" at a
// glance rather than a precise technical drawing.
const CAR_PATHS: Record<TintBodyStyle, string> = {
  sedan_coupe:
    'M40 60 Q40 30 70 28 L130 28 Q160 30 165 55 Q170 60 165 68 L160 90 Q155 100 140 100 L60 100 Q45 100 40 90 Z',
  suv_wagon_van: 'M30 55 Q30 25 60 24 L145 24 Q175 26 178 55 L178 92 Q178 100 168 100 L38 100 Q30 100 30 90 Z',
}

// Percent coordinates within the diagram's viewBox, per window position —
// presentation-only, kept out of src/lib/windowTint.ts which stays
// framework-agnostic.
const WINDOW_LAYOUT: Record<TintBodyStyle, Partial<Record<TintWindowPosition, { top: string; left: string }>>> = {
  sedan_coupe: {
    front_left: { top: '30%', left: '20%' },
    front_right: { top: '30%', left: '80%' },
    rear_left: { top: '58%', left: '16%' },
    rear_right: { top: '58%', left: '84%' },
    back_glass: { top: '82%', left: '50%' },
  },
  suv_wagon_van: {
    front_left: { top: '28%', left: '18%' },
    front_right: { top: '28%', left: '82%' },
    rear_left: { top: '50%', left: '14%' },
    rear_right: { top: '50%', left: '86%' },
    rear_quarter_left: { top: '72%', left: '18%' },
    rear_quarter_right: { top: '72%', left: '82%' },
    back_glass: { top: '90%', left: '50%' },
  },
}

function PercentPills({
  value,
  onChange,
  label,
}: {
  value: number | null
  onChange: (percent: number) => void
  label: string
}) {
  return (
    <div className="flex flex-wrap gap-1.5" role="group" aria-label={label}>
      {TINT_VLT_PERCENTS.map((p) => (
        <button
          key={p}
          type="button"
          onClick={() => onChange(p)}
          aria-pressed={value === p}
          className={`min-h-9 rounded-lg border-2 px-2.5 text-sm font-semibold transition-colors ${
            value === p ? 'border-brand bg-blue-50 text-ink' : 'border-zinc-200 text-zinc-600 hover:border-zinc-300'
          }`}
        >
          {p}%
        </button>
      ))}
    </div>
  )
}

function WindowRow({
  window: w,
  onChange,
}: {
  window: WindowTintWindow
  onChange: (patch: Partial<WindowTintWindow>) => void
}) {
  return (
    <div className="rounded-xl border border-zinc-200 p-3">
      <label className="flex items-center gap-2.5 text-base font-medium text-ink">
        <input
          type="checkbox"
          className="h-5 w-5 accent-[#1d4ed8]"
          checked={w.included}
          onChange={(e) => onChange({ included: e.target.checked, vltPercent: e.target.checked ? w.vltPercent : null })}
        />
        {TINT_WINDOW_LABELS[w.position]}
      </label>
      {w.included ? (
        <div className="mt-2">
          <PercentPills
            value={w.vltPercent}
            onChange={(p) => onChange({ vltPercent: p })}
            label={`${TINT_WINDOW_LABELS[w.position]} tint percentage`}
          />
        </div>
      ) : null}
    </div>
  )
}

export default function WindowTintEditor({ index, value, onChange }: WindowTintEditorProps) {
  const bodyStyle = value.bodyStyle

  const updateWindow = (position: TintWindowPosition, patch: Partial<WindowTintWindow>) => {
    onChange({ ...value, windows: value.windows.map((w) => (w.position === position ? { ...w, ...patch } : w)) })
  }

  const applyToAll = (percent: number) => {
    onChange({ ...value, windows: value.windows.map((w) => (w.included ? { ...w, vltPercent: percent } : w)) })
  }

  const totalCents = computeWindowTintTotalCents(windowTintFormValuesToConfig(value))

  return (
    <div className="space-y-4">
      <div>
        <p className="mb-1.5 text-sm font-semibold text-ink">What kind of vehicle is this?</p>
        <div className="grid gap-3 sm:grid-cols-2">
          {BODY_STYLES.map((style) => (
            <button
              key={style}
              type="button"
              onClick={() => onChange({ ...value, bodyStyle: style, windows: windowsForBodyStyle(style) })}
              aria-pressed={bodyStyle === style}
              className={`rounded-xl border-2 p-4 text-left transition-colors ${
                bodyStyle === style ? 'border-brand bg-blue-50' : 'border-zinc-200 hover:border-zinc-300'
              }`}
            >
              <p className="text-base font-bold text-ink">{BODY_STYLE_INFO[style].label}</p>
              <p className="text-sm text-zinc-500">{BODY_STYLE_INFO[style].windowCountLabel}</p>
            </button>
          ))}
        </div>
        {bodyStyle === 'sedan_coupe' ? (
          <p className="mt-2 text-sm text-zinc-500">
            Some 2-door vehicles don&apos;t have all these windows — leave the ones that don&apos;t apply toggled off.
          </p>
        ) : null}
      </div>

      <div>
        <p className="mb-1.5 text-sm font-semibold text-ink">Film type</p>
        <div className="grid gap-3 sm:grid-cols-2">
          {TINT_TYPES.map((type) => (
            <button
              key={type}
              type="button"
              onClick={() => onChange({ ...value, tintType: type })}
              aria-pressed={value.tintType === type}
              className={`rounded-xl border-2 p-4 text-left transition-colors ${
                value.tintType === type ? 'border-brand bg-blue-50' : 'border-zinc-200 hover:border-zinc-300'
              }`}
            >
              <p className="text-base font-bold text-ink">{TINT_TYPE_INFO[type].label}</p>
              <p className="text-sm text-zinc-500">{TINT_TYPE_INFO[type].hint}</p>
            </button>
          ))}
        </div>
      </div>

      <Field label="Tint job price" htmlFor={`tint-${index}-price`} hint="Covers all the windows you include below.">
        <Input
          id={`tint-${index}-price`}
          inputMode="decimal"
          placeholder="$350"
          value={value.price}
          onChange={(e) => onChange({ ...value, price: e.target.value })}
        />
      </Field>

      <div>
        <p className="mb-1.5 text-sm font-semibold text-ink">Apply one % to all windows</p>
        <PercentPills value={null} onChange={applyToAll} label="Apply one percentage to all windows" />
      </div>

      <div className="relative mx-auto hidden aspect-[16/10] w-full max-w-sm sm:block">
        <svg viewBox="0 0 200 120" className="absolute inset-0 h-full w-full" aria-hidden="true">
          <path d={CAR_PATHS[bodyStyle]} fill="#f4f4f5" stroke="#d4d4d8" strokeWidth="2" />
        </svg>
        {value.windows.map((w) => {
          const pos = WINDOW_LAYOUT[bodyStyle][w.position]
          if (!pos) return null
          return (
            <button
              key={w.position}
              type="button"
              onClick={() => updateWindow(w.position, { included: !w.included, vltPercent: !w.included ? w.vltPercent : null })}
              aria-pressed={w.included}
              aria-label={`${TINT_WINDOW_LABELS[w.position]} — ${w.included ? 'included' : 'not included'}`}
              title={TINT_WINDOW_LABELS[w.position]}
              style={{
                top: pos.top,
                left: pos.left,
                opacity: w.included ? 1 - (w.vltPercent ?? 0) / 100 / 1.4 : 0.25,
              }}
              className="absolute flex h-9 w-9 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-md border-2 border-white bg-brand text-[11px] font-bold text-white shadow"
            >
              {w.included && w.vltPercent ? w.vltPercent : ''}
            </button>
          )
        })}
      </div>

      <div className="space-y-2">
        {value.windows.map((w) => (
          <WindowRow key={w.position} window={w} onChange={(patch) => updateWindow(w.position, patch)} />
        ))}
      </div>

      <div className="rounded-xl bg-zinc-50 p-3">
        <label className="flex items-center gap-2.5 text-base font-medium text-ink">
          <input
            type="checkbox"
            className="h-5 w-5 accent-[#1d4ed8]"
            checked={value.removeOldTint}
            onChange={(e) =>
              onChange({
                ...value,
                removeOldTint: e.target.checked,
                removeOldTintPrice: e.target.checked ? value.removeOldTintPrice : '',
              })
            }
          />
          Remove old tint first?
        </label>
        {value.removeOldTint ? (
          <div className="mt-2 max-w-xs">
            <Field label="Removal price" htmlFor={`tint-${index}-removal-price`}>
              <Input
                id={`tint-${index}-removal-price`}
                inputMode="decimal"
                placeholder="$50"
                value={value.removeOldTintPrice}
                onChange={(e) => onChange({ ...value, removeOldTintPrice: e.target.value })}
              />
            </Field>
          </div>
        ) : null}
      </div>

      <div className="rounded-xl bg-zinc-50 p-3">
        <label className="flex items-center gap-2.5 text-base font-medium text-ink">
          <input
            type="checkbox"
            className="h-5 w-5 accent-[#1d4ed8]"
            checked={value.windshieldIncluded}
            onChange={(e) =>
              onChange({
                ...value,
                windshieldIncluded: e.target.checked,
                windshieldVltPercent: e.target.checked ? value.windshieldVltPercent : null,
                windshieldPrice: e.target.checked ? value.windshieldPrice : '',
              })
            }
          />
          Also tint the windshield?
        </label>
        <p className="mt-1 text-sm text-zinc-500">
          Most states treat windshield tint differently — often just a visor strip or a lighter %.
        </p>
        {value.windshieldIncluded ? (
          <div className="mt-2 space-y-3">
            <PercentPills
              value={value.windshieldVltPercent}
              onChange={(p) => onChange({ ...value, windshieldVltPercent: p })}
              label="Windshield tint percentage"
            />
            <div className="max-w-xs">
              <Field label="Windshield price" htmlFor={`tint-${index}-windshield-price`}>
                <Input
                  id={`tint-${index}-windshield-price`}
                  inputMode="decimal"
                  placeholder="$120"
                  value={value.windshieldPrice}
                  onChange={(e) => onChange({ ...value, windshieldPrice: e.target.value })}
                />
              </Field>
            </div>
          </div>
        ) : null}
      </div>

      {totalCents > 0 ? (
        <p className="text-right text-base font-bold text-ink">Total tint price: {formatCurrency(totalCents)}</p>
      ) : null}
    </div>
  )
}
