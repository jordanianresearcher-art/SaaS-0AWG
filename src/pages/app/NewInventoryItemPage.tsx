// Add a product to the catalog: scan its barcode (hardware scanner or
// camera), snap a photo for AI identification, or type it in by hand and
// generate an internal code if it has no real barcode at all. All three
// paths funnel into the same confirm-before-save form — nothing is ever
// auto-saved without a person looking at it first.

import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, Barcode, Camera, Sparkles } from 'lucide-react'
import { useRepo } from '../../data/AppDataContext'
import { useToast } from '../../components/Toast'
import { Button, Card, Field, Input, LoadingBlock, Select } from '../../components/ui'
import { PRODUCT_CATEGORY_INFO, PRODUCT_CATEGORIES } from '../../lib/audioConfigs'
import { formatCurrency, parseDollarsToCents } from '../../lib/format'
import { useHardwareScanner } from '../../lib/useHardwareScanner'
import type { CatalogItem, ImportSource, ProductCategory } from '../../types'
import type { ProductResolutionCandidate } from '../../data/repository'

const BarcodeScanner = lazy(() => import('../../components/BarcodeScanner').then((m) => ({ default: m.BarcodeScanner })))

const CONFIDENCE_BADGE: Record<ProductResolutionCandidate['confidenceLevel'], string> = {
  high: 'bg-green-100 text-green-800',
  probable: 'bg-blue-50 text-brand',
  low: 'bg-zinc-100 text-zinc-600',
}
const CONFIDENCE_LABEL: Record<ProductResolutionCandidate['confidenceLevel'], string> = {
  high: 'Strong match',
  probable: 'Possible match',
  low: 'Low confidence',
}

type FormState = {
  brand: string
  model: string
  name: string
  category: string
  price: string
  upc: string
  imageUrl: string | null
  importSource: ImportSource
  upcIsGenerated: boolean
}

const EMPTY_FORM: FormState = {
  brand: '',
  model: '',
  name: '',
  category: '',
  price: '',
  upc: '',
  imageUrl: null,
  importSource: 'manual',
  upcIsGenerated: false,
}

