// One catalog item: view/edit its details, adjust stock (always through
// recordStockMovement — quantityOnHand is never hand-edited directly, same
// invariant apply_stock_movement enforces in production), and see its full
// stock-movement ledger.

import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, Barcode, Minus, Pencil, Plus, Trash2 } from 'lucide-react'
import { useAppData, useRepo } from '../../data/AppDataContext'
import { useToast } from '../../components/Toast'
import { Badge, Button, Card, Field, Input, LoadingBlock, Modal, Select } from '../../components/ui'
import { CategoryIcon } from '../../components/categoryIcon'
import { PRODUCT_CATEGORY_INFO, PRODUCT_CATEGORIES } from '../../lib/audioConfigs'
import { effectiveThreshold, isLowStock } from '../../lib/inventory'
import { barcodeAdvice, classifyBarcode, normalizeBarcodeInput } from '../../lib/barcodeIdentity'
import {
  brandNeedsFitment,
  describeFitmentRange,
  fitmentFromSpecs,
  specsWithFitment,
  type FitmentRange,
} from '../../lib/fitment'
import { formatCurrency, formatDateTime, parseDollarsToCents } from '../../lib/format'
import { formatItemShortName } from '../../lib/productNaming'
import type { CatalogItem, ProductCategory, StockMovement } from '../../types'
import type { NewCatalogItemInput } from '../../data/repository'

const MOVEMENT_LABELS: Record<StockMovement['movementType'], string> = {
  receiving: 'Received',
  outgoing_order: 'Sent out',
  sale: 'Sold',
  adjustment: 'Adjusted',
}

function currentInput(item: CatalogItem, overrides: Partial<NewCatalogItemInput> = {}): NewCatalogItemInput {
  return {
    brand: item.brand,
    model: item.model,
    name: item.name,
    defaultPriceCents: item.defaultPriceCents,
    category: item.category,
    lowStockThreshold: item.lowStockThreshold,
    ...overrides,
  }
}

