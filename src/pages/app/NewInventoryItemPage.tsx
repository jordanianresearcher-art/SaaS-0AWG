// Rapid intake: put a whole shipment into the catalog without waiting on
// anything. Built around one hard constraint — a manufacturer that never
// published its barcodes (Nemesis Audio being the case that drove this) can
// NEVER be resolved from a code, by us or by anyone. No barcode database has
// it and no web search can tie that number to a product. The only thing that
// can identify the box is the person holding it.
//
// So the flow optimizes for that instead of fighting it:
//
//   * Lock the brand you're receiving once, at the top. Every search after
//     that is scoped to it, which is what makes a web lookup work at all for
//     these products — "Nemesis Audio NA-12F" finds the manufacturer's page,
//     "192837465012" finds nothing, ever.
//   * A scanned code is looked up FAST (cache + barcode DB, ~1s, no AI). A
//     miss stops there and hands you the keyboard rather than spending 15-30s
//     failing.
//   * Typing matches this shop's OWN catalog instantly with no network, so
//     the second unit of anything is zero lookups. Web results merge in
//     behind those when they arrive, without reordering under your finger.
//   * Saving binds the scanned code to the product permanently, so you are
//     only ever asked once per product, for the life of the shop.
//   * Re-scanning a code already in this session just adds one to its
//     quantity — a case of six subs is six beeps, no typing.
//   * Photos/specs/prices are filled in afterwards in the background. You
//     never wait for them.

import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft, Camera, Check, Loader2, Package, Sparkles, X } from 'lucide-react'
import { useAppData, useRepo } from '../../data/AppDataContext'
import { useToast } from '../../components/Toast'
import { Badge, Button, Card, Field, Input, LoadingBlock } from '../../components/ui'
import { knownBrands, mergeSearchHits, searchLocalCatalog, type ProductSearchHit } from '../../lib/productSearch'
import { guessCategoryFromName } from '../../lib/categorize'
import { formatCurrency, parseDollarsToCents } from '../../lib/format'
import { formatItemShortName, splitItemName } from '../../lib/productNaming'
import { useHardwareScanner } from '../../lib/useHardwareScanner'
import { errorMessage } from '../../lib/errors'
import type { CatalogItem } from '../../types'

const BarcodeScanner = lazy(() => import('../../components/BarcodeScanner').then((m) => ({ default: m.BarcodeScanner })))

const WEB_SEARCH_DEBOUNCE_MS = 500
const MIN_WEB_QUERY = 2

/** One product taken in during this session — the running tape on the right. */
interface IntakeLine {
  id: string
  catalogItemId: string
  /** Descriptor half only — brand and model carry the identity. */
  name: string
  brand: string | null
  model: string | null
  code: string | null
  quantity: number
  isNewProduct: boolean
  /** True while a background lookup is still trying to fill in photo/price. */
  enriching: boolean
}

