// A polished, printable sales document — used for both invoices and the
// scan workspace's inline quote result. Ported from a real packing-slip
// design the user supplied (dark→brand-color gradient bar, a bordered
// order-info box, bordered info cards, a dark section-title bar over the
// items table, a bordered totals panel, and a bordered policy footer) and
// generalized to any shop's own branding (name/logo/address/primaryColor)
// rather than hardcoded to the one shop whose design this came from. See
// docs/INVOICE_AND_QUOTE_DOCUMENT.md.
//
// Deliberately doesn't include a "Ship To" card the way the source packing
// slip did — this app has no separate shipping-address concept (it's an
// in-shop install business, not e-commerce fulfillment) — inventing one
// would just be blank. "Bill to" + "Status" covers what's actually real.

import type { ReactNode } from 'react'
import { MapPin, Phone } from 'lucide-react'
import type { Shop } from '../types'
import { formatCurrency } from '../lib/format'

export interface SalesDocumentItem {
  id: string
  name: string
  brand: string | null
  model: string | null
  quantity: number
  /** Null for a quote's items — this app prices a quote per-option, not
   *  per-item (see QuoteItem in types.ts), so there's no real per-line
   *  price to show; the Price/Total columns render "—" instead of a
   *  fabricated number. Invoice items always have a real unit price. */
  unitPriceCents: number | null
}

export type SalesDocumentStatusTone = 'success' | 'warning' | 'neutral'

const STATUS_TONE_CLASSES: Record<SalesDocumentStatusTone, string> = {
  success: 'bg-green-100 text-green-800',
  warning: 'bg-amber-100 text-amber-800',
  neutral: 'bg-zinc-100 text-zinc-700',
}

