// Staff calendar — /app/calendar. Day view with one column per bay, since
// capacity here is bays, not staff (see docs/MVP_PLAN.md §5). Booking a
// staff appointment is meant to take well under 30 seconds on the phone
// mid-call — see AddAppointmentModal's field order: time, then who, then
// what, nothing optional in the way.

import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { CalendarClock, Check, ChevronLeft, ChevronRight, MessageSquare, Plus, X } from 'lucide-react'
import { useAppData, useRepo } from '../../data/AppDataContext'
import { useToast } from '../../components/Toast'
import { Button, Card, EmptyState, Field, Input, LoadingBlock, Modal, PageHeader } from '../../components/ui'
import { DayStrip, TimeSlotGrid } from '../../components/BookingPickers'
import { BodyStyleSilhouette } from '../../components/BodyStyleSilhouette'
import { errorMessage } from '../../lib/errors'
import { formatTime } from '../../lib/format'
import {
  addDaysToDateKey,
  availableSlotsForDay,
  dayOpenWindow,
  findNextAvailableDay,
  formatMinuteOfDay,
  minuteToTimeString,
  timeStringToMinute,
} from '../../lib/scheduling'
import { BODY_STYLE_INFO, BODY_STYLE_ORDER } from '../../lib/windowTint'
import { buildBookingConfirmationSmsBody, buildBookingReminderSmsBody, buildSmsLink } from '../../lib/sms'
import { env } from '../../lib/env'
import type { Appointment, Bay, BusinessHoursDay, ScheduleException, Service, TintBodyStyle } from '../../types'

/**
 * How far ahead booking looks — both for the day strip and for the
 * next-available scan. Three weeks matches what the public booking page
 * already offers, so staff and customers see the same horizon.
 */
const BOOKING_WINDOW_DAYS = 21

/** Minutes since local midnight for an instant. The scheduling module works in these. */
function minutesSinceMidnight(iso: string): number {
  const d = new Date(iso)
  return d.getHours() * 60 + d.getMinutes()
}

/** "2h 30m" — how long a job takes, said the way a shop says it. */
function formatDuration(totalMinutes: number): string {
  const h = Math.floor(totalMinutes / 60)
  const m = totalMinutes % 60
  if (h === 0) return `${m} minutes`
  if (m === 0) return h === 1 ? '1 hour' : `${h} hours`
  return `${h}h ${m}m`
}

function toDateKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function dayRange(dateKey: string): { start: string; end: string } {
  const start = new Date(`${dateKey}T00:00:00`)
  const end = new Date(start)
  end.setDate(end.getDate() + 1)
  return { start: start.toISOString(), end: end.toISOString() }
}

const STATUS_STYLE: Record<Appointment['status'], string> = {
  confirmed: 'border-l-emerald-500 bg-emerald-50',
  awaiting_deposit: 'border-l-amber-500 bg-amber-50',
  cancelled: 'border-l-zinc-300 bg-zinc-50 opacity-60',
  completed: 'border-l-zinc-400 bg-zinc-50',
  no_show: 'border-l-red-500 bg-red-50',
}