export default function NewInventoryItemPage() {
  const repo = useRepo()
  const { mode } = useAppData()
  const toast = useToast()

  const [catalog, setCatalog] = useState<CatalogItem[] | null>(null)
  const [brand, setBrand] = useState('')
  const [brandLocked, setBrandLocked] = useState(false)
  const [lines, setLines] = useState<IntakeLine[]>([])

  // The code currently awaiting identification. null = ready for the next scan.
  const [pendingCode, setPendingCode] = useState<string | null>(null)
  const [scanning, setScanning] = useState(false)
  const [cameraOpen, setCameraOpen] = useState(false)

  // Identification form
  const [query, setQuery] = useState('')
  const [price, setPrice] = useState('')
  const [webHits, setWebHits] = useState<ProductSearchHit[]>([])
  const [webSearching, setWebSearching] = useState(false)
  // Why the web half of the search is empty, when it is empty for a reason
  // other than "no match": no AI key funded, or a provider that refused.
  const [lookupNote, setLookupNote] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const scanRef = useRef<HTMLInputElement>(null)
  const queryRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    void repo.listCatalogItems().then(setCatalog)
  }, [repo])

  const focusScan = useCallback(() => {
    setTimeout(() => scanRef.current?.focus(), 30)
  }, [])

  useEffect(() => {
    if (!pendingCode && !cameraOpen) focusScan()
  }, [pendingCode, cameraOpen, focusScan])

  const brands = useMemo(() => knownBrands(catalog ?? []), [catalog])
  const effectiveBrand = brandLocked ? brand.trim() : ''

  // ---- instant, offline local matches + debounced brand-scoped web search ----
  const localHits = useMemo(
    () => (catalog ? searchLocalCatalog(catalog, query, effectiveBrand) : []),
    [catalog, query, effectiveBrand],
  )

  useEffect(() => {
    const q = query.trim()
    if (q.length < MIN_WEB_QUERY) {
      setWebHits([])
      setLookupNote(null)
      setWebSearching(false)
      return
    }
    let cancelled = false
    setWebSearching(true)
    const timer = setTimeout(() => {
      void repo
        .lookupProductSuggestions(q, effectiveBrand || null)
        .then((result) => {
          if (cancelled) return
          // An empty web half is normal. An empty web half *because lookup is
          // switched off or broken* is not, and staring at a blank list is how
          // a shop concludes the whole feature doesn't work.
          setLookupNote(
            !result.aiConfigured
              ? "Product lookup isn't set up yet — an admin needs to add an AI key in Supabase. Type the details in below."
              : result.aiError
                ? `Product lookup failed — ${result.aiError}. Type the details in below.`
                : null,
          )
          setWebHits(
            result.suggestions.map((s, i) => ({
              key: `web:${i}:${s.name}`,
              source: 'web' as const,
              brand: s.brand,
              model: s.model,
              name: s.name,
              priceCents: s.unitPriceCents,
              imageUrl: s.imageUrl,
              score: 0,
            })),
          )
        })
        .catch(() => !cancelled && setWebHits([]))
        .finally(() => !cancelled && setWebSearching(false))
    }, WEB_SEARCH_DEBOUNCE_MS)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [query, effectiveBrand, repo])

  const hits = useMemo(() => mergeSearchHits(localHits, webHits), [localHits, webHits])

  // ---- receiving ----

  /** Records +qty of an existing catalog item and puts it on the session tape. */
  const receiveExisting = useCallback(
    async (item: CatalogItem, code: string | null, isNew = false) => {
      const result = await repo.recordStockMovement({
        catalogItemId: item.id,
        movementType: 'receiving',
        quantityDelta: 1,
        counterpartyName: item.brand ?? effectiveBrand ?? null,
        note: 'Rapid intake',
      })
      setCatalog((prev) => (prev ?? []).map((i) => (i.id === item.id ? result.catalogItem : i)))
      setLines((prev) => {
        const existing = prev.find((l) => l.catalogItemId === item.id)
        if (existing) {
          return prev.map((l) => (l.catalogItemId === item.id ? { ...l, quantity: l.quantity + 1 } : l))
        }
        return [
          {
            id: item.id,
            catalogItemId: item.id,
            name: item.name,
            brand: item.brand,
            model: item.model,
            code,
            quantity: 1,
            isNewProduct: isNew,
            enriching: false,
          },
          ...prev,
        ]
      })
    },
    [repo, effectiveBrand],
  )

  /**
   * Fills in photo/price after the fact so staff never wait for them. Only
   * ever writes fields that are still empty — a price or image a person
   * chose is never overwritten by a web guess (same rule the resolver's own
   * docs set out).
   */
  const enrichInBackground = useCallback(
    (item: CatalogItem, searchTerm: string, hintBrand: string) => {
      if (item.imageUrl && item.defaultPriceCents != null) return
      setLines((prev) => prev.map((l) => (l.catalogItemId === item.id ? { ...l, enriching: true } : l)))
      void repo
        .resolveProduct({ kind: 'text', query: searchTerm, brandHint: hintBrand || null })
        .then(async (res) => {
          const top = res.candidates[0]
          if (!top) return
          const patch: Parameters<typeof repo.updateCatalogItem>[1] = {
            brand: item.brand,
            model: item.model,
            name: item.name,
            defaultPriceCents: item.defaultPriceCents,
          }
          let changed = false
          if (!item.imageUrl && top.imageUrl) {
            patch.imageUrl = top.imageUrl
            patch.imageSourceUrl = top.priceSourceUrl
            changed = true
          }
          if (item.defaultPriceCents == null && top.referencePriceCents != null) {
            patch.defaultPriceCents = top.referencePriceCents
            patch.priceSourceUrl = top.priceSourceUrl
            patch.priceSourceName = top.priceSourceName
            changed = true
          }
          if (!changed) return
          const updated = await repo.updateCatalogItem(item.id, patch)
          setCatalog((prev) => (prev ?? []).map((i) => (i.id === item.id ? updated : i)))
        })
        .catch(() => {
          /* Enrichment is best-effort by design — never surface a failure. */
        })
        .finally(() => {
          setLines((prev) => prev.map((l) => (l.catalogItemId === item.id ? { ...l, enriching: false } : l)))
        })
    },
    [repo],
  )

  function resetIdentify() {
    setPendingCode(null)
    setQuery('')
    setPrice('')
    setWebHits([])
  }

  // ---- scanning ----

  const handleScan = useCallback(
    async (raw: string) => {
      const code = raw.trim()
      if (!code || scanning) return
      setCameraOpen(false)

      // 1. Already taken in this session? Just add one. A case of six is six
      //    beeps and no typing — the single biggest speed win in bulk intake.
      const onTape = lines.find((l) => l.code === code)
      if (onTape && catalog) {
        const item = catalog.find((i) => i.id === onTape.catalogItemId)
        if (item) {
          await receiveExisting(item, code)
          focusScan()
          return
        }
      }

      // 2. Already in the shop's catalog? Instant, no network at all.
      const local = (catalog ?? []).find((i) => i.upc === code || i.sku === code)
      if (local) {
        await receiveExisting(local, code)
        focusScan()
        return
      }

      // 3. Unknown here. One fast remote check (cache + barcode DB, no AI),
      //    then hand over to the keyboard either way.
      setScanning(true)
      try {
        const result = await repo.lookupProductByUpc(code, { fast: true, brandHint: effectiveBrand || null })
        if (result.source === 'catalog') {
          await receiveExisting(result.catalogItem, code)
          focusScan()
          return
        }
        setPendingCode(code)
        if (result.source === 'external') {
          setQuery([result.brand, result.name].filter(Boolean).join(' ').trim() || '')
          if (result.unitPriceCents != null) setPrice(String(result.unitPriceCents / 100))
        } else {
          setQuery('')
        }
      } catch (err) {
        setPendingCode(code)
        toast('error', errorMessage(err) ?? 'Lookup failed — type what it is.')
      } finally {
        setScanning(false)
        setTimeout(() => queryRef.current?.focus(), 40)
      }
    },
    [catalog, lines, scanning, repo, effectiveBrand, receiveExisting, focusScan, toast],
  )

  useHardwareScanner((code) => void handleScan(code), !pendingCode && !cameraOpen)

  async function handlePhoto(base64Jpeg: string) {
    setCameraOpen(false)
    setPendingCode(pendingCode ?? '')
    setScanning(true)
    try {
      const [upload, resolved] = await Promise.allSettled([
        repo.uploadProductPhoto(base64Jpeg),
        repo.resolveProduct({ kind: 'photo', imageBase64: base64Jpeg, mediaType: 'image/jpeg' }),
      ])
      if (resolved.status === 'fulfilled' && resolved.value.candidates.length > 0) {
        const top = resolved.value.candidates[0]
        // Brand is locked separately below, so seed the query with the MODEL
        // only. Prefixing the brand here is what made saveNew build a name of
        // "DS18 DS18 Project 360" and print a doubled title on the tape.
        setQuery(top.model ?? top.name)
        if (top.brand) setBrand(top.brand)
        if (top.referencePriceCents != null) setPrice(String(top.referencePriceCents / 100))
      } else if (resolved.status === 'fulfilled' && !resolved.value.aiConfigured) {
        toast('error', "Product lookup isn't set up yet — an admin needs to add an AI key in Supabase. You can still type the details in.")
      } else if (resolved.status === 'fulfilled' && resolved.value.aiError) {
        // The key is funded but the provider rejected the call. Say what it
        // said, so the fix is one reading rather than a support thread.
        toast('error', `Product lookup failed — ${resolved.value.aiError}. Type the model below.`)
      } else if (resolved.status === 'fulfilled') {
        toast('error', "Couldn't identify that product from the photo. Type the model below.")
      }
      if (upload.status === 'rejected') toast('error', 'Photo upload failed — the product can still be saved.')
    } finally {
      setScanning(false)
      setTimeout(() => queryRef.current?.focus(), 40)
    }
  }

  // ---- saving ----

  /** Binds the pending code to an existing catalog product, then receives one. */
  async function pickExisting(hit: ProductSearchHit) {
    if (!hit.catalogItemId || !catalog) return
    const item = catalog.find((i) => i.id === hit.catalogItemId)
    if (!item) return
    setSaving(true)
    try {
      let target = item
      // Bind the scanned code so this product is never asked about again.
      if (pendingCode && !item.upc) {
        target = await repo.updateCatalogItem(item.id, {
          brand: item.brand,
          model: item.model,
          name: item.name,
          defaultPriceCents: item.defaultPriceCents,
          upc: pendingCode,
          upcIsGenerated: false,
        })
        setCatalog((prev) => (prev ?? []).map((i) => (i.id === item.id ? target : i)))
        toast('success', `Barcode learned — ${formatItemShortName(target)} will scan instantly from now on.`)
      }
      await receiveExisting(target, pendingCode)
      resetIdentify()
      focusScan()
    } catch (err) {
      toast('error', errorMessage(err) ?? 'Could not save.')
    } finally {
      setSaving(false)
    }
  }

  /** Creates a brand-new catalog product from what's typed, binds the code, receives one. */
  async function saveNew(fromHit?: ProductSearchHit) {
    const typed = (fromHit ? [fromHit.brand, fromHit.model ?? fromHit.name].filter(Boolean).join(' ') : query).trim()
    if (!typed) return
    const resolvedBrand = fromHit?.brand ?? effectiveBrand ?? null
    const model = fromHit?.model ?? query.trim()
    // `name` carries the DESCRIPTOR only — never brand or model, which have
    // their own columns. Building it as brand + query (what this used to do)
    // put the same words in twice and rendered as "DS18 Project 360 DS18
    // Project 360" on the tape. canonicalizeProductFields strips repeats on
    // write, but the honest fix is not to duplicate them here in the first
    // place: when all the operator typed was the brand and model, there simply
    // is no descriptor yet, and an empty one is correct.
    const name = fromHit?.name ?? ''
    const priceCents = price.trim() ? parseDollarsToCents(price) : (fromHit?.priceCents ?? null)

    setSaving(true)
    try {
      const created = await repo.createCatalogItem({
        brand: resolvedBrand || null,
        model: model || null,
        name,
        defaultPriceCents: priceCents,
        category: guessCategoryFromName(name),
        upc: pendingCode || null,
        upcIsGenerated: false,
        imageUrl: fromHit?.imageUrl ?? null,
        importSource: fromHit?.source === 'web' ? 'ai_photo_import' : 'manual',
      })
      setCatalog((prev) => [...(prev ?? []), created])
      await receiveExisting(created, pendingCode, true)
      // Photo/price arrive later; staff move on now.
      enrichInBackground(created, [resolvedBrand, model].filter(Boolean).join(' ') || name, resolvedBrand ?? '')
      resetIdentify()
      focusScan()
    } catch (err) {
      toast('error', errorMessage(err) ?? 'Could not save.')
    } finally {
      setSaving(false)
    }
  }

  const totalUnits = lines.reduce((sum, l) => sum + l.quantity, 0)

  if (!catalog) return <LoadingBlock label="Loading catalog…" />

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <Link to="/app/inventory" className="inline-flex items-center gap-1 text-base font-semibold text-brand">
            <ArrowLeft className="h-4 w-4" aria-hidden="true" /> Inventory
          </Link>
          <h1 className="text-3xl font-black text-ink">Rapid intake</h1>
        </div>
        {lines.length > 0 ? (
          <div className="text-right">
            <div className="text-2xl font-black text-ink">{totalUnits}</div>
            <div className="text-sm text-zinc-500">units this session</div>
          </div>
        ) : null}
      </div>

      {/* Brand lock */}
      <Card className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-base font-bold text-ink">Receiving:</span>
          {brandLocked ? (
            <>
              <Badge className="bg-brand text-white">{brand}</Badge>
              <button type="button" onClick={() => setBrandLocked(false)} className="text-sm font-semibold text-brand underline">
                change
              </button>
            </>
          ) : (
            <span className="text-base text-zinc-600">pick a brand to make searches far more accurate</span>
          )}
        </div>
        {!brandLocked ? (
          <>
            <div className="flex gap-2">
              <Input
                value={brand}
                onChange={(e) => setBrand(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && brand.trim()) {
                    e.preventDefault()
                    setBrandLocked(true)
                  }
                }}
                placeholder="e.g. Nemesis Audio"
                aria-label="Brand being received"
              />
              <Button onClick={() => brand.trim() && setBrandLocked(true)} disabled={!brand.trim()}>
                Lock
              </Button>
            </div>
            {brands.length > 0 ? (
              <div className="flex flex-wrap gap-2 pt-1">
                {brands.slice(0, 6).map((b) => (
                  <button
                    key={b}
                    type="button"
                    onClick={() => {
                      setBrand(b)
                      setBrandLocked(true)
                    }}
                    className="min-h-9 rounded-full border border-zinc-300 px-3 text-sm font-semibold text-zinc-700 hover:border-brand hover:text-brand"
                  >
                    {b}
                  </button>
                ))}
              </div>
            ) : null}
          </>
        ) : null}
      </Card>

      <div className="grid gap-4 lg:grid-cols-[1fr_20rem]">
        <div className="space-y-4">
          {cameraOpen ? (
            <Suspense fallback={<LoadingBlock label="Loading camera…" />}>
              <BarcodeScanner
                onBarcodeDetected={(c) => void handleScan(c)}
                onPhotoCaptured={(p) => void handlePhoto(p)}
                onCameraError={(m) => {
                  setCameraOpen(false)
                  toast('error', m)
                }}
              />
            </Suspense>
          ) : pendingCode === null ? (
            <Card className="space-y-3">
              <div className="rounded-xl border-2 border-dashed border-zinc-300 bg-zinc-50 p-6 text-center">
                <p className="mb-3 text-base font-semibold text-zinc-700">
                  {scanning ? 'Checking…' : 'Scan the next box'}
                </p>
                <input
                  ref={scanRef}
                  type="text"
                  inputMode="none"
                  onKeyDown={(e) => {
                    if (e.key !== 'Enter') return
                    e.preventDefault()
                    const v = e.currentTarget.value.trim()
                    e.currentTarget.value = ''
                    if (v) void handleScan(v)
                  }}
                  onBlur={focusScan}
                  placeholder="Scan a barcode…"
                  className="h-12 w-full rounded-lg border border-zinc-300 bg-white px-3 text-center text-base"
                />
                {scanning ? (
                  <Loader2 className="mx-auto mt-3 h-5 w-5 animate-spin text-brand" aria-hidden="true" />
                ) : null}
              </div>
              <div className="flex gap-2">
                <Button variant="secondary" className="flex-1" onClick={() => setCameraOpen(true)}>
                  <Camera className="h-5 w-5" aria-hidden="true" /> Camera
                </Button>
                <Button variant="ghost" className="flex-1" onClick={() => setPendingCode('')}>
                  No barcode — type it
                </Button>
              </div>
            </Card>
          ) : (
            <Card className="space-y-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="text-xl font-bold text-ink">What is it?</h2>
                  {pendingCode ? (
                    <p className="text-sm text-zinc-500">
                      Code <span className="font-mono">{pendingCode}</span> isn&apos;t in any barcode database — name it
                      once and it&apos;ll scan instantly forever.
                    </p>
                  ) : (
                    <p className="text-sm text-zinc-500">No barcode — this product will get an internal code.</p>
                  )}
                </div>
                <button type="button" onClick={() => { resetIdentify(); focusScan() }} aria-label="Cancel" className="text-zinc-400 hover:text-zinc-700">
                  <X className="h-5 w-5" aria-hidden="true" />
                </button>
              </div>

              <Field label={effectiveBrand ? `${effectiveBrand} model` : 'Model or product name'} htmlFor="intake-query" required>
                <Input
                  id="intake-query"
                  ref={queryRef}
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && query.trim() && !saving) {
                      e.preventDefault()
                      void saveNew()
                    }
                  }}
                  placeholder={effectiveBrand ? 'NA-12F' : 'Nemesis Audio NA-12F'}
                  autoComplete="off"
                />
              </Field>

              {hits.length > 0 ? (
                <ul className="divide-y divide-zinc-100 overflow-hidden rounded-xl border border-zinc-200">
                  {hits.map((hit) => (
                    <li key={hit.key}>
                      <button
                        type="button"
                        disabled={saving}
                        onClick={() => (hit.source === 'catalog' ? void pickExisting(hit) : void saveNew(hit))}
                        className="flex w-full items-center gap-3 px-3 py-2.5 text-left hover:bg-zinc-50 disabled:opacity-50"
                      >
                        {hit.imageUrl ? (
                          <img src={hit.imageUrl} alt="" className="h-10 w-10 shrink-0 rounded object-contain" />
                        ) : (
                          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded bg-zinc-100 text-zinc-400">
                            <Package className="h-5 w-5" aria-hidden="true" />
                          </span>
                        )}
                        <span className="min-w-0 flex-1">
                          <span className="block truncate font-semibold text-ink">{splitItemName(hit).title}</span>
                          <span className="block truncate text-sm text-zinc-500">
                            {splitItemName(hit).descriptor ?? '—'}
                          </span>
                        </span>
                        <span className="shrink-0 text-right">
                          {hit.priceCents != null ? (
                            <span className="block text-sm font-semibold text-ink">{formatCurrency(hit.priceCents)}</span>
                          ) : null}
                          {hit.source === 'catalog' ? (
                            <Badge className="bg-green-100 text-green-800">In stock: {hit.quantityOnHand ?? 0}</Badge>
                          ) : (
                            <Badge className="bg-blue-50 text-brand">Web</Badge>
                          )}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}

              {webSearching ? (
                <p className="flex items-center gap-2 text-sm text-zinc-500">
                  <Sparkles className="h-4 w-4 animate-pulse text-brand" aria-hidden="true" />
                  Searching {effectiveBrand || 'the web'}…
                </p>
              ) : lookupNote ? (
                <p className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">{lookupNote}</p>
              ) : null}

              <Field label="Price (optional — fills in automatically if left blank)" htmlFor="intake-price">
                <Input
                  id="intake-price"
                  inputMode="decimal"
                  value={price}
                  onChange={(e) => setPrice(e.target.value)}
                  placeholder="0.00"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && query.trim() && !saving) {
                      e.preventDefault()
                      void saveNew()
                    }
                  }}
                />
              </Field>

              <Button onClick={() => void saveNew()} disabled={saving || !query.trim()} className="w-full">
                {saving ? 'Saving…' : 'Save & scan next'}
              </Button>
            </Card>
          )}
        </div>

        {/* Session tape */}
        <Card className="lg:sticky lg:top-24 lg:self-start">
          <h2 className="text-lg font-bold text-ink">This session</h2>
          {lines.length === 0 ? (
            <p className="mt-2 text-sm text-zinc-600">Nothing taken in yet. Scan a box to start.</p>
          ) : (
            <ul className="mt-2 divide-y divide-zinc-100">
              {lines.map((line) => {
                const title = formatItemShortName(line)
                const detail = line.name.trim() && line.name.trim() !== title ? line.name.trim() : line.brand
                return (
                <li key={line.id} className="flex items-center gap-2 py-2">
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-green-100 text-green-800">
                    <Check className="h-3.5 w-3.5" aria-hidden="true" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <Link to={`/app/inventory/${line.catalogItemId}`} className="block truncate text-sm font-semibold text-ink hover:text-brand">
                      {title}
                    </Link>
                    <span className="flex items-center gap-1.5 text-xs text-zinc-500">
                      {line.isNewProduct ? <Badge className="bg-blue-50 px-1.5 py-0 text-[11px] text-brand">New</Badge> : null}
                      {line.enriching ? (
                        <span className="flex items-center gap-1">
                          <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" /> finding photo…
                        </span>
                      ) : (
                        detail ?? '—'
                      )}
                    </span>
                  </span>
                  <span className="shrink-0 text-base font-black text-ink">×{line.quantity}</span>
                </li>
                )
              })}
            </ul>
          )}
          {mode === 'demo' ? (
            <p className="mt-3 text-xs text-zinc-500">
              Demo mode never makes a real web call, so the web half of the search stays empty here.
            </p>
          ) : null}
        </Card>
      </div>
    </div>
  )
}
