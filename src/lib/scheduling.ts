// Pure booking-availability math — no Date object arithmetic, no timezone
// handling, no network. Everything here operates on plain
// minutes-since-midnight integers for a single, already-resolved shop-local
// calendar day.
//
// Why minutes-since-midnight instead of real Date/timestamp math: this app
// has one shop per install, operating out of one physical location, so
// "shop time" and "customer time" are the same timezone in every real case
// this product serves. Rather than pull in a timezone library to solve a
// problem this domain doesn't have, the boundary is pushed to the caller —
// the RPC layer resolves "what shop-local day is being requested" and
// "what's shop-local now" using the shop's own stored IANA timezone
// (Postgres `AT TIME ZONE` handles DST correctly there), then hands this
// module plain minute integers for ONE day. DST transitions are a
// real-timestamp concern and are handled at that boundary, not here — a
// day is always exactly 1440 minutes as far as this file is concerned,
// which is correct because a job never spans the moment a clock changes
// (jobs run during business hours, DST changes happen at ~2am).
//
// See docs/MVP_PLAN.md §5 for the booking spec this implements.

const MINUTES_PER_DAY = 24 * 60

/** One occupied span on a single bay, in minutes-since-midnight. Never crosses midnight — a job that would isn't offered as a slot in the first place (see availableSlotsForDay). */
export interface BusyInterval {
  bayId: string
  startMinute: number
  endMinute: number
}

export interface DayAvailabilityInput {
  /** Bays capable of doing this service. v1 treats every bay as capable of every service — no per-bay service restrictions yet. */
  bayIds: string[]
  /** Shop's opening/closing minute for the day being queried. Either both null (closed) or both set. */
  openMinute: number | null
  closeMinute: number | null
  durationMinutes: number
  /** Every existing appointment across all of this shop's bays that falls on the day being queried. */
  busy: BusyInterval[]
  /**
   * Minutes-since-midnight "now" is, ONLY when the day being queried is
   * today — pass null/omit for any future day, since a past-midnight lead
   * time never applies to a day that hasn't started yet.
   */
  nowMinuteIfToday?: number | null
  /** Minimum notice required before a slot can start, in minutes. Default 0 (no restriction). */
  leadTimeMinutes?: number
  /** Spacing between the start times offered, in minutes. Default 30. Does not change job duration — only how many candidate start times get checked. */
  slotIntervalMinutes?: number
  /** Gap required after one job ends before the next can start on the same bay (cleanup/buffer time). Default 0. */
  bufferMinutes?: number
}

export interface AvailableSlot {
  startMinute: number
  endMinute: number
  bayId: string
}

/**
 * Every bookable (start time, bay) pair for one shop-local day. Returns one
 * row per bay that's actually free at that start time — a customer-facing
 * "pick a time" list should dedupe by startMinute (several bays free at the
 * same time is still just one option to show), while a staff calendar wants
 * every row to know which bay column to place it in. Both are one line of
 * calling code on top of this; deduping isn't this function's job.
 */
export function availableSlotsForDay(input: DayAvailabilityInput): AvailableSlot[] {
  const {
    bayIds,
    openMinute,
    closeMinute,
    durationMinutes,
    busy,
    nowMinuteIfToday = null,
    leadTimeMinutes = 0,
    slotIntervalMinutes = 30,
    bufferMinutes = 0,
  } = input

  if (openMinute === null || closeMinute === null) return []
  if (durationMinutes <= 0 || slotIntervalMinutes <= 0) return []
  if (bayIds.length === 0) return []

  // Nothing to offer once the shop's remaining open window can't fit one
  // more job of this length, even before checking any bay's calendar.
  if (openMinute + durationMinutes > closeMinute) return []

  const earliestStart = nowMinuteIfToday !== null ? nowMinuteIfToday + leadTimeMinutes : -Infinity

  const busyByBay = new Map<string, BusyInterval[]>()
  for (const b of busy) {
    const list = busyByBay.get(b.bayId) ?? []
    list.push(b)
    busyByBay.set(b.bayId, list)
  }

  const slots: AvailableSlot[] = []
  for (let start = openMinute; start + durationMinutes <= closeMinute; start += slotIntervalMinutes) {
    if (start < earliestStart) continue
    const end = start + durationMinutes

    for (const bayId of bayIds) {
      const bayBusy = busyByBay.get(bayId) ?? []
      const conflicts = bayBusy.some((b) => start < b.endMinute + bufferMinutes && end + bufferMinutes > b.startMinute)
      if (!conflicts) slots.push({ startMinute: start, endMinute: end, bayId })
    }
  }

  return slots
}

/** Convert "HH:mm" (24-hour, e.g. "09:00", "17:30") to minutes-since-midnight. Throws on a malformed string rather than silently returning a wrong time — a bad business-hours row should fail loudly, not quietly show the wrong slots. */
export function timeStringToMinute(time: string): number {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(time)
  if (!match) throw new Error(`Invalid time string: "${time}" (expected HH:mm, 24-hour)`)
  return Number(match[1]) * 60 + Number(match[2])
}

/** The reverse of timeStringToMinute, for rendering. */
export function minuteToTimeString(minute: number): string {
  const wrapped = ((minute % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY
  const h = Math.floor(wrapped / 60)
  const m = wrapped % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

/**
 * Whether a shop-local calendar date is inside the shop's booking window —
 * not in the past, and not further out than the shop allows. Both bounds are
 * plain "YYYY-MM-DD" date strings (compare correctly as strings; no Date
 * parsing needed for a same-format comparison, which sidesteps timezone
 * questions entirely).
 */
export function isDateBookable(date: string, todayDate: string, maxAdvanceDays: number | null): boolean {
  if (date < todayDate) return false
  if (maxAdvanceDays === null) return true
  const [ty, tm, td] = todayDate.split('-').map(Number)
  const [dy, dm, dd] = date.split('-').map(Number)
  // UTC noon avoids any DST-edge rollover in the day-count itself — this is
  // pure calendar-day counting, not a real elapsed-time calculation.
  const diffDays = Math.round(
    (Date.UTC(dy, dm - 1, dd, 12) - Date.UTC(ty, tm - 1, td, 12)) / (24 * 60 * 60 * 1000),
  )
  return diffDays <= maxAdvanceDays
}
