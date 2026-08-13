import type { SunroofType, TintType, WindowTintWindow } from '../types'
import {
  BODY_STYLE_INFO,
  BODY_STYLE_ORDER,
  SUNROOF_TYPE_INFO,
  TINT_SLOT_LABEL,
  TINT_SLOT_ORDER,
  TINT_TYPE_INFO,
  TINT_VLT_PERCENTS,
  computeWindowTintTotalCents,
  windowTintFormValuesToConfig,
  windowsForBodyStyle,
  type WindowTintFormValues,
} from '../lib/windowTint'
import { TINT_VISUAL_SLOT_POSITIONS, type TintVisualSlot } from '../lib/carDiagrams'
import { formatCurrency } from '../lib/format'
import { Field, Input } from './ui'

interface WindowTintEditorProps {
  /** Scopes this entry's DOM ids when a quote carries several tint options. */
  index: number
  value: WindowTintFormValues
  onChange: (next: WindowTintFormValues) => void
}

const TINT_TYPES = Object.keys(TINT_TYPE_INFO) as TintType[]

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

// One row per *visual* slot (front/rear/quarter/back glass), not per
// physical window — driver and passenger side are tinted identically in
// the overwhelming majority of jobs, so there's no reason to make staff
// set (and look at) the same checkbox and percentage twice. Whichever
// side(s) a slot has (see TINT_VISUAL_SLOT_POSITIONS) move together.
function VisualSlotRow({
  slot,
  windows,
  onToggle,
  onSetPercent,
}: {
  slot: TintVisualSlot
  windows: WindowTintWindow[]
  onToggle: () => void
  onSetPercent: (percent: number) => void
}) {
  const relevant = windows.filter((w) => TINT_VISUAL_SLOT_POSITIONS[slot].includes(w.position))
  const included = relevant.some((w) => w.included)
  const percent = relevant.find((w) => w.included && w.vltPercent !== null)?.vltPercent ?? null
  return (
    <div className="rounded-xl border border-zinc-200 p-3">
      <label className="flex items-center gap-2.5 text-base font-medium text-ink">
        <input type="checkbox" className="h-5 w-5 accent-[#1d4ed8]" checked={included} onChange={onToggle} />
        {TINT_SLOT_LABEL[slot]}
      </label>
      {included ? (
        <div className="mt-2">
          <PercentPills value={percent} onChange={onSetPercent} label={`${TINT_SLOT_LABEL[slot]} tint percentage`} />
        </div>
      ) : null}
    </div>
  )
}

