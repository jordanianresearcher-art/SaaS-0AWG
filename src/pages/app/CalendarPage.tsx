// Staff calendar — /app/calendar. Day view with one column per bay, since
// capacity here is bays, not staff (see docs/MVP_PLAN.md §5). Booking a
// staff appointment is meant to take well under 30 seconds on the phone
// mid-call — see AddAppointmentModal's field order: time, then who, then
// what, nothing optional in the way.

import { useEffect, useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight, Plus, X } from 'lucide-react'
import { useRepo } from '../../data/AppDataContext'
import { useToast } from '../../components/Toast'
import { Button, Card, EmptyState, Field, Input, LoadingBlock, Modal, Select } from '../../components/ui'
import { errorMessage } from '../../lib/errors'
import { availableSlotsForDay, minuteToTimeString, timeStringToMinute } from '../../lib/scheduling'
import { BODY_STYLE_INFO, BODY_STYLE_ORDER } from '../../lib/windowTint'
import type { Appointment, Bay, BusinessHoursDay, ScheduleException, Service, TintBodyStyle } from '../../types'

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
  const toast = useToast()
  const [date, setDate] = useState(() => new Date())
  const [bays, setBays] = useState<Bay[] | null>(null)
  const [appointments, setAppointments] = useState<Appointment[] | null>(null)
  const [adding, setAdding] = useState(false)
  const [detail, setDetail] = useState<Appointment | null>(null)

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
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-3xl font-black text-ink">Calendar</h1>
          <p className="mt-1 text-base text-zinc-600">
            {date.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}
          </p>
        </div>
        <Button onClick={() => setAdding(true)}>
          <Plus className="h-5 w-5" aria-hidden="true" /> Add appointment
        </Button>
      </div>

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
                            {new Date(appt.startsAt).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}
                            {' – '}
                            {new Date(appt.endsAt).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}
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
            onBooked={async () => {
              setAdding(false)
              await load()
            }}
          />
        ) : null}
      </Modal>

      <Modal open={detail !== null} onClose={() => setDetail(null)} title="Appointment">
        {detail ? (
          <div className="space-y-4">
            <div>
              <p className="text-lg font-bold text-ink">
                {new Date(detail.startsAt).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}
                {' – '}
                {new Date(detail.endsAt).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}
              </p>
              <p className="text-base text-zinc-600">{detail.services.map((s) => s.name).join(', ')}</p>
              {detail.notes ? <p className="mt-2 text-sm text-zinc-600">{detail.notes}</p> : null}
            </div>
            <div className="flex flex-wrap gap-2">
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
              {detail.status !== 'cancelled' ? (
                <Button variant="danger" onClick={() => void setStatus(detail, 'cancelled')}>
                  <X className="h-4 w-4" aria-hidden="true" /> Cancel
                </Button>
              ) : null}
            </div>
          </div>
        ) : null}
      </Modal>
    </div>
  )
}

