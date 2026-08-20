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

/**
 * Clock time for a human to read: "2:30 PM", not "14:30".
 *
 * `minuteToTimeString` produces the 24-hour form, which is what a value needs
 * to be (it feeds `new Date(\`${dateKey}T${time}:00\`)`), but both booking
 * screens were rendering that value straight to the user. A shop and its
 * customers pick "2:30 PM" out of a list; scanning thirty-six rows of "14:30"
 * to find it is work the app was making them do.
 *
 * Keep the two apart: this is for display only, never for a form value.
 */
export function formatMinuteOfDay(minute: number): string {
  const wrapped = ((minute % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY
  const h24 = Math.floor(wrapped / 60)
  const m = wrapped % 60
  const suffix = h24 < 12 ? 'AM' : 'PM'
  // 0 and 12 both display as 12 — midnight is 12 AM, noon is 12 PM.
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12
  return `${h12}:${String(m).padStart(2, '0')} ${suffix}`
}

/** Which part of the day a start time falls in, for grouping a list of them. */
export function timeOfDayBucket(minute: number): 'morning' | 'afternoon' | 'evening' {
  if (minute < 12 * 60) return 'morning'
  if (minute < 17 * 60) return 'afternoon'
  return 'evening'
}

export interface DayHoursSource {
  dayOfWeek: number
  isOpen: boolean
  openTime: string | null
  closeTime: string | null
}

export interface DayExceptionSource {
  date: string
  isClosed: boolean
  openTime: string | null
  closeTime: string | null
}

/**
 * The open/close window for one calendar day, with a date-specific exception
 * taking precedence over the weekly pattern.
 *
 * Extracted because both booking screens had inlined the same nested-ternary
 * version of this, and a next-available search needs it for many days at once.
 * Returns nulls when the shop is closed, which is what `availableSlotsForDay`
 * already expects.
 */
export function dayOpenWindow(
  dateKey: string,
  businessHours: DayHoursSource[],
  exceptions: DayExceptionSource[],
): { openMinute: number | null; closeMinute: number | null } {
  const exception = exceptions.find((e) => e.date === dateKey)
  if (exception) {
    if (exception.isClosed || !exception.openTime || !exception.closeTime) {
      return { openMinute: null, closeMinute: null }
    }
    return {
      openMinute: timeStringToMinute(exception.openTime),
      closeMinute: timeStringToMinute(exception.closeTime),
    }
  }

  // Sunday is 0 in both getDay() and the business_hours table.
  const dow = new Date(`${dateKey}T00:00:00`).getDay()
  const day = businessHours.find((h) => h.dayOfWeek === dow)
  if (!day?.isOpen || !day.openTime || !day.closeTime) {
    return { openMinute: null, closeMinute: null }
  }
  return { openMinute: timeStringToMinute(day.openTime), closeMinute: timeStringToMinute(day.closeTime) }
}

/** Advance a "YYYY-MM-DD" key by whole calendar days. UTC noon sidesteps DST edges in the arithmetic. */
export function addDaysToDateKey(dateKey: string, days: number): string {
  const [y, m, d] = dateKey.split('-').map(Number)
  const shifted = new Date(Date.UTC(y, m - 1, d, 12))
  shifted.setUTCDate(shifted.getUTCDate() + days)
  return `${shifted.getUTCFullYear()}-${String(shifted.getUTCMonth() + 1).padStart(2, '0')}-${String(shifted.getUTCDate()).padStart(2, '0')}`
}

export interface NextAvailableInput {
  /** Where to start looking, inclusive. */
  fromDateKey: string
  /** How many calendar days to try in total, including the first. */
  maxDays: number
  bayIds: string[]
  durationMinutes: number
  businessHours: DayHoursSource[]
  exceptions: DayExceptionSource[]
  /** Every busy block across the search window. Filtered to each day internally. */
  busy: Array<{ bayId: string; startMinute: number; endMinute: number; dateKey: string }>
  /** Today's key, so today's already-past slots are excluded. */
  todayDateKey: string
  /** Minutes-since-midnight right now, used only when a candidate day is today. */
  nowMinute: number
  slotIntervalMinutes?: number
  leadTimeMinutes?: number
}

/**
 * The first day and time that can actually fit this job.
 *
 * "When can you take me?" is the first question on every phone call, and the
 * app could not answer it: both booking screens computed availability for ONE
 * day and, when that day was full, said "try another" without saying which.
 * Staff were left clicking through days one at a time while a customer waited.
 *
 * Scans forward day by day and returns the earliest fitting start, or null if
 * nothing fits inside the window.
 */
export function findNextAvailableDay(input: NextAvailableInput): { dateKey: string; startMinute: number } | null {
  if (input.durationMinutes <= 0 || input.bayIds.length === 0) return null

  for (let offset = 0; offset < input.maxDays; offset++) {
    const dateKey = addDaysToDateKey(input.fromDateKey, offset)
    // A day already gone by can never be the *next* opening.
    if (dateKey < input.todayDateKey) continue

    const { openMinute, closeMinute } = dayOpenWindow(dateKey, input.businessHours, input.exceptions)
    if (openMinute === null || closeMinute === null) continue

    const slots = availableSlotsForDay({
      bayIds: input.bayIds,
      openMinute,
      closeMinute,
      durationMinutes: input.durationMinutes,
      busy: input.busy.filter((b) => b.dateKey === dateKey),
      nowMinuteIfToday: dateKey === input.todayDateKey ? input.nowMinute : null,
      slotIntervalMinutes: input.slotIntervalMinutes ?? 15,
      leadTimeMinutes: input.leadTimeMinutes ?? 0,
    })
    if (slots.length === 0) continue

    const earliest = slots.reduce((min, s) => (s.startMinute < min ? s.startMinute : min), slots[0].startMinute)
    return { dateKey, startMinute: earliest }
  }

  return null
}
