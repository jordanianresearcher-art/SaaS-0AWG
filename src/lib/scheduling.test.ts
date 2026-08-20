import { describe, expect, it } from 'vitest'
import {
  addDaysToDateKey,
  availableSlotsForDay,
  dayOpenWindow,
  findNextAvailableDay,
  formatMinuteOfDay,
  isDateBookable,
  minuteToTimeString,
  timeStringToMinute,
  type DayAvailabilityInput,
} from './scheduling'

const BASE: DayAvailabilityInput = {
  bayIds: ['bay-1'],
  openMinute: timeStringToMinute('09:00'),
  closeMinute: timeStringToMinute('18:00'),
  durationMinutes: 120,
  busy: [],
}

describe('timeStringToMinute / minuteToTimeString', () => {
  it('converts HH:mm to minutes and back', () => {
    expect(timeStringToMinute('09:00')).toBe(540)
    expect(timeStringToMinute('17:30')).toBe(1050)
    expect(timeStringToMinute('00:00')).toBe(0)
    expect(minuteToTimeString(540)).toBe('09:00')
    expect(minuteToTimeString(1050)).toBe('17:30')
  })

  it('rejects a malformed time string rather than guessing', () => {
    expect(() => timeStringToMinute('9:00')).toThrow()
    expect(() => timeStringToMinute('25:00')).toThrow()
    expect(() => timeStringToMinute('12:60')).toThrow()
    expect(() => timeStringToMinute('noon')).toThrow()
  })
})

describe('availableSlotsForDay', () => {
  it('offers slots across the full open window at the given interval', () => {
    const slots = availableSlotsForDay({ ...BASE, slotIntervalMinutes: 60 })
    // 09:00 open, 18:00 close, 120min job -> last start is 16:00
    expect(slots.map((s) => minuteToTimeString(s.startMinute))).toEqual([
      '09:00', '10:00', '11:00', '12:00', '13:00', '14:00', '15:00', '16:00',
    ])
  })

  it('returns nothing on a closed day', () => {
    const slots = availableSlotsForDay({ ...BASE, openMinute: null, closeMinute: null })
    expect(slots).toEqual([])
  })

  it('respects a half day (shortened hours from a schedule exception)', () => {
    const slots = availableSlotsForDay({
      ...BASE,
      openMinute: timeStringToMinute('09:00'),
      closeMinute: timeStringToMinute('12:00'),
      durationMinutes: 120,
      slotIntervalMinutes: 60,
    })
    // A 2-hour job fits at 09:00 (ends 11:00) and 10:00 (ends exactly at the
    // 12:00 close) but not 11:00 (would end 13:00, past close).
    expect(slots.map((s) => minuteToTimeString(s.startMinute))).toEqual(['09:00', '10:00'])
  })

  it('offers nothing when the job is too long to fit in the open window at all', () => {
    const slots = availableSlotsForDay({
      ...BASE,
      openMinute: timeStringToMinute('09:00'),
      closeMinute: timeStringToMinute('10:00'),
      durationMinutes: 120,
    })
    expect(slots).toEqual([])
  })

  it('excludes a slot that overlaps an existing appointment on that bay', () => {
    const slots = availableSlotsForDay({
      ...BASE,
      slotIntervalMinutes: 60,
      busy: [{ bayId: 'bay-1', startMinute: timeStringToMinute('10:00'), endMinute: timeStringToMinute('12:00') }],
    })
    const starts = slots.map((s) => minuteToTimeString(s.startMinute))
    expect(starts).not.toContain('09:30') // would end 11:30, overlaps 10-12
    expect(starts).not.toContain('10:00')
    expect(starts).not.toContain('11:00')
    expect(starts).toContain('12:00') // starts exactly when the busy block ends
  })

  it('respects a buffer between back-to-back jobs on the same bay', () => {
    const slots = availableSlotsForDay({
      ...BASE,
      slotIntervalMinutes: 30,
      bufferMinutes: 30,
      busy: [{ bayId: 'bay-1', startMinute: timeStringToMinute('10:00'), endMinute: timeStringToMinute('12:00') }],
    })
    const starts = slots.map((s) => minuteToTimeString(s.startMinute))
    expect(starts).not.toContain('12:00') // needs a 30min gap after the busy block ends
    expect(starts).toContain('12:30')
  })

  it('enforces a lead-time floor only for the current day, not a future day', () => {
    const todaySlots = availableSlotsForDay({
      ...BASE,
      slotIntervalMinutes: 60,
      nowMinuteIfToday: timeStringToMinute('11:00'),
      leadTimeMinutes: 60,
    })
    expect(todaySlots.map((s) => minuteToTimeString(s.startMinute))[0]).toBe('12:00')

    const futureDaySlots = availableSlotsForDay({
      ...BASE,
      slotIntervalMinutes: 60,
      nowMinuteIfToday: null,
      leadTimeMinutes: 60,
    })
    expect(futureDaySlots.map((s) => minuteToTimeString(s.startMinute))[0]).toBe('09:00')
  })

  it('dedupes across multiple bays only in the sense that each free bay gets its own slot row', () => {
    const slots = availableSlotsForDay({
      ...BASE,
      bayIds: ['bay-1', 'bay-2'],
      slotIntervalMinutes: 60,
      busy: [{ bayId: 'bay-1', startMinute: timeStringToMinute('09:00'), endMinute: timeStringToMinute('11:00') }],
    })
    const at9 = slots.filter((s) => s.startMinute === timeStringToMinute('09:00'))
    // bay-1 is busy at 9am but bay-2 is free — the caller sees one option remains.
    expect(at9.map((s) => s.bayId)).toEqual(['bay-2'])
    const at12 = slots.filter((s) => s.startMinute === timeStringToMinute('12:00'))
    // Both bays free later in the day — both show up, so a staff calendar can place either.
    expect(at12.map((s) => s.bayId).sort()).toEqual(['bay-1', 'bay-2'])
  })

  it('returns nothing when there are no bays at all', () => {
    expect(availableSlotsForDay({ ...BASE, bayIds: [] })).toEqual([])
  })

  it('rejects a non-positive duration or slot interval rather than looping forever', () => {
    expect(availableSlotsForDay({ ...BASE, durationMinutes: 0 })).toEqual([])
    expect(availableSlotsForDay({ ...BASE, slotIntervalMinutes: 0 })).toEqual([])
  })
})