export function SalesDocument({
  kind,
  shop,
  number,
  dateLabel,
  statusLabel,
  statusTone,
  customerName,
  customerEmail,
  items,
  subtotalCents,
  taxCents,
  discountCents,
  totalCents,
  paidCents,
  extraStatusLine,
}: {
  kind: 'invoice' | 'quote'
  shop: Shop | null
  number: string
  dateLabel: string
  statusLabel: string
  statusTone: SalesDocumentStatusTone
  customerName: string
  customerEmail: string
  items: SalesDocumentItem[]
  subtotalCents: number
  /** Omit or 0 to hide the line — a tax-included sale shows no tax row. */
  taxCents?: number
  discountCents?: number
  totalCents: number
  /** e.g. "Paid $250.00 — Cash" for a paid invoice. */
  paidCents?: number | null
  extraStatusLine?: ReactNode
}) {
  const color = shop?.primaryColor || '#1d4ed8'
  const hasBillTo = customerName.trim() || customerEmail.trim()

  return (
    <div className="overflow-hidden rounded-2xl border border-zinc-200 bg-white">
      <div className="h-2" style={{ background: `linear-gradient(90deg, #111827, ${color})` }} />

      <div className="p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            {shop?.logoUrl ? (
              <img src={shop.logoUrl} alt={shop.name} className="max-h-14 max-w-64 object-contain" />
            ) : (
              <p className="text-2xl font-black text-ink">{shop?.name ?? 'Your Shop'}</p>
            )}
            <div className="mt-2 space-y-0.5 text-xs text-zinc-500">
              <p className="font-semibold text-ink">{shop?.name}</p>
              {shop?.address ? (
                <p className="flex items-center gap-1.5">
                  <MapPin className="h-3 w-3 shrink-0" aria-hidden="true" /> {shop.address}
                </p>
              ) : null}
              <p className="flex items-center gap-1.5 flex-wrap">
                {shop?.email}
                {shop?.phone ? (
                  <>
                    <Phone className="h-3 w-3 shrink-0" aria-hidden="true" /> {shop.phone}
                  </>
                ) : null}
                {shop?.website ? <span>{shop.website}</span> : null}
              </p>
            </div>
          </div>

          <div className="min-w-52 rounded-xl border border-zinc-200 bg-zinc-50 p-4 text-right">
            <p className="text-lg font-black tracking-tight" style={{ color }}>
              {kind === 'invoice' ? 'INVOICE' : 'QUOTE'}
            </p>
            <p className="mt-1 text-sm font-semibold text-zinc-600">#{number}</p>
            <p className="text-sm text-zinc-500">{dateLabel}</p>
          </div>
        </div>

        <div className="mt-5 grid gap-3 sm:grid-cols-2">
          {hasBillTo ? (
            <div className="rounded-xl border border-zinc-200 p-4">
              <p className="text-xs font-bold tracking-wide uppercase" style={{ color }}>
                Bill to
              </p>
              {customerName.trim() ? <p className="mt-1 text-sm font-semibold text-ink">{customerName.trim()}</p> : null}
              {customerEmail.trim() ? <p className="text-sm text-zinc-600">{customerEmail.trim()}</p> : null}
            </div>
          ) : null}
          <div className="rounded-xl border border-zinc-200 p-4">
            <p className="text-xs font-bold tracking-wide uppercase" style={{ color }}>
              Status
            </p>
            <span className={`mt-1 inline-block rounded-full px-3 py-1 text-xs font-bold ${STATUS_TONE_CLASSES[statusTone]}`}>
              {statusLabel}
            </span>
            {extraStatusLine ? <p className="mt-1.5 text-sm text-zinc-600">{extraStatusLine}</p> : null}
          </div>
        </div>
      </div>

      <div className="mx-6 rounded-lg bg-ink px-4 py-2">
        <p className="text-xs font-bold tracking-wide text-white uppercase">
          {kind === 'invoice' ? 'Items' : 'What this covers'}
        </p>
      </div>

      <table className="mt-3 w-full text-sm">
        <thead>
          <tr className="border-b border-zinc-100 text-left text-xs font-semibold tracking-wide text-zinc-400 uppercase">
            <th className="px-6 py-2 font-semibold">Item</th>
            <th className="px-3 py-2 text-right font-semibold">Qty</th>
            <th className="px-3 py-2 text-right font-semibold">Price</th>
            <th className="px-6 py-2 text-right font-semibold">Total</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-100">
          {items.map((item) => (
            <tr key={item.id}>
              <td className="px-6 py-3">
                <p className="font-medium text-ink">{item.name.trim() || 'Item'}</p>
                {item.brand || item.model ? <p className="text-xs text-zinc-500">{[item.brand, item.model].filter(Boolean).join(' · ')}</p> : null}
              </td>
              <td className="px-3 py-3 text-right text-zinc-500">{item.quantity}</td>
              <td className="px-3 py-3 text-right text-zinc-500">{item.unitPriceCents != null ? formatCurrency(item.unitPriceCents) : '—'}</td>
              <td className="px-6 py-3 text-right font-semibold text-ink">
                {item.unitPriceCents != null ? formatCurrency(item.unitPriceCents * item.quantity) : '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="flex justify-end p-6 pt-4">
        <div className="w-full max-w-64 space-y-1.5 rounded-xl border border-zinc-200 p-4">
          <div className="flex items-center justify-between text-sm text-zinc-500">
            <span>Subtotal</span>
            <span>{formatCurrency(subtotalCents)}</span>
          </div>
          {discountCents ? (
            <div className="flex items-center justify-between text-sm text-zinc-500">
              <span>Discount</span>
              <span>-{formatCurrency(discountCents)}</span>
            </div>
          ) : null}
          {taxCents ? (
            <div className="flex items-center justify-between text-sm text-zinc-500">
              <span>Tax</span>
              <span>{formatCurrency(taxCents)}</span>
            </div>
          ) : null}
          <div className="flex items-center justify-between border-t border-zinc-200 pt-1.5 text-base font-bold text-ink">
            <span>Total</span>
            <span>{formatCurrency(totalCents)}</span>
          </div>
          {paidCents != null ? (
            <div className="flex items-center justify-between text-sm text-green-700">
              <span>Paid</span>
              <span>{formatCurrency(paidCents)}</span>
            </div>
          ) : null}
        </div>
      </div>

      {shop?.quoteDisclaimer?.trim() ? (
        <div className="mx-6 mb-4 rounded-xl border-2 border-ink p-4">
          <p className="text-xs font-bold tracking-wide uppercase" style={{ color }}>
            Terms
          </p>
          <p className="mt-1.5 text-xs leading-relaxed text-zinc-600">{shop.quoteDisclaimer}</p>
        </div>
      ) : null}

      <p className="border-t border-zinc-100 px-6 py-4 text-center text-xs text-zinc-400">
        Thank you for your business{shop?.name ? ` — ${shop.name}` : ''}
        {shop?.phone ? ` · ${shop.phone}` : ''}
      </p>
    </div>
  )
}