export default function WindowTintEditor({ index, value, onChange }: WindowTintEditorProps) {
  const bodyStyle = value.bodyStyle

  // Set a percentage on every physical window within one visual slot at
  // once (front/rear/quarter/back glass) — see VisualSlotRow above.
  const setSlotPercent = (slot: TintVisualSlot, percent: number) => {
    const positions = TINT_VISUAL_SLOT_POSITIONS[slot]
    onChange({
      ...value,
      windows: value.windows.map((w) => (positions.includes(w.position) ? { ...w, included: true, vltPercent: percent } : w)),
    })
  }

  const presentSlots = TINT_SLOT_ORDER.filter((slot) =>
    value.windows.some((w) => TINT_VISUAL_SLOT_POSITIONS[slot].includes(w.position)),
  )

  // Toggling a slot on the diagram flips every physical window at that
  // visual position together (see TINT_VISUAL_SLOT_POSITIONS — a single
  // silhouette can't show driver vs. passenger side separately). All-on
  // wins ties: if any window at this position is currently included, the
  // click turns them all off; otherwise it turns them all on, keeping
  // whatever % each one already had.
  const toggleSlot = (slot: TintVisualSlot) => {
    const positions = TINT_VISUAL_SLOT_POSITIONS[slot]
    const anyIncluded = value.windows.some((w) => positions.includes(w.position) && w.included)
    onChange({
      ...value,
      windows: value.windows.map((w) =>
        positions.includes(w.position) ? { ...w, included: !anyIncluded, vltPercent: !anyIncluded ? w.vltPercent : null } : w,
      ),
    })
  }

  const applyToAll = (percent: number) => {
    onChange({ ...value, windows: value.windows.map((w) => (w.included ? { ...w, vltPercent: percent } : w)) })
  }

  const totalCents = computeWindowTintTotalCents(windowTintFormValuesToConfig(value))

  return (
    <div className="space-y-4">
      {/* Body style still drives which window rows exist below (a single-cab
         truck has no rear doors, a coupe has quarter glass instead) — it's
         just a plain label picker now. The car-diagram thumbnails that used
         to sit here are pulled pending the top-down redesign. */}
      <div>
        <p className="mb-1.5 text-sm font-semibold text-ink">What kind of vehicle is this?</p>
        <div className="flex flex-wrap gap-2">
          {BODY_STYLE_ORDER.map((style) => (
            <button
              key={style}
              type="button"
              onClick={() => onChange({ ...value, bodyStyle: style, windows: windowsForBodyStyle(style) })}
              aria-pressed={bodyStyle === style}
              className={`min-h-11 rounded-xl border-2 px-3.5 text-sm font-semibold transition-colors ${
                bodyStyle === style ? 'border-brand bg-blue-50 text-ink' : 'border-zinc-200 text-zinc-600 hover:border-zinc-300'
              }`}
            >
              {BODY_STYLE_INFO[style].label}
            </button>
          ))}
        </div>
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

      <Field label="Tint job price" htmlFor={`tint-${index}-price`}>
        <Input
          id={`tint-${index}-price`}
          inputMode="decimal"
          placeholder="$350"
          value={value.price}
          onChange={(e) => onChange({ ...value, price: e.target.value })}
        />
      </Field>

      <div>
        <p className="mb-1.5 text-sm font-semibold text-ink">Entire vehicle</p>
        <PercentPills value={null} onChange={applyToAll} label="Apply one percentage to every included window" />
      </div>

      <div className="space-y-2">
        {presentSlots.map((slot) => (
          <VisualSlotRow
            key={slot}
            slot={slot}
            windows={value.windows}
            onToggle={() => toggleSlot(slot)}
            onSetPercent={(p) => setSlotPercent(slot, p)}
          />
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

      <div className="rounded-xl bg-zinc-50 p-3">
        <label className="flex items-center gap-2.5 text-base font-medium text-ink">
          <input
            type="checkbox"
            className="h-5 w-5 accent-[#1d4ed8]"
            checked={value.sunroofIncluded}
            onChange={(e) =>
              onChange({
                ...value,
                sunroofIncluded: e.target.checked,
                sunroofType: e.target.checked ? (value.sunroofType ?? 'single') : null,
                sunroofVltPercent: e.target.checked ? value.sunroofVltPercent : null,
                sunroofPrice: e.target.checked ? value.sunroofPrice : '',
              })
            }
          />
          Also tint the sunroof?
        </label>
        {value.sunroofIncluded ? (
          <div className="mt-2 space-y-3">
            <div className="flex flex-wrap gap-2" role="group" aria-label="Sunroof type">
              {(Object.keys(SUNROOF_TYPE_INFO) as SunroofType[]).map((t) => (
                <button
                  key={t}
                  type="button"
                  aria-pressed={value.sunroofType === t}
                  onClick={() => onChange({ ...value, sunroofType: t })}
                  className={`min-h-9 rounded-lg border-2 px-2.5 text-sm font-semibold transition-colors ${
                    value.sunroofType === t ? 'border-brand bg-blue-50 text-ink' : 'border-zinc-200 text-zinc-600 hover:border-zinc-300'
                  }`}
                >
                  {SUNROOF_TYPE_INFO[t].label}
                </button>
              ))}
            </div>
            <PercentPills
              value={value.sunroofVltPercent}
              onChange={(p) => onChange({ ...value, sunroofVltPercent: p })}
              label="Sunroof tint percentage"
            />
            <div className="max-w-xs">
              <Field label="Sunroof price" htmlFor={`tint-${index}-sunroof-price`}>
                <Input
                  id={`tint-${index}-sunroof-price`}
                  inputMode="decimal"
                  placeholder="$90"
                  value={value.sunroofPrice}
                  onChange={(e) => onChange({ ...value, sunroofPrice: e.target.value })}
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