describe('isDateBookable', () => {
  it('rejects a date before today', () => {
    expect(isDateBookable('2026-08-17', '2026-08-18', null)).toBe(false)
  })

  it('accepts today and any future date when there is no advance cap', () => {
    expect(isDateBookable('2026-08-18', '2026-08-18', null)).toBe(true)
    expect(isDateBookable('2027-01-01', '2026-08-18', null)).toBe(true)
  })

  it('enforces maxAdvanceDays', () => {
    expect(isDateBookable('2026-08-25', '2026-08-18', 7)).toBe(true)
    expect(isDateBookable('2026-08-26', '2026-08-18', 7)).toBe(false)
  })

  it('handles a maxAdvanceDays window that crosses a month boundary correctly (no DST/day-count drift)', () => {
    // Aug 29 -> Sep 5 is exactly 7 days (Aug has 31 days), so it's the last
    // bookable day; Sep 6 is 8 days out and past the cap.
    expect(isDateBookable('2026-09-01', '2026-08-29', 7)).toBe(true)
    expect(isDateBookable('2026-09-05', '2026-08-29', 7)).toBe(true)
    expect(isDateBookable('2026-09-06', '2026-08-29', 7)).toBe(false)
  })
})

describe('formatMinuteOfDay', () => {
  it('renders the clock time a shop actually reads out loud', () => {
    // Both booking screens were rendering minuteToTimeString's 24-hour value
    // straight to the user, so a customer picked their appointment out of a
    // list of "14:30"s.
    expect(formatMinuteOfDay(14 * 60 + 30)).toBe('2:30 PM')
    expect(formatMinuteOfDay(9 * 60)).toBe('9:00 AM')
  })

  it('gets the two hours that trip every 12-hour conversion right', () => {
    expect(formatMinuteOfDay(0)).toBe('12:00 AM')
    expect(formatMinuteOfDay(12 * 60)).toBe('12:00 PM')
    expect(formatMinuteOfDay(5)).toBe('12:05 AM')
    expect(formatMinuteOfDay(12 * 60 + 5)).toBe('12:05 PM')
  })

  it('stays paired with minuteToTimeString, which remains the form value', () => {
    // Display and value must not be confused: the value feeds
    // new Date(`${dateKey}T${value}:00`) and has to stay 24-hour.
    expect(minuteToTimeString(14 * 60 + 30)).toBe('14:30')
    expect(formatMinuteOfDay(14 * 60 + 30)).toBe('2:30 PM')
  })
})

describe('dayOpenWindow', () => {
  const hours = [
    { dayOfWeek: 1, isOpen: true, openTime: '09:00', closeTime: '18:00' },
    { dayOfWeek: 0, isOpen: false, openTime: null, closeTime: null },
  ]

  it('uses the weekly pattern when no exception applies', () => {
    // 2026-08-24 is a Monday.
    expect(dayOpenWindow('2026-08-24', hours, [])).toEqual({ openMinute: 540, closeMinute: 1080 })
  })

  it('returns a closed window on a day the shop does not open', () => {
    // 2026-08-23 is a Sunday.
    expect(dayOpenWindow('2026-08-23', hours, [])).toEqual({ openMinute: null, closeMinute: null })
  })

  it('lets a date-specific exception override the weekly pattern', () => {
    const exceptions = [{ date: '2026-08-24', isClosed: false, openTime: '11:00', closeTime: '15:00' }]
    expect(dayOpenWindow('2026-08-24', hours, exceptions)).toEqual({ openMinute: 660, closeMinute: 900 })
  })

  it('treats a closed exception as closed even on a normally-open day', () => {
    const exceptions = [{ date: '2026-08-24', isClosed: true, openTime: null, closeTime: null }]
    expect(dayOpenWindow('2026-08-24', hours, exceptions)).toEqual({ openMinute: null, closeMinute: null })
  })
})

