// The scan-to-invoice workspace: the shop's primary daily workflow. Scan a
// barcode (or search/add manually) and it lands in the center work area,
// editable via a pencil button; the side panel is where staff decide what
// this scan session becomes. This phase wires only the "Invoice" document
// type end to end — Quote/Receive inventory/Outgoing order are shown as
// upcoming, not yet functional (see docs/INVENTORY_AND_SCANNING.md).

import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { AlertTriangle, Barcode, Camera, Loader2, Mail, MapPin, Minus, Package, Pencil, Phone, Plus, Printer, Search, Trash2 } from 'lucide-react'
import { useAppData, useRepo } from '../../data/AppDataContext'
import { useToast } from '../../components/Toast'
import { Button, Card, EmptyState, Field, Input, LoadingBlock, Modal, Select } from '../../components/ui'
import { ProductSuggestField } from '../../components/ProductSuggestField'
import { formatCurrency, formatDateTime, parseDollarsToCents } from '../../lib/format'
import { newId } from '../../lib/ids'
import { useHardwareScanner } from '../../lib/useHardwareScanner'
import {
  addOrIncrementCartItem,
  cartSubtotalCents,
  cartToInvoiceItemInputs,
  cartToQuoteItemInputs,
  removeCartItem,
  setCartItemQuantity,
  updateCartItem,
  type ScannedCartItem,
} from '../../lib/scanCart'
import type { CatalogItem, Invoice, InvoicePaymentMethod, Shop } from '../../types'
import type { ProductResolutionCandidate, ProductSuggestion } from '../../data/repository'
import type { ScanQuotePrefill } from './NewQuotePage'

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

// @zxing/browser (~470kb) only matters once someone actually opens the
// scanner — code-split it into its own chunk instead of bloating the main
// bundle every phone loads just to reach the dashboard.
const BarcodeScanner = lazy(() =>
  import('../../components/BarcodeScanner').then((m) => ({ default: m.BarcodeScanner })),
)

const PAYMENT_METHOD_LABELS: Record<InvoicePaymentMethod, string> = {
  cash: 'Cash',
  card: 'Card',
  zelle: 'Zelle',
  cashapp: 'Cash App',
  venmo: 'Venmo',
  paypal: 'PayPal',
  link: 'Payment link',
  other: 'Other',
}

function catalogItemToCartItem(item: CatalogItem, quantity = 1): ScannedCartItem {
  return {
    id: newId(),
    catalogItemId: item.id,
    name: item.name,
    brand: item.brand,
    model: item.model,
    imageUrl: item.imageUrl,
    unitPriceCents: item.defaultPriceCents ?? 0,
    quantity,
    category: item.category,
  }
}

