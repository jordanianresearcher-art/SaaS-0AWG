// Rapid intake — /app/inventory/new.
//
// Scan first, identify later.
//
// The old flow stopped dead on every scan: fire the trigger, wait for a
// lookup, name the thing, save, then scan the next one. A pallet of forty
// boxes meant forty pauses, and the pauses were the slow part — the scanning
// itself takes a second. Staff worked around it by not using the app.
//
// Now scanning only records a code and a quantity, which never blocks.
// Identification runs behind it, one lookup at a time, filling rows in as
// answers arrive. When the pallet is done, the operator reviews a list that
// has mostly identified itself, fixes what the machine got wrong, and commits
// the whole batch in one go.
//
// The batch itself lives in src/lib/intakeBatch.ts, which is pure and tested —
// including the part with the sharp edges: lookups finish out of order and can
// come back for a line the operator has since edited or deleted, and a stale
// answer must never overwrite a person's correction.

import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { Barcode, Camera, Check, Loader2, Package, Search, Trash2 } from 'lucide-react'
import { useAppData, useRepo } from '../../data/AppDataContext'
import { useToast } from '../../components/Toast'
import { Badge, Button, Card, EmptyState, Field, Input, LoadingBlock, PageHeader } from '../../components/ui'
import { useHardwareScanner } from '../../lib/useHardwareScanner'
import { formatCurrency } from '../../lib/format'
import { formatItemDisplayName } from '../../lib/productNaming'
import { barcodeAdvice, classifyBarcode } from '../../lib/barcodeIdentity'
import { searchLocalCatalog } from '../../lib/productSearch'
import { errorMessage } from '../../lib/errors'
import {
  addScan,
  addTypedEntry,
  applyResolution,
  chooseAlternate,
  editLine,
  markResolving,
  nextPending,
  removeLine,
  setQuantity,
  summarize,
  type IntakeAlternate,
  type IntakeBatchLine,
} from '../../lib/intakeBatch'
import type { CatalogItem } from '../../types'
import type { ProductResolutionCandidate } from '../../data/repository'
import { loadIntakeBatch, saveIntakeBatch } from '../../lib/intakeStash'

const BarcodeScanner = lazy(() => import('../../components/BarcodeScanner').then((m) => ({ default: m.BarcodeScanner })))

