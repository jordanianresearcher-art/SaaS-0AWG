// Public self-serve booking wizard — /book/:shopSlug, optionally
// ?quote=<publicToken> when reached via the "Book my install" CTA on a
// quote. Per docs/MVP_PLAN.md §5: 4 steps cold, 2 steps from an accepted
// quote, no account ever created for the customer.
//
// Availability shown here is a courtesy, not the source of truth — picking a
// time that's since been taken still fails cleanly, because book_appointment
// (migration 0021) re-derives everything server-side and the database's own
// exclusion constraint is what actually prevents a double-book.

import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { Check, MapPin, Phone } from 'lucide-react'
import { resolvePublicBookingApi, type PublicBookingApi } from '../data/publicBooking'
import { resolvePublicQuoteApi } from '../data/publicQuote'
import { Button, Field, Input, LoadingBlock, Logo, Select } from '../components/ui'
import { formatCurrency } from '../lib/format'
import { availableSlotsForDay, isDateBookable, minuteToTimeString, timeStringToMinute } from '../lib/scheduling'
import { BODY_STYLE_INFO, BODY_STYLE_ORDER } from '../lib/windowTint'
import type { PublicBookingPage as PublicBookingPageData, TintBodyStyle } from '../types'

function toDateKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function minutesSinceMidnight(iso: string): number {
  const d = new Date(iso)
  return d.getHours() * 60 + d.getMinutes()
}

const MAX_ADVANCE_DAYS = 21

