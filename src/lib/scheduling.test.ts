import { describe, expect, it } from 'vitest'
import {
  availableSlotsForDay,
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
