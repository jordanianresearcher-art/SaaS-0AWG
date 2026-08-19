// The scan-to-invoice workspace: the shop's primary daily workflow. Scan a
// barcode (or search/add manually) and it lands in the center work area,
// editable via a pencil button; the side panel is where staff decide what
// this scan session becomes — an invoice or a quote, both finished right
// here (Receive inventory/Outgoing order are still shown as upcoming, not
// yet functional — see docs/INVENTORY_AND_SCANNING.md; taking a shipment
// IN is now its own flow at /app/inventory/new, "Rapid intake").

import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, Barcode, Camera, Copy, Loader2, Mail, Minus, Package, Pencil, Plus, Printer, Search, Trash2 } from 'lucide-react'
import { useAppData, useRepo } from '../../data/AppDataContext'
import { useToast } from '../../components/Toast'
import { Button, Card, EmptyState, Field, Input, LoadingBlock, Modal, Select } from '../../components/ui'
import { ProductSuggestField } from '../../components/ProductSuggestField'
import { SalesDocument, type SalesDocumentItem } from '../../components/SalesDocument'
import { EmailPreviewModal, publicQuoteUrl } from '../../components/EmailPreviewModal'
import { formatCurrency, formatDateTime, parseDollarsToCents } from '../../lib/format'
import { newId } from '../../lib/ids'
import { filterCatalog } from '../../lib/catalogSearch'
import { computeInvoiceTotals } from '../../lib/invoicePricing'
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
import type { CatalogItem, Invoice, InvoicePaymentMethod, QuoteBundle } from '../../types'
import type { ProductResolutionCandidate, ProductSuggestion } from '../../data/repository'
import { splitItemName } from '../../lib/productNaming'

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
  financed: 'Financed (Snap, Acima, …)',
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

function invoiceToDocumentItems(invoice: Invoice): SalesDocumentItem[] {
  return invoice.items.map((item) => ({
    id: item.id,
    name: item.name,
    brand: item.brand,
    model: item.model,
    quantity: item.quantity,
    unitPriceCents: item.unitPriceCents,
  }))
}

// Quotes price per-option, not per-item (see SalesDocumentItem's doc
// comment) -- unitPriceCents is always null here, which renders as "—"
// rather than a fabricated per-line price.
function quoteOptionToDocumentItems(option: QuoteBundle['options'][number] | undefined): SalesDocumentItem[] {
  if (!option) return []
  return option.items.map((item) => ({
    id: item.id,
    name: item.name,
    brand: item.brand,
    model: item.model,
    quantity: item.quantity,
    unitPriceCents: null,
  }))
}