export default function RapidIntakePage() {
  const repo = useRepo()
  const { mode } = useAppData()
  const toast = useToast()

  const [catalog, setCatalog] = useState<CatalogItem[] | null>(null)
  const [batch, setBatch] = useState<IntakeBatchLine[]>(loadIntakeBatch)
  const [phase, setPhase] = useState<'scanning' | 'review'>('scanning')
  const [cameraOpen, setCameraOpen] = useState(false)
  const [committing, setCommitting] = useState(false)
  const [typedText, setTypedText] = useState('')
  const scanRef = useRef<HTMLInputElement>(null)
  const typedRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    void repo.listCatalogItems().then(setCatalog)
  }, [repo])

  useEffect(() => {
    saveIntakeBatch(batch)
  }, [batch])

  const focusScan = useCallback(() => {
    setTimeout(() => {
      // The scan box normally reclaims focus so the next trigger-pull always
      // lands somewhere — but never while someone is typing a no-barcode
      // product into the field below, or it would steal the cursor mid-word.
      if (document.activeElement === typedRef.current) return
      scanRef.current?.focus()
    }, 30)
  }, [])

  const handleScan = useCallback(
    (raw: string) => {
      const code = raw.trim()
      if (!code) return
      setBatch((prev) => addScan(prev, code))
      focusScan()
    },
    [focusScan],
  )

  /**
   * The machine's top guesses as review options. Three is the ceiling the
   * candidates already arrive under; anything the shop's own catalog or the
   * shared catalog answered doesn't come through here, so everything in this
   * list is genuinely a guess worth double-checking.
   */
  const toAlternates = (candidates: ProductResolutionCandidate[]): IntakeAlternate[] =>
    candidates.slice(0, 3).map((c) => ({
      brand: c.brand,
      model: c.model,
      name: c.name,
      imageUrl: c.imageUrl,
      referencePriceCents: c.referencePriceCents,
      source: c.source === 'shared_catalog' ? ('shared' as const) : ('web' as const),
    }))

  const handleTypedAdd = useCallback(() => {
    const text = typedText.trim()
    if (text.length < 2) return
    setBatch((prev) => addTypedEntry(prev, text))
    setTypedText('')
    // Focus stays here: someone typing products in is going to type another.
    typedRef.current?.focus()
  }, [typedText])

  useHardwareScanner((code) => handleScan(code), phase === 'scanning' && !cameraOpen)

  // ---- the background identifier -------------------------------------------
  //
  // One at a time, deliberately. Firing forty lookups at once would rate-limit
  // the barcode database and cost forty AI calls for a pallet where half the
  // items are already in the shop's own catalog. Sequential also means the
  // list fills top-down in scan order, which reads as progress.
  const resolving = useRef(false)

  /**
   * A lookup that never comes back must not take the batch with it.
   *
   * Lines resolve strictly one at a time, so a single hung request stalls
   * every line behind it — the operator sees "Still looking…" forever on a
   * list that has silently stopped working, with nothing to click. Capping
   * each lookup turns that into one honest "name it yourself" and lets the
   * queue move on. Generous on purpose: a real grounded search can take
   * twenty seconds, and cutting off a slow answer that was about to arrive
   * is its own kind of wrong.
   */
  const LOOKUP_TIMEOUT_MS = 30_000

  const withTimeout = useCallback(async <T,>(work: Promise<T>, fallback: T): Promise<T> => {
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      return await Promise.race([
        work,
        new Promise<T>((resolve) => {
          timer = setTimeout(() => resolve(fallback), LOOKUP_TIMEOUT_MS)
        }),
      ])
    } finally {
      if (timer) clearTimeout(timer)
    }
  }, [])

  useEffect(() => {
    if (resolving.current || catalog === null) return
    const line = nextPending(batch)
    if (!line) return

    resolving.current = true
    const startedAtRevision = line.revision
    setBatch((prev) => markResolving(prev, line.code))

    void (async () => {
      try {
        // A typed line is a text search, not a barcode: no classification,
        // no barcode databases. Its own catalog check matches on model/SKU/
        // name the way the search box does, and only an exact-grade match
        // (score >= 880: full model, SKU, or brand+model) binds to an
        // existing item — a fuzzy local match would silently merge two
        // different products' stock counts.
        if (line.entry === 'typed') {
          const localHit = searchLocalCatalog(catalog ?? [], line.code, null, 1)[0]
          if (localHit && localHit.score >= 880 && localHit.catalogItemId) {
            setBatch((prev) =>
              applyResolution(
                prev,
                line.code,
                {
                  status: 'resolved',
                  brand: localHit.brand,
                  model: localHit.model,
                  name: localHit.name,
                  imageUrl: localHit.imageUrl,
                  source: 'catalog',
                  catalogItemId: localHit.catalogItemId,
                },
                startedAtRevision,
              ),
            )
            return
          }

          // The resolver's text path: live retailer listings first, the AI
          // only for what no store carries. Shared-catalog rows come back as
          // candidates too, marked with their source.
          const result = await withTimeout(repo.resolveProduct({ kind: 'text', query: line.code }), {
            candidates: [],
            retainedInput: line.code,
            aiConfigured: true,
            aiError: null,
            unresolvableBarcode: false,
          })
          const top = result.candidates[0]
          if (top) {
            setBatch((prev) =>
              applyResolution(
                prev,
                line.code,
                {
                  status: 'resolved',
                  brand: top.brand,
                  model: top.model,
                  name: top.name,
                  imageUrl: top.imageUrl,
                  referencePriceCents: top.referencePriceCents,
                  source: top.source === 'shared_catalog' ? 'shared' : 'web',
                  alternates: toAlternates(result.candidates),
                },
                startedAtRevision,
              ),
            )
          } else {
            setBatch((prev) => applyResolution(prev, line.code, { status: 'unidentified' }, startedAtRevision))
          }
          return
        }

        // 1. This shop's own catalog. Instant, free, and the most likely hit
        //    on a re-order — no reason to ask anyone else first.
        const local = (catalog ?? []).find((i) => i.upc === line.code || i.sku === line.code)
        if (local) {
          setBatch((prev) =>
            applyResolution(
              prev,
              line.code,
              {
                status: 'resolved',
                brand: local.brand,
                model: local.model,
                name: local.name,
                imageUrl: local.imageUrl,
                source: 'catalog',
                catalogItemId: local.id,
              },
              startedAtRevision,
            ),
          )
          return
        }

        // 2. A code no database can hold never goes to the network at all
        //    (store-assigned prefixes, internal item numbers — see
        //    barcodeIdentity.ts). It goes straight to "name it by hand".
        if (barcodeAdvice(classifyBarcode(line.code))) {
          setBatch((prev) => applyResolution(prev, line.code, { status: 'unidentified' }, startedAtRevision))
          return
        }

        // 3. Everything else — the shared catalog, then the barcode database,
        //    then AI. All three live behind lookupProductByUpc so this page
        //    and the scan workspace climb the same ladder in the same order.
        //    This used to query the shared catalog here as well, which meant
        //    a second identical RPC on every miss and a looser match than the
        //    repository's (it accepted the top row of a text search on a
        //    barcode, which is not the same claim as an exact barcode hit).
        const result = await withTimeout(repo.lookupProductByUpc(line.code), { source: 'not_found' as const })
        if (result.source === 'catalog') {
          setBatch((prev) =>
            applyResolution(
              prev,
              line.code,
              {
                status: 'resolved',
                brand: result.catalogItem.brand,
                model: result.catalogItem.model,
                name: result.catalogItem.name,
                imageUrl: result.catalogItem.imageUrl,
                source: 'catalog',
                catalogItemId: result.catalogItem.id,
              },
              startedAtRevision,
            ),
          )
        } else if (result.source === 'external') {
          setBatch((prev) =>
            applyResolution(
              prev,
              line.code,
              {
                status: 'resolved',
                brand: result.brand,
                name: result.name ?? '',
                imageUrl: result.imageUrl,
                referencePriceCents: result.unitPriceCents,
                source: 'web',
              },
              startedAtRevision,
            ),
          )
        } else if (result.source === 'candidates' && result.candidates.length > 0) {
          const top = result.candidates[0]
          setBatch((prev) =>
            applyResolution(
              prev,
              line.code,
              {
                status: 'resolved',
                brand: top.brand,
                model: top.model,
                name: top.name,
                imageUrl: top.imageUrl,
                referencePriceCents: top.referencePriceCents,
                // Where it really came from: a shared-catalog hit is another
                // shop's identification, not a web search, and the review
                // screen's badge should say so.
                source: top.source === 'shared_catalog' ? 'shared' : 'web',
                alternates: toAlternates(result.candidates),
              },
              startedAtRevision,
            ),
          )
        } else {
          setBatch((prev) => applyResolution(prev, line.code, { status: 'unidentified' }, startedAtRevision))
        }
      } catch (err) {
        // A failed lookup is not a failed scan. The line stays, named by hand.
        console.error('intake resolution failed', err)
        setBatch((prev) => applyResolution(prev, line.code, { status: 'unidentified' }, startedAtRevision))
      } finally {
        resolving.current = false
        // Nudge the effect to pick up the next pending line.
        setBatch((prev) => [...prev])
      }
    })()
  }, [batch, catalog, repo, withTimeout])

  const summary = useMemo(() => summarize(batch), [batch])

  const commit = async () => {
    setCommitting(true)
    let added = 0
    try {
      for (const line of batch) {
        let catalogItemId = line.catalogItemId

        if (!catalogItemId) {
          const created = await repo.createCatalogItem({
            brand: line.brand,
            model: line.model,
            name: line.name || line.code,
            defaultPriceCents: null,
            // A scanned code is the product's barcode; typed text is just
            // what someone called it, and saving it as a UPC would poison
            // every future scan-match against this item.
            upc: line.entry === 'typed' ? null : line.code,
            upcIsGenerated: false,
            imageUrl: line.imageUrl,
          })
          catalogItemId = created.id
        }

        await repo.recordStockMovement({
          catalogItemId,
          movementType: 'receiving',
          quantityDelta: line.quantity,
          counterpartyName: line.brand,
          note: 'Rapid intake',
        })
        added += line.quantity
      }

      setBatch([])
      setPhase('scanning')
      setCatalog(await repo.listCatalogItems())
      toast('success', `Took in ${added} unit${added === 1 ? '' : 's'}.`)
      focusScan()
    } catch (err) {
      // The batch is deliberately NOT cleared: whatever failed, the operator
      // still has their scans and can retry rather than re-scanning a pallet.
      toast('error', errorMessage(err) ?? 'Could not save the batch. Your scans are still here.')
    } finally {
      setCommitting(false)
    }
  }

  if (catalog === null) return <LoadingBlock label="Loading catalog…" />

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <PageHeader
        back={{ to: '/app/inventory', label: 'Inventory' }}
        title="Rapid intake"
        subtitle={
          phase === 'scanning'
            ? 'Scan everything first. Names fill themselves in while you work.'
            : 'Check what came back, fix anything wrong, then take it all in.'
        }
        actions={
          summary.lines > 0 ? (
            <div className="text-right">
              <div className="text-2xl font-black text-ink">{summary.units}</div>
              <div className="text-sm text-zinc-500">units scanned</div>
            </div>
          ) : undefined
        }
      />

      {phase === 'scanning' ? (
        <div className="grid gap-5 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
          <div className="space-y-4">
            {cameraOpen ? (
              <Suspense fallback={<LoadingBlock label="Loading camera…" />}>
                <BarcodeScanner
                  onBarcodeDetected={(c) => {
                    handleScan(c)
                    setCameraOpen(false)
                  }}
                  // Photo identification belongs to the review step, not the
                  // scanning one: a photo has to be looked at, and stopping to
                  // look at something is exactly what batch mode exists to
                  // avoid. Snapping a picture here just records nothing.
                  onPhotoCaptured={() => {
                    setCameraOpen(false)
                    toast('info', 'Scan the barcode to add it — photo lookup lives on the item screen.')
                  }}
                  onCameraError={(m) => {
                    setCameraOpen(false)
                    toast('error', m)
                  }}
                />
              </Suspense>
            ) : (
              <Card className="space-y-3">
                <div className="flex min-h-64 flex-col items-center justify-center rounded-xl border-2 border-dashed border-zinc-300 bg-zinc-50 p-6 text-center">
                  <span className="mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-tint text-brand">
                    <Barcode className="h-7 w-7" aria-hidden="true" />
                  </span>
                  <p className="mb-1 text-xl font-bold text-ink">Scan away</p>
                  <p className="mb-4 text-sm text-zinc-500">
                    Every scan lands instantly. Scan the same box twice to count two.
                  </p>
                  <input
                    ref={scanRef}
                    type="text"
                    inputMode="none"
                    autoFocus
                    onKeyDown={(e) => {
                      if (e.key !== 'Enter') return
                      e.preventDefault()
                      const v = e.currentTarget.value.trim()
                      e.currentTarget.value = ''
                      handleScan(v)
                    }}
                    onBlur={focusScan}
                    placeholder="Scan a barcode…"
                    className="h-12 w-full max-w-sm rounded-lg border border-zinc-300 bg-white px-3 text-center text-base"
                  />
                </div>
                <Button variant="secondary" className="w-full" onClick={() => setCameraOpen(true)}>
                  <Camera className="h-5 w-5" aria-hidden="true" /> Use the camera
                </Button>
                <div>
                  <p className="mb-1.5 text-sm font-medium text-zinc-600">No barcode on the box?</p>
                  <div className="flex gap-2">
                    <Input
                      ref={typedRef}
                      value={typedText}
                      onChange={(e) => setTypedText(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key !== 'Enter') return
                        e.preventDefault()
                        handleTypedAdd()
                      }}
                      placeholder="Type the model or name — e.g. JP234"
                      autoComplete="off"
                    />
                    <Button variant="secondary" onClick={handleTypedAdd} disabled={typedText.trim().length < 2}>
                      Add
                    </Button>
                  </div>
                </div>
              </Card>
            )}

            {summary.lines > 0 ? (
              <Button className="w-full" onClick={() => setPhase('review')}>
                <Search className="h-5 w-5" aria-hidden="true" />
                Review {summary.lines} product{summary.lines === 1 ? '' : 's'}
                {summary.working > 0 ? ` · ${summary.working} still looking` : ''}
              </Button>
            ) : null}
          </div>

          <Card className="lg:sticky lg:top-24 lg:self-start lg:min-h-[22rem]">
            <h2 className="text-lg font-bold text-ink">This batch</h2>
            {batch.length === 0 ? (
              <p className="mt-2 text-sm text-zinc-600">Nothing scanned yet.</p>
            ) : (
              <ul className="mt-2 divide-y divide-zinc-100">
                {batch.map((line) => (
                  <BatchRow
                    key={line.code}
                    line={line}
                    onQuantity={(q) => setBatch((prev) => setQuantity(prev, line.code, q))}
                    onRemove={() => setBatch((prev) => removeLine(prev, line.code))}
                  />
                ))}
              </ul>
            )}
            {mode === 'demo' ? (
              <p className="mt-3 text-xs text-zinc-500">Demo mode never makes a real lookup call.</p>
            ) : null}
          </Card>
        </div>
      ) : (
        <ReviewStep
          batch={batch}
          committing={committing}
          onEdit={(code, patch) => setBatch((prev) => editLine(prev, code, patch))}
          onChooseAlternate={(code, index) => setBatch((prev) => chooseAlternate(prev, code, index))}
          onQuantity={(code, q) => setBatch((prev) => setQuantity(prev, code, q))}
          onRemove={(code) => setBatch((prev) => removeLine(prev, code))}
          onBack={() => {
            setPhase('scanning')
            focusScan()
          }}
          onCommit={() => void commit()}
        />
      )}
    </div>
  )
}