export default function CalendarPage() {
  const repo = useRepo()
  const { shop } = useAppData()
  const toast = useToast()
  const [date, setDate] = useState(() => new Date())
  const [bays, setBays] = useState<Bay[] | null>(null)
  const [appointments, setAppointments] = useState<Appointment[] | null>(null)
  const [adding, setAdding] = useState(false)
  const [detail, setDetail] = useState<Appointment | null>(null)
  /** The appointment being moved. Cancel-and-rebook used to be the only way. */
  const [moving, setMoving] = useState<Appointment | null>(null)

  const dateKey = toDateKey(date)

  const load = async () => {
    const { start, end } = dayRange(dateKey)
    const [b, a] = await Promise.all([repo.listBays(), repo.listAppointments(start, end)])
    setBays(b)
    setAppointments(a)
  }

  useEffect(() => {
    setAppointments(null)
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dateKey])

  const shiftDay = (delta: number) => {
    const next = new Date(date)
    next.setDate(next.getDate() + delta)
    setDate(next)
  }

  const setStatus = async (appt: Appointment, status: Appointment['status']) => {
    try {
      await repo.setAppointmentStatus(appt.id, status)
      setDetail(null)
      await load()
      toast('success', 'Updated.')
    } catch (err) {
      const detail2 = errorMessage(err)
      toast('error', detail2 ? `Could not update: ${detail2}` : 'Could not update.')
    }
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="Calendar"
        subtitle={date.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}
        actions={
          <Button onClick={() => setAdding(true)}>
            <Plus className="h-5 w-5" aria-hidden="true" /> Add appointment
          </Button>
        }
      />

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => shiftDay(-1)}
          aria-label="Previous day"
          className="flex h-11 w-11 items-center justify-center rounded-xl border border-zinc-200 text-zinc-600 hover:bg-zinc-100"
        >
          <ChevronLeft className="h-5 w-5" aria-hidden="true" />
        </button>
        <Button variant="secondary" onClick={() => setDate(new Date())}>
          Today
        </Button>
        <button
          type="button"
          onClick={() => shiftDay(1)}
          aria-label="Next day"
          className="flex h-11 w-11 items-center justify-center rounded-xl border border-zinc-200 text-zinc-600 hover:bg-zinc-100"
        >
          <ChevronRight className="h-5 w-5" aria-hidden="true" />
        </button>
      </div>

      {bays === null || appointments === null ? (
        <LoadingBlock label="Loading calendar…" />
      ) : bays.length === 0 ? (
        <EmptyState title="No bays set up yet" message="Add a bay in Settings → Booking before you can schedule jobs." />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {bays.map((bay) => {
            const bayAppointments = appointments
              .filter((a) => a.bayId === bay.id)
              .sort((a, b) => a.startsAt.localeCompare(b.startsAt))
            return (
              <Card key={bay.id} className="space-y-2">
                <h2 className="text-base font-bold text-ink">{bay.name}</h2>
                {bayAppointments.length === 0 ? (
                  <p className="text-sm text-zinc-400">Open all day</p>
                ) : (
                  <ul className="space-y-2">
                    {bayAppointments.map((appt) => (
                      <li key={appt.id}>
                        <button
                          type="button"
                          onClick={() => setDetail(appt)}
                          className={`w-full rounded-lg border-l-4 px-3 py-2 text-left ${STATUS_STYLE[appt.status]}`}
                        >
                          <p className="text-sm font-bold text-ink">
                            {formatTime(appt.startsAt)}
                            {' – '}
                            {formatTime(appt.endsAt)}
                          </p>
                          <p className="text-sm text-zinc-700">{appt.services.map((s) => s.name).join(', ')}</p>
                          {appt.status === 'awaiting_deposit' ? (
                            <p className="text-xs font-semibold text-amber-700">Awaiting deposit</p>
                          ) : null}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
            )
          })}
        </div>
      )}

      <Modal open={adding} onClose={() => setAdding(false)} title="Add appointment" size="wide">
        {adding ? (
          <AddAppointmentModal
            dateKey={dateKey}
            // Reload behind the confirmation step rather than closing over it:
            // the modal stays open on "Booked", where the text button lives.
            onBooked={() => void load()}
            onDone={() => setAdding(false)}
          />
        ) : null}
      </Modal>

      <Modal open={detail !== null} onClose={() => setDetail(null)} title="Appointment">
        {detail ? ((() => {
          const start = new Date(detail.startsAt)
          const whenLabel = `${start.toLocaleDateString(undefined, { weekday: 'long' })} at ${formatTime(start.toISOString())}`
          const smsCtx = {
            firstName: detail.customerFirstName || null,
            shopName: shop?.name ?? 'the shop',
            serviceName: detail.services.map((s) => s.name).join(', ') || null,
            whenLabel,
            manageUrl: `${env.appUrl}/booking/${detail.publicToken}`,
          }
          const smsLink = buildSmsLink(
            detail.customerPhone,
            detail.status === 'awaiting_deposit'
              ? buildBookingConfirmationSmsBody(smsCtx)
              : buildBookingReminderSmsBody(smsCtx),
          )
          return (
          <div className="space-y-4">
            <div>
              <p className="text-lg font-bold text-ink">
                {formatTime(detail.startsAt)}
                {' – '}
                {formatTime(detail.endsAt)}
              </p>
              <p className="text-base font-semibold text-ink">
                {[detail.customerFirstName, detail.customerLastName].filter(Boolean).join(' ') || 'Customer'}
              </p>
              <p className="text-base text-zinc-600">{detail.services.map((s) => s.name).join(', ')}</p>
              {detail.notes ? <p className="mt-2 text-sm text-zinc-600">{detail.notes}</p> : null}
            </div>
            <div className="flex flex-wrap gap-2">
              {/* Tap-to-text. The reminder wording is used once the appointment
                 is in the future and already confirmed; right after booking,
                 the "you're booked" phrasing is what staff want to fire off
                 while the customer is still on the phone. */}
              {smsLink ? (
                <a
                  href={smsLink}
                  className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl border border-zinc-300 bg-white px-4 text-base font-semibold text-ink hover:bg-zinc-50"
                >
                  <MessageSquare className="h-5 w-5" aria-hidden="true" />
                  {detail.reminderSentAt ? 'Text again' : 'Text reminder'}
                </a>
              ) : null}
              {detail.status !== 'completed' && detail.status !== 'cancelled' ? (
                <Button variant="secondary" onClick={() => void setStatus(detail, 'completed')}>
                  Mark completed
                </Button>
              ) : null}
              {detail.status !== 'no_show' && detail.status !== 'completed' && detail.status !== 'cancelled' ? (
                <Button variant="secondary" onClick={() => void setStatus(detail, 'no_show')}>
                  Mark no-show
                </Button>
              ) : null}
              {detail.status !== 'cancelled' && detail.status !== 'completed' ? (
                <Button
                  variant="secondary"
                  onClick={() => {
                    setMoving(detail)
                    setDetail(null)
                  }}
                >
                  <CalendarClock className="h-4 w-4" aria-hidden="true" /> Move
                </Button>
              ) : null}
              {detail.status !== 'cancelled' ? (
                <Button variant="danger" onClick={() => void setStatus(detail, 'cancelled')}>
                  <X className="h-4 w-4" aria-hidden="true" /> Cancel
                </Button>
              ) : null}
            </div>
          </div>
          )
        })()) : null}
      </Modal>

      <Modal open={moving !== null} onClose={() => setMoving(null)} title="Move appointment" size="wide">
        {moving ? (
          <RescheduleModal
            appointment={moving}
            onMoved={async () => {
              setMoving(null)
              await load()
              toast('success', 'Appointment moved.')
            }}
          />
        ) : null}
      </Modal>
    </div>
  )
}

/**
 * Move an existing appointment to a new day and time.
 *
 * Before this, "the customer wants Thursday instead" meant cancelling and
 * rebooking, which throws away the record and mints a fresh public_token —
 * silently breaking the manage link already sitting in the customer's inbox.
 * Moving in place keeps both, and the duration comes from the appointment's
 * own snapshotted service lines, so a service whose length was edited since
 * booking can't quietly stretch a job that is only being rescheduled.
 */
function RescheduleModal({ appointment, onMoved }: { appointment: Appointment; onMoved: () => void }) {
  const repo = useRepo()
  const [bays, setBays] = useState<Bay[] | null>(null)
  const [hours, setHours] = useState<BusinessHoursDay[] | null>(null)
  const [exceptions, setExceptions] = useState<ScheduleException[] | null>(null)
  const [windowAppointments, setWindowAppointments] = useState<Appointment[] | null>(null)

  const todayKey = toDateKey(new Date())
  const [dateKey, setDateKey] = useState(() => toDateKey(new Date(appointment.startsAt)))
  const [startTime, setStartTime] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const totalMinutes = appointment.services.reduce((sum, s) => sum + s.durationMinutes, 0)

  useEffect(() => {
    void Promise.all([
      repo.listBays(),
      repo.listBusinessHours(),
      repo.listScheduleExceptions(),
      repo.listAppointments(dayRange(todayKey).start, dayRange(addDaysToDateKey(todayKey, BOOKING_WINDOW_DAYS)).end),
    ]).then(([b, h, e, a]) => {
      setBays(b)
      setHours(h)
      setExceptions(e)
      setWindowAppointments(a)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const activeBayIds = useMemo(() => (bays ?? []).filter((b) => b.active).map((b) => b.id), [bays])

  // The appointment being moved is excluded from its own busy list — otherwise
  // it blocks the slot it currently occupies and "move it 30 minutes later"
  // reads as unavailable.
  const busyBlocks = useMemo(
    () =>
      (windowAppointments ?? [])
        .filter((a) => a.status !== 'cancelled' && a.id !== appointment.id)
        .map((a) => ({
          bayId: a.bayId,
          startMinute: minutesSinceMidnight(a.startsAt),
          endMinute: minutesSinceMidnight(a.endsAt),
          dateKey: toDateKey(new Date(a.startsAt)),
        })),
    [windowAppointments, appointment.id],
  )

  const slots = useMemo(() => {
    if (!hours || !exceptions || !windowAppointments || totalMinutes === 0) return []
    const { openMinute, closeMinute } = dayOpenWindow(dateKey, hours, exceptions)
    return availableSlotsForDay({
      bayIds: activeBayIds,
      openMinute,
      closeMinute,
      durationMinutes: totalMinutes,
      busy: busyBlocks.filter((b) => b.dateKey === dateKey),
      nowMinuteIfToday: dateKey === todayKey ? minutesSinceMidnight(new Date().toISOString()) : null,
      slotIntervalMinutes: 15,
    })
  }, [hours, exceptions, windowAppointments, totalMinutes, dateKey, activeBayIds, busyBlocks, todayKey])

  const startTimeOptions = useMemo(
    () => Array.from(new Set(slots.map((s) => s.startMinute))).sort((a, b) => a - b),
    [slots],
  )

  const move = async () => {
    if (!startTime) {
      setError('Pick a new time.')
      return
    }
    const startMinute = timeStringToMinute(startTime)
    const bay = (bays ?? []).find((b) => slots.some((sl) => sl.bayId === b.id && sl.startMinute === startMinute))
    if (!bay) {
      setError('That time was just taken. Pick another.')
      return
    }
    setError(null)
    setSaving(true)
    try {
      await repo.rescheduleAppointment(appointment.id, {
        startsAt: new Date(`${dateKey}T${startTime}:00`).toISOString(),
        bayId: bay.id,
      })
      onMoved()
    } catch (err) {
      setError(errorMessage(err) ?? 'Could not move that appointment.')
    } finally {
      setSaving(false)
    }
  }

  if (bays === null) return <LoadingBlock label="Loading…" />

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-3">
        <p className="text-sm text-zinc-500">Currently</p>
        <p className="text-base font-semibold text-ink">
          {new Date(appointment.startsAt).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}
          {' at '}
          {formatTime(appointment.startsAt)}
        </p>
        <p className="text-sm text-zinc-600">
          {appointment.services.map((sv) => sv.name).join(', ')} · {formatDuration(totalMinutes)}
        </p>
      </div>

      <Field label="Move to" htmlFor="move-time" required error={error ?? undefined}>
        <DayStrip
          fromDateKey={todayKey}
          dayCount={BOOKING_WINDOW_DAYS}
          value={dateKey}
          todayDateKey={todayKey}
          onChange={(next) => {
            setDateKey(next)
            setStartTime('')
          }}
        />
        {startTimeOptions.length === 0 ? (
          <p className="mt-2 text-sm text-amber-700">Nothing open on this day that fits. Try another.</p>
        ) : (
          <div className="mt-2">
            <TimeSlotGrid startMinutes={startTimeOptions} value={startTime} onChange={setStartTime} />
          </div>
        )}
      </Field>

      <Button className="w-full" disabled={saving || !startTime} onClick={() => void move()}>
        {saving ? 'Moving…' : 'Move appointment'}
      </Button>
    </div>
  )
}
/**
 * Booking an appointment, in the order a phone call actually goes.
 *
 * What was here before dead-ended: it was locked to whichever day the calendar
 * was showing, so when it said "no open slots, try a different day" there was
 * no way to try one without closing the modal, clicking the day chevrons, and
 * starting over. The time picker was a <select> of thirty-odd raw 24-hour
 * strings. And when the booking succeeded it closed on a toast, at the exact
 * moment staff still had the customer on the line and wanted to text them.
 *
 * Now: services, then a day strip, then tappable times — with the shop's next
 * actual opening offered as one tap, because "when can you take me?" is the
 * first thing anyone asks and the app previously could not answer it.
 */
function AddAppointmentModal({
  dateKey: initialDateKey,
  onBooked,
  onDone,
}: {
  dateKey: string
  /** Fired after a successful booking so the calendar behind can reload. */
  onBooked: () => void
  /** Fired when the user is finished with the confirmation step. */
  onDone: () => void
}) {
  const repo = useRepo()
  const { shop } = useAppData()
  const [services, setServices] = useState<Service[] | null>(null)
  const [bays, setBays] = useState<Bay[] | null>(null)
  const [hours, setHours] = useState<BusinessHoursDay[] | null>(null)
  const [exceptions, setExceptions] = useState<ScheduleException[] | null>(null)
  // Every appointment across the whole search window, not just one day — the
  // next-available scan needs to see all of them at once.
  const [windowAppointments, setWindowAppointments] = useState<Appointment[] | null>(null)

  const [dateKey, setDateKey] = useState(initialDateKey)
  const [selectedServiceIds, setSelectedServiceIds] = useState<string[]>([])
  const [bodyStyle, setBodyStyle] = useState<TintBodyStyle | ''>('')
  const [startTime, setStartTime] = useState('')
  const [customerFirstName, setCustomerFirstName] = useState('')
  const [customerLastName, setCustomerLastName] = useState('')
  const [customerPhone, setCustomerPhone] = useState('')
  const [customerEmail, setCustomerEmail] = useState('')
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)
  // Errors live on the field they belong to, not in one bucket at the bottom.
  const [fieldErrors, setFieldErrors] = useState<{ services?: string; time?: string; name?: string; form?: string }>({})
  /** Set once the booking lands — the modal becomes a confirmation, not a form. */
  const [booked, setBooked] = useState<Appointment | null>(null)

  const todayKey = toDateKey(new Date())

  useEffect(() => {
    void Promise.all([
      repo.listServices(),
      repo.listBays(),
      repo.listBusinessHours(),
      repo.listScheduleExceptions(),
      repo.listAppointments(
        dayRange(todayKey).start,
        dayRange(addDaysToDateKey(todayKey, BOOKING_WINDOW_DAYS)).end,
      ),
    ]).then(([s, b, h, e, a]) => {
      setServices(s)
      setBays(b)
      setHours(h)
      setExceptions(e)
      setWindowAppointments(a)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const selectedServices = (services ?? []).filter((s) => selectedServiceIds.includes(s.id))
  const totalMinutes = selectedServices.reduce((sum, s) => {
    const override = s.durationOverrides.find((o) => o.bodyStyle === bodyStyle)
    return sum + (override?.durationMinutes ?? s.durationMinutes)
  }, 0)

  const activeBayIds = useMemo(() => (bays ?? []).filter((b) => b.active).map((b) => b.id), [bays])

  /** Busy blocks across the whole window, tagged with their day. */
  const busyBlocks = useMemo(
    () =>
      (windowAppointments ?? [])
        .filter((a) => a.status !== 'cancelled')
        .map((a) => ({
          bayId: a.bayId,
          startMinute: minutesSinceMidnight(a.startsAt),
          endMinute: minutesSinceMidnight(a.endsAt),
          dateKey: toDateKey(new Date(a.startsAt)),
        })),
    [windowAppointments],
  )

  const slots = useMemo(() => {
    if (!hours || !exceptions || !windowAppointments || !bays || totalMinutes === 0) return []
    const { openMinute, closeMinute } = dayOpenWindow(dateKey, hours, exceptions)
    return availableSlotsForDay({
      bayIds: activeBayIds,
      openMinute,
      closeMinute,
      durationMinutes: totalMinutes,
      busy: busyBlocks.filter((b) => b.dateKey === dateKey),
      nowMinuteIfToday: dateKey === todayKey ? minutesSinceMidnight(new Date().toISOString()) : null,
      slotIntervalMinutes: 15,
    })
  }, [hours, exceptions, windowAppointments, bays, totalMinutes, dateKey, activeBayIds, busyBlocks, todayKey])

  /**
   * The shop's next real opening, scanned across the window.
   *
   * This is the answer to the only question a customer on the phone is
   * actually asking, and offering it as one tap turns a day-by-day hunt into
   * a single press.
   */
  const nextOpening = useMemo(() => {
    if (!hours || !exceptions || totalMinutes === 0 || activeBayIds.length === 0) return null
    return findNextAvailableDay({
      fromDateKey: todayKey,
      maxDays: BOOKING_WINDOW_DAYS,
      bayIds: activeBayIds,
      durationMinutes: totalMinutes,
      businessHours: hours,
      exceptions,
      busy: busyBlocks,
      todayDateKey: todayKey,
      nowMinute: minutesSinceMidnight(new Date().toISOString()),
      slotIntervalMinutes: 15,
    })
  }, [hours, exceptions, totalMinutes, activeBayIds, busyBlocks, todayKey])

  const startTimeOptions = useMemo(
    () => Array.from(new Set(slots.map((s) => s.startMinute))).sort((a, b) => a - b),
    [slots],
  )

  const save = async () => {
    const errors: typeof fieldErrors = {}
    if (selectedServiceIds.length === 0) errors.services = 'Pick at least one service.'
    if (!startTime) errors.time = 'Pick a time.'
    if (!customerFirstName.trim()) errors.name = 'Enter the customer name.'
    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors)
      return
    }

    const startMinute = timeStringToMinute(startTime)
    const bay = (bays ?? []).find((b) => slots.some((s) => s.bayId === b.id && s.startMinute === startMinute))
    if (!bay) {
      setFieldErrors({ time: 'That time was just taken. Pick another.' })
      return
    }

    setFieldErrors({})
    setSaving(true)
    try {
      const appointment = await repo.createAppointment({
        bayId: bay.id,
        customerFirstName: customerFirstName.trim(),
        customerLastName: customerLastName.trim() || null,
        customerEmail: customerEmail.trim() || null,
        customerPhone: customerPhone.trim() || null,
        source: 'staff',
        startsAt: new Date(`${dateKey}T${startTime}:00`).toISOString(),
        bodyStyle: bodyStyle || null,
        notes: notes.trim() || null,
        services: selectedServices.map((s) => {
          const override = s.durationOverrides.find((o) => o.bodyStyle === bodyStyle)
          return {
            serviceId: s.id,
            name: s.name,
            durationMinutes: override?.durationMinutes ?? s.durationMinutes,
            priceCents: s.priceCents,
          }
        }),
      })
      // Reload the calendar behind, but stay open on the confirmation — the
      // customer is still on the phone and the next thing staff want is to
      // text them, not to hunt for the appointment they just made.
      onBooked()
      setBooked(appointment)
    } catch (err) {
      const detail = errorMessage(err)
      setFieldErrors({ form: detail ? `Could not book: ${detail}` : 'Could not book that appointment. Please try again.' })
    } finally {
      setSaving(false)
    }
  }

  if (services === null) return <LoadingBlock label="Loading…" />

  if (booked) {
    return <BookedConfirmation appointment={booked} shopName={shop?.name ?? 'the shop'} onDone={onDone} />
  }

  const usesTint = selectedServices.some((s) => s.durationOverrides.length > 0)

  return (
    <div className="space-y-4">
      <Field label="Services" htmlFor="appt-services" required error={fieldErrors.services}>
        {/* A required field with nothing in it is a dead end: Save demands a
            service, the time picker needs a duration, and nothing on this
            screen can resolve it. Migration 0025 seeds starter services so a
            new shop never lands here — this covers a shop that deleted them. */}
        {services.length === 0 ? (
          <div className="rounded-xl border border-amber-300 bg-amber-50 p-4">
            <p className="text-base font-semibold text-amber-900">No services yet</p>
            <p className="mt-1 text-sm text-amber-800">
              Add what you can book — a system install, a tint job — then come back and schedule it.
            </p>
            <Link
              to="/app/settings"
              className="mt-3 inline-flex min-h-11 items-center justify-center rounded-xl bg-amber-900 px-4 text-base font-semibold text-white hover:bg-amber-950"
            >
              Add a service in Settings
            </Link>
          </div>
        ) : (
          <div className="flex flex-wrap gap-2">
            {services.map((s) => {
              const active = selectedServiceIds.includes(s.id)
              return (
                <button
                  key={s.id}
                  type="button"
                  aria-pressed={active}
                  onClick={() => {
                    setSelectedServiceIds((prev) => (active ? prev.filter((id) => id !== s.id) : [...prev, s.id]))
                    // Duration changed, so the chosen time may no longer fit.
                    setStartTime('')
                  }}
                  className={`min-h-12 rounded-full border-2 px-4 text-sm font-semibold transition-colors ${
                    active ? 'border-brand bg-brand-tint text-brand' : 'border-zinc-200 text-zinc-600 hover:border-zinc-300'
                  }`}
                >
                  {s.name}
                </button>
              )
            })}
          </div>
        )}
      </Field>

      {usesTint ? (
        <Field label="Vehicle body style" htmlFor="appt-body-style" hint="Affects how long the job takes.">
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              aria-pressed={bodyStyle === ''}
              onClick={() => { setBodyStyle(''); setStartTime('') }}
              className={`min-h-12 rounded-xl border-2 px-3 text-sm font-semibold ${
                bodyStyle === '' ? 'border-brand bg-brand-tint text-brand' : 'border-zinc-200 text-zinc-600'
              }`}
            >
              Standard
            </button>
            {BODY_STYLE_ORDER.map((b) => (
              <button
                key={b}
                type="button"
                aria-pressed={bodyStyle === b}
                aria-label={BODY_STYLE_INFO[b].label}
                onClick={() => { setBodyStyle(b); setStartTime('') }}
                className={`flex w-20 flex-col items-center gap-1 rounded-xl border-2 px-2 py-2 ${
                  bodyStyle === b ? 'border-brand bg-brand-tint text-brand' : 'border-zinc-200 text-zinc-600'
                }`}
              >
                <BodyStyleSilhouette bodyStyle={b} className="h-7 w-full" />
                <span className="text-[11px] leading-tight font-semibold">{BODY_STYLE_INFO[b].label}</span>
              </button>
            ))}
          </div>
        </Field>
      ) : null}

      {totalMinutes > 0 ? (
        <Field
          label="When"
          htmlFor="appt-time"
          required
          error={fieldErrors.time}
          hint={`This will take about ${formatDuration(totalMinutes)}.`}
        >
          {nextOpening && !(nextOpening.dateKey === dateKey && minuteToTimeString(nextOpening.startMinute) === startTime) ? (
            <button
              type="button"
              onClick={() => {
                setDateKey(nextOpening.dateKey)
                setStartTime(minuteToTimeString(nextOpening.startMinute))
              }}
              className="mb-3 flex w-full items-center justify-between gap-2 rounded-xl border-2 border-brand bg-brand-tint px-3 py-2.5 text-left"
            >
              <span className="text-sm font-semibold text-brand">
                Next opening ·{' '}
                {new Date(`${nextOpening.dateKey}T00:00:00`).toLocaleDateString(undefined, {
                  weekday: 'short',
                  month: 'short',
                  day: 'numeric',
                })}{' '}
                at {formatMinuteOfDay(nextOpening.startMinute)}
              </span>
              <span className="shrink-0 text-xs font-bold text-brand uppercase">Use</span>
            </button>
          ) : null}

          <DayStrip
            fromDateKey={todayKey}
            dayCount={BOOKING_WINDOW_DAYS}
            value={dateKey}
            todayDateKey={todayKey}
            onChange={(next) => {
              setDateKey(next)
              setStartTime('')
            }}
          />

          {startTimeOptions.length === 0 ? (
            <p className="mt-2 text-sm text-amber-700">
              {nextOpening
                ? 'Nothing fits on this day — use the next opening above, or pick another day.'
                : 'Nothing open in the next three weeks for this combination of services.'}
            </p>
          ) : (
            <div className="mt-2">
              <TimeSlotGrid startMinutes={startTimeOptions} value={startTime} onChange={setStartTime} />
            </div>
          )}
        </Field>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Customer name" htmlFor="appt-first" required error={fieldErrors.name}>
          <Input id="appt-first" value={customerFirstName} onChange={(e) => setCustomerFirstName(e.target.value)} placeholder="Marcus" />
        </Field>
        <Field label="Last name" htmlFor="appt-last">
          <Input id="appt-last" value={customerLastName} onChange={(e) => setCustomerLastName(e.target.value)} />
        </Field>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Phone" htmlFor="appt-phone" hint="Lets you text them a reminder.">
          <Input id="appt-phone" type="tel" value={customerPhone} onChange={(e) => setCustomerPhone(e.target.value)} />
        </Field>
        <Field label="Email" htmlFor="appt-email">
          <Input id="appt-email" type="email" value={customerEmail} onChange={(e) => setCustomerEmail(e.target.value)} />
        </Field>
      </div>
      <Field label="Notes" htmlFor="appt-notes">
        <Input id="appt-notes" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional" />
      </Field>

      {fieldErrors.form ? (
        <p role="alert" className="text-base font-medium text-red-700">
          {fieldErrors.form}
        </p>
      ) : null}

      {/* Disabled rather than clickable-then-rejected: an error you cannot act
          on from the screen you are looking at is worse than a button that
          plainly isn't ready yet. */}
      <Button
        className="w-full"
        disabled={saving || services.length === 0 || selectedServiceIds.length === 0 || !startTime}
        onClick={() => void save()}
      >
        {saving ? 'Booking…' : 'Book appointment'}
      </Button>
    </div>
  )
}

/**
 * What the modal becomes the moment a booking lands.
 *
 * The old flow closed on a toast, which threw away the one moment that
 * matters: staff are still on the phone, and the thing they want next is to
 * fire off a confirmation text while the customer can hear it arrive.
 */
function BookedConfirmation({
  appointment,
  shopName,
  onDone,
}: {
  appointment: Appointment
  shopName: string
  onDone: () => void
}) {
  const start = new Date(appointment.startsAt)
  const whenLabel = `${start.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })} at ${formatTime(appointment.startsAt)}`
  const smsLink = appointment.customerPhone
    ? buildSmsLink(
        appointment.customerPhone,
        buildBookingConfirmationSmsBody({
          firstName: appointment.customerFirstName || null,
          shopName,
          serviceName: appointment.services.map((s) => s.name).join(', ') || null,
          whenLabel,
          manageUrl: `${env.appUrl}/booking/${appointment.publicToken}`,
        }),
      )
    : null

  return (
    <div className="space-y-4 text-center">
      <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-green-100 text-green-800">
        <Check className="h-7 w-7" aria-hidden="true" />
      </span>
      <div>
        <p className="text-xl font-bold text-ink">Booked</p>
        <p className="mt-1 text-base text-zinc-600">
          {[appointment.customerFirstName, appointment.customerLastName].filter(Boolean).join(' ')} — {whenLabel}
        </p>
        <p className="mt-1 text-sm text-zinc-500">{appointment.services.map((s) => s.name).join(', ')}</p>
      </div>

      <div className="flex flex-col gap-2">
        {smsLink ? (
          <a
            href={smsLink}
            className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-brand px-4 text-base font-semibold text-white"
          >
            <MessageSquare className="h-5 w-5" aria-hidden="true" /> Text the confirmation
          </a>
        ) : (
          <p className="text-sm text-zinc-500">No phone number on file, so there&apos;s no one to text.</p>
        )}
        <Button variant="secondary" className="w-full" onClick={onDone}>
          Done
        </Button>
      </div>
    </div>
  )
}
