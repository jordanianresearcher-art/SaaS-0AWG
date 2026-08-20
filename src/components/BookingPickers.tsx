// The day and time pickers, shared by the staff calendar and the public
// booking page.
//
// They were not shared before, and the two drifted badly. The public page had
// tappable day chips and a time grid; the staff modal had no day picker at all
// and a <select> of thirty-odd raw 24-hour strings. Since staff book most
// appointments — on the phone, on a phone — the worse experience was the one
// that mattered more.
//
// Both render the same way in both places, with one concession: the public
// page paints itself in the shop's own brand colour, so an optional
// `accentColor` switches from theme classes to inline styles. The app chrome
// never passes it.

import { addDaysToDateKey, formatMinuteOfDay, minuteToTimeString, timeOfDayBucket } from '../lib/scheduling'

function chipStyle(active: boolean, accentColor?: string) {
  if (!accentColor) return undefined
  return active
    ? { borderColor: accentColor, backgroundColor: `${accentColor}14`, color: '#18181b' }
    : { borderColor: '#e4e4e7', color: '#3f3f46' }
}

function chipClass(active: boolean, accentColor?: string) {
  const base = 'shrink-0 rounded-xl border-2 px-3 py-2 text-sm font-semibold transition-colors'
  if (accentColor) return base
  return `${base} ${active ? 'border-brand bg-brand-tint text-brand' : 'border-zinc-200 text-zinc-600 hover:border-zinc-300'}`
}

/**
 * A horizontal run of days to choose from.
 *
 * `dayCount` days starting at `fromDateKey`. Scrolls rather than wrapping, so
 * the strip stays one line tall on a phone held one-handed at a counter.
 */
export function DayStrip({
  fromDateKey,
  dayCount,
  value,
  onChange,
  accentColor,
  todayDateKey,
}: {
  fromDateKey: string
  dayCount: number
  value: string
  onChange: (dateKey: string) => void
  accentColor?: string
  /** Marks one chip as "Today" instead of its weekday name. */
  todayDateKey?: string
}) {
  const days = Array.from({ length: dayCount }, (_, i) => addDaysToDateKey(fromDateKey, i))

  return (
    <div className="flex gap-2 overflow-x-auto pb-2" role="group" aria-label="Pick a day">
      {days.map((dateKey) => {
        const active = dateKey === value
        const date = new Date(`${dateKey}T00:00:00`)
        const isToday = dateKey === todayDateKey
        return (
          <button
            key={dateKey}
            type="button"
            onClick={() => onChange(dateKey)}
            aria-pressed={active}
            className={chipClass(active, accentColor)}
            style={chipStyle(active, accentColor)}
          >
            <span className="block text-[11px] font-bold tracking-wide uppercase opacity-70">
              {isToday ? 'Today' : date.toLocaleDateString(undefined, { weekday: 'short' })}
            </span>
            <span className="block">{date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</span>
          </button>
        )
      })}
    </div>
  )
}

const BUCKET_LABEL = { morning: 'Morning', afternoon: 'Afternoon', evening: 'Evening' } as const
const BUCKET_ORDER = ['morning', 'afternoon', 'evening'] as const

/**
 * Start times as tappable chips, grouped by part of day.
 *
 * `value` and `onChange` speak the 24-hour "HH:mm" form, because that is what
 * the form submits and what `new Date(\`${dateKey}T${value}:00\`)` needs. Only
 * the label is 12-hour — keeping the two apart is the whole point.
 */
export function TimeSlotGrid({
  startMinutes,
  value,
  onChange,
  accentColor,
}: {
  startMinutes: number[]
  /** "HH:mm", 24-hour — the form value, not the label. */
  value: string
  onChange: (timeValue: string) => void
  accentColor?: string
}) {
  const grouped = BUCKET_ORDER.map((bucket) => ({
    bucket,
    minutes: startMinutes.filter((m) => timeOfDayBucket(m) === bucket),
  })).filter((g) => g.minutes.length > 0)

  return (
    <div className="space-y-3">
      {grouped.map(({ bucket, minutes }) => (
        <div key={bucket}>
          {/* The heading is skipped when every slot lands in one bucket — a
              lone "Morning" label above four chips is noise, not structure. */}
          {grouped.length > 1 ? (
            <p className="mb-1.5 text-xs font-bold tracking-wide text-zinc-500 uppercase">{BUCKET_LABEL[bucket]}</p>
          ) : null}
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
            {minutes.map((m) => {
              const timeValue = minuteToTimeString(m)
              const active = timeValue === value
              return (
                <button
                  key={m}
                  type="button"
                  onClick={() => onChange(timeValue)}
                  aria-pressed={active}
                  className={`min-h-12 rounded-xl border-2 text-sm font-semibold transition-colors ${
                    accentColor
                      ? ''
                      : active
                        ? 'border-brand bg-brand text-white'
                        : 'border-zinc-200 text-zinc-700 hover:border-zinc-300'
                  }`}
                  style={
                    accentColor
                      ? active
                        ? { borderColor: accentColor, backgroundColor: accentColor, color: '#fff' }
                        : { borderColor: '#e4e4e7', color: '#3f3f46' }
                      : undefined
                  }
                >
                  {formatMinuteOfDay(m)}
                </button>
              )
            })}
          </div>
        </div>
      ))}
    </div>
  )
}
