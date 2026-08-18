// Settings → Booking: services, bays, weekly hours, one-off exceptions, and
// the self-serve deposit amount. Kept as its own file, imported into
// SettingsPage with a single <BookingSettingsSection /> line — that page is
// already a conflict magnet across parallel work, so new sections land here
// instead of growing it further.

import { useEffect, useState } from 'react'
import { CalendarOff, Clock, DoorOpen, Pencil, Plus, Trash2, Wrench } from 'lucide-react'
import { useAppData, useRepo } from '../data/AppDataContext'
import { useToast } from './Toast'
import { Button, Card, EmptyState, Field, Input, LoadingBlock, Modal, Select, Textarea } from './ui'
import { errorMessage } from '../lib/errors'
import { formatCurrency, parseDollarsToCents } from '../lib/format'
import { BODY_STYLE_INFO, BODY_STYLE_ORDER } from '../lib/windowTint'
import type { Bay, BusinessHoursDay, Service, ServiceDurationOverride, ScheduleException } from '../types'

const DAY_LABELS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

export function BookingSettingsSection() {
  return (
    <Card className="space-y-6">
      <div>
        <h2 className="text-xl font-bold text-ink">Booking</h2>
        <p className="text-base text-zinc-600">
          What customers can book, how many jobs you can run at once, and when you're open.
        </p>
      </div>
      <DepositSection />
      <ServicesSubsection />
      <BaysSubsection />
      <HoursSubsection />
      <ExceptionsSubsection />
    </Card>
  )
}

