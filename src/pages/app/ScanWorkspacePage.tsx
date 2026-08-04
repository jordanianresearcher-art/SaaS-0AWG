// The scan-to-invoice workspace: the shop's primary daily workflow. Scan a
// barcode (or search/add manually) and it lands in the center work area,
// editable via a pencil button; the side panel is where staff decide what
// this scan session becomes. This phase wires only the "Invoice" document
// type end to end — Quote/Receive inventory/Outgoing order are shown as
// upcoming, not yet functional (see docs/INVENTORY_AND_SCANNING.md).

import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Barcode, Camera, Loader2, Minus, Package, Pencil, Plus, Printer, Search, Trash2 } from 'lucide-react'
import { useAppData, useRepo } from '../../data/AppDataContext'
import { useToast } from '../../components/Toast'
import { Button, Card, EmptyState, Field, Input, LoadingBlock, Modal, Select } from '../../components/ui'
import { formatCurrency, formatDateTime, parseDollarsToCents } from '../../lib/format'
import { newId } from '../../lib/ids'
import { useHardwareScanner } from '../../lib/useHardwareScanner'
import {
  addOrIncrementCartItem,
  cartSubtotalCents,
  cartToInvoiceItemInputs,
  removeCartItem,
  setCartItemQuantity,
  updateCartItem,
  type ScannedCartItem,
} from '../../lib/scanCart'
import type { CatalogItem, Invoice, InvoicePaymentMethod } from '../../types'

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
  const [creatingInvoice, setCreatingInvoice] = useState(false)
  const [paymentMethod, setPaymentMethod] = useState<InvoicePaymentMethod>('cash')
  const [paymentAmount, setPaymentAmount] = useState('')
  const [markingPaid, setMarkingPaid] = useState(false)

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
    try {
      const result = await repo.lookupProductByUpc(code)
      if (result.source === 'catalog') {
        addCatalogItem(result.catalogItem)
        toast('success', `Added ${result.catalogItem.name}.`)
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
      } else {
        toast('error', `No match for that barcode (${code}). Add it manually below.`)
      }
    } catch (err) {
      toast('error', err instanceof Error ? err.message : 'Barcode lookup failed.')
    } finally {
      setLookupBusy(false)
      // Return focus to the scan field either way, so the very next scan —
      // via the scanner, no click needed — just works.
      scanInputRef.current?.focus()
    }
  }

  // Fallback for when focus has drifted off the dedicated scan input (a
  // button, the page background) — see useHardwareScanner.ts. Only active
  // while still building the cart; nothing to scan into once the invoice
  // is locked in.
  useHardwareScanner(handleBarcodeDetected, building)

  function handlePhotoCaptured() {
    setScannerOpen(false)
    toast('error', "Photo lookup isn't available yet — add this item manually below.")
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
        brand: null,
        model: null,
        imageUrl: null,
        unitPriceCents: parseDollarsToCents(customPrice) ?? 0,
        quantity: 1,
        category: null,
      },
    ])
    setCustomName('')
    setCustomPrice('')
  }

  async function handleCreateInvoice() {
    setCreatingInvoice(true)
    try {
      const created = await repo.createInvoice({ items: cartToInvoiceItemInputs(cart) })
      setInvoice(created)
      setPaymentAmount((created.totalCents / 100).toString())
    } catch {
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

  function startNewSession() {
    setCart([])
    setInvoice(null)
    setPaymentAmount('')
    setPaymentMethod('cash')
    setManualQuery('')
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
                      Looking it up…
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
                <div className="flex flex-wrap gap-2">
                  <Input value={customName} onChange={(e) => setCustomName(e.target.value)} placeholder="Item name" className="min-w-40 flex-1" />
                  <Input value={customPrice} onChange={(e) => setCustomPrice(e.target.value)} placeholder="Price" inputMode="decimal" className="w-28" />
                  <Button variant="secondary" onClick={addCustomItem} disabled={!customName.trim()}>
                    <Plus className="h-4 w-4" aria-hidden="true" />
                    Add
                  </Button>
                </div>
              </Card>
            </>
          ) : (
            <InvoiceSummary invoice={invoice} shopName={shop?.name ?? ''} />
          )}
        </div>

        {/* Side panel */}
        <div className="no-print mt-4 space-y-4 lg:sticky lg:top-4 lg:mt-0">
          <Card className="space-y-3">
            <p className="text-sm font-semibold text-ink">Turn this into…</p>
            <div className="grid grid-cols-2 gap-2">
              <div className="rounded-xl border-2 border-brand bg-blue-50 px-3 py-2.5 text-center text-sm font-semibold text-brand">Invoice</div>
              {['Quote', 'Receive inventory', 'Outgoing order'].map((label) => (
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

            <div className="flex items-center justify-between border-t border-zinc-100 pt-3 text-sm">
              <span className="text-zinc-500">Subtotal</span>
              <span className="text-base font-bold text-ink">{formatCurrency(subtotalCents)}</span>
            </div>

            {building ? (
              <Button className="w-full" onClick={handleCreateInvoice} disabled={cart.length === 0 || creatingInvoice}>
                {creatingInvoice ? <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" /> : null}
                Create invoice
              </Button>
            ) : invoice.status === 'draft' ? (
              <div className="space-y-2">
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
            ) : (
              <div className="space-y-2">
                <Button className="w-full" variant="secondary" onClick={() => window.print()}>
                  <Printer className="h-5 w-5" aria-hidden="true" />
                  Print invoice
                </Button>
                <Button className="w-full" variant="ghost" onClick={startNewSession}>
                  Start a new scan
                </Button>
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

function InvoiceSummary({ invoice, shopName }: { invoice: Invoice; shopName: string }) {
  return (
    <Card className="space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold tracking-wide text-zinc-500 uppercase">{shopName}</p>
          <h2 className="text-xl font-bold text-ink">Invoice #{invoice.invoiceNumber}</h2>
        </div>
        <div className="text-right text-sm text-zinc-500">
          <p>{formatDateTime(invoice.createdAt)}</p>
          {invoice.status === 'paid' ? (
            <p className="mt-1 font-semibold text-green-700">Paid{invoice.paymentMethod ? ` — ${PAYMENT_METHOD_LABELS[invoice.paymentMethod]}` : ''}</p>
          ) : (
            <p className="mt-1 font-semibold text-amber-600">Unpaid</p>
          )}
        </div>
      </div>
      <div className="divide-y divide-zinc-100 border-y border-zinc-100">
        {invoice.items.map((item) => (
          <div key={item.id} className="flex items-center justify-between gap-3 py-2 text-sm">
            <div className="min-w-0">
              <p className="truncate font-medium text-ink">{item.name}</p>
              <p className="text-xs text-zinc-500">{[item.brand, item.model].filter(Boolean).join(' · ')}</p>
            </div>
            <span className="shrink-0 text-zinc-500">×{item.quantity}</span>
            <span className="shrink-0 font-semibold text-ink">{formatCurrency(item.unitPriceCents * item.quantity)}</span>
          </div>
        ))}
      </div>
      <div className="flex items-center justify-between text-base font-bold text-ink">
        <span>Total</span>
        <span>{formatCurrency(invoice.totalCents)}</span>
      </div>
    </Card>
  )
}