const SOURCE_LABEL = {
  catalog: 'Already yours',
  shared: 'From other shops',
  web: 'From the web',
} as const

function BatchRow({
  line,
  onQuantity,
  onRemove,
}: {
  line: IntakeBatchLine
  onQuantity: (q: number) => void
  onRemove: () => void
}) {
  const identified = line.status === 'resolved'
  return (
    <li className="flex items-center gap-2 py-2">
      <span
        className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${
          identified
            ? 'bg-green-100 text-green-800'
            : line.status === 'unidentified'
              ? 'bg-amber-100 text-amber-800'
              : 'bg-zinc-100 text-zinc-400'
        }`}
      >
        {identified ? (
          <Check className="h-4 w-4" aria-hidden="true" />
        ) : line.status === 'unidentified' ? (
          <Package className="h-4 w-4" aria-hidden="true" />
        ) : (
          <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
        )}
      </span>

      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold text-ink">
          {identified ? formatItemDisplayName(line) : line.code}
        </span>
        <span className="block truncate text-xs text-zinc-500">
          {line.status === 'resolved' && line.source
            ? SOURCE_LABEL[line.source]
            : line.status === 'unidentified'
              ? 'Name it in review'
              : 'Looking…'}
        </span>
      </span>

      <input
        type="number"
        min={0}
        value={line.quantity}
        aria-label={`Quantity for ${line.code}`}
        onChange={(e) => onQuantity(Number(e.target.value))}
        className="h-9 w-14 shrink-0 rounded-lg border border-zinc-300 text-center text-sm"
      />
      <button
        type="button"
        onClick={onRemove}
        aria-label={`Remove ${line.code}`}
        className="shrink-0 text-zinc-400 hover:text-red-700"
      >
        <Trash2 className="h-4 w-4" aria-hidden="true" />
      </button>
    </li>
  )
}

function ReviewStep({
  batch,
  committing,
  onEdit,
  onChooseAlternate,
  onQuantity,
  onRemove,
  onBack,
  onCommit,
}: {
  batch: IntakeBatchLine[]
  committing: boolean
  onEdit: (code: string, patch: Partial<Pick<IntakeBatchLine, 'brand' | 'model' | 'name'>>) => void
  onChooseAlternate: (code: string, index: number) => void
  onQuantity: (code: string, q: number) => void
  onRemove: (code: string) => void
  onBack: () => void
  onCommit: () => void
}) {
  const summary = summarize(batch)

  if (batch.length === 0) {
    return (
      <EmptyState
        title="Nothing to review"
        message="Scan some products first and they'll line up here."
        action={<Button onClick={onBack}>Back to scanning</Button>}
      />
    )
  }

  return (
    <div className="space-y-4">
      <Card className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-base text-zinc-700">
          <span className="font-bold text-ink">{summary.identified}</span> identified
          {summary.unidentified > 0 ? (
            <>
              {' · '}
              <span className="font-bold text-amber-800">{summary.unidentified}</span> need a name
            </>
          ) : null}
          {summary.working > 0 ? (
            <>
              {' · '}
              <span className="font-bold text-zinc-500">{summary.working}</span> still looking
            </>
          ) : null}
        </p>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={onBack}>
            <Barcode className="h-5 w-5" aria-hidden="true" /> Scan more
          </Button>
          <Button disabled={committing} onClick={onCommit}>
            <Check className="h-5 w-5" aria-hidden="true" />
            {committing ? 'Taking in…' : `Take in ${summary.units} unit${summary.units === 1 ? '' : 's'}`}
          </Button>
        </div>
      </Card>

      <ul className="space-y-3">
        {batch.map((line) => (
          <li key={line.code}>
            <Card className="space-y-3">
              <div className="flex items-start gap-3">
                {line.imageUrl ? (
                  <img src={line.imageUrl} alt="" className="h-14 w-14 shrink-0 rounded-lg border border-zinc-200 object-contain" />
                ) : (
                  <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-lg bg-zinc-100 text-zinc-400">
                    <Package className="h-6 w-6" aria-hidden="true" />
                  </span>
                )}
                <div className="min-w-0 flex-1">
                  <p className="font-mono text-xs text-zinc-500">{line.code}</p>
                  {line.status === 'resolved' && line.source ? (
                    <Badge className="mt-1 bg-brand-tint text-brand">{SOURCE_LABEL[line.source]}</Badge>
                  ) : line.status === 'unidentified' ? (
                    <Badge className="mt-1 bg-amber-100 text-amber-900">Not found — name it</Badge>
                  ) : (
                    <Badge className="mt-1 bg-zinc-100 text-zinc-600">Still looking…</Badge>
                  )}
                  {line.referencePriceCents !== null ? (
                    <p className="mt-1 text-xs text-zinc-500">
                      List price {formatCurrency(line.referencePriceCents)}
                    </p>
                  ) : null}
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <input
                    type="number"
                    min={0}
                    value={line.quantity}
                    aria-label={`Quantity for ${line.code}`}
                    onChange={(e) => onQuantity(line.code, Number(e.target.value))}
                    className="h-11 w-16 rounded-lg border border-zinc-300 text-center text-base"
                  />
                  <button
                    type="button"
                    onClick={() => onRemove(line.code)}
                    aria-label={`Remove ${line.code}`}
                    className="text-zinc-400 hover:text-red-700"
                  >
                    <Trash2 className="h-5 w-5" aria-hidden="true" />
                  </button>
                </div>
              </div>

              {line.alternates.length > 1 ? (
                <div>
                  {/* The machine's other guesses, as one-tap options. The
                      active chip is whichever the line currently matches, so
                      flipping between them while holding the box reads as a
                      selection, not a mystery button. */}
                  <p className="mb-1.5 text-xs font-medium text-zinc-500">Which one is it?</p>
                  <div className="flex flex-wrap gap-1.5">
                    {line.alternates.map((alt, i) => {
                      const active = line.name === alt.name && line.brand === alt.brand && line.model === alt.model
                      return (
                        <button
                          key={i}
                          type="button"
                          onClick={() => onChooseAlternate(line.code, i)}
                          className={`rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
                            active
                              ? 'border-brand bg-brand-tint text-brand'
                              : 'border-zinc-300 bg-white text-zinc-700 hover:border-zinc-400'
                          }`}
                        >
                          {[alt.brand, alt.model ?? alt.name].filter(Boolean).join(' ')}
                          {alt.referencePriceCents !== null ? ` · ${formatCurrency(alt.referencePriceCents)}` : ''}
                        </button>
                      )
                    })}
                  </div>
                </div>
              ) : null}

              <div className="grid gap-3 sm:grid-cols-3">
                <Field label="Brand" htmlFor={`b-${line.code}`}>
                  <Input
                    id={`b-${line.code}`}
                    value={line.brand ?? ''}
                    onChange={(e) => onEdit(line.code, { brand: e.target.value || null })}
                  />
                </Field>
                <Field label="Model" htmlFor={`m-${line.code}`}>
                  <Input
                    id={`m-${line.code}`}
                    value={line.model ?? ''}
                    onChange={(e) => onEdit(line.code, { model: e.target.value || null })}
                  />
                </Field>
                <Field label="Description" htmlFor={`n-${line.code}`}>
                  <Input
                    id={`n-${line.code}`}
                    value={line.name}
                    onChange={(e) => onEdit(line.code, { name: e.target.value })}
                  />
                </Field>
              </div>
            </Card>
          </li>
        ))}
      </ul>

      <p className="text-center text-sm text-zinc-500">
        Anything still looking will keep resolving — you can take the batch in whenever you like.{' '}
        <Link to="/app/inventory" className="font-semibold text-brand">
          Inventory
        </Link>
      </p>
    </div>
  )
}
