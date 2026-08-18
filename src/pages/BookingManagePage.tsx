// Public "manage my appointment" page — /booking/:publicToken. Reached
// right after booking, and from the confirmation email. Self-reschedule
// lands in Phase 5 (docs/MVP_PLAN.md §5 Slice 2); this ships confirm +
// cancel + (once Phase 4 lands) pay-deposit.

import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { Calendar, Check, MapPin, Phone, X } from 'lucide-react'
import { resolvePublicAppointmentApi, type PublicAppointmentApi } from '../data/publicBooking'
import { Button, LoadingBlock, Logo } from '../components/ui'
import { formatCurrency } from '../lib/format'
import type { PublicAppointment } from '../types'

const STATUS_LABEL: Record<PublicAppointment['status'], string> = {
  confirmed: "You're all set",
  awaiting_deposit: 'Almost set — deposit needed',
  cancelled: 'Cancelled',
  completed: 'Completed',
  no_show: 'Marked as a no-show',
}

export default function BookingManagePage() {
  const { publicToken = '' } = useParams<{ publicToken: string }>()
  const [state, setState] = useState<'loading' | 'ready' | 'missing' | 'error'>('loading')
  const [api, setApi] = useState<PublicAppointmentApi | null>(null)
  const [appt, setAppt] = useState<PublicAppointment | null>(null)
  const [busy, setBusy] = useState(false)
  const [confirmingCancel, setConfirmingCancel] = useState(false)

  const load = async (resolved: PublicAppointmentApi) => {
    const data = await resolved.get()
    if (!data) {
      setState('missing')
      return
    }
    setAppt(data)
    setState('ready')
  }

  useEffect(() => {
    ;(async () => {
      try {
        const resolved = await resolvePublicAppointmentApi(publicToken)
        if (!resolved) {
          setState('missing')
          return
        }
        setApi(resolved)
        await load(resolved)
      } catch {
        setState('error')
      }
    })()
  }, [publicToken])

  const cancel = async () => {
    if (!api) return
    setBusy(true)
    try {
      await api.cancel()
      await load(api)
      setConfirmingCancel(false)
    } catch {
      setState('error')
    } finally {
      setBusy(false)
    }
  }

  const fakePayDeposit = async () => {
    if (!api?.fakePayDeposit) return
    setBusy(true)
    try {
      await api.fakePayDeposit()
      await load(api)
    } finally {
      setBusy(false)
    }
  }

  if (state === 'loading') return <LoadingBlock label="Loading…" />
  if (state === 'missing' || !appt) {
    return <CenteredNote title="Not found" body="This booking link isn't valid anymore. Please contact the shop." />
  }
  if (state === 'error') {
    return <CenteredNote title="Something went wrong" body="We couldn't load this right now. Please try again in a minute." />
  }

  const color = appt.shopPrimaryColor || '#1d4ed8'
  const start = new Date(appt.startsAt)
  const end = new Date(appt.endsAt)

  return (
    <div className="min-h-screen bg-zinc-50 pb-16">
      <header className="border-b-4 bg-white px-4 py-5" style={{ borderBottomColor: color }}>
        <div className="mx-auto max-w-lg">
          <Logo className="text-xl" />
          <h1 className="mt-3 text-2xl font-black text-ink">{appt.shopName}</h1>
        </div>
      </header>

      <div className="mx-auto max-w-lg space-y-5 px-4 py-6">
        <div className="rounded-2xl border border-zinc-200 bg-white p-5">
          <p className="text-lg font-black text-ink">{STATUS_LABEL[appt.status]}</p>
          <p className="mt-2 flex items-center gap-2 text-base text-zinc-700">
            <Calendar className="h-5 w-5 shrink-0 text-zinc-400" aria-hidden="true" />
            {start.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}
            {' · '}
            {start.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}
            {' – '}
            {end.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}
          </p>
          <p className="mt-1 text-base text-zinc-600">{appt.services.map((s) => s.name).join(', ')}</p>
          <p className="mt-2 flex items-center gap-2 text-sm text-zinc-500">
            <MapPin className="h-4 w-4 shrink-0" aria-hidden="true" /> {appt.shopAddress}
          </p>
        </div>

        {appt.status === 'awaiting_deposit' ? (
          <div className="rounded-2xl border border-amber-300 bg-amber-50 p-5">
            <p className="text-base font-bold text-amber-900">
              A {formatCurrency(appt.depositAmountCents ?? 0)} deposit holds this slot.
            </p>
            {api?.fakePayDeposit ? (
              // Demo mode only — production's real "Pay deposit" button (a
              // Stripe Checkout redirect) lands in Phase 4. This exists so
              // the demo/sales pitch can show the whole flow end to end
              // before Stripe is wired up.
              <Button className="mt-3 w-full" disabled={busy} onClick={() => void fakePayDeposit()}>
                {busy ? 'Working…' : `Pay ${formatCurrency(appt.depositAmountCents ?? 0)} (demo)`}
              </Button>
            ) : (
              <p className="mt-2 text-sm text-amber-800">
                Call <a href={`tel:${appt.shopPhone}`} className="font-semibold underline">{appt.shopPhone}</a> to pay your
                deposit and lock in this time — online payment is coming soon.
              </p>
            )}
          </div>
        ) : null}

        {appt.status === 'confirmed' || appt.status === 'awaiting_deposit' ? (
          confirmingCancel ? (
            <div className="rounded-2xl border border-zinc-200 bg-white p-5">
              <p className="text-base font-semibold text-ink">Cancel this appointment?</p>
              <div className="mt-3 flex gap-2">
                <Button variant="secondary" className="flex-1" onClick={() => setConfirmingCancel(false)}>
                  Keep it
                </Button>
                <Button variant="danger" className="flex-1" disabled={busy} onClick={() => void cancel()}>
                  {busy ? 'Cancelling…' : 'Cancel it'}
                </Button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmingCancel(true)}
              className="flex w-full items-center justify-center gap-2 rounded-xl border-2 border-zinc-200 py-3 text-base font-semibold text-zinc-500"
            >
              <X className="h-4 w-4" aria-hidden="true" /> Cancel this appointment
            </button>
          )
        ) : null}

        <a
          href={`tel:${appt.shopPhone}`}
          className="flex w-full items-center justify-center gap-2 rounded-xl border-2 py-3 text-base font-bold"
          style={{ borderColor: color, color }}
        >
          <Phone className="h-5 w-5" aria-hidden="true" /> Call the shop
        </a>

        {appt.status === 'confirmed' ? (
          <p className="flex items-center justify-center gap-1.5 text-center text-sm text-green-700">
            <Check className="h-4 w-4" aria-hidden="true" /> You're on the schedule.
          </p>
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