function DepositSection() {
  const { shop, refresh } = useAppData()
  const repo = useRepo()
  const toast = useToast()
  const [value, setValue] = useState(shop?.bookingDepositCents ? (shop.bookingDepositCents / 100).toString() : '')
  const [saving, setSaving] = useState(false)

  const save = async () => {
    const cents = value.trim() ? parseDollarsToCents(value) : 0
    if (value.trim() && cents === null) {
      toast('error', 'Enter a valid dollar amount.')
      return
    }
    setSaving(true)
    try {
      await repo.updateShop({ bookingDepositCents: cents || null })
      await refresh()
      toast('success', 'Deposit setting saved.')
    } catch (err) {
      const detail = errorMessage(err)
      toast('error', detail ? `Could not save: ${detail}` : 'Could not save. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="border-b border-zinc-100 pb-6">
      <Field
        label="Self-serve booking deposit"
        htmlFor="bk-deposit"
        hint="A customer booking online (not on the phone) has to pay this to hold the slot. Leave blank for no deposit required. Doesn't apply when you book someone yourself."
      >
        <div className="flex gap-2">
          <Input
            id="bk-deposit"
            inputMode="decimal"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="$20"
            className="max-w-40"
          />
          <Button variant="secondary" onClick={() => void save()} disabled={saving}>
            {saving ? 'Saving…' : 'Save'}
          </Button>
        </div>
      </Field>
    </div>
  )
}

function ServicesSubsection() {
  const repo = useRepo()
  const toast = useToast()
  const [services, setServices] = useState<Service[] | null>(null)
  const [editing, setEditing] = useState<Service | 'new' | null>(null)

  const load = async () => setServices(await repo.listServices())
  useEffect(() => {
    void load()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const onDelete = async (service: Service) => {
    try {
      await repo.deleteService(service.id)
      await load()
      toast('success', 'Service removed.')
    } catch (err) {
      const detail = errorMessage(err)
      toast('error', detail ? `Could not remove that service: ${detail}` : 'Could not remove that service.')
    }
  }

  return (
    <div className="border-b border-zinc-100 pb-6">
      <div className="flex items-center justify-between">
        <h3 className="flex items-center gap-2 text-base font-bold text-ink">
          <Wrench className="h-4 w-4 text-zinc-400" aria-hidden="true" /> Services
        </h3>
        <Button variant="secondary" onClick={() => setEditing('new')}>
          <Plus className="h-4 w-4" aria-hidden="true" /> Add
        </Button>
      </div>
      {services === null ? (
        <LoadingBlock label="Loading services…" />
      ) : services.length === 0 ? (
        <EmptyState title="No services yet" message="Add what you can book — a system install, a tint job." />
      ) : (
        <ul className="mt-2 divide-y divide-zinc-100">
          {services.map((s) => (
            <li key={s.id} className="flex items-center justify-between gap-3 py-2.5">
              <div>
                <p className="text-base font-semibold text-ink">{s.name}</p>
                <p className="text-sm text-zinc-500">
                  {s.durationMinutes} min
                  {s.priceCents !== null ? ` · ${formatCurrency(s.priceCents)}` : ''}
                  {s.durationOverrides.length > 0 ? ` · ${s.durationOverrides.length} vehicle overrides` : ''}
                </p>
              </div>
              <div className="flex shrink-0 gap-1">
                <button
                  type="button"
                  aria-label={`Edit ${s.name}`}
                  onClick={() => setEditing(s)}
                  className="flex h-10 w-10 items-center justify-center rounded-xl text-zinc-500 hover:bg-zinc-100"
                >
                  <Pencil className="h-4 w-4" aria-hidden="true" />
                </button>
                <button
                  type="button"
                  aria-label={`Remove ${s.name}`}
                  onClick={() => void onDelete(s)}
                  className="flex h-10 w-10 items-center justify-center rounded-xl text-zinc-400 hover:bg-red-50 hover:text-red-600"
                >
                  <Trash2 className="h-4 w-4" aria-hidden="true" />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
      <Modal open={editing !== null} onClose={() => setEditing(null)} title={editing === 'new' ? 'Add service' : 'Edit service'}>
        {editing !== null ? (
          <ServiceForm
            service={editing === 'new' ? null : editing}
            onSaved={async () => {
              setEditing(null)
              await load()
            }}
          />
        ) : null}
      </Modal>
    </div>
  )
}

function ServiceForm({ service, onSaved }: { service: Service | null; onSaved: () => void }) {
  const repo = useRepo()
  const toast = useToast()
  const [name, setName] = useState(service?.name ?? '')
  const [description, setDescription] = useState(service?.description ?? '')
  const [duration, setDuration] = useState(service?.durationMinutes.toString() ?? '90')
  const [price, setPrice] = useState(service?.priceCents !== null && service?.priceCents !== undefined ? (service.priceCents / 100).toString() : '')
  const [overrides, setOverrides] = useState<ServiceDurationOverride[]>(service?.durationOverrides ?? [])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const usedStyles = new Set(overrides.map((o) => o.bodyStyle))
  const availableStyles = BODY_STYLE_ORDER.filter((s) => !usedStyles.has(s))

  const save = async () => {
    setError(null)
    const durationMinutes = parseInt(duration, 10)
    if (!name.trim()) {
      setError('Give this service a name.')
      return
    }
    if (!Number.isFinite(durationMinutes) || durationMinutes <= 0) {
      setError('Enter how many minutes this usually takes.')
      return
    }
    const priceCents = price.trim() ? parseDollarsToCents(price) : null
    if (price.trim() && priceCents === null) {
      setError('Enter a valid dollar amount.')
      return
    }
    setSaving(true)
    try {
      await repo.saveService(service?.id ?? null, {
        name: name.trim(),
        description: description.trim() || null,
        durationMinutes,
        priceCents,
        durationOverrides: overrides,
      })
      toast('success', 'Service saved.')
      onSaved()
    } catch (err) {
      const detail = errorMessage(err)
      setError(detail ? `Could not save: ${detail}` : 'Could not save. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-4">
      <Field label="Name" htmlFor="svc-name" required>
        <Input id="svc-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Window Tint" />
      </Field>
      <Field label="Details" htmlFor="svc-desc">
        <Textarea id="svc-desc" rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
      </Field>
      <div className="grid grid-cols-2 gap-4">
        <Field label="Usual duration (minutes)" htmlFor="svc-duration" required>
          <Input id="svc-duration" type="number" inputMode="numeric" min={1} value={duration} onChange={(e) => setDuration(e.target.value)} />
        </Field>
        <Field label="Price" htmlFor="svc-price" hint="Optional">
          <Input id="svc-price" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} placeholder="$250" />
        </Field>
      </div>

      <div>
        <p className="text-base font-semibold text-ink">Takes longer for certain vehicles?</p>
        <p className="text-sm text-zinc-500">Optional — only add one if a body style genuinely needs more time.</p>
        <ul className="mt-2 space-y-2">
          {overrides.map((o) => (
            <li key={o.bodyStyle} className="flex items-center gap-2">
              <span className="flex-1 text-sm font-medium text-ink">{BODY_STYLE_INFO[o.bodyStyle].label}</span>
              <Input
                type="number"
                inputMode="numeric"
                className="w-24"
                value={o.durationMinutes}
                onChange={(e) =>
                  setOverrides((prev) =>
                    prev.map((x) => (x.bodyStyle === o.bodyStyle ? { ...x, durationMinutes: Number(e.target.value) || 0 } : x)),
                  )
                }
              />
              <button
                type="button"
                aria-label={`Remove override for ${BODY_STYLE_INFO[o.bodyStyle].label}`}
                onClick={() => setOverrides((prev) => prev.filter((x) => x.bodyStyle !== o.bodyStyle))}
                className="flex h-9 w-9 items-center justify-center rounded-xl text-zinc-400 hover:bg-red-50 hover:text-red-600"
              >
                <Trash2 className="h-4 w-4" aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
        {availableStyles.length > 0 ? (
          <Select
            className="mt-2"
            value=""
            onChange={(e) => {
              const bodyStyle = e.target.value as ServiceDurationOverride['bodyStyle']
              if (!bodyStyle) return
              // Seeds the override with the service's own base duration — a
              // sensible starting point the owner then adjusts up or down.
              const baseDuration = parseInt(duration, 10) || 0
              setOverrides((prev) => [...prev, { bodyStyle, durationMinutes: baseDuration }])
            }}
          >
            <option value="">+ Add a vehicle override…</option>
            {availableStyles.map((s) => (
              <option key={s} value={s}>
                {BODY_STYLE_INFO[s].label}
              </option>
            ))}
          </Select>
        ) : null}
      </div>

      {error ? (
        <p role="alert" className="text-base font-medium text-red-700">
          {error}
        </p>
      ) : null}
      <Button className="w-full" disabled={saving} onClick={() => void save()}>
        {saving ? 'Saving…' : 'Save service'}
      </Button>
    </div>
  )
}

function BaysSubsection() {
  const repo = useRepo()
  const toast = useToast()
  const [bays, setBays] = useState<Bay[] | null>(null)
  const [adding, setAdding] = useState(false)
  const [name, setName] = useState('')

  const load = async () => setBays(await repo.listBays())
  useEffect(() => {
    void load()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const addBay = async () => {
    if (!name.trim()) return
    try {
      await repo.saveBay(null, name.trim())
      setName('')
      setAdding(false)
      await load()
    } catch (err) {
      const detail = errorMessage(err)
      toast('error', detail ? `Could not add that bay: ${detail}` : 'Could not add that bay.')
    }
  }

  const removeBay = async (bay: Bay) => {
    try {
      await repo.deleteBay(bay.id)
      await load()
    } catch (err) {
      const detail = errorMessage(err)
      toast('error', detail ? `Could not remove that bay: ${detail}` : 'Could not remove that bay.')
    }
  }

  return (
    <div className="border-b border-zinc-100 pb-6">
      <h3 className="flex items-center gap-2 text-base font-bold text-ink">
        <DoorOpen className="h-4 w-4 text-zinc-400" aria-hidden="true" /> Bays
      </h3>
      <p className="text-sm text-zinc-500">How many jobs you can run at once — not how many people work here.</p>
      {bays === null ? (
        <LoadingBlock label="Loading bays…" />
      ) : (
        <ul className="mt-2 space-y-1.5">
          {bays.map((b) => (
            <li key={b.id} className="flex items-center justify-between gap-2 rounded-xl border border-zinc-200 px-3 py-2">
              <span className="text-base font-medium text-ink">{b.name}</span>
              <button
                type="button"
                aria-label={`Remove ${b.name}`}
                onClick={() => void removeBay(b)}
                className="flex h-8 w-8 items-center justify-center rounded-lg text-zinc-400 hover:bg-red-50 hover:text-red-600"
              >
                <Trash2 className="h-4 w-4" aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      )}
      {adding ? (
        <div className="mt-2 flex gap-2">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Bay 3" autoFocus />
          <Button onClick={() => void addBay()}>Add</Button>
        </div>
      ) : (
        <Button variant="secondary" className="mt-2" onClick={() => setAdding(true)}>
          <Plus className="h-4 w-4" aria-hidden="true" /> Add a bay
        </Button>
      )}
    </div>
  )
}

function HoursSubsection() {
  const repo = useRepo()
  const toast = useToast()
  const [hours, setHours] = useState<BusinessHoursDay[] | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    void repo.listBusinessHours().then(setHours)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const save = async () => {
    if (!hours) return
    setSaving(true)
    try {
      const saved = await repo.saveBusinessHours(hours)
      setHours(saved)
      toast('success', 'Hours saved.')
    } catch (err) {
      const detail = errorMessage(err)
      toast('error', detail ? `Could not save hours: ${detail}` : 'Could not save hours.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="border-b border-zinc-100 pb-6">
      <h3 className="flex items-center gap-2 text-base font-bold text-ink">
        <Clock className="h-4 w-4 text-zinc-400" aria-hidden="true" /> Hours
      </h3>
      {hours === null ? (
        <LoadingBlock label="Loading hours…" />
      ) : (
        <div className="mt-2 space-y-2">
          {hours.map((h) => (
            <div key={h.dayOfWeek} className="flex items-center gap-3">
              <label className="flex w-28 shrink-0 items-center gap-2 text-sm font-medium text-ink">
                <input
                  type="checkbox"
                  checked={h.isOpen}
                  onChange={(e) =>
                    setHours((prev) =>
                      prev!.map((x) =>
                        x.dayOfWeek === h.dayOfWeek
                          ? { ...x, isOpen: e.target.checked, openTime: e.target.checked ? (x.openTime ?? '09:00') : null, closeTime: e.target.checked ? (x.closeTime ?? '18:00') : null }
                          : x,
                      ),
                    )
                  }
                />
                {DAY_LABELS[h.dayOfWeek]}
              </label>
              {h.isOpen ? (
                <>
                  <Input
                    type="time"
                    className="max-w-32"
                    value={h.openTime ?? ''}
                    onChange={(e) => setHours((prev) => prev!.map((x) => (x.dayOfWeek === h.dayOfWeek ? { ...x, openTime: e.target.value } : x)))}
                  />
                  <span className="text-sm text-zinc-400">to</span>
                  <Input
                    type="time"
                    className="max-w-32"
                    value={h.closeTime ?? ''}
                    onChange={(e) => setHours((prev) => prev!.map((x) => (x.dayOfWeek === h.dayOfWeek ? { ...x, closeTime: e.target.value } : x)))}
                  />
                </>
              ) : (
                <span className="text-sm text-zinc-400">Closed</span>
              )}
            </div>
          ))}
          <Button disabled={saving} onClick={() => void save()}>
            {saving ? 'Saving…' : 'Save hours'}
          </Button>
        </div>
      )}
    </div>
  )
}

function ExceptionsSubsection() {
  const repo = useRepo()
  const toast = useToast()
  const [exceptions, setExceptions] = useState<ScheduleException[] | null>(null)
  const [adding, setAdding] = useState(false)
  const [date, setDate] = useState('')
  const [note, setNote] = useState('')

  const load = async () => setExceptions(await repo.listScheduleExceptions())
  useEffect(() => {
    void load()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const addException = async () => {
    if (!date) return
    try {
      await repo.saveScheduleException(null, { date, isClosed: true, openTime: null, closeTime: null, note: note.trim() || null })
      setDate('')
      setNote('')
      setAdding(false)
      await load()
    } catch (err) {
      const detail = errorMessage(err)
      toast('error', detail ? `Could not add that closure: ${detail}` : 'Could not add that closure.')
    }
  }

  const removeException = async (ex: ScheduleException) => {
    try {
      await repo.deleteScheduleException(ex.id)
      await load()
    } catch (err) {
      const detail = errorMessage(err)
      toast('error', detail ? `Could not remove that: ${detail}` : 'Could not remove that.')
    }
  }

  return (
    <div>
      <h3 className="flex items-center gap-2 text-base font-bold text-ink">
        <CalendarOff className="h-4 w-4 text-zinc-400" aria-hidden="true" /> Closed dates
      </h3>
      <p className="text-sm text-zinc-500">Holidays or one-off closures — these override your regular hours.</p>
      {exceptions === null ? (
        <LoadingBlock label="Loading…" />
      ) : exceptions.length > 0 ? (
        <ul className="mt-2 space-y-1.5">
          {exceptions.map((ex) => (
            <li key={ex.id} className="flex items-center justify-between gap-2 rounded-xl border border-zinc-200 px-3 py-2">
              <span className="text-base font-medium text-ink">
                {ex.date}
                {ex.note ? ` — ${ex.note}` : ''}
              </span>
              <button
                type="button"
                aria-label={`Remove closure on ${ex.date}`}
                onClick={() => void removeException(ex)}
                className="flex h-8 w-8 items-center justify-center rounded-lg text-zinc-400 hover:bg-red-50 hover:text-red-600"
              >
                <Trash2 className="h-4 w-4" aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {adding ? (
        <div className="mt-2 flex flex-wrap gap-2">
          <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="max-w-44" />
          <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Christmas Day" className="max-w-48" />
          <Button onClick={() => void addException()}>Add</Button>
        </div>
      ) : (
        <Button variant="secondary" className="mt-2" onClick={() => setAdding(true)}>
          <Plus className="h-4 w-4" aria-hidden="true" /> Add a closed date
        </Button>
      )}
    </div>
  )
}