function AddAppointmentModal({ dateKey, onBooked }: { dateKey: string; onBooked: () => void }) {
  const repo = useRepo()
  const toast = useToast()
  const [services, setServices] = useState<Service[] | null>(null)
  const [bays, setBays] = useState<Bay[] | null>(null)
  const [hours, setHours] = useState<BusinessHoursDay[] | null>(null)
  const [exceptions, setExceptions] = useState<ScheduleException[] | null>(null)
  const [appointments, setAppointments] = useState<Appointment[] | null>(null)

  const [selectedServiceIds, setSelectedServiceIds] = useState<string[]>([])
  const [bodyStyle, setBodyStyle] = useState<TintBodyStyle | ''>('')
  const [startTime, setStartTime] = useState('')
  const [customerFirstName, setCustomerFirstName] = useState('')
  const [customerLastName, setCustomerLastName] = useState('')
  const [customerPhone, setCustomerPhone] = useState('')
  const [customerEmail, setCustomerEmail] = useState('')
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    void Promise.all([
      repo.listServices(),
      repo.listBays(),
      repo.listBusinessHours(),
      repo.listScheduleExceptions(),
      repo.listAppointments(dayRangeStart(dateKey), dayRangeEnd(dateKey)),
    ]).then(([s, b, h, e, a]) => {
      setServices(s)
      setBays(b)
      setHours(h)
      setExceptions(e)
      setAppointments(a)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dateKey])

  function dayRangeStart(key: string) {
    return dayRange(key).start
  }
  function dayRangeEnd(key: string) {
    return dayRange(key).end
  }

  const selectedServices = (services ?? []).filter((s) => selectedServiceIds.includes(s.id))
  const totalMinutes = selectedServices.reduce((sum, s) => {
    const override = s.durationOverrides.find((o) => o.bodyStyle === bodyStyle)
    return sum + (override?.durationMinutes ?? s.durationMinutes)
  }, 0)

  const slots = useMemo(() => {
    if (!hours || !exceptions || !appointments || !bays || totalMinutes === 0) return []
    const dow = new Date(`${dateKey}T00:00:00`).getDay()
    const exception = exceptions.find((e) => e.date === dateKey)
    const dayHours = hours.find((h) => h.dayOfWeek === dow)
    const openMinute = exception ? (exception.isClosed ? null : timeStringToMinute(exception.openTime!)) : dayHours?.isOpen ? timeStringToMinute(dayHours.openTime!) : null
    const closeMinute = exception ? (exception.isClosed ? null : timeStringToMinute(exception.closeTime!)) : dayHours?.isOpen ? timeStringToMinute(dayHours.closeTime!) : null
    const todayKey = toDateKey(new Date())
    return availableSlotsForDay({
      bayIds: bays.filter((b) => b.active).map((b) => b.id),
      openMinute,
      closeMinute,
      durationMinutes: totalMinutes,
      busy: appointments
        .filter((a) => a.status !== 'cancelled')
        .map((a) => ({
          bayId: a.bayId,
          startMinute: minutesSinceMidnight(a.startsAt),
          endMinute: minutesSinceMidnight(a.endsAt),
        })),
      nowMinuteIfToday: dateKey === todayKey ? minutesSinceMidnight(new Date().toISOString()) : null,
      slotIntervalMinutes: 15,
    })
  }, [hours, exceptions, appointments, bays, totalMinutes, dateKey])

  function minutesSinceMidnight(iso: string): number {
    const d = new Date(iso)
    return d.getHours() * 60 + d.getMinutes()
  }

  // Unique start times a staff member can pick — the actual bay gets chosen
  // automatically at save time (any bay free at that start time works).
  const startTimeOptions = Array.from(new Set(slots.map((s) => s.startMinute))).sort((a, b) => a - b)

  const save = async () => {
    setError(null)
    if (selectedServiceIds.length === 0) {
      setError('Pick at least one service.')
      return
    }
    if (!startTime) {
      setError('Pick a time.')
      return
    }
    if (!customerFirstName.trim()) {
      setError('Enter the customer name.')
      return
    }
    const bay = bays?.find((b) => {
      const startMinute = timeStringToMinute(startTime)
      return slots.some((s) => s.bayId === b.id && s.startMinute === startMinute)
    })
    if (!bay) {
      setError('That time is no longer available. Pick another.')
      return
    }
    const startsAt = new Date(`${dateKey}T${startTime}:00`).toISOString()
    setSaving(true)
    try {
      await repo.createAppointment({
        bayId: bay.id,
        customerFirstName: customerFirstName.trim(),
        customerLastName: customerLastName.trim() || null,
        customerEmail: customerEmail.trim() || null,
        customerPhone: customerPhone.trim() || null,
        source: 'staff',
        startsAt,
        bodyStyle: bodyStyle || null,
        notes: notes.trim() || null,
        services: selectedServices.map((s) => {
          const override = s.durationOverrides.find((o) => o.bodyStyle === bodyStyle)
          return { serviceId: s.id, name: s.name, durationMinutes: override?.durationMinutes ?? s.durationMinutes, priceCents: s.priceCents }
        }),
      })
      toast('success', 'Appointment booked.')
      onBooked()
    } catch (err) {
      const detail = errorMessage(err)
      setError(detail ? `Could not book: ${detail}` : 'Could not book that appointment. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  if (services === null) return <LoadingBlock label="Loading…" />

  const usesTint = selectedServices.some((s) => s.durationOverrides.length > 0)

  return (
    <div className="space-y-4">
      <Field label="Services" htmlFor="appt-services" required>
        <div className="flex flex-wrap gap-2">
          {services.map((s) => {
            const active = selectedServiceIds.includes(s.id)
            return (
              <button
                key={s.id}
                type="button"
                onClick={() =>
                  setSelectedServiceIds((prev) => (active ? prev.filter((id) => id !== s.id) : [...prev, s.id]))
                }
                className={`rounded-full border-2 px-4 py-2 text-sm font-semibold ${active ? 'border-brand bg-blue-50 text-brand' : 'border-zinc-200 text-zinc-600'}`}
              >
                {s.name}
              </button>
            )
          })}
        </div>
      </Field>

      {usesTint ? (
        <Field label="Vehicle body style" htmlFor="appt-body-style" hint="Affects how long the job takes.">
          <Select id="appt-body-style" value={bodyStyle} onChange={(e) => setBodyStyle(e.target.value as TintBodyStyle)}>
            <option value="">Standard duration</option>
            {BODY_STYLE_ORDER.map((b) => (
              <option key={b} value={b}>
                {BODY_STYLE_INFO[b].label}
              </option>
            ))}
          </Select>
        </Field>
      ) : null}

      {totalMinutes > 0 ? (
        <Field label="Time" htmlFor="appt-time" required hint={`This will take about ${totalMinutes} minutes.`}>
          {startTimeOptions.length === 0 ? (
            <p className="text-sm text-amber-700">No open slots that fit on this day. Try a different day.</p>
          ) : (
            <Select id="appt-time" value={startTime} onChange={(e) => setStartTime(e.target.value)}>
              <option value="">Pick a time…</option>
              {startTimeOptions.map((m) => (
                <option key={m} value={minuteToTimeString(m)}>
                  {minuteToTimeString(m)}
                </option>
              ))}
            </Select>
          )}
        </Field>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Customer name" htmlFor="appt-first" required>
          <Input id="appt-first" value={customerFirstName} onChange={(e) => setCustomerFirstName(e.target.value)} placeholder="Marcus" />
        </Field>
        <Field label="Last name" htmlFor="appt-last">
          <Input id="appt-last" value={customerLastName} onChange={(e) => setCustomerLastName(e.target.value)} />
        </Field>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Phone" htmlFor="appt-phone">
          <Input id="appt-phone" type="tel" value={customerPhone} onChange={(e) => setCustomerPhone(e.target.value)} />
        </Field>
        <Field label="Email" htmlFor="appt-email">
          <Input id="appt-email" type="email" value={customerEmail} onChange={(e) => setCustomerEmail(e.target.value)} />
        </Field>
      </div>
      <Field label="Notes" htmlFor="appt-notes">
        <Input id="appt-notes" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional" />
      </Field>

      {error ? (
        <p role="alert" className="text-base font-medium text-red-700">
          {error}
        </p>
      ) : null}
      <Button className="w-full" disabled={saving} onClick={() => void save()}>
        {saving ? 'Booking…' : 'Book & send'}
      </Button>
    </div>
  )
}
