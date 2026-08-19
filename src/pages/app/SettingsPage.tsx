import { Suspense, lazy, useCallback, useEffect, useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { CreditCard, Download, KeyRound, LayoutGrid, Package, Pencil, Plus, QrCode, RotateCcw, Smartphone, Trash2 } from 'lucide-react'
import { useAppData, useRepo } from '../../data/AppDataContext'
import { useToast } from '../../components/Toast'
import { Button, Card, EmptyState, Field, Input, LoadingBlock, Modal, Select, Textarea } from '../../components/ui'
import CatalogOrganizer from '../../components/CatalogOrganizer'
import { ProductSuggestField } from '../../components/ProductSuggestField'
import { LogoUploadField } from '../../components/LogoUploadField'
import { BookingSettingsSection } from '../../components/BookingSettingsSection'
import { errorMessage } from '../../lib/errors'
import { formatCurrency, formatDateTime, parseDollarsToCents } from '../../lib/format'
import {
  COMMON_FINANCING_PROVIDERS,
  MAX_FINANCING_OFFERS,
  guessProviderName,
  makeFinancingOffer,
  parseScannedFinancingCode,
} from '../../lib/financing'
import { PRODUCT_CATEGORIES, PRODUCT_CATEGORY_INFO } from '../../lib/audioConfigs'
import type { CatalogItem, FinancingOffer, InventoryDevice, ProductCategory } from '../../types'
import type { NewCatalogItemInput, ShopifyImportResult } from '../../data/repository'
import { formatItemDisplayName } from '../../lib/productNaming'

const schema = z.object({
    name: z.string().min(2, 'Enter your shop name'),
    phone: z.string().min(7, 'Enter the shop phone number'),
    email: z.string().email('Enter a valid shop email'),
    replyToEmail: z.string().email('Enter a valid reply-to email'),
    address: z.string().min(5, 'Enter the shop street address'),
    website: z.string().url('Enter a full URL (https://…)').or(z.literal('')),
    logoUrl: z.string().url('Enter a full image URL').or(z.literal('')),
    primaryColor: z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Pick a color'),
    quoteExpirationDays: z.coerce.number().int().min(1, 'At least 1 day').max(365, 'No more than a year'),
    followUpSchedule: z
      .string()
      .regex(/^\d+(\s*,\s*\d+)*$/, 'Use numbers separated by commas, like 2, 3, 5'),
    quoteDisclaimer: z.string().min(10, 'A short disclaimer is required'),
    autoFollowUpEnabled: z.boolean(),
  })

type FormValues = z.infer<typeof schema>

export default function SettingsPage() {
  const { shop, mode, refresh, resetDemo } = useAppData()
  const repo = useRepo()
  const toast = useToast()
  const [catalogReloadSignal, setCatalogReloadSignal] = useState(0)

  const {
    register,
    handleSubmit,
    reset,
    setValue,
    watch,
    formState: { errors, isSubmitting, isDirty },
  } = useForm<FormValues>({ resolver: zodResolver(schema) })


  useEffect(() => {
    if (shop) {
      reset({
        name: shop.name,
        phone: shop.phone,
        email: shop.email,
        replyToEmail: shop.replyToEmail,
        address: shop.address,
        website: shop.website ?? '',
        logoUrl: shop.logoUrl ?? '',
        primaryColor: shop.primaryColor,
        quoteExpirationDays: shop.quoteExpirationDays,
        followUpSchedule: shop.followUpScheduleDays.join(', '),
        autoFollowUpEnabled: shop.autoFollowUpEnabled,
        quoteDisclaimer: shop.quoteDisclaimer,
      })
    }
  }, [shop, reset])

  if (!shop) return <LoadingBlock label="Loading settings…" />

  const onSubmit = async (values: FormValues) => {
    try {
      await repo.updateShop({
        name: values.name,
        phone: values.phone,
        email: values.email,
        replyToEmail: values.replyToEmail,
        address: values.address,
        website: values.website || null,
        logoUrl: values.logoUrl || null,
        primaryColor: values.primaryColor,
        quoteExpirationDays: values.quoteExpirationDays,
        followUpScheduleDays: values.followUpSchedule.split(',').map((n) => parseInt(n.trim(), 10)),
        autoFollowUpEnabled: values.autoFollowUpEnabled,
        quoteDisclaimer: values.quoteDisclaimer,
      })
      await refresh()
      toast('success', 'Settings saved.')
    } catch (err) {
      console.error('updateShop failed', err)
      const detail = errorMessage(err)
      toast('error', detail ? `Could not save settings: ${detail}` : 'Could not save settings. Please try again.')
    }
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="text-3xl font-black text-ink">Settings</h1>
        <p className="mt-1 text-base text-zinc-600">This is what customers see on quotes and in emails.</p>
      </div>

      <form onSubmit={handleSubmit(onSubmit)} noValidate>
        <Card className="space-y-4">
          <Field label="Shop name" htmlFor="s-name" error={errors.name?.message} required>
            <Input id="s-name" {...register('name')} />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Shop phone" htmlFor="s-phone" error={errors.phone?.message} required>
              <Input id="s-phone" type="tel" {...register('phone')} />
            </Field>
            <Field label="Shop email" htmlFor="s-email" error={errors.email?.message} required>
              <Input id="s-email" type="email" {...register('email')} />
            </Field>
          </div>
          <Field
            label="Reply-to email for quotes"
            htmlFor="s-reply"
            error={errors.replyToEmail?.message}
            hint="When customers reply to a quote email, it goes here."
            required
          >
            <Input id="s-reply" type="email" {...register('replyToEmail')} />
          </Field>
          <Field label="Street address" htmlFor="s-address" error={errors.address?.message} required>
            <Input id="s-address" {...register('address')} />
          </Field>
          <Field label="Website" htmlFor="s-website" error={errors.website?.message}>
            <Input id="s-website" type="url" {...register('website')} />
          </Field>
          <Field label="Logo" htmlFor="s-logo" error={errors.logoUrl?.message}>
            <LogoUploadField
              value={watch('logoUrl') || null}
              onChange={(url) => setValue('logoUrl', url ?? '', { shouldDirty: true, shouldValidate: true })}
            />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Brand color" htmlFor="s-color" error={errors.primaryColor?.message}>
              <Input id="s-color" type="color" className="h-14 w-24 p-1" {...register('primaryColor')} />
            </Field>
            <Field label="Quotes are good for (days)" htmlFor="s-exp" error={errors.quoteExpirationDays?.message}>
              <Input id="s-exp" type="number" inputMode="numeric" {...register('quoteExpirationDays')} />
            </Field>
          </div>
          <Field
            label="Follow-up rhythm (days between emails)"
            htmlFor="s-schedule"
            error={errors.followUpSchedule?.message}
            hint="Example: 2, 3, 5 = check in after 2 days, again 3 days later, again 5 days later."
          >
            <Input id="s-schedule" {...register('followUpSchedule')} />
          </Field>
          {/* The one switch that decides whether the app emails customers on
             its own. Worth its own explanatory line — it is the only place in
             the product that sends without a human. */}
          <label className="flex items-start gap-3 rounded-xl border border-zinc-200 p-4">
            <input
              type="checkbox"
              className="mt-1 h-5 w-5 shrink-0 accent-brand"
              {...register('autoFollowUpEnabled')}
            />
            <span>
              <span className="block text-base font-semibold text-ink">Send follow-ups automatically</span>
              <span className="mt-0.5 block text-sm text-zinc-600">
                Follow-up emails go out on schedule and stop the moment a customer replies, books, or opts out. Texts
                are never automatic.
              </span>
            </span>
          </label>
          <Field label="Quote disclaimer" htmlFor="s-disclaimer" error={errors.quoteDisclaimer?.message}>
            <Textarea id="s-disclaimer" rows={3} {...register('quoteDisclaimer')} />
          </Field>
          <Button type="submit" disabled={isSubmitting || !isDirty} className="w-full sm:w-auto">
            {isSubmitting ? 'Saving…' : 'Save settings'}
          </Button>
        </Card>
      </form>

      <BookingSettingsSection />

      <FinancingSection />

      {mode === 'production' ? <ShopifyImportSection onImported={() => setCatalogReloadSignal((n) => n + 1)} /> : null}

      <CatalogSection reloadSignal={catalogReloadSignal} />

      <SharedDeviceAccessSection />

      {mode === 'demo' ? (
        <Card className="space-y-3">
          <h2 className="text-xl font-bold text-ink">Demo data</h2>
          <p className="text-base text-zinc-600">
            Put the sample shop back exactly how it started. Any quotes or changes you made in the demo will be erased.
          </p>
          <Button
            variant="danger"
            onClick={() => {
              resetDemo()
              toast('success', 'Demo data has been reset.')
            }}
          >
            <RotateCcw className="h-5 w-5" aria-hidden="true" /> Reset demo data
          </Button>
        </Card>
      ) : null}
    </div>
  )
}

/**
 * The shop's third-party financing applications (Snap, Acima, …).
 *
 * The whole point of the QR scan is that these links are store-specific and
 * ugly — `snapfinance.com/apply/store/48812?ref=…`. Owners have that link as a
 * QR code on a counter card, not as text they can retype, so scanning is the
 * primary path and typing is the fallback, not the other way around.
 */
function FinancingSection() {
  const { shop, refresh } = useAppData()
  const repo = useRepo()
  const toast = useToast()
  const [editing, setEditing] = useState<FinancingOffer | 'new' | null>(null)
  const [removing, setRemoving] = useState<FinancingOffer | null>(null)
  const [saving, setSaving] = useState(false)

  const offers = shop?.financingOffers ?? []

  const save = async (next: FinancingOffer[], successMessage: string) => {
    setSaving(true)
    try {
      await repo.updateShop({ financingOffers: next })
      await refresh()
      toast('success', successMessage)
      return true
    } catch (err) {
      console.error('save financing offers failed', err)
      const detail = errorMessage(err)
      toast('error', detail ? `Could not save financing options: ${detail}` : 'Could not save financing options. Please try again.')
      return false
    } finally {
      setSaving(false)
    }
  }

  const onSubmitOffer = async (offer: FinancingOffer) => {
    const next =
      editing === 'new' ? [...offers, offer] : offers.map((o) => (o.id === offer.id ? offer : o))
    if (await save(next, editing === 'new' ? 'Financing option added.' : 'Financing option updated.')) {
      setEditing(null)
    }
  }

  const onRemove = async (offer: FinancingOffer) => {
    if (await save(offers.filter((o) => o.id !== offer.id), 'Financing option removed.')) {
      setRemoving(null)
    }
  }

  const atLimit = offers.length >= MAX_FINANCING_OFFERS

  return (
    <Card className="space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold text-ink">Financing options</h2>
          <p className="text-base text-zinc-600">
            Customers see these as buttons on every quote email and quote page, so they can apply the moment they see the
            price.
          </p>
        </div>
        <Button className="shrink-0" disabled={atLimit} onClick={() => setEditing('new')}>
          <Plus className="h-5 w-5" aria-hidden="true" /> Add
        </Button>
      </div>

      {offers.length === 0 ? (
        <EmptyState
          title="No financing options yet"
          message="Add Snap, Acima, or whoever you work with. Scan the QR code on their card and you're done."
        />
      ) : (
        <ul className="divide-y divide-zinc-100">
          {offers.map((offer) => (
            <li key={offer.id} className="flex items-center justify-between gap-3 py-3">
              <div className="flex min-w-0 items-center gap-3">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-50 text-emerald-700">
                  <CreditCard className="h-5 w-5" aria-hidden="true" />
                </span>
                <div className="min-w-0">
                  <p className="text-base font-bold text-ink">{offer.name}</p>
                  <p className="truncate text-sm text-zinc-500">{offer.applicationUrl}</p>
                </div>
              </div>
              <div className="flex shrink-0 gap-1">
                <button
                  type="button"
                  aria-label={`Edit ${offer.name}`}
                  onClick={() => setEditing(offer)}
                  className="flex h-11 w-11 items-center justify-center rounded-xl text-zinc-500 hover:bg-zinc-100"
                >
                  <Pencil className="h-5 w-5" aria-hidden="true" />
                </button>
                <button
                  type="button"
                  aria-label={`Remove ${offer.name}`}
                  onClick={() => setRemoving(offer)}
                  className="flex h-11 w-11 items-center justify-center rounded-xl text-zinc-400 hover:bg-red-50 hover:text-red-600"
                >
                  <Trash2 className="h-5 w-5" aria-hidden="true" />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {atLimit ? (
        <p className="text-sm text-zinc-500">
          That's the maximum of {MAX_FINANCING_OFFERS}. Remove one to add another.
        </p>
      ) : null}

      <Modal
        open={editing !== null}
        onClose={() => setEditing(null)}
        title={editing === 'new' ? 'Add financing option' : 'Edit financing option'}
      >
        {editing !== null ? (
          <FinancingOfferForm
            offer={editing === 'new' ? null : editing}
            saving={saving}
            onSubmit={onSubmitOffer}
          />
        ) : null}
      </Modal>

      <Modal open={removing !== null} onClose={() => setRemoving(null)} title="Remove financing option?">
        <p className="text-base text-zinc-600">
          {removing?.name} will stop appearing on new quote emails and quote pages. Quotes you already sent keep working.
        </p>
        <div className="mt-5 flex gap-3">
          <Button variant="secondary" className="flex-1" onClick={() => setRemoving(null)}>
            Keep it
          </Button>
          <Button
            variant="danger"
            className="flex-1"
            disabled={saving}
            onClick={() => removing && void onRemove(removing)}
          >
            {saving ? 'Removing…' : 'Remove'}
          </Button>
        </div>
      </Modal>
    </Card>
  )
}

// Owner/manager only, enforced server-side (rotate_staff_access_code /
// revoke_inventory_device both check is_shop_admin — see migration 0017);
// shown to every role here, same as the rest of this page, and any denial
// surfaces as a plain toast rather than a UI-level gate.
function SharedDeviceAccessSection() {
  const repo = useRepo()
  const { shop, refresh } = useAppData()
  const toast = useToast()
  const [devices, setDevices] = useState<InventoryDevice[] | null>(null)
  const [rotating, setRotating] = useState(false)
  const [newCode, setNewCode] = useState<string | null>(null)

  const load = useCallback(async () => {
    setDevices(await repo.listInventoryDevices())
  }, [repo])

  useEffect(() => {
    void load()
  }, [load])

  async function handleRotate() {
    if (
      shop?.hasStaffAccessCode &&
      !window.confirm('Generate a new code? Every phone/tablet/PC currently signed in with the old code will be signed out.')
    ) {
      return
    }
    setRotating(true)
    try {
      const code = await repo.rotateStaffAccessCode()
      setNewCode(code)
      await Promise.all([refresh(), load()])
    } catch (err) {
      console.error('rotateStaffAccessCode failed', err)
      const detail = errorMessage(err)
      toast('error', detail ? `Could not generate a code: ${detail}` : 'Could not generate a code. Please try again.')
    } finally {
      setRotating(false)
    }
  }

  async function handleRevoke(device: InventoryDevice) {
    if (!window.confirm(`Sign out "${device.deviceName || 'this device'}"?`)) return
    try {
      await repo.revokeInventoryDevice(device.id)
      setDevices((prev) => (prev ?? []).filter((d) => d.id !== device.id))
      toast('success', 'Device signed out.')
    } catch (err) {
      console.error('revokeInventoryDevice failed', err)
      const detail = errorMessage(err)
      toast('error', detail ? `Could not sign out that device: ${detail}` : 'Could not sign out that device. Please try again.')
    }
  }

  return (
    <Card className="space-y-4">
      <div>
        <h2 className="text-xl font-bold text-ink">Shared device access</h2>
        <p className="text-base text-zinc-600">
          Give any phone, tablet, or PC access to Scan and Inventory only — no account, no email — by sharing this
          code. It can&apos;t see quotes, customers, or reports.
        </p>
      </div>

      {newCode ? (
        <div className="rounded-xl border border-green-300 bg-green-50 p-4">
          <p className="text-sm font-semibold text-green-900">
            New code — write it down now, it won&apos;t be shown again:
          </p>
          <p className="mt-1 font-mono text-2xl font-black tracking-widest text-green-900">{newCode}</p>
          <p className="mt-2 text-sm text-green-800">
            On the shared device, go to <span className="font-mono">/join</span> and enter this code.
          </p>
        </div>
      ) : null}

      <Button variant="secondary" onClick={handleRotate} disabled={rotating}>
        <KeyRound className="h-5 w-5" aria-hidden="true" />
        {rotating ? 'Working…' : shop?.hasStaffAccessCode ? 'Generate a new code' : 'Generate a code'}
      </Button>

      <div>
        <h3 className="text-base font-bold text-ink">Signed-in devices</h3>
        {devices === null ? (
          <p className="mt-2 text-base text-zinc-600">Loading…</p>
        ) : devices.length === 0 ? (
          <p className="mt-2 text-base text-zinc-600">No devices have joined yet.</p>
        ) : (
          <ul className="mt-2 divide-y divide-zinc-100">
            {devices.map((d) => (
              <li key={d.id} className="flex items-center justify-between gap-3 py-2.5">
                <div className="flex items-center gap-2">
                  <Smartphone className="h-4 w-4 shrink-0 text-zinc-400" aria-hidden="true" />
                  <div>
                    <p className="text-base font-semibold text-ink">{d.deviceName || 'Unnamed device'}</p>
                    <p className="text-sm text-zinc-500">Joined {formatDateTime(d.joinedAt)}</p>
                  </div>
                </div>
                <Button variant="danger" onClick={() => handleRevoke(d)} className="min-h-9 px-3 text-sm">
                  Sign out
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Card>
  )
}

function FinancingOfferForm({
  offer,
  saving,
  onSubmit,
}: {
  offer: FinancingOffer | null
  saving: boolean
  onSubmit: (offer: FinancingOffer) => void
}) {
  const [name, setName] = useState(offer?.name ?? '')
  const [url, setUrl] = useState(offer?.applicationUrl ?? '')
  const [scanning, setScanning] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleDecoded = (text: string) => {
    setScanning(false)
    const link = parseScannedFinancingCode(text)
    if (!link) {
      setError("That code isn't an application link. Try again, or paste the link below.")
      return
    }
    setError(null)
    setUrl(link)
    // Only auto-fill a name we actually recognize, and never overwrite one the
    // owner already typed.
    const guessed = guessProviderName(link)
    if (guessed && !name.trim()) setName(guessed)
  }

  const handleSubmit = () => {
    const built = makeFinancingOffer(name, url, offer?.id)
    if (!built) {
      setError(
        !name.trim() ? 'Give this a name customers will recognize.' : 'Enter a valid application link (https://…).',
      )
      return
    }
    setError(null)
    onSubmit(built)
  }

  // The scanner replaces the form rather than opening a second modal on top of
  // this one — nested dialogs fight over focus and the Escape key.
  if (scanning) {
    return (
      <div className="space-y-3">
        <Suspense fallback={<LoadingBlock label="Starting camera…" />}>
          <QrScanner
            onDecoded={handleDecoded}
            onCameraError={(message) => {
              setScanning(false)
              setError(message)
            }}
          />
        </Suspense>
        <Button type="button" variant="secondary" className="w-full" onClick={() => setScanning(false)}>
          Cancel
        </Button>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <Button type="button" variant="secondary" className="w-full" onClick={() => setScanning(true)}>
        <QrCode className="h-5 w-5" aria-hidden="true" /> Scan QR code
      </Button>

      <Field label="Provider" htmlFor="fin-name" required>
        <Input
          id="fin-name"
          list="fin-provider-options"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Snap Finance"
        />
        <datalist id="fin-provider-options">
          {COMMON_FINANCING_PROVIDERS.map((p) => (
            <option key={p} value={p} />
          ))}
        </datalist>
      </Field>

      <Field label="Application link" htmlFor="fin-url" required>
        <Input
          id="fin-url"
          inputMode="url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="snapfinance.com/apply/your-shop"
        />
      </Field>

      {error ? (
        <p role="alert" className="text-base font-medium text-red-700">
          {error}
        </p>
      ) : null}

      <Button type="button" className="w-full" disabled={saving} onClick={handleSubmit}>
        {saving ? 'Saving…' : 'Save financing option'}
      </Button>
    </div>
  )
}
type ImportTotals = Pick<ShopifyImportResult, 'created' | 'updated' | 'unchanged' | 'skipped' | 'failed'>

const EMPTY_TOTALS: ImportTotals = { created: 0, updated: 0, unchanged: 0, skipped: 0, failed: 0 }

function ShopifyImportSection({ onImported }: { onImported: () => void }) {
  const repo = useRepo()
  const toast = useToast()
  const [running, setRunning] = useState(false)
  const [totals, setTotals] = useState<ImportTotals | null>(null)
  const [errors, setErrors] = useState<ShopifyImportResult['errors']>([])
  const [failureMessage, setFailureMessage] = useState<string | null>(null)

  const runImport = async () => {
    setRunning(true)
    setFailureMessage(null)
    setErrors([])
    const acc: ImportTotals = { ...EMPTY_TOTALS }
    const accErrors: ShopifyImportResult['errors'] = []
    try {
      let cursor: string | null = null
      let hasMore = true
      while (hasMore) {
        const result = await repo.runShopifyImport(cursor ? { afterCursor: cursor } : undefined)
        acc.created += result.created
        acc.updated += result.updated
        acc.unchanged += result.unchanged
        acc.skipped += result.skipped
        acc.failed += result.failed
        accErrors.push(...result.errors)
        setTotals({ ...acc })
        hasMore = result.hasMore
        cursor = result.nextCursor
      }
      toast('success', `Shopify import complete — ${acc.created} added, ${acc.updated} updated, ${acc.unchanged} unchanged.`)
      onImported()
    } catch (e) {
      setFailureMessage(e instanceof Error ? e.message : 'Import failed. Please try again.')
      toast('error', 'Shopify import failed. See details below.')
    } finally {
      setErrors(accErrors)
      setRunning(false)
    }
  }

  return (
    <Card className="space-y-3">
      <div>
        <h2 className="text-xl font-bold text-ink">Shopify catalog import</h2>
        <p className="text-base text-zinc-600">
          Pull your shop's real Shopify catalog into the product catalog below. Safe to run more than once — it never
          duplicates products and never overwrites a price you've edited here yourself. Owner/manager only.
        </p>
      </div>
      <Button onClick={() => void runImport()} disabled={running}>
        <Download className="h-5 w-5" aria-hidden="true" /> {running ? 'Importing…' : 'Run import'}
      </Button>
      {totals ? (
        <p className="text-sm text-zinc-600">
          {totals.created} added · {totals.updated} updated · {totals.unchanged} unchanged
          {totals.skipped > 0 ? ` · ${totals.skipped} skipped (locally edited price kept)` : ''}
          {totals.failed > 0 ? ` · ${totals.failed} failed` : ''}
          {running ? ' — still going…' : ''}
        </p>
      ) : null}
      {failureMessage ? (
        <p role="alert" className="text-sm font-medium text-red-700">
          {failureMessage}
        </p>
      ) : null}
      {errors.length > 0 ? (
        <ul className="max-h-40 space-y-1 overflow-y-auto text-sm text-red-700">
          {errors.map((e, i) => (
            <li key={i}>
              {e.product}: {e.message}
            </li>
          ))}
        </ul>
      ) : null}
    </Card>
  )
}

// @zxing/browser (~470kb) only matters once an owner actually opens the QR
// scanner — code-split it into its own chunk, the same way ScanWorkspacePage
// does, instead of putting it in the bundle every phone loads to reach the
// dashboard.
const QrScanner = lazy(() => import('../../components/QrScanner').then((m) => ({ default: m.QrScanner })))

const catalogSchema = z.object({
  brand: z.string(),
  model: z.string(),
  name: z.string().min(1, 'Give this product a name'),
  price: z.string().refine((v) => v === '' || parseDollarsToCents(v) !== null, 'Enter a valid dollar amount'),
  // Blank means "uncategorized" — a real ProductCategory value is the only other option.
  category: z.string(),
})
type CatalogFormValues = z.infer<typeof catalogSchema>

function toCatalogInput(values: CatalogFormValues): NewCatalogItemInput {
  return {
    brand: values.brand.trim() || null,
    model: values.model.trim() || null,
    name: values.name.trim(),
    defaultPriceCents: values.price.trim() ? parseDollarsToCents(values.price) : null,
    category: (values.category || null) as ProductCategory | null,
  }
}

function CatalogSection({ reloadSignal }: { reloadSignal: number }) {
  const repo = useRepo()
  const toast = useToast()
  const [items, setItems] = useState<CatalogItem[] | null>(null)
  const [editing, setEditing] = useState<CatalogItem | 'new' | null>(null)
  const [organizing, setOrganizing] = useState(false)

  const load = useCallback(async () => {
    setItems(await repo.listCatalogItems())
  }, [repo])

  useEffect(() => {
    void load()
    // reloadSignal: re-fetch after a Shopify import completes elsewhere on this page.
  }, [load, reloadSignal])

  const setItemCategory = async (itemId: string, category: ProductCategory | null) => {
    const item = items?.find((i) => i.id === itemId)
    if (!item) return
    await repo.updateCatalogItem(itemId, {
      brand: item.brand,
      model: item.model,
      name: item.name,
      defaultPriceCents: item.defaultPriceCents,
      category,
    })
    setItems((prev) => (prev ? prev.map((i) => (i.id === itemId ? { ...i, category } : i)) : prev))
  }

  const {
    register,
    handleSubmit,
    reset,
    setValue,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<CatalogFormValues>({ resolver: zodResolver(catalogSchema) })

  const openEdit = (item: CatalogItem | 'new') => {
    setEditing(item)
    reset(
      item === 'new'
        ? { brand: '', model: '', name: '', price: '', category: '' }
        : {
            brand: item.brand ?? '',
            model: item.model ?? '',
            name: item.name,
            price: item.defaultPriceCents !== null ? (item.defaultPriceCents / 100).toString() : '',
            category: item.category ?? '',
          },
    )
  }

  const onSubmit = async (values: CatalogFormValues) => {
    try {
      if (editing === 'new') {
        await repo.createCatalogItem(toCatalogInput(values))
        toast('success', 'Product added to your catalog.')
      } else if (editing) {
        await repo.updateCatalogItem(editing.id, toCatalogInput(values))
        toast('success', 'Product updated.')
      }
      setEditing(null)
      await load()
    } catch (err) {
      console.error('save catalog item failed', err)
      const detail = errorMessage(err)
      toast('error', detail ? `Could not save that product: ${detail}` : 'Could not save that product. Please try again.')
    }
  }

  const onDelete = async (item: CatalogItem) => {
    try {
      await repo.deleteCatalogItem(item.id)
      await load()
      toast('success', 'Removed from your catalog.')
    } catch (err) {
      console.error('deleteCatalogItem failed', err)
      const detail = errorMessage(err)
      toast('error', detail ? `Could not remove that product: ${detail}` : 'Could not remove that product. Please try again.')
    }
  }

  return (
    <Card className="space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-ink">Product catalog</h2>
          <p className="text-base text-zinc-600">
            Save products you sell often so you can add them to a quote with one tap instead of retyping them.
          </p>
        </div>
        <div className="flex shrink-0 gap-2">
          {items && items.length > 0 ? (
            <Button variant="secondary" onClick={() => setOrganizing(true)}>
              <LayoutGrid className="h-5 w-5" aria-hidden="true" /> Organize by category
            </Button>
          ) : null}
          <Button onClick={() => openEdit('new')}>
            <Plus className="h-5 w-5" aria-hidden="true" /> Add
          </Button>
        </div>
      </div>

      {items === null ? (
        <LoadingBlock label="Loading catalog…" />
      ) : items.length === 0 ? (
        <EmptyState
          title="No saved products yet"
          message="Add the brands and models you install most — they'll show up as quick picks when building a quote."
        />
      ) : (
        <ul className="divide-y divide-zinc-100">
          {items.map((item) => (
            <li key={item.id} className="flex items-center justify-between gap-3 py-3">
              <div className="flex items-center gap-3">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-blue-50 text-brand">
                  <Package className="h-5 w-5" aria-hidden="true" />
                </span>
                <div>
                  <p className="text-base font-bold text-ink">
                    {formatItemDisplayName(item)}
                  </p>
                  <p className="flex items-center gap-1.5 text-sm text-zinc-500">
                    {item.defaultPriceCents !== null ? formatCurrency(item.defaultPriceCents) : null}
                    {item.category ? (
                      <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs font-medium text-zinc-600">
                        {PRODUCT_CATEGORY_INFO[item.category].label}
                      </span>
                    ) : (
                      <span className="rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700">Uncategorized</span>
                    )}
                  </p>
                </div>
              </div>
              <div className="flex shrink-0 gap-1">
                <button
                  type="button"
                  aria-label={`Edit ${item.name}`}
                  onClick={() => openEdit(item)}
                  className="flex h-11 w-11 items-center justify-center rounded-xl text-zinc-500 hover:bg-zinc-100"
                >
                  <Pencil className="h-5 w-5" aria-hidden="true" />
                </button>
                <button
                  type="button"
                  aria-label={`Remove ${item.name}`}
                  onClick={() => void onDelete(item)}
                  className="flex h-11 w-11 items-center justify-center rounded-xl text-zinc-400 hover:bg-red-50 hover:text-red-600"
                >
                  <Trash2 className="h-5 w-5" aria-hidden="true" />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <Modal open={editing !== null} onClose={() => setEditing(null)} title={editing === 'new' ? 'Add product' : 'Edit product'}>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Brand" htmlFor="cat-brand">
              <Input id="cat-brand" {...register('brand')} placeholder="Kicker" />
            </Field>
            <Field label="Model" htmlFor="cat-model" hint="Start typing a model number to search the web for it.">
              <ProductSuggestField
                id="cat-model"
                value={watch('model')}
                onChange={(v) => setValue('model', v, { shouldDirty: true })}
                onSelect={(s) => {
                  if (s.brand) setValue('brand', s.brand, { shouldDirty: true })
                  setValue('model', s.model ?? watch('model'), { shouldDirty: true })
                  setValue('name', s.name, { shouldDirty: true, shouldValidate: true })
                  if (s.unitPriceCents !== null) {
                    setValue('price', (s.unitPriceCents / 100).toString(), { shouldDirty: true, shouldValidate: true })
                  }
                }}
                placeholder="KEY200.4"
              />
            </Field>
          </div>
          <Field label="What is it?" htmlFor="cat-name" error={errors.name?.message} required>
            <Input id="cat-name" {...register('name')} placeholder="4-channel smart amp" />
          </Field>
          <Field
            label="Usual price"
            htmlFor="cat-price"
            error={errors.price?.message}
            hint="Optional. Just for your own reference when quoting."
          >
            <Input id="cat-price" inputMode="decimal" {...register('price')} placeholder="$249" />
          </Field>
          <Field
            label="Category"
            htmlFor="cat-category"
            hint="Lets this product fill a slot in the drag-and-drop package builder."
          >
            <Select id="cat-category" {...register('category')}>
              <option value="">Uncategorized</option>
              {PRODUCT_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {PRODUCT_CATEGORY_INFO[c].label}
                </option>
              ))}
            </Select>
          </Field>
          <Button type="submit" disabled={isSubmitting} className="w-full">
            {isSubmitting ? 'Saving…' : 'Save product'}
          </Button>
        </form>
      </Modal>

      <Modal open={organizing} onClose={() => setOrganizing(false)} title="Organize by category" size="xl">
        {items ? <CatalogOrganizer items={items} onSetCategory={setItemCategory} /> : null}
      </Modal>
    </Card>
  )
}