export default function BookingPage() {
  const { shopSlug = '' } = useParams<{ shopSlug: string }>()
  const [searchParams] = useSearchParams()
  const quoteToken = searchParams.get('quote')
  const navigate = useNavigate()

  const [state, setState] = useState<'loading' | 'ready' | 'missing' | 'error'>('loading')
  const [api, setApi] = useState<PublicBookingApi | null>(null)
  const [page, setPage] = useState<PublicBookingPageData | null>(null)
  const [quoteFirstName, setQuoteFirstName] = useState<string | null>(null)

  const [selectedServiceIds, setSelectedServiceIds] = useState<string[]>([])
  const [bodyStyle, setBodyStyle] = useState<TintBodyStyle | ''>('')
  const [dateKey, setDateKey] = useState(() => toDateKey(new Date()))
  const [startTime, setStartTime] = useState('')
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    ;(async () => {
      try {
        const resolved = await resolvePublicBookingApi(shopSlug)
        if (!resolved) {
          setState('missing')
          return
        }
        const [data] = await Promise.all([
          resolved.getBookingPage(),
          quoteToken
            ? resolvePublicQuoteApi(quoteToken).then((qApi) => qApi?.get()).then((q) => setQuoteFirstName(q?.customerFirstName ?? null))
            : Promise.resolve(),
        ])
        if (!data) {
          setState('missing')
          return
        }
        setApi(resolved)
        setPage(data)
        setState('ready')
      } catch {
        setState('error')
      }
    })()
  }, [shopSlug, quoteToken])

  const services = page?.services ?? []
  const selectedServices = services.filter((s) => selectedServiceIds.includes(s.id))
  const totalMinutes = selectedServices.reduce((sum, s) => {
    const override = s.durationOverrides.find((o) => o.bodyStyle === bodyStyle)
    return sum + (override?.durationMinutes ?? s.durationMinutes)
  }, 0)
  const usesTint = selectedServices.some((s) => s.durationOverrides.length > 0)

  const dateOptions = useMemo(() => {
    const out: string[] = []
    const d = new Date()
    for (let i = 0; i < MAX_ADVANCE_DAYS; i++) {
      out.push(toDateKey(d))
      d.setDate(d.getDate() + 1)
    }
    return out
  }, [])

  const slots = useMemo(() => {
    if (!page || totalMinutes === 0) return []
    const todayKey = toDateKey(new Date())
    if (!isDateBookable(dateKey, todayKey, MAX_ADVANCE_DAYS)) return []
    const dow = new Date(`${dateKey}T00:00:00`).getDay()
    const exception = page.scheduleExceptions.find((e) => e.date === dateKey)
    const dayHours = page.businessHours.find((h) => h.dayOfWeek === dow)
    const openMinute = exception ? (exception.isClosed ? null : timeStringToMinute(exception.openTime!)) : dayHours?.isOpen ? timeStringToMinute(dayHours.openTime!) : null
    const closeMinute = exception ? (exception.isClosed ? null : timeStringToMinute(exception.closeTime!)) : dayHours?.isOpen ? timeStringToMinute(dayHours.closeTime!) : null
    return availableSlotsForDay({
      bayIds: page.bayIds,
      openMinute,
      closeMinute,
      durationMinutes: totalMinutes,
      busy: page.busyBlocks
        .filter((b) => toDateKey(new Date(b.startsAt)) === dateKey)
        .map((b) => ({ bayId: b.bayId, startMinute: minutesSinceMidnight(b.startsAt), endMinute: minutesSinceMidnight(b.endsAt) })),
      nowMinuteIfToday: dateKey === todayKey ? minutesSinceMidnight(new Date().toISOString()) : null,
      slotIntervalMinutes: 30,
      leadTimeMinutes: 60,
    })
  }, [page, totalMinutes, dateKey])

  const startTimeOptions = Array.from(new Set(slots.map((s) => s.startMinute))).sort((a, b) => a - b)

  const skipContactStep = Boolean(quoteToken)

  const book = async () => {
    if (!api) return
    setError(null)
    if (selectedServiceIds.length === 0) {
      setError('Pick what you need done.')
      return
    }
    if (!startTime) {
      setError('Pick a time.')
      return
    }
    if (!skipContactStep) {
      if (!firstName.trim()) {
        setError('Enter your name.')
        return
      }
      if (!email.trim() && !phone.trim()) {
        setError('Enter your email or phone number.')
        return
      }
    }
    setSubmitting(true)
    try {
      const startsAt = new Date(`${dateKey}T${startTime}:00`).toISOString()
      const result = await api.bookAppointment({
        serviceIds: selectedServiceIds,
        startsAt,
        bodyStyle: bodyStyle || null,
        customerFirstName: firstName,
        customerLastName: lastName || null,
        customerEmail: email || null,
        customerPhone: phone || null,
        sourceQuotePublicToken: quoteToken,
        notes: null,
      })
      navigate(`/booking/${result.publicToken}`, { replace: true })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not book that time. Please try another.')
    } finally {
      setSubmitting(false)
    }
  }

  if (state === 'loading') return <LoadingBlock label="Loading…" />
  if (state === 'missing') {
    return <CenteredNote title="Not found" body="This booking link isn't valid. Please contact the shop directly." />
  }
  if (state === 'error' || !page) {
    return <CenteredNote title="Something went wrong" body="We couldn't load booking right now. Please try again or call the shop." />
  }

  const color = page.shopPrimaryColor || '#1d4ed8'

  if (services.length === 0 || page.bayIds.length === 0) {
    return (
      <CenteredNote
        title="Booking isn't set up yet"
        body={`${page.shopName} hasn't turned on online booking yet. Give them a call at ${page.shopPhone} to schedule.`}
      />
    )
  }

  return (
    <div className="min-h-screen bg-zinc-50 pb-16">
      <header className="border-b-4 bg-white px-4 py-5" style={{ borderBottomColor: color }}>
        <div className="mx-auto max-w-lg">
          <Logo className="text-xl" />
          <h1 className="mt-3 text-2xl font-black text-ink">{page.shopName}</h1>
          <p className="mt-1 flex items-center gap-1.5 text-sm text-zinc-500">
            <MapPin className="h-4 w-4 shrink-0" aria-hidden="true" /> {page.shopAddress}
          </p>
        </div>
      </header>

      <div className="mx-auto max-w-lg space-y-5 px-4 py-6">
        {quoteFirstName ? (
          <p className="text-base text-zinc-600">Hi {quoteFirstName} — let's get you on the schedule.</p>
        ) : null}

        <div>
          <p className="mb-2 text-base font-bold text-ink">What do you need?</p>
          <div className="flex flex-wrap gap-2">
            {services.map((s) => {
              const active = selectedServiceIds.includes(s.id)
              return (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => setSelectedServiceIds((prev) => (active ? prev.filter((id) => id !== s.id) : [...prev, s.id]))}
                  className="rounded-2xl border-2 px-4 py-3 text-left text-base font-semibold"
                  style={active ? { borderColor: color, backgroundColor: `${color}14`, color: '#18181b' } : { borderColor: '#e4e4e7', color: '#3f3f46' }}
                >
                  {s.name}
                  {/* Explicit space, not just the margin class — the margin is visual only,
                     and without a real text-node space the accessible name reads
                     "Window Tint$250" with nothing between them. */}
                  {s.priceCents !== null ? <span className="ml-2 text-sm font-normal text-zinc-500"> {formatCurrency(s.priceCents)}</span> : null}
                </button>
              )
            })}
          </div>
        </div>

        {usesTint ? (
          <Field label="Your vehicle" htmlFor="bk-body-style">
            <Select id="bk-body-style" value={bodyStyle} onChange={(e) => setBodyStyle(e.target.value as TintBodyStyle)}>
              <option value="">Standard</option>
              {BODY_STYLE_ORDER.map((b) => (
                <option key={b} value={b}>
                  {BODY_STYLE_INFO[b].label}
                </option>
              ))}
            </Select>
          </Field>
        ) : null}

        {totalMinutes > 0 ? (
          <div>
            <p className="mb-2 text-base font-bold text-ink">Pick a day</p>
            <div className="flex gap-2 overflow-x-auto pb-2">
              {dateOptions.map((d) => {
                const active = d === dateKey
                const label = new Date(`${d}T00:00:00`).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })
                return (
                  <button
                    key={d}
                    type="button"
                    onClick={() => {
                      setDateKey(d)
                      setStartTime('')
                    }}
                    className="shrink-0 rounded-xl border-2 px-3 py-2 text-sm font-semibold"
                    style={active ? { borderColor: color, backgroundColor: `${color}14` } : { borderColor: '#e4e4e7', color: '#3f3f46' }}
                  >
                    {label}
                  </button>
                )
              })}
            </div>

            {startTimeOptions.length === 0 ? (
              <p className="mt-2 text-sm text-zinc-500">Nothing open this day — try another.</p>
            ) : (
              <div className="mt-2 grid grid-cols-3 gap-2">
                {startTimeOptions.map((m) => {
                  const t = minuteToTimeString(m)
                  const active = t === startTime
                  return (
                    <button
                      key={m}
                      type="button"
                      onClick={() => setStartTime(t)}
                      className="rounded-xl border-2 py-2.5 text-sm font-semibold"
                      style={active ? { borderColor: color, backgroundColor: color, color: '#fff' } : { borderColor: '#e4e4e7', color: '#3f3f46' }}
                    >
                      {t}
                    </button>
                  )
                })}
              </div>
            )}
          </div>
        ) : null}

        {!skipContactStep && startTime ? (
          <div className="space-y-3">
            <p className="text-base font-bold text-ink">Your info</p>
            <div className="grid grid-cols-2 gap-3">
              <Input value={firstName} onChange={(e) => setFirstName(e.target.value)} placeholder="First name" />
              <Input value={lastName} onChange={(e) => setLastName(e.target.value)} placeholder="Last name" />
            </div>
            <Input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Phone" />
            <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email" />
          </div>
        ) : null}

        {page.bookingDepositCents ? (
          <p className="text-sm text-zinc-500">
            <Phone className="mr-1 inline h-4 w-4" aria-hidden="true" />A {formatCurrency(page.bookingDepositCents)} deposit holds your slot.
          </p>
        ) : null}

        {error ? (
          <p role="alert" className="text-base font-medium text-red-700">
            {error}
          </p>
        ) : null}

        {startTime ? (
          <Button className="w-full" style={{ backgroundColor: color }} disabled={submitting} onClick={() => void book()}>
            <Check className="h-5 w-5" aria-hidden="true" />
            {submitting ? 'Booking…' : 'Confirm booking'}
          </Button>
        ) : null}
      </div>
    </div>
  )
}

function CenteredNote({ title, body }: { title: string; body: string }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-50 px-4">
      <div className="max-w-sm text-center">
        <Logo className="mx-auto text-2xl" />
        <h1 className="mt-4 text-xl font-bold text-ink">{title}</h1>
        <p className="mt-2 text-base text-zinc-600">{body}</p>
      </div>
    </div>
  )
}