export default function InventoryDetailPage() {
  const { itemId } = useParams<{ itemId: string }>()
  const repo = useRepo()
  const { shop } = useAppData()
  const toast = useToast()
  const navigate = useNavigate()

  const [item, setItem] = useState<CatalogItem | null | undefined>(undefined)
  const [movements, setMovements] = useState<StockMovement[]>([])
  const [editing, setEditing] = useState(false)
  const [form, setForm] = useState({ brand: '', model: '', name: '', category: '', price: '', threshold: '' })
  const [saving, setSaving] = useState(false)
  const [draftQty, setDraftQty] = useState(0)
  const [adjusting, setAdjusting] = useState(false)
  const [generatingSku, setGeneratingSku] = useState(false)

  useEffect(() => {
    if (!itemId) return
    void repo.listCatalogItems().then((items) => {
      const found = items.find((i) => i.id === itemId) ?? null
      setItem(found)
      if (found) setDraftQty(found.quantityOnHand)
    })
    void repo.listStockMovements(itemId).then(setMovements)
  }, [repo, itemId])

  const defaultThreshold = shop?.defaultLowStockThreshold ?? 3
  const low = item ? isLowStock(item, defaultThreshold) : false

  function startEdit() {
    if (!item) return
    setForm({
      brand: item.brand ?? '',
      model: item.model ?? '',
      name: item.name,
      category: item.category ?? '',
      price: item.defaultPriceCents != null ? String(item.defaultPriceCents / 100) : '',
      threshold: item.lowStockThreshold != null ? String(item.lowStockThreshold) : '',
    })
    setEditing(true)
  }

  async function saveEdit() {
    if (!item || !form.name.trim()) return
    setSaving(true)
    try {
      const updated = await repo.updateCatalogItem(
        item.id,
        currentInput(item, {
          brand: form.brand.trim() || null,
          model: form.model.trim() || null,
          name: form.name.trim(),
          category: (form.category || null) as ProductCategory | null,
          defaultPriceCents: form.price.trim() ? parseDollarsToCents(form.price) : null,
          lowStockThreshold: form.threshold.trim() ? Number(form.threshold) : null,
        }),
      )
      setItem(updated)
      setEditing(false)
      toast('success', 'Saved.')
    } catch (err) {
      toast('error', err instanceof Error ? err.message : 'Could not save.')
    } finally {
      setSaving(false)
    }
  }

  async function applyAdjustment() {
    if (!item || draftQty === item.quantityOnHand) return
    setAdjusting(true)
    try {
      const result = await repo.recordStockMovement({
        catalogItemId: item.id,
        movementType: 'adjustment',
        quantityDelta: draftQty - item.quantityOnHand,
        note: 'Manual adjustment',
      })
      setItem(result.catalogItem)
      setMovements((prev) => [result.movement, ...prev])
      toast('success', 'Stock updated.')
    } catch (err) {
      toast('error', err instanceof Error ? err.message : 'Could not update stock.')
      setDraftQty(item.quantityOnHand)
    } finally {
      setAdjusting(false)
    }
  }

  // Web-looked-up fitment waiting for a human to approve. Never saved
  // straight to the item: the owner's standing rule for AI answers is
  // "give me options and take my input", and a wrong application list on a
  // dash kit sells someone the wrong part for their truck.
  const [fitmentPreview, setFitmentPreview] = useState<FitmentRange[] | null>(null)
  const [fitmentBusy, setFitmentBusy] = useState(false)
  const [fitmentError, setFitmentError] = useState<string | null>(null)

  async function lookUpFitment() {
    if (!item) return
    setFitmentBusy(true)
    setFitmentError(null)
    setFitmentPreview(null)
    try {
      const result = await repo.lookupVehicleFitment({ brand: item.brand ?? '', model: item.model ?? item.name })
      if (result.fitment.length > 0) setFitmentPreview(result.fitment)
      else setFitmentError(result.aiError ?? "Couldn't find a published application list for this part.")
    } finally {
      setFitmentBusy(false)
    }
  }

  async function saveFitment(ranges: FitmentRange[]) {
    if (!item) return
    try {
      const updated = await repo.updateCatalogItem(
        item.id,
        currentInput(item, { specs: specsWithFitment(item.specs, ranges) }),
      )
      setItem(updated)
      setFitmentPreview(null)
      toast('success', `Saved fitment for ${ranges.length} vehicle${ranges.length === 1 ? '' : 's'}.`)
    } catch (err) {
      toast('error', err instanceof Error ? err.message : 'Could not save the fitment.')
    }
  }

  const [attachOpen, setAttachOpen] = useState(false)
  const [attachCode, setAttachCode] = useState('')
  const [attachError, setAttachError] = useState<string | null>(null)
  const [attaching, setAttaching] = useState(false)

  /**
   * Attach a scanned (or typed) barcode to this item.
   *
   * Two checks stand between the trigger-pull and the save, because a wrong
   * binding here is worse than none — it makes every future scan of that
   * code resolve to the wrong product:
   *
   *   1. The classifier's misread verdict. A 12/13-digit code with a failing
   *      check digit is a bad read of a good label, and the fix is to scan
   *      again, not to save the mangled number.
   *   2. Uniqueness. A code already on another item means either a mis-scan
   *      or a real data problem; either way it needs a person, named plainly.
   */
  async function attachBarcode() {
    if (!item) return
    const code = normalizeBarcodeInput(attachCode)
    if (!code) return
    const advice = barcodeAdvice(classifyBarcode(code))
    if (classifyBarcode(code).likelyMisread) {
      setAttachError("That scan didn't read cleanly — the check digit fails. Scan it again.")
      return
    }
    setAttaching(true)
    setAttachError(null)
    try {
      const existing = await repo.findCatalogItemByCode(code)
      if (existing && existing.id !== item.id) {
        setAttachError(`That code is already on "${formatItemShortName(existing)}". Remove it there first if this is the right box.`)
        return
      }
      const updated = await repo.updateCatalogItem(item.id, currentInput(item, { upc: code, upcIsGenerated: false }))
      setItem(updated)
      setAttachOpen(false)
      setAttachCode('')
      toast('success', advice ? `Code ${code} attached. (${advice})` : `Barcode ${code} attached — scans find this item instantly now.`)
    } catch (err) {
      setAttachError(err instanceof Error ? err.message : 'Could not save the barcode.')
    } finally {
      setAttaching(false)
    }
  }

  async function generateCode() {
    if (!item) return
    setGeneratingSku(true)
    try {
      const code = await repo.generateSku(item.brand, item.model ?? item.name)
      const updated = await repo.updateCatalogItem(item.id, currentInput(item, { upc: code, upcIsGenerated: true }))
      setItem(updated)
      toast('success', `Generated code ${code}.`)
    } catch (err) {
      toast('error', err instanceof Error ? err.message : 'Could not generate a code.')
    } finally {
      setGeneratingSku(false)
    }
  }

  async function handleDelete() {
    if (!item) return
    if (!window.confirm(`Remove "${formatItemShortName(item)}" from your catalog? This can't be undone.`)) return
    try {
      await repo.deleteCatalogItem(item.id)
      toast('success', 'Removed from your catalog.')
      navigate('/app/inventory')
    } catch (err) {
      toast('error', err instanceof Error ? err.message : 'Could not remove item.')
    }
  }

  const categoryLabel = useMemo(() => (item?.category ? PRODUCT_CATEGORY_INFO[item.category].label : null), [item])
  // The heading is the item's identity (brand + model); `name` carries only the
  // descriptor and is legitimately empty when the typed name was nothing but
  // brand and model. Rendering it raw here used to leave the page untitled.
  const displayName = item ? formatItemShortName(item) : ''
  const descriptor = item && item.name.trim() && item.name.trim() !== displayName ? item.name.trim() : null

  if (item === undefined) return <LoadingBlock label="Loading item…" />
  if (item === null) {
    return (
      <div className="space-y-4">
        <Link to="/app/inventory" className="inline-flex items-center gap-1 text-base font-semibold text-brand">
          <ArrowLeft className="h-4 w-4" aria-hidden="true" /> Back to inventory
        </Link>
        <p className="text-base text-zinc-600">This item couldn&apos;t be found — it may have been removed.</p>
      </div>
    )
  }

  return (
    <div className="space-y-5">
      <Link to="/app/inventory" className="inline-flex items-center gap-1 text-base font-semibold text-brand">
        <ArrowLeft className="h-4 w-4" aria-hidden="true" /> Back to inventory
      </Link>

      <Card className="flex flex-col gap-4 sm:flex-row">
        {item.imageUrl ? (
          <img src={item.imageUrl} alt="" className="h-32 w-32 shrink-0 self-center rounded-xl border border-zinc-200 object-cover sm:self-start" />
        ) : (
          <span className="flex h-32 w-32 shrink-0 items-center justify-center self-center rounded-xl bg-zinc-100 text-zinc-400 sm:self-start">
            <CategoryIcon category={item.category} className="h-10 w-10" />
          </span>
        )}

        <div className="min-w-0 flex-1 space-y-3">
          {!editing ? (
            <>
              <div>
                <h1 className="text-2xl font-black text-ink">{displayName}</h1>
                <p className="text-base text-zinc-600">{descriptor ?? '—'}</p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {categoryLabel ? <Badge className="bg-zinc-100 text-zinc-700">{categoryLabel}</Badge> : null}
                {item.upc ? (
                  <Badge className={item.upcIsGenerated ? 'bg-zinc-100 text-zinc-700' : 'bg-green-50 text-green-800'} title={item.upcIsGenerated ? 'Generated by this app — not a real manufacturer code' : 'Real manufacturer UPC'}>
                    <Barcode className="h-3.5 w-3.5" aria-hidden="true" /> {item.upc}
                    {item.upcIsGenerated ? ' (internal)' : ''}
                  </Badge>
                ) : (
                  <Badge className="bg-brand-tint text-brand">No UPC yet</Badge>
                )}
              </div>
              <div className="text-2xl font-black text-ink">
                {item.defaultPriceCents != null ? formatCurrency(item.defaultPriceCents) : 'No price set'}
              </div>
              <div className="flex gap-2">
                <Button variant="secondary" onClick={startEdit}>
                  <Pencil className="h-4 w-4" aria-hidden="true" /> Edit
                </Button>
                {!item.upc || item.upcIsGenerated ? (
                  <Button variant="secondary" onClick={() => { setAttachOpen(true); setAttachError(null) }}>
                    <Barcode className="h-4 w-4" aria-hidden="true" />
                    {item.upc ? 'Scan the real barcode' : 'Scan its barcode'}
                  </Button>
                ) : null}
                {!item.upc ? (
                  <Button variant="secondary" onClick={generateCode} disabled={generatingSku}>
                    <Barcode className="h-4 w-4" aria-hidden="true" /> {generatingSku ? 'Generating…' : 'Generate a code'}
                  </Button>
                ) : null}
                <Button variant="danger" onClick={handleDelete}>
                  <Trash2 className="h-4 w-4" aria-hidden="true" /> Remove
                </Button>
              </div>
            </>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Name" htmlFor="edit-name" required>
                <Input id="edit-name" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
              </Field>
              <Field label="Category" htmlFor="edit-category">
                <Select id="edit-category" value={form.category} onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))}>
                  <option value="">Uncategorized</option>
                  {PRODUCT_CATEGORIES.map((c) => (
                    <option key={c} value={c}>
                      {PRODUCT_CATEGORY_INFO[c].label}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Brand" htmlFor="edit-brand">
                <Input id="edit-brand" value={form.brand} onChange={(e) => setForm((f) => ({ ...f, brand: e.target.value }))} />
              </Field>
              <Field label="Model" htmlFor="edit-model">
                <Input id="edit-model" value={form.model} onChange={(e) => setForm((f) => ({ ...f, model: e.target.value }))} />
              </Field>
              <Field label="Price" htmlFor="edit-price">
                <Input id="edit-price" inputMode="decimal" placeholder="0.00" value={form.price} onChange={(e) => setForm((f) => ({ ...f, price: e.target.value }))} />
              </Field>
              <Field label="Low-stock alert threshold" htmlFor="edit-threshold" hint={`Shop default is ${defaultThreshold} — leave blank to use it.`}>
                <Input id="edit-threshold" inputMode="numeric" placeholder={String(defaultThreshold)} value={form.threshold} onChange={(e) => setForm((f) => ({ ...f, threshold: e.target.value }))} />
              </Field>
              <div className="flex gap-2 sm:col-span-2">
                <Button onClick={saveEdit} disabled={saving || !form.name.trim()}>
                  {saving ? 'Saving…' : 'Save'}
                </Button>
                <Button variant="secondary" onClick={() => setEditing(false)} disabled={saving}>
                  Cancel
                </Button>
              </div>
            </div>
          )}
        </div>
      </Card>

      {brandNeedsFitment(item.brand) ? (
        <Card className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-xl font-bold text-ink">Vehicle fitment</h2>
            <Button variant="secondary" onClick={() => void lookUpFitment()} disabled={fitmentBusy}>
              {fitmentBusy ? 'Looking it up…' : fitmentFromSpecs(item.specs).length > 0 ? 'Re-check the web' : 'Look up from the web'}
            </Button>
          </div>

          {fitmentFromSpecs(item.specs).length > 0 ? (
            <div className="flex flex-wrap gap-1.5">
              {fitmentFromSpecs(item.specs).map((r, i) => (
                <span key={i} className="rounded-full bg-zinc-100 px-3 py-1 text-sm font-medium text-zinc-800">
                  {describeFitmentRange(r)}
                </span>
              ))}
            </div>
          ) : fitmentPreview === null ? (
            <p className="text-sm text-zinc-600">
              This is a vehicle-specific part with no application list saved yet. Look it up once and the
              inventory page can answer &ldquo;what fits a 2018 Tacoma&rdquo; without anyone reading the box.
            </p>
          ) : null}

          {fitmentError ? <p className="text-sm text-amber-800">{fitmentError}</p> : null}

          {fitmentPreview ? (
            <div className="rounded-xl border border-brand/40 bg-brand-tint/40 p-3">
              {/* Found on the web, saved only on approval — a wrong application
                  list on a dash kit sells someone the wrong part. */}
              <p className="mb-2 text-sm font-semibold text-ink">Found this application list — does it match the box?</p>
              <div className="mb-3 flex flex-wrap gap-1.5">
                {fitmentPreview.map((r, i) => (
                  <span key={i} className="rounded-full bg-white px-3 py-1 text-sm font-medium text-zinc-800 shadow-sm">
                    {describeFitmentRange(r)}
                  </span>
                ))}
              </div>
              <div className="flex gap-2">
                <Button onClick={() => void saveFitment(fitmentPreview)}>Save it</Button>
                <Button variant="ghost" onClick={() => setFitmentPreview(null)}>
                  Discard
                </Button>
              </div>
            </div>
          ) : null}
        </Card>
      ) : null}

      <Card>
        <h2 className="text-xl font-bold text-ink">Stock on hand</h2>
        <p className="text-sm text-zinc-500">
          Threshold: {effectiveThreshold(item, defaultThreshold)}
          {item.lowStockThreshold == null ? ' (shop default)' : ''}
          {item.lastCountedAt ? ` · Last counted ${formatDateTime(item.lastCountedAt)}` : ' · Never counted'}
        </p>
        <div className="mt-3 flex items-center gap-3">
          <button
            type="button"
            onClick={() => setDraftQty((q) => Math.max(0, q - 1))}
            className="flex h-12 w-12 items-center justify-center rounded-xl border border-zinc-300 text-zinc-700 hover:bg-zinc-50"
            aria-label="Decrease quantity"
          >
            <Minus className="h-5 w-5" aria-hidden="true" />
          </button>
          <span className={`w-16 text-center text-3xl font-black ${low ? 'text-amber-700' : 'text-ink'}`}>{draftQty}</span>
          <button
            type="button"
            onClick={() => setDraftQty((q) => q + 1)}
            className="flex h-12 w-12 items-center justify-center rounded-xl border border-zinc-300 text-zinc-700 hover:bg-zinc-50"
            aria-label="Increase quantity"
          >
            <Plus className="h-5 w-5" aria-hidden="true" />
          </button>
          {draftQty !== item.quantityOnHand ? (
            <div className="flex gap-2">
              <Button onClick={applyAdjustment} disabled={adjusting}>
                {adjusting ? 'Saving…' : 'Save count'}
              </Button>
              <Button variant="secondary" onClick={() => setDraftQty(item.quantityOnHand)} disabled={adjusting}>
                Cancel
              </Button>
            </div>
          ) : null}
        </div>
      </Card>

      <Card>
        <h2 className="text-xl font-bold text-ink">History</h2>
        {movements.length === 0 ? (
          <p className="mt-3 text-base text-zinc-600">No stock movements recorded yet.</p>
        ) : (
          <ul className="mt-3 divide-y divide-zinc-100">
            {movements.map((m) => (
              <li key={m.id} className="flex items-center justify-between gap-3 py-2.5 text-base">
                <div>
                  <span className="font-semibold text-ink">{MOVEMENT_LABELS[m.movementType]}</span>{' '}
                  <span className={m.quantityDelta > 0 ? 'text-green-700' : 'text-red-700'}>
                    {m.quantityDelta > 0 ? `+${m.quantityDelta}` : m.quantityDelta}
                  </span>
                  {m.counterpartyName ? <span className="text-zinc-500"> · {m.counterpartyName}</span> : null}
                  {m.note ? <span className="text-zinc-500"> · {m.note}</span> : null}
                </div>
                <span className="shrink-0 text-sm text-zinc-500">{formatDateTime(m.createdAt)}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
      <Modal open={attachOpen} onClose={() => setAttachOpen(false)} title="Attach a barcode">
        <div className="space-y-3">
          <p className="text-sm text-zinc-600">
            Point the scanner at the box and pull the trigger — or type the digits printed under the bars.
            {item?.upc ? ' This replaces the app-generated internal code.' : ''}
          </p>
          <Field label="Barcode" htmlFor="attach-code" error={attachError ?? undefined}>
            <Input
              id="attach-code"
              value={attachCode}
              autoFocus
              autoComplete="off"
              inputMode="numeric"
              onChange={(e) => setAttachCode(e.target.value)}
              onKeyDown={(e) => {
                if (e.key !== 'Enter') return
                e.preventDefault()
                void attachBarcode()
              }}
              placeholder="e.g. 677478807501"
            />
          </Field>
          <Button className="w-full" onClick={() => void attachBarcode()} disabled={attaching || !attachCode.trim()}>
            {attaching ? 'Saving…' : 'Attach it'}
          </Button>
        </div>
      </Modal>
    </div>
  )
}