describe('addDaysToDateKey', () => {
  it('rolls over month and year boundaries', () => {
    expect(addDaysToDateKey('2026-08-31', 1)).toBe('2026-09-01')
    expect(addDaysToDateKey('2026-12-31', 1)).toBe('2027-01-01')
    expect(addDaysToDateKey('2026-03-01', -1)).toBe('2026-02-28')
  })
})

describe('findNextAvailableDay', () => {
  // Mon-Sat 9-6, closed Sunday — what migration 0025 seeds for a new shop.
  const businessHours = [0, 1, 2, 3, 4, 5, 6].map((dayOfWeek) => ({
    dayOfWeek,
    isOpen: dayOfWeek !== 0,
    openTime: dayOfWeek !== 0 ? '09:00' : null,
    closeTime: dayOfWeek !== 0 ? '18:00' : null,
  }))
  const base = {
    maxDays: 14,
    bayIds: ['bay-1'],
    durationMinutes: 120,
    businessHours,
    exceptions: [],
    busy: [],
    nowMinute: 0,
    slotIntervalMinutes: 30,
  }

  it('answers the question the app could not: when can you take me', () => {
    // 2026-08-24 is a Monday, wide open.
    const found = findNextAvailableDay({ ...base, fromDateKey: '2026-08-24', todayDateKey: '2026-08-24' })
    expect(found).toEqual({ dateKey: '2026-08-24', startMinute: 540 })
  })

  it('skips a closed day rather than reporting no availability', () => {
    // Starting on a Sunday must roll to Monday, not give up.
    const found = findNextAvailableDay({ ...base, fromDateKey: '2026-08-23', todayDateKey: '2026-08-23' })
    expect(found?.dateKey).toBe('2026-08-24')
  })

  it('skips a day closed by exception', () => {
    const found = findNextAvailableDay({
      ...base,
      fromDateKey: '2026-08-24',
      todayDateKey: '2026-08-24',
      exceptions: [{ date: '2026-08-24', isClosed: true, openTime: null, closeTime: null }],
    })
    expect(found?.dateKey).toBe('2026-08-25')
  })

  it('rolls past a fully booked day to the next real opening', () => {
    const fullDay = [{ bayId: 'bay-1', startMinute: 540, endMinute: 1080, dateKey: '2026-08-24' }]
    const found = findNextAvailableDay({
      ...base,
      fromDateKey: '2026-08-24',
      todayDateKey: '2026-08-24',
      busy: fullDay,
    })
    expect(found).toEqual({ dateKey: '2026-08-25', startMinute: 540 })
  })

  it('returns the earliest fitting gap, not merely the first slot checked', () => {
    // Morning is taken; the answer is the first time the job actually fits.
    const found = findNextAvailableDay({
      ...base,
      fromDateKey: '2026-08-24',
      todayDateKey: '2026-08-24',
      busy: [{ bayId: 'bay-1', startMinute: 540, endMinute: 780, dateKey: '2026-08-24' }],
    })
    expect(found).toEqual({ dateKey: '2026-08-24', startMinute: 780 })
  })

  it('does not offer a time that has already passed today', () => {
    const found = findNextAvailableDay({
      ...base,
      fromDateKey: '2026-08-24',
      todayDateKey: '2026-08-24',
      nowMinute: 15 * 60,
    })
    expect(found?.startMinute).toBeGreaterThanOrEqual(15 * 60)
  })

  it('respects lead time on today only', () => {
    const found = findNextAvailableDay({
      ...base,
      fromDateKey: '2026-08-24',
      todayDateKey: '2026-08-24',
      nowMinute: 10 * 60,
      leadTimeMinutes: 120,
    })
    expect(found?.startMinute).toBeGreaterThanOrEqual(12 * 60)
  })

  it('gives up honestly when nothing fits in the window', () => {
    const found = findNextAvailableDay({
      ...base,
      fromDateKey: '2026-08-24',
      todayDateKey: '2026-08-24',
      durationMinutes: 10 * 60, // longer than the shop is open
    })
    expect(found).toBeNull()
  })

  it('returns null for an unanswerable question rather than a wrong answer', () => {
    expect(findNextAvailableDay({ ...base, fromDateKey: '2026-08-24', todayDateKey: '2026-08-24', bayIds: [] })).toBeNull()
    expect(
      findNextAvailableDay({ ...base, fromDateKey: '2026-08-24', todayDateKey: '2026-08-24', durationMinutes: 0 }),
    ).toBeNull()
  })
})