export default function ScanWorkspacePage() {
  const repo = useRepo()
  const { shop } = useAppData()
  const toast = useToast()

  const [catalogItems, setCatalogItems] = useState<CatalogItem[] | null>(null)
  useEffect(() => {
    void repo.listCatalogItems().then(setCatalogItems)
  }, [repo])

  const [cart, setCart] = useState<ScannedCartItem[]>([])
  const [invoice, setInvoice] = useState<Invoice | null>(null)
  // Which document this scan session becomes — a toggle, not an action;
  // switching modes never touches the cart. Only 'invoice'/'quote' are
  // wired end to end (see the side panel's "Turn this into…" grid).
  const [docType, setDocType] = useState<'invoice' | 'quote'>('invoice')
  const [quote, setQuote] = useState<QuoteBundle | null>(null)
  const [creatingQuote, setCreatingQuote] = useState(false)
  const [quoteEmailPreviewOpen, setQuoteEmailPreviewOpen] = useState(false)
  const [scannerOpen, setScannerOpen] = useState(false)
  const [lookupBusy, setLookupBusy] = useState(false)
  const [manualQuery, setManualQuery] = useState('')
  const [scanInputValue, setScanInputValue] = useState('')
  const scanInputRef = useRef<HTMLInputElement>(null)
  // The most recently scanned code, so a slow background lookup that
  // finishes after staff have moved on to a different item doesn't pop a
  // candidate modal for the wrong product.
  const latestScanRef = useRef<string | null>(null)
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
  // The walk-in customer's details. Persisted onto the invoice record
  // itself (migration 0017's customer_name/phone/email columns) so a
  // reopened or reprinted invoice still says who bought it — previously
  // this was component state only and was lost on reload.
  const [customerName, setCustomerName] = useState('')
  const [customerEmail, setCustomerEmail] = useState('')
  const [sendingEmail, setSendingEmail] = useState(false)
  // Tax and discount are set before the invoice is created, because both
  // change the total the cashier reads out loud. Rate is entered as a
  // percentage ("8.25") and stored as a fraction.
  const [taxPercent, setTaxPercent] = useState('')
  // "Price includes tax" is how most shops here actually quote — the sticker
  // is the out-the-door number. In that mode no tax line is added; the rate
  // is recorded as 0 so the printed total and what the customer pays match.
  const [taxIncluded, setTaxIncluded] = useState(false)
  const [discountDollars, setDiscountDollars] = useState('')

  const building = invoice === null && quote === null
  const subtotalCents = building ? cartSubtotalCents(cart) : invoice ? invoice.subtotalCents : (quote!.options[0]?.priceCents ?? 0)
  // Tax-included mode adds no tax line — the price on the shelf is the
  // out-the-door price, which is how these shops quote.
  const cartTaxRate = taxIncluded ? 0 : (Number(taxPercent) || 0) / 100
  const cartDiscountCents = parseDollarsToCents(discountDollars) ?? 0
  const cartTotals = computeInvoiceTotals(
    cart.map((line) => ({ unitPriceCents: line.unitPriceCents, quantity: line.quantity })),
    cartTaxRate,
    cartDiscountCents,
  )

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
    latestScanRef.current = code
    // Tracked locally (not read back from state, which wouldn't reflect a
    // setResolveCandidates call made earlier in this same invocation) so
    // the finally block below knows whether to return focus to the scan
    // input or leave it on the just-opened candidate modal.
    let openedCandidateModal = false
    try {
      // Fast first: cache + barcode database only, ~1s. A code from a
      // manufacturer that never published its barcodes will never resolve
      // from the number alone, so failing fast and handing staff the
      // keyboard beats making them watch a 15-30s search miss.
      const result = await repo.lookupProductByUpc(code, { fast: true })
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
      } else if (result.source === 'candidates') {
        // Never dead-end: nothing in the local catalog and no single
        // confident external match, so show the ranked candidates
        // lookupProductByUpc already resolved instead of just reporting
        // "not found" — carried straight through from that one call (see
        // UpcLookupResult's 'candidates' case), not a second network
        // round-trip to re-fetch the same thing.
        setUnresolvedCode(code)
        setResolveKind('barcode')
        setResolveCandidates(result.candidates)
        openedCandidateModal = true
      } else {
        // Fast lookup missed. Retain the code so staff can act on it right
        // now, and keep looking in the background — if the slower AI/web
        // search does turn something up, offer it, but only while this is
        // still the code on screen (see latestScanRef).
        setUnresolvedCode(code)
        toast('info', `No instant match for ${code} — type what it is below. Still searching in the background.`)
        void repo
          .lookupProductByUpc(code)
          .then((full) => {
            if (latestScanRef.current !== code) return
            if (full.source === 'candidates' && full.candidates.length > 0) {
              setResolveKind('barcode')
              setResolveCandidates(full.candidates)
            }
          })
          .catch(() => {
            /* Background best-effort — the retained code above is the real answer. */
          })
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
    } catch (err) {
      console.error('createCatalogItem (from resolved candidate) failed', err)
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
      } else if (!resolved.aiConfigured) {
        // Distinct from a genuine miss: nothing looked at all, because no AI
        // provider key is funded. Saying "couldn't identify" here sends the
        // shop hunting for a better photo of a problem that is pure config.
        toast('error', "Product lookup isn't set up yet — an admin needs to add an AI key in Supabase. You can still type the details in.")
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

  async function addCustomItem() {
    if (!customName.trim()) return
    const priceCents = parseDollarsToCents(customPrice) ?? 0
    const brand = customSuggestion?.brand ?? null
    const model = customSuggestion?.model ?? null
    const imageUrl = customSuggestion?.imageUrl ?? null
    const name = customName.trim()

    // Selling a product IS how the catalog gets built. When the line came from
    // a real web/AI match (not free text someone typed), file it in the
    // catalog on the way past — canonically named, with its photo — so the
    // second unit of that product costs zero lookups and the shop ends up with
    // a real product database as a side effect of ordinary counter work.
    //
    // Best-effort on purpose: a catalog write must never block a sale. If it
    // fails, the line still goes in the cart as a one-off.
    let catalogItemId: string | null = null
    if (customSuggestion) {
      try {
        const saved = await repo.createCatalogItem({
          brand,
          model,
          name,
          defaultPriceCents: priceCents || null,
          imageUrl,
          // Records where this came from, so an owner reviewing the catalog can
          // tell AI-resolved rows from hand-typed ones.
          importSource: 'upc_lookup',
        })
        catalogItemId = saved.id
        setCatalogItems((prev) => (prev ? [...prev, saved] : prev))
      } catch (err) {
        console.error('inline catalog save failed', err)
      }
    }

    setCart((prev) => [
      ...prev,
      {
        id: newId(),
        catalogItemId,
        name,
        brand,
        model,
        imageUrl,
        unitPriceCents: priceCents,
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
      const created = await repo.createInvoice({
        items: cartToInvoiceItemInputs(cart),
        taxRate: cartTaxRate,
        discountCents: cartDiscountCents,
        customerName: customerName.trim() || null,
        customerEmail: customerEmail.trim() || null,
      })
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
    } catch (err) {
      console.error('markInvoicePaid failed', err)
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
    } catch (err) {
      console.error('sendInvoiceEmail failed', err)
      toast('error', 'Could not email the invoice. Please try again.')
    } finally {
      setSendingEmail(false)
    }
  }

  function startNewSession() {
    setCart([])
    setInvoice(null)
    setQuote(null)
    setDocType('invoice')
    setPaymentAmount('')
    setPaymentMethod('cash')
    setManualQuery('')
    setCustomerName('')
    setCustomerEmail('')
  }

  // Builds a real quote right here — no redirect to NewQuotePage. A single
  // option ('Quote', tier 'good') carrying the whole cart at the cart's
  // subtotal, same shape NewQuotePage's own scan-prefill path
  // (optionsFromScan) already produces from a cart — this just calls
  // createQuote directly instead of routing through a form. Staff who need
  // real tiers/deposit config/vehicle info still have the full NewQuotePage
  // flow for that; this is the fast path for "just get a number in front
  // of the customer."
  async function handleCreateQuote() {
    setCreatingQuote(true)
    try {
      const created = await repo.createQuote({
        customer: {
          firstName: customerName.trim() || 'Walk-in customer',
          lastName: null,
          email: customerEmail.trim(),
          phone: null,
          vehicleYear: null,
          vehicleMake: null,
          vehicleModel: null,
          vehicleTrim: null,
          source: null,
          emailContactPermissionConfirmed: false,
        },
        quote: { internalNotes: null, expirationDate: null, nextFollowUpAt: null, windowTints: [] },
        options: [
          {
            optionKind: 'main',
            name: 'Quote',
            description: '',
            priceCents: cartSubtotalCents(cart),
            laborIncluded: true,
            depositPaymentMethod: null,
            depositPaymentHandle: null,
            depositAmountCents: null,
            configId: null,
            items: cartToQuoteItemInputs(cart).map((item) => ({ ...item, description: null })),
          },
        ],
      })
      const bundle = await repo.getQuoteBundle(created.id)
      if (!bundle) throw new Error('Quote created but could not be reloaded')
      setQuote(bundle)
    } catch (err) {
      console.error('createQuote failed', err)
      toast('error', 'Could not create the quote. Please try again.')
    } finally {
      setCreatingQuote(false)
    }
  }

  async function handleCopyQuoteLink() {
    if (!quote) return
    try {
      await navigator.clipboard.writeText(publicQuoteUrl(quote.quote.publicToken))
      toast('success', 'Quote link copied.')
    } catch {
      toast('error', 'Could not copy the link.')
    }
  }

  const filteredCatalog = useMemo(() => {
    if (!catalogItems || !manualQuery.trim()) return []
    return filterCatalog(catalogItems.filter((i) => i.active), manualQuery).slice(0, 8)
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
                      {resolving ? 'Searching product sources…' : 'Looking it up…'}
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
                  <Button variant="secondary" onClick={() => void addCustomItem()} disabled={!customName.trim()}>
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
                            {splitItemName(candidate).title}
                          </p>
                          <p className="truncate text-xs text-zinc-500">{splitItemName(candidate).descriptor ?? '—'}</p>
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
          ) : invoice ? (
            <SalesDocument
              kind="invoice"
              shop={shop}
              number={String(invoice.invoiceNumber)}
              dateLabel={formatDateTime(invoice.createdAt)}
              statusLabel={invoice.status === 'paid' ? 'PAID' : 'UNPAID'}
              statusTone={invoice.status === 'paid' ? 'success' : 'warning'}
              extraStatusLine={invoice.status === 'paid' && invoice.paymentMethod ? PAYMENT_METHOD_LABELS[invoice.paymentMethod] : undefined}
              customerName={customerName}
              customerEmail={customerEmail}
              items={invoiceToDocumentItems(invoice)}
              subtotalCents={invoice.subtotalCents}
              taxCents={invoice.taxCents}
              discountCents={invoice.discountCents}
              totalCents={invoice.totalCents}
              paidCents={invoice.status === 'paid' ? invoice.paymentAmountCents : null}
            />
          ) : quote ? (
            <SalesDocument
              kind="quote"
              shop={shop}
              number={quote.quote.id.slice(0, 8).toUpperCase()}
              dateLabel={formatDateTime(quote.quote.createdAt)}
              statusLabel={quote.quote.status.toUpperCase()}
              statusTone={quote.quote.status === 'draft' ? 'neutral' : 'success'}
              customerName={customerName}
              customerEmail={customerEmail}
              items={quoteOptionToDocumentItems(quote.options[0])}
              subtotalCents={quote.options[0]?.priceCents ?? 0}
              totalCents={quote.options[0]?.priceCents ?? 0}
            />
          ) : null}
        </div>

        {/* Side panel */}
        <div className="no-print mt-4 space-y-4 lg:sticky lg:top-4 lg:mt-0">
          <Card className="space-y-3">
            {building ? (
              <>
                <p className="text-sm font-semibold text-ink">Turn this into…</p>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setDocType('invoice')}
                    className={
                      docType === 'invoice'
                        ? 'rounded-xl border-2 border-brand bg-blue-50 px-3 py-2.5 text-center text-sm font-semibold text-brand'
                        : 'rounded-xl border-2 border-zinc-200 px-3 py-2.5 text-center text-sm font-semibold text-charcoal transition-colors hover:border-brand hover:text-brand'
                    }
                  >
                    Invoice
                  </button>
                  <button
                    type="button"
                    onClick={() => setDocType('quote')}
                    className={
                      docType === 'quote'
                        ? 'rounded-xl border-2 border-brand bg-blue-50 px-3 py-2.5 text-center text-sm font-semibold text-brand'
                        : 'rounded-xl border-2 border-zinc-200 px-3 py-2.5 text-center text-sm font-semibold text-charcoal transition-colors hover:border-brand hover:text-brand'
                    }
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

            <div className="space-y-2 border-t border-zinc-100 pt-3 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-zinc-500">Subtotal</span>
                <span className="text-base font-bold text-ink">{formatCurrency(subtotalCents)}</span>
              </div>
              {building && docType === 'invoice' ? (
                <>
                  <div className="flex items-center gap-2">
                    <Input
                      value={taxPercent}
                      onChange={(e) => setTaxPercent(e.target.value)}
                      inputMode="decimal"
                      placeholder="Tax %"
                      aria-label="Tax rate percent"
                      className="h-11 w-24"
                      disabled={taxIncluded}
                    />
                    <label className="flex items-center gap-2 text-sm text-zinc-600">
                      <input
                        type="checkbox"
                        className="h-4 w-4 accent-brand"
                        checked={taxIncluded}
                        onChange={(e) => setTaxIncluded(e.target.checked)}
                      />
                      Price includes tax
                    </label>
                  </div>
                  <Input
                    value={discountDollars}
                    onChange={(e) => setDiscountDollars(e.target.value)}
                    inputMode="decimal"
                    placeholder="Discount $"
                    aria-label="Discount amount"
                    className="h-11 w-32"
                  />
                  {cartTotals.taxCents > 0 ? (
                    <div className="flex items-center justify-between">
                      <span className="text-zinc-500">Tax</span>
                      <span className="text-zinc-700">{formatCurrency(cartTotals.taxCents)}</span>
                    </div>
                  ) : null}
                  {cartTotals.discountCents > 0 ? (
                    <div className="flex items-center justify-between">
                      <span className="text-zinc-500">Discount</span>
                      <span className="text-zinc-700">-{formatCurrency(cartTotals.discountCents)}</span>
                    </div>
                  ) : null}
                  <div className="flex items-center justify-between border-t border-zinc-100 pt-2">
                    <span className="font-semibold text-ink">Total</span>
                    <span className="text-lg font-black text-ink">{formatCurrency(cartTotals.totalCents)}</span>
                  </div>
                </>
              ) : null}
            </div>

            {building ? (
              <Button
                className="w-full"
                onClick={docType === 'invoice' ? handleCreateInvoice : () => void handleCreateQuote()}
                disabled={cart.length === 0 || creatingInvoice || creatingQuote}
              >
                {creatingInvoice || creatingQuote ? <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" /> : null}
                {docType === 'invoice' ? 'Create invoice' : 'Create quote'}
              </Button>
            ) : invoice ? (
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
            ) : quote ? (
              <div className="space-y-3">
                <div className="space-y-2">
                  <Field label="Customer name" htmlFor="cust-name" hint="Optional — shown on the quote.">
                    <Input id="cust-name" value={customerName} onChange={(e) => setCustomerName(e.target.value)} placeholder="Walk-in customer" />
                  </Field>
                  <Field label="Customer email" htmlFor="cust-email" hint="Needed to email the quote.">
                    <Input id="cust-email" type="email" value={customerEmail} onChange={(e) => setCustomerEmail(e.target.value)} placeholder="name@example.com" />
                  </Field>
                </div>

                <div className="space-y-2 border-t border-zinc-100 pt-3">
                  <Button className="w-full" variant="secondary" onClick={() => window.print()}>
                    <Printer className="h-5 w-5" aria-hidden="true" />
                    Print quote
                  </Button>
                  <Button className="w-full" variant="secondary" onClick={() => void handleCopyQuoteLink()}>
                    <Copy className="h-5 w-5" aria-hidden="true" />
                    Copy customer link
                  </Button>
                  <Button className="w-full" onClick={() => setQuoteEmailPreviewOpen(true)}>
                    <Mail className="h-5 w-5" aria-hidden="true" />
                    Preview &amp; send quote email
                  </Button>
                  <a
                    href={`/app/quotes/${quote.quote.id}`}
                    className="block w-full rounded-xl px-4 py-2.5 text-center text-sm font-semibold text-brand hover:underline"
                  >
                    Open full quote page (tiers, deposit, vehicle info…)
                  </a>
                  <Button className="w-full" variant="ghost" onClick={startNewSession}>
                    Start a new scan
                  </Button>
                </div>
              </div>
            ) : null}
          </Card>
        </div>
      </div>

      {quote ? (
        <EmailPreviewModal
          bundle={quote}
          initialTemplate="initial"
          open={quoteEmailPreviewOpen}
          onClose={() => setQuoteEmailPreviewOpen(false)}
          onSent={() => {
            void repo.getQuoteBundle(quote.quote.id).then((b) => {
              if (b) setQuote(b)
            })
          }}
        />
      ) : null}

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
            <p className="truncate text-sm font-semibold text-ink">{splitItemName(row).title}</p>
            <p className="truncate text-xs text-zinc-500">{splitItemName(row).descriptor ?? '—'}</p>
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