export default function NewInventoryItemPage() {
  const repo = useRepo()
  const toast = useToast()
  const navigate = useNavigate()

  const [mode, setMode] = useState<'scan' | 'form'>('scan')
  const [cameraOpen, setCameraOpen] = useState(false)
  const [form, setForm] = useState<FormState>(EMPTY_FORM)
  const [status, setStatus] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [existingMatch, setExistingMatch] = useState<CatalogItem | null>(null)
  const [candidates, setCandidates] = useState<ProductResolutionCandidate[] | null>(null)
  const [saving, setSaving] = useState(false)
  const [skuHint, setSkuHint] = useState('')
  const [generatingSku, setGeneratingSku] = useState(false)

  const scanInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (mode === 'scan') scanInputRef.current?.focus()
  }, [mode])

  // Fallback path for when focus has drifted off the dedicated scan input —
  // same pattern as ScanWorkspacePage.
  useHardwareScanner(handleBarcodeDetected, mode === 'scan')

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((f) => ({ ...f, [key]: value }))
  }

  function startOver() {
    setForm(EMPTY_FORM)
    setStatus(null)
    setExistingMatch(null)
    setCandidates(null)
    setSkuHint('')
    setMode('scan')
  }

  function applyCandidate(c: ProductResolutionCandidate, importSource: ImportSource) {
    setForm((f) => ({
      ...f,
      name: c.name || f.name,
      brand: c.brand ?? f.brand,
      model: c.model ?? f.model,
      price: c.referencePriceCents != null ? String(c.referencePriceCents / 100) : f.price,
      imageUrl: c.imageUrl ?? f.imageUrl,
      upc: c.upc ?? f.upc,
      importSource,
    }))
    setCandidates(null)
  }

  async function handleBarcodeDetected(code: string) {
    setCameraOpen(false)
    setMode('form')
    setBusy(true)
    setStatus('Looking up barcode…')
    try {
      const result = await repo.lookupProductByUpc(code)
      if (result.source === 'catalog') {
        setExistingMatch(result.catalogItem)
        setStatus('This barcode is already in your catalog.')
      } else if (result.source === 'external') {
        setForm((f) => ({
          ...f,
          name: result.name ?? f.name,
          brand: result.brand ?? f.brand,
          price: result.unitPriceCents != null ? String(result.unitPriceCents / 100) : f.price,
          imageUrl: result.imageUrl ?? f.imageUrl,
          upc: result.upc,
          importSource: 'upc_lookup',
        }))
        setStatus('Found it — check the details below before saving.')
      } else if (result.source === 'candidates') {
        setForm((f) => ({ ...f, upc: code }))
        setCandidates(result.candidates)
        setStatus(result.candidates.length > 0 ? 'A few possible matches — pick one, or fill it in by hand.' : null)
      } else {
        setForm((f) => ({ ...f, upc: code }))
        setStatus("Barcode not found anywhere — it's saved below. Fill in the rest by hand.")
      }
    } catch (err) {
      setForm((f) => ({ ...f, upc: code }))
      setStatus(err instanceof Error ? err.message : 'Lookup failed. Enter details manually.')
    } finally {
      setBusy(false)
    }
  }

  async function handlePhotoCaptured(base64Jpeg: string) {
    setCameraOpen(false)
    setMode('form')
    setBusy(true)
    setStatus('Identifying product… this can take up to a couple of minutes.')

    const [uploadResult, resolveResult] = await Promise.allSettled([
      repo.uploadProductPhoto(base64Jpeg),
      repo.resolveProduct({ kind: 'photo', imageBase64: base64Jpeg, mediaType: 'image/jpeg' }),
    ])

    if (uploadResult.status === 'fulfilled') set('imageUrl', uploadResult.value)

    if (resolveResult.status === 'fulfilled' && resolveResult.value.candidates.length > 0) {
      const top = resolveResult.value.candidates[0]
      applyCandidate(top, 'ai_photo_import')
      if (resolveResult.value.candidates.length > 1) setCandidates(resolveResult.value.candidates)
      setStatus('AI best guess below — double-check before saving.')
    } else {
      setStatus("Couldn't identify the product from the photo. Fill in the details by hand.")
    }
    setBusy(false)
  }

  function handleCameraError(message: string) {
    setCameraOpen(false)
    setMode('form')
    setStatus(message)
  }

  async function generateCode() {
    setGeneratingSku(true)
    try {
      const code = await repo.generateSku(form.brand || null, skuHint.trim() || form.model || form.name)
      set('upc', code)
      set('upcIsGenerated', true)
      setStatus(`Generated internal code ${code}.`)
    } catch (err) {
      toast('error', err instanceof Error ? err.message : 'Could not generate a code.')
    } finally {
      setGeneratingSku(false)
    }
  }

  async function handleSave() {
    if (!form.name.trim()) return
    setSaving(true)
    try {
      const item = await repo.createCatalogItem({
        brand: form.brand.trim() || null,
        model: form.model.trim() || null,
        name: form.name.trim(),
        category: (form.category || null) as ProductCategory | null,
        defaultPriceCents: form.price.trim() ? parseDollarsToCents(form.price) : null,
        upc: form.upc.trim() || null,
        imageUrl: form.imageUrl,
        importSource: form.importSource,
        upcIsGenerated: form.upcIsGenerated,
      })
      toast('success', 'Added to your catalog.')
      navigate(`/app/inventory/${item.id}`)
    } catch (err) {
      toast('error', err instanceof Error ? err.message : 'Could not save.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="mx-auto max-w-lg space-y-4">
      <button
        type="button"
        onClick={() => navigate('/app/inventory')}
        className="inline-flex items-center gap-1 text-base font-semibold text-brand"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden="true" /> Back to inventory
      </button>
      <h1 className="text-3xl font-black text-ink">Add item</h1>

      {mode === 'scan' && !cameraOpen ? (
        <Card className="space-y-3">
          <div className="rounded-xl border-2 border-dashed border-zinc-300 bg-zinc-50 p-6 text-center">
            <p className="mb-3 text-base font-semibold text-zinc-700">Ready to scan</p>
            <input
              ref={scanInputRef}
              type="text"
              inputMode="none"
              onKeyDown={(e) => {
                if (e.key !== 'Enter') return
                e.preventDefault()
                const value = scanInputRef.current?.value.trim()
                if (scanInputRef.current) scanInputRef.current.value = ''
                if (value) void handleBarcodeDetected(value)
              }}
              onBlur={() => setTimeout(() => scanInputRef.current?.focus(), 50)}
              placeholder="Scan a barcode…"
              className="h-12 w-full rounded-lg border border-zinc-300 bg-white px-3 text-center text-base"
            />
          </div>
          <Button variant="secondary" className="w-full" onClick={() => setCameraOpen(true)}>
            <Camera className="h-5 w-5" aria-hidden="true" /> Use camera instead
          </Button>
          <Button variant="ghost" className="w-full" onClick={() => setMode('form')}>
            Enter details by hand
          </Button>
        </Card>
      ) : null}

      {cameraOpen ? (
        <Suspense fallback={<LoadingBlock label="Loading camera…" />}>
          <BarcodeScanner onBarcodeDetected={handleBarcodeDetected} onPhotoCaptured={handlePhotoCaptured} onCameraError={handleCameraError} />
        </Suspense>
      ) : null}

      {mode === 'form' ? (
        <Card className="space-y-4">
          {status ? (
            <p className="flex items-center gap-2 text-base text-zinc-700">
              {busy ? <Sparkles className="h-4 w-4 shrink-0 animate-pulse text-brand" aria-hidden="true" /> : null}
              {status}
            </p>
          ) : null}

          {existingMatch ? (
            <div className="rounded-xl border border-blue-200 bg-blue-50 p-4">
              <p className="font-semibold text-ink">{existingMatch.name}</p>
              <p className="text-sm text-zinc-600">Already in your catalog — {existingMatch.quantityOnHand} on hand.</p>
              <div className="mt-3 flex gap-2">
                <Button onClick={() => navigate(`/app/inventory/${existingMatch.id}`)}>View item</Button>
                <Button variant="secondary" onClick={startOver}>
                  Scan something else
                </Button>
              </div>
            </div>
          ) : (
            <>
              {candidates && candidates.length > 0 ? (
                <div className="space-y-2">
                  {candidates.map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => applyCandidate(c, form.upc && c.upc === form.upc ? 'upc_lookup' : 'ai_photo_import')}
                      className="flex w-full items-center gap-3 rounded-xl border border-zinc-200 p-3 text-left hover:border-brand"
                    >
                      {c.imageUrl ? (
                        <img src={c.imageUrl} alt="" className="h-12 w-12 shrink-0 rounded-lg object-contain" />
                      ) : (
                        <span className="h-12 w-12 shrink-0 rounded-lg bg-zinc-100" />
                      )}
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-semibold text-ink">{c.name}</p>
                        <p className="truncate text-sm text-zinc-500">{[c.brand, c.model].filter(Boolean).join(' · ') || '—'}</p>
                      </div>
                      <div className="shrink-0 text-right">
                        {c.referencePriceCents != null ? <p className="text-sm font-semibold text-ink">{formatCurrency(c.referencePriceCents)}</p> : null}
                        <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-semibold ${CONFIDENCE_BADGE[c.confidenceLevel]}`}>
                          {CONFIDENCE_LABEL[c.confidenceLevel]}
                        </span>
                      </div>
                    </button>
                  ))}
                </div>
              ) : null}

              {form.imageUrl ? <img src={form.imageUrl} alt="" className="h-32 w-32 rounded-xl border border-zinc-200 object-cover" /> : null}

              <Field label="Name" htmlFor="new-name" required>
                <Input id="new-name" value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="12&quot; subwoofer" />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Brand" htmlFor="new-brand">
                  <Input id="new-brand" value={form.brand} onChange={(e) => set('brand', e.target.value)} />
                </Field>
                <Field label="Model" htmlFor="new-model">
                  <Input id="new-model" value={form.model} onChange={(e) => set('model', e.target.value)} />
                </Field>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Category" htmlFor="new-category">
                  <Select id="new-category" value={form.category} onChange={(e) => set('category', e.target.value)}>
                    <option value="">Uncategorized</option>
                    {PRODUCT_CATEGORIES.map((c) => (
                      <option key={c} value={c}>
                        {PRODUCT_CATEGORY_INFO[c].label}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Price" htmlFor="new-price">
                  <Input id="new-price" inputMode="decimal" placeholder="0.00" value={form.price} onChange={(e) => set('price', e.target.value)} />
                </Field>
              </div>

              <Field label="UPC / code" htmlFor="new-upc" hint={form.upcIsGenerated ? 'Generated by this app — not a real manufacturer code.' : undefined}>
                <div className="flex gap-2">
                  <Input
                    id="new-upc"
                    value={form.upc}
                    onChange={(e) => {
                      set('upc', e.target.value)
                      set('upcIsGenerated', false)
                    }}
                    placeholder="No barcode found"
                  />
                </div>
              </Field>
              {!form.upc ? (
                <div className="flex items-end gap-2">
                  <Field label="Generate a code from" htmlFor="sku-hint">
                    <Input id="sku-hint" value={skuHint} onChange={(e) => setSkuHint(e.target.value)} placeholder={form.model || form.name || 'model name'} />
                  </Field>
                  <Button variant="secondary" onClick={generateCode} disabled={generatingSku}>
                    <Barcode className="h-4 w-4" aria-hidden="true" /> {generatingSku ? 'Generating…' : 'Generate'}
                  </Button>
                </div>
              ) : null}

              <div className="flex gap-2">
                <Button onClick={handleSave} disabled={saving || !form.name.trim()}>
                  {saving ? 'Saving…' : 'Save to catalog'}
                </Button>
                <Button variant="secondary" onClick={startOver} disabled={saving}>
                  Start over
                </Button>
              </div>
            </>
          )}
        </Card>
      ) : null}
    </div>
  )
}