export default function ScanWorkspacePage() {
  const repo = useRepo()
  const { shop } = useAppData()
  const toast = useToast()
  const navigate = useNavigate()

  const [catalogItems, setCatalogItems] = useState<CatalogItem[] | null>(null)
  useEffect(() => {
    void repo.listCatalogItems().then(setCatalogItems)
  }, [repo])

  const [cart, setCart] = useState<ScannedCartItem[]>([])
  const [invoice, setInvoice] = useState<Invoice | null>(null)
  const [scannerOpen, setScannerOpen] = useState(false)
  const [lookupBusy, setLookupBusy] = useState(false)
  const [manualQuery, setManualQuery] = useState('')
  const [scanInputValue, setScanInputValue] = useState('')
  const scanInputRef = useRef<HTMLInputElement>(null)
  const [editingRowId, setEditingRowId] = useState<string | null>(null)
  const [customName, setCustomName] = useState('')
  const [customPrice, setCustomPrice] = useState('')
  // Never-dead-end resolver state: a barcode that missed the local catalog
  // (and wasn't a single confident external match) goes through
  // resolveProduct() automatically. null = no candidates being shown;
  // an array (possibly empty, though an empty array closes the modal
  // immediately in favor of the retained-code hint below) is what's
  // offered for confirmation. See handleBarcodeDetected.
  const [resolveCandidates, setResolveCandidates] = useState<ProductResolutionCandidate[] | null>(null)
  // Which resolver path produced resolveCandidates -- only matters for the
  // confirmation modal's copy ("this barcode isn't in your catalog" reads
  // wrong for a photo-sourced result). Set right alongside setResolveCandidates.
  const [resolveKind, setResolveKind] = useState<'barcode' | 'photo'>('barcode')
  const [resolving, setResolving] = useState(false)
  // The most recent scanned/typed code that genuinely found nothing —
  // retained (never discarded) so staff can still act on it via the
  // one-off-item field below instead of hitting a dead end.
  const [unresolvedCode, setUnresolvedCode] = useState<string | null>(null)
  // Set only by picking a ProductSuggestField dropdown result — carries the
  // brand/model/image that plain text typing can't. Cleared the moment the
  // name is hand-edited again so a stale match never rides along silently.
  const [customSuggestion, setCustomSuggestion] = useState<ProductSuggestion | null>(null)
  const [creatingInvoice, setCreatingInvoice] = useState(false)
  const [paymentMethod, setPaymentMethod] = useState<InvoicePaymentMethod>('cash')
  const [paymentAmount, setPaymentAmount] = useState('')
  const [markingPaid, setMarkingPaid] = useState(false)
  // Typed after the invoice exists, purely for the printed "Bill to" line
  // and as the email recipient — deliberately not persisted to the
  // invoice record itself (this flow is walk-in/fast by design; a real
  // Customer record is what NewQuotePage's fuller intake is for).
  const [customerName, setCustomerName] = useState('')
  const [customerEmail, setCustomerEmail] = useState('')
  const [sendingEmail, setSendingEmail] = useState(false)

  const building = invoice === null
  const subtotalCents = building ? cartSubtotalCents(cart) : invoice.subtotalCents

  // Auto-focus the dedicated scan input on mount, and again whenever we
  // return to "building" after starting a new session — a hardware
  // scanner's keystrokes land directly in whatever has focus, so this is
  // what makes "just walk up and start scanning" work with zero clicks.
  useEffect(() => {
    if (building) scanInputRef.current?.focus()
  }, [building])

  const addCatalogItem = useCallback((item: CatalogItem) => {
    setCart((prev) => addOrIncrementCartItem(prev, catalogItemToCartItem(item)))
  }, [])

  async function handleBarcodeDetected(code: string) {
    setScannerOpen(false)
    setLookupBusy(true)
    // Tracked locally (not read back from state, which wouldn't reflect a
    // setResolveCandidates call made earlier in this same invocation) so
    // the finally block below knows whether to return focus to the scan
    // input or leave it on the just-opened candidate modal.
    let openedCandidateModal = false
    try {
      const result = await repo.lookupProductByUpc(code)
      if (result.source === 'catalog') {
        addCatalogItem(result.catalogItem)
        toast('success', `Added ${result.catalogItem.name}.`)
        setUnresolvedCode(null)
      } else if (result.source === 'external') {
        // Save it to the catalog so the next scan of this exact barcode is
        // an instant local match instead of another external lookup.
        const saved = await repo.createCatalogItem({
          brand: result.brand,
          model: null,
          name: result.name ?? 'Scanned item',
          defaultPriceCents: result.unitPriceCents,
          upc: result.upc,
          imageUrl: result.imageUrl,
        })
        setCatalogItems((prev) => (prev ? [...prev, saved] : [saved]))
        addCatalogItem(saved)
        toast('success', `Found "${saved.name}" — added to your catalog and this order.`)
        setUnresolvedCode(null)
      } else {
        // Never dead-end: nothing in the local catalog and no single
        // confident external match, so automatically continue into the
        // universal resolver instead of just reporting "not found." This
        // second call is a cache hit in the common case (lookupProductByUpc
        // already triggered the real AI/web search internally), not a
        // repeat network round trip.
        setResolving(true)
        const resolved = await repo.resolveProduct({ kind: 'barcode', code })
        setUnresolvedCode(code)
        if (resolved.candidates.length > 0) {
          setResolveKind('barcode')
          setResolveCandidates(resolved.candidates)
          openedCandidateModal = true
        } else {
          toast('error', `No match for that barcode (${code}) anywhere we looked. It's been kept below — add the details manually.`)
        }
      }
    } catch (err) {
      toast('error', err instanceof Error ? err.message : 'Barcode lookup failed.')
    } finally {
      setLookupBusy(false)
      setResolving(false)
      // Return focus to the scan field either way, so the very next scan —
      // via the scanner, no click needed — just works. Not stolen back
      // while the candidate-confirmation modal is open, though.
      if (!openedCandidateModal) scanInputRef.current?.focus()
    }
  }

  function handleAddCandidate(candidate: ProductResolutionCandidate) {
    setCart((prev) =>
      addOrIncrementCartItem(prev, {
        id: newId(),
        catalogItemId: null,
        name: candidate.name,
        brand: candidate.brand,
        model: candidate.model,
        imageUrl: candidate.imageUrl,
        unitPriceCents: candidate.referencePriceCents ?? 0,
        quantity: 1,
        category: null,
      }),
    )
    toast('success', `Added ${candidate.name}.`)
    setResolveCandidates(null)
    setUnresolvedCode(null)
  }

  async function handleSaveCandidateToCatalog(candidate: ProductResolutionCandidate) {
    try {
      const saved = await repo.createCatalogItem({
        brand: candidate.brand,
        model: candidate.model,
        name: candidate.name,
        defaultPriceCents: candidate.referencePriceCents,
        upc: candidate.upc,
        imageUrl: candidate.imageUrl,
      })
      setCatalogItems((prev) => (prev ? [...prev, saved] : [saved]))
      addCatalogItem(saved)
      toast('success', `Saved "${saved.name}" to your catalog and added it to this order.`)
      setResolveCandidates(null)
      setUnresolvedCode(null)
    } catch {
      toast('error', 'Could not save that product. Please try again.')
    }
  }

  // Fallback for when focus has drifted off the dedicated scan input (a
  // button, the page background) — see useHardwareScanner.ts. Only active
  // while still building the cart; nothing to scan into once the invoice
  // is locked in.
  useHardwareScanner(handleBarcodeDetected, building)

  // No barcode ever missed here — this is the "no readable barcode" path,
  // so there's no unresolvedCode to set/retain, unlike handleBarcodeDetected.
  async function handlePhotoCaptured(base64Jpeg: string) {
    setScannerOpen(false)
    setLookupBusy(true)
    setResolving(true)
    let openedCandidateModal = false
    try {
      const resolved = await repo.resolveProduct({ kind: 'photo', imageBase64: base64Jpeg, mediaType: 'image/jpeg' })
      if (resolved.candidates.length > 0) {
        setResolveKind('photo')
        setResolveCandidates(resolved.candidates)
        openedCandidateModal = true
      } else {
        toast('error', "Couldn't identify a product in that photo. Add it manually below.")
      }
    } catch (err) {
      toast('error', err instanceof Error ? err.message : 'Photo lookup failed.')
    } finally {
      setLookupBusy(false)
      setResolving(false)
      if (!openedCandidateModal) scanInputRef.current?.focus()
    }
  }

  function handleCameraError(message: string) {
    setScannerOpen(false)
    toast('error', message)
  }

  function addCustomItem() {
    if (!customName.trim()) return
    setCart((prev) => [
      ...prev,
      {
        id: newId(),
        catalogItemId: null,
        name: customName.trim(),
        brand: customSuggestion?.brand ?? null,
        model: customSuggestion?.model ?? null,
        imageUrl: customSuggestion?.imageUrl ?? null,
        unitPriceCents: parseDollarsToCents(customPrice) ?? 0,
        quantity: 1,
        category: null,
      },
    ])
    setCustomName('')
    setCustomPrice('')
    setCustomSuggestion(null)
    setUnresolvedCode(null)
  }

  async function handleCreateInvoice() {
    setCreatingInvoice(true)
    try {
      const created = await repo.createInvoice({ items: cartToInvoiceItemInputs(cart) })
      setInvoice(created)
      setPaymentAmount((created.totalCents / 100).toString())
    } catch (err) {
      // Log the real Postgres/network error to the console — the toast
      // stays generic for the cashier, but without this, a real failure
      // (e.g. migration 0011's tables/trigger missing in production) is
      // completely invisible and undiagnosable from the browser.
      console.error('createInvoice failed', err)
      toast('error', 'Could not create the invoice. Please try again.')
    } finally {
      setCreatingInvoice(false)
    }
  }

  async function handleMarkPaid() {
    if (!invoice) return
    const amountCents = parseDollarsToCents(paymentAmount)
    if (amountCents === null) {
      toast('error', 'Enter a valid payment amount.')
      return
    }
    setMarkingPaid(true)
    try {
      const paid = await repo.markInvoicePaid(invoice.id, paymentMethod, amountCents)
      setInvoice(paid)
      toast('success', 'Invoice marked paid — stock updated.')
    } catch {
      toast('error', 'Could not mark this invoice paid. Please try again.')
    } finally {
      setMarkingPaid(false)
    }
  }

  async function handleEmailInvoice() {
    if (!invoice || !customerEmail.trim()) return
    setSendingEmail(true)
    try {
      const result = await repo.sendInvoiceEmail(invoice.id, customerEmail.trim(), customerName.trim() || undefined)
      toast(result.ok ? 'success' : 'error', result.message)
    } catch {
      toast('error', 'Could not email the invoice. Please try again.')
    } finally {
      setSendingEmail(false)
    }
  }

  function startNewSession() {
    setCart([])
    setInvoice(null)
    setPaymentAmount('')
    setPaymentMethod('cash')
    setManualQuery('')
    setCustomerName('')
    setCustomerEmail('')
  }

  // Hands the scan cart off to the existing quote-creation flow rather
  // than trying to build a full quote (customer info, tiers, deposit
  // config) here — NewQuotePage already does that well. Mirrors the
  // "Duplicate quote" pre-fill pattern (see location.state.duplicateFrom
  // there) with a parallel state key instead of overloading that one.
  function sendCartToQuote() {
    const prefill: ScanQuotePrefill = { items: cartToQuoteItemInputs(cart), priceCents: cartSubtotalCents(cart) }
    navigate('/app/quotes/new', { state: { fromScan: prefill } })
  }

  const filteredCatalog = useMemo(() => {
    if (!catalogItems || !manualQuery.trim()) return []
    const q = manualQuery.trim().toLowerCase()
    return catalogItems
      .filter((i) => i.active && [i.name, i.brand, i.model].filter((v): v is string => Boolean(v)).some((v) => v.toLowerCase().includes(q)))
      .slice(0, 8)
  }, [catalogItems, manualQuery])

  return (
    <div className="space-y-4">
      <div className="no-print">
        <h1 className="text-2xl font-bold text-ink">Scan</h1>
        <p className="text-sm text-zinc-500">Point a barcode scanner at this page and pull the trigger — or search/add items below. Choose what this becomes on the right.</p>
      </div>

      <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-start lg:gap-4">
        {/* Center work area */}
        <div className="space-y-4">
          {building ? (
            <>
              <Card className="no-print space-y-3">
                <div>
                  <label htmlFor="hardware-scan-input" className="mb-1.5 flex items-center gap-2 text-sm font-semibold text-ink">
                    <Barcode className="h-4 w-4 text-brand" aria-hidden="true" />
                    Scanner ready — scan here
                  </label>
                  <Input
                    id="hardware-scan-input"
                    ref={scanInputRef}
                    value={scanInputValue}
                    onChange={(e) => setScanInputValue(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key !== 'Enter') return
                      e.preventDefault()
                      const code = scanInputValue.trim()
                      setScanInputValue('')
                      if (code) void handleBarcodeDetected(code)
                    }}
                    placeholder="Works with a USB or Bluetooth laser scanner — no camera needed"
                    autoComplete="off"
                    className="text-lg"
                  />
                  <p className="mt-1 text-xs text-zinc-500">
                    Click elsewhere to use another field — scanning still works from anywhere on this page.
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-3">
                  {lookupBusy ? (
                    <span className="inline-flex items-center gap-2 text-sm font-medium text-zinc-500">
                      <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                      {resolving ? 'Not in your catalog — searching product sources…' : 'Checking your catalog…'}
                    </span>
                  ) : null}
                  <Button variant="secondary" onClick={() => setScannerOpen(true)} className="ml-auto">
                    <Camera className="h-4 w-4" aria-hidden="true" />
                    Use camera instead
                  </Button>
                </div>
                <div className="relative border-t border-zinc-100 pt-3">
                  <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-zinc-400" aria-hidden="true" />
                  <Input
                    value={manualQuery}
                    onChange={(e) => setManualQuery(e.target.value)}
                    placeholder="Search your catalog…"
                    className="pl-9"
                  />
                  {filteredCatalog.length > 0 ? (
                    <div className="mt-2 space-y-1 rounded-xl border border-zinc-200 bg-white p-1.5">
                      {filteredCatalog.map((item) => (
                        <button
                          key={item.id}
                          type="button"
                          onClick={() => {
                            addCatalogItem(item)
                            setManualQuery('')
                          }}
                          className="flex w-full items-center justify-between gap-2 rounded-lg px-2.5 py-2 text-left text-sm hover:bg-zinc-50"
                        >
                          <span className="truncate">{[item.brand, item.name].filter(Boolean).join(' — ')}</span>
                          <span className="shrink-0 text-zinc-500">{item.defaultPriceCents !== null ? formatCurrency(item.defaultPriceCents) : '—'}</span>
                        </button>
                      ))}
                    </div>
                  ) : null}
                </div>
              </Card>

              {cart.length === 0 ? (
                <EmptyState title="Nothing scanned yet" message="Scan a barcode or search your catalog above to start building this order." />
              ) : (
                <div className="space-y-2">
                  {cart.map((row) => (
                    <CartRowCard
                      key={row.id}
                      row={row}
                      editing={editingRowId === row.id}
                      onToggleEdit={() => setEditingRowId((id) => (id === row.id ? null : row.id))}
                      onChange={(patch) => setCart((prev) => updateCartItem(prev, row.id, patch))}
                      onQuantityChange={(q) => setCart((prev) => setCartItemQuantity(prev, row.id, q))}
                      onRemove={() => setCart((prev) => removeCartItem(prev, row.id))}
                    />
                  ))}
                </div>
              )}

              <Card className="no-print space-y-2">
                <p className="text-sm font-semibold text-ink">Add a one-off item</p>
                {unresolvedCode ? (
                  <p className="flex items-start gap-1.5 rounded-lg bg-amber-50 px-3 py-2 text-xs font-medium text-amber-800">
                    <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                    Scanned code {unresolvedCode} — no confident match. It's kept here; fill in the details and it'll still go in as a one-off item.
                  </p>
                ) : null}
                <div className="flex flex-wrap items-start gap-2">
                  <div className="min-w-40 flex-1">
                    <ProductSuggestField
                      value={customName}
                      onChange={(v) => {
                        setCustomName(v)
                        setCustomSuggestion(null)
                      }}
                      onSelect={(s) => {
                        setCustomName(s.name)
                        setCustomSuggestion(s)
                        if (s.unitPriceCents !== null) setCustomPrice((s.unitPriceCents / 100).toString())
                      }}
                      placeholder="Item name — try typing a model number"
                    />
                  </div>
                  {/* Wrapped in a width-constrained div rather than passing
                      className="w-28" straight to Input -- Input's own base
                      w-full class wins the Tailwind specificity tie against a
                      narrower width passed via className (compiled-stylesheet
                      order, not markup order), which silently stretched this
                      field to the full row width and pushed Price/Add onto
                      their own line below the name field's suggestion
                      dropdown -- where closing that dropdown on an outside
                      click could shift the layout out from under an
                      in-flight click on Add. Same fix as the name field's
                      own wrapper just above. */}
                  <div className="w-28">
                    <Input value={customPrice} onChange={(e) => setCustomPrice(e.target.value)} placeholder="Price" inputMode="decimal" />
                  </div>
                  <Button variant="secondary" onClick={addCustomItem} disabled={!customName.trim()}>
                    <Plus className="h-4 w-4" aria-hidden="true" />
                    Add
                  </Button>
                </div>
              </Card>

              <Modal
                open={resolveCandidates !== null && resolveCandidates.length > 0}
                onClose={() => {
                  setResolveCandidates(null)
                  scanInputRef.current?.focus()
                }}
                title={resolveKind === 'photo' ? 'Possible matches for that photo' : unresolvedCode ? `Possible matches for ${unresolvedCode}` : 'Possible matches'}
              >
                <div className="space-y-3">
                  <p className="text-sm text-zinc-600">
                    {resolveKind === 'photo'
                      ? "Here's what we identified from the photo — pick one, or add it manually below instead."
                      : "This barcode isn't in your catalog yet. Here's what we found on the web — pick one, or add it manually below instead."}
                  </p>
                  {(resolveCandidates ?? []).map((candidate) => (
                    <div key={candidate.id} className="rounded-xl border border-zinc-200 p-3">
                      <div className="flex items-start gap-3">
                        <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-lg bg-blue-50">
                          {candidate.imageUrl ? (
                            <img src={candidate.imageUrl} alt="" className="h-full w-full rounded-lg object-contain" />
                          ) : (
                            <Package className="h-6 w-6 text-brand" aria-hidden="true" />
                          )}
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-semibold text-ink">
                            {[candidate.brand, candidate.model].filter(Boolean).join(' ') || candidate.name}
                          </p>
                          <p className="truncate text-xs text-zinc-500">{candidate.name}</p>
                          <div className="mt-1 flex flex-wrap items-center gap-1.5">
                            <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${CONFIDENCE_BADGE[candidate.confidenceLevel]}`}>
                              {CONFIDENCE_LABEL[candidate.confidenceLevel]}
                            </span>
                            {candidate.referencePriceCents !== null ? (
                              <span className="text-xs text-zinc-500">
                                {formatCurrency(candidate.referencePriceCents)}
                                {candidate.priceKind !== 'unknown' ? ` (${candidate.priceKind.toUpperCase()})` : ''}
                                {candidate.priceSourceName ? ` — ${candidate.priceSourceName}` : ''}
                              </span>
                            ) : null}
                          </div>
                          {candidate.warnings.length > 0 ? (
                            <p className="mt-1 flex items-start gap-1 text-xs text-amber-700">
                              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                              {candidate.warnings[0]}
                            </p>
                          ) : null}
                        </div>
                      </div>
                      <div className="mt-2 flex gap-2">
                        <Button variant="secondary" className="flex-1" onClick={() => handleAddCandidate(candidate)}>
                          Add to cart
                        </Button>
                        <Button variant="ghost" onClick={() => void handleSaveCandidateToCatalog(candidate)}>
                          Save to catalog &amp; add
                        </Button>
                      </div>
                    </div>
                  ))}
                  <Button
                    variant="ghost"
                    className="w-full"
                    onClick={() => {
                      setResolveCandidates(null)
                      scanInputRef.current?.focus()
                    }}
                  >
                    None of these — I&apos;ll enter it manually
                  </Button>
                </div>
              </Modal>
            </>
          ) : (
            <InvoiceDocument invoice={invoice} shop={shop} customerName={customerName} customerEmail={customerEmail} />
          )}
        </div>

        {/* Side panel */}
        <div className="no-print mt-4 space-y-4 lg:sticky lg:top-4 lg:mt-0">
          <Card className="space-y-3">
            {building ? (
              <>
                <p className="text-sm font-semibold text-ink">Turn this into…</p>
                <div className="grid grid-cols-2 gap-2">
                  <div className="rounded-xl border-2 border-brand bg-blue-50 px-3 py-2.5 text-center text-sm font-semibold text-brand">Invoice</div>
                  <button
                    type="button"
                    onClick={sendCartToQuote}
                    disabled={cart.length === 0}
                    title={cart.length === 0 ? 'Scan or add an item first' : 'Send these items to a new quote'}
                    className="rounded-xl border-2 border-zinc-200 px-3 py-2.5 text-center text-sm font-semibold text-charcoal transition-colors hover:border-brand hover:text-brand disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:border-zinc-200 disabled:hover:text-charcoal"
                  >
                    Quote
                  </button>
                  {['Receive inventory', 'Outgoing order'].map((label) => (
                    <div
                      key={label}
                      title="Coming in a later phase"
                      className="relative rounded-xl border-2 border-zinc-200 px-3 py-2.5 text-center text-sm font-semibold text-zinc-400"
                    >
                      {label}
                      <span className="absolute -top-1.5 -right-1.5 rounded-full bg-zinc-200 px-1.5 py-0.5 text-[10px] font-bold text-zinc-500">Soon</span>
                    </div>
                  ))}
                </div>
              </>
            ) : null}

            <div className="flex items-center justify-between border-t border-zinc-100 pt-3 text-sm">
              <span className="text-zinc-500">Subtotal</span>
              <span className="text-base font-bold text-ink">{formatCurrency(subtotalCents)}</span>
            </div>

            {building ? (
              <Button className="w-full" onClick={handleCreateInvoice} disabled={cart.length === 0 || creatingInvoice}>
                {creatingInvoice ? <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" /> : null}
                Create invoice
              </Button>
            ) : (
              <div className="space-y-3">
                <div className="space-y-2">
                  <Field label="Customer name" htmlFor="cust-name" hint="Optional — shown on the printed invoice.">
                    <Input id="cust-name" value={customerName} onChange={(e) => setCustomerName(e.target.value)} placeholder="Walk-in customer" />
                  </Field>
                  <Field label="Customer email" htmlFor="cust-email" hint="Optional — needed to email a copy.">
                    <Input id="cust-email" type="email" value={customerEmail} onChange={(e) => setCustomerEmail(e.target.value)} placeholder="name@example.com" />
                  </Field>
                </div>

                {invoice.status === 'draft' ? (
                  <div className="space-y-2 border-t border-zinc-100 pt-3">
                    <Field label="Payment method" htmlFor="pay-method">
                      <Select id="pay-method" value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value as InvoicePaymentMethod)}>
                        {(Object.keys(PAYMENT_METHOD_LABELS) as InvoicePaymentMethod[]).map((m) => (
                          <option key={m} value={m}>
                            {PAYMENT_METHOD_LABELS[m]}
                          </option>
                        ))}
                      </Select>
                    </Field>
                    <Field label="Amount received" htmlFor="pay-amount">
                      <Input id="pay-amount" value={paymentAmount} onChange={(e) => setPaymentAmount(e.target.value)} inputMode="decimal" />
                    </Field>
                    <Button className="w-full" variant="success" onClick={handleMarkPaid} disabled={markingPaid}>
                      {markingPaid ? <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" /> : null}
                      Mark paid
                    </Button>
                  </div>
                ) : null}

                <div className="space-y-2 border-t border-zinc-100 pt-3">
                  <Button className="w-full" variant="secondary" onClick={() => window.print()}>
                    <Printer className="h-5 w-5" aria-hidden="true" />
                    Print invoice
                  </Button>
                  <Button
                    className="w-full"
                    variant="secondary"
                    onClick={handleEmailInvoice}
                    disabled={!customerEmail.trim() || sendingEmail}
                    title={!customerEmail.trim() ? 'Enter a customer email above first' : undefined}
                  >
                    {sendingEmail ? <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" /> : <Mail className="h-5 w-5" aria-hidden="true" />}
                    Email invoice
                  </Button>
                  <Button className="w-full" variant="ghost" onClick={startNewSession}>
                    Start a new scan
                  </Button>
                </div>
              </div>
            )}
          </Card>
        </div>
      </div>

      <Modal open={scannerOpen} onClose={() => setScannerOpen(false)} title="Scan a barcode">
        <Suspense fallback={<LoadingBlock label="Loading scanner…" />}>
          <BarcodeScanner onBarcodeDetected={handleBarcodeDetected} onPhotoCaptured={handlePhotoCaptured} onCameraError={handleCameraError} />
        </Suspense>
      </Modal>
    </div>
  )
}

function CartRowCard({
  row,
  editing,
  onToggleEdit,
  onChange,
  onQuantityChange,
  onRemove,
}: {
  row: ScannedCartItem
  editing: boolean
  onToggleEdit: () => void
  onChange: (patch: Partial<ScannedCartItem>) => void
  onQuantityChange: (quantity: number) => void
  onRemove: () => void
}) {
  const [draftName, setDraftName] = useState(row.name)
  const [draftBrand, setDraftBrand] = useState(row.brand ?? '')
  const [draftPrice, setDraftPrice] = useState((row.unitPriceCents / 100).toString())

  // Re-seed the drafts only on the closed->open transition, not on every
  // row change (e.g. the quantity stepper below) — same reasoning as the
  // price field elsewhere in this app: keep the raw typed string as form
  // state while editing, converting to cents only when the edit commits,
  // so the input never "snaps" mid-keystroke.
  useEffect(() => {
    if (editing) {
      setDraftName(row.name)
      setDraftBrand(row.brand ?? '')
      setDraftPrice((row.unitPriceCents / 100).toString())
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing])

  function handlePencilClick() {
    if (editing) {
      onChange({
        name: draftName.trim() || row.name,
        brand: draftBrand.trim() || null,
        unitPriceCents: parseDollarsToCents(draftPrice) ?? row.unitPriceCents,
      })
    }
    onToggleEdit()
  }

  return (
    <Card className="flex items-start gap-3">
      <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-lg bg-blue-50">
        {row.imageUrl ? (
          <img src={row.imageUrl} alt="" className="h-full w-full rounded-lg object-contain" />
        ) : (
          <Package className="h-6 w-6 text-brand" aria-hidden="true" />
        )}
      </div>
      <div className="min-w-0 flex-1 space-y-1.5">
        {editing ? (
          <div className="space-y-1.5">
            <Input value={draftName} onChange={(e) => setDraftName(e.target.value)} placeholder="Name" aria-label="Item name" />
            <div className="flex gap-1.5">
              <Input value={draftBrand} onChange={(e) => setDraftBrand(e.target.value)} placeholder="Brand" className="flex-1" aria-label="Brand" />
              <Input value={draftPrice} onChange={(e) => setDraftPrice(e.target.value)} placeholder="Price" inputMode="decimal" className="w-24" aria-label="Price" />
            </div>
          </div>
        ) : (
          <>
            <p className="truncate text-sm font-semibold text-ink">{row.name}</p>
            <p className="truncate text-xs text-zinc-500">{[row.brand, row.model].filter(Boolean).join(' · ') || '—'}</p>
          </>
        )}
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => onQuantityChange(row.quantity - 1)}
              aria-label="Decrease quantity"
              className="flex h-7 w-7 items-center justify-center rounded-lg border border-zinc-200 text-zinc-500 hover:bg-zinc-50"
            >
              <Minus className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
            <span className="w-6 text-center text-sm font-semibold">{row.quantity}</span>
            <button
              type="button"
              onClick={() => onQuantityChange(row.quantity + 1)}
              aria-label="Increase quantity"
              className="flex h-7 w-7 items-center justify-center rounded-lg border border-zinc-200 text-zinc-500 hover:bg-zinc-50"
            >
              <Plus className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          </div>
          <span className="text-sm font-semibold text-ink">{formatCurrency(row.unitPriceCents * row.quantity)}</span>
        </div>
      </div>
      <div className="flex shrink-0 flex-col gap-1">
        <button
          type="button"
          onClick={handlePencilClick}
          aria-label={editing ? 'Save changes' : `Edit ${row.name}`}
          className="flex h-8 w-8 items-center justify-center rounded-lg text-zinc-400 hover:bg-zinc-100 hover:text-ink"
        >
          <Pencil className="h-4 w-4" aria-hidden="true" />
        </button>
        <button
          type="button"
          onClick={onRemove}
          aria-label={`Remove ${row.name}`}
          className="flex h-8 w-8 items-center justify-center rounded-lg text-zinc-400 hover:bg-red-50 hover:text-red-600"
        >
          <Trash2 className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>
    </Card>
  )
}

/**
 * The invoice, laid out like an actual invoice — this is both what's shown
 * on screen and (via the existing .no-print convention hiding everything
 * else on the page) what prints/Saves-as-PDF, and mirrors what
 * invoiceEmailTemplate.ts renders for the emailed copy. Letterhead style
 * matches PublicQuotePage's shop-branding convention (logo-or-name, a
 * primaryColor accent bar, phone/address).
 */
function InvoiceDocument({
  invoice,
  shop,
  customerName,
  customerEmail,
}: {
  invoice: Invoice
  shop: Shop | null
  customerName: string
  customerEmail: string
}) {
  const color = shop?.primaryColor || '#1d4ed8'
  return (
    <Card className="overflow-hidden space-y-0 p-0">
      <div className="p-6" style={{ borderTop: `6px solid ${color}` }}>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            {shop?.logoUrl ? (
              <img src={shop.logoUrl} alt={shop.name} className="max-h-12" />
            ) : (
              <p className="text-xl font-black text-ink">{shop?.name ?? 'Your Shop'}</p>
            )}
            <div className="mt-2 space-y-0.5 text-sm text-zinc-500">
              {shop?.address ? (
                <p className="flex items-center gap-1.5">
                  <MapPin className="h-3.5 w-3.5 shrink-0" aria-hidden="true" /> {shop.address}
                </p>
              ) : null}
              {shop?.phone ? (
                <p className="flex items-center gap-1.5">
                  <Phone className="h-3.5 w-3.5 shrink-0" aria-hidden="true" /> {shop.phone}
                </p>
              ) : null}
            </div>
          </div>
          <div className="text-right">
            <p className="text-2xl font-black tracking-tight text-ink">INVOICE</p>
            <p className="text-sm font-semibold text-zinc-500">#{invoice.invoiceNumber}</p>
            <p className="mt-1 text-sm text-zinc-500">{formatDateTime(invoice.createdAt)}</p>
            {invoice.status === 'paid' ? (
              <span className="mt-2 inline-block rounded-full bg-green-100 px-3 py-1 text-xs font-bold text-green-800">
                PAID{invoice.paymentMethod ? ` — ${PAYMENT_METHOD_LABELS[invoice.paymentMethod]}` : ''}
              </span>
            ) : (
              <span className="mt-2 inline-block rounded-full bg-amber-100 px-3 py-1 text-xs font-bold text-amber-800">UNPAID</span>
            )}
          </div>
        </div>

        {customerName.trim() || customerEmail.trim() ? (
          <div className="mt-5 border-t border-zinc-100 pt-4">
            <p className="text-xs font-semibold tracking-wide text-zinc-400 uppercase">Bill to</p>
            {customerName.trim() ? <p className="text-sm font-semibold text-ink">{customerName.trim()}</p> : null}
            {customerEmail.trim() ? <p className="text-sm text-zinc-500">{customerEmail.trim()}</p> : null}
          </div>
        ) : null}
      </div>

      <table className="w-full border-t border-zinc-100 text-sm">
        <thead>
          <tr className="border-b border-zinc-100 text-left text-xs font-semibold tracking-wide text-zinc-400 uppercase">
            <th className="px-6 py-2 font-semibold">Item</th>
            <th className="px-3 py-2 text-right font-semibold">Qty</th>
            <th className="px-3 py-2 text-right font-semibold">Price</th>
            <th className="px-6 py-2 text-right font-semibold">Total</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-100">
          {invoice.items.map((item) => (
            <tr key={item.id}>
              <td className="px-6 py-3">
                <p className="font-medium text-ink">{item.name}</p>
                {item.brand || item.model ? <p className="text-xs text-zinc-500">{[item.brand, item.model].filter(Boolean).join(' · ')}</p> : null}
              </td>
              <td className="px-3 py-3 text-right text-zinc-500">{item.quantity}</td>
              <td className="px-3 py-3 text-right text-zinc-500">{formatCurrency(item.unitPriceCents)}</td>
              <td className="px-6 py-3 text-right font-semibold text-ink">{formatCurrency(item.unitPriceCents * item.quantity)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="flex justify-end p-6 pt-4">
        <div className="w-full max-w-56 space-y-1.5">
          <div className="flex items-center justify-between text-sm text-zinc-500">
            <span>Subtotal</span>
            <span>{formatCurrency(invoice.subtotalCents)}</span>
          </div>
          <div className="flex items-center justify-between border-t border-zinc-200 pt-1.5 text-base font-bold text-ink">
            <span>Total</span>
            <span>{formatCurrency(invoice.totalCents)}</span>
          </div>
          {invoice.status === 'paid' && invoice.paymentAmountCents !== null ? (
            <div className="flex items-center justify-between text-sm text-green-700">
              <span>Paid</span>
              <span>{formatCurrency(invoice.paymentAmountCents)}</span>
            </div>
          ) : null}
        </div>
      </div>

      <p className="border-t border-zinc-100 px-6 py-4 text-center text-xs text-zinc-400">
        Thank you for your business{shop?.name ? ` — ${shop.name}` : ''}
        {shop?.phone ? ` · ${shop.phone}` : ''}
      </p>
    </Card>
  )
}
