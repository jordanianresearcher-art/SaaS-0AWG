// Print 4x6" product labels — /app/inventory/labels.
//
// Closes the loop opened by src/lib/sku.ts: a product with no findable
// manufacturer barcode gets a generated Code 128 code, and this is where that
// code becomes a label you can stick on the shelf. Once it's on the box, every
// future scan resolves instantly out of the local catalog — no lookup, no AI
// call, no typing. That's the whole flywheel: identify a product once, never
// pay for it again.
//
// Printing goes through the browser's own print dialog rather than a PDF
// library. 4x6" is the standard thermal label size (Rollo, Zebra, DYMO), and a
// 4x6 `@page` rule (injected around the print call — see printLabels) drives
// those printers directly, while "Save as PDF" in the same dialog covers a shop
// that just wants a file. A jsPDF dependency would add weight and take away the
// direct-to-printer path.

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Printer, Tag } from 'lucide-react'
import { useRepo } from '../../data/AppDataContext'
import { useToast } from '../../components/Toast'
import { Button, Card, EmptyState, LoadingBlock, PageHeader } from '../../components/ui'
import { code128SvgMarkup } from '../../lib/barcode'
import { formatItemDisplayName, formatItemShortName } from '../../lib/productNaming'
import { formatCurrency } from '../../lib/format'
import { errorMessage } from '../../lib/errors'
import type { CatalogItem } from '../../types'

/** The code a label carries: a real manufacturer UPC when we have one, else the generated SKU. */
function labelCode(item: CatalogItem): string | null {
  return item.upc?.trim() || item.sku?.trim() || null
}

function LabelSheet({ item }: { item: CatalogItem }) {
  const code = labelCode(item)
  // moduleWidth 2 keeps the printed bars wide enough for cheap USB and
  // phone-camera scanners; below that, thermal printers start dropping reads.
  const svg = code ? code128SvgMarkup(code, { moduleWidth: 2, height: 90 }) : null

  return (
    <div className="label-sheet flex flex-col items-center justify-between border border-zinc-300 bg-white p-4 text-center">
      <div className="w-full">
        <p className="text-[15px] leading-tight font-black text-black">{formatItemShortName(item)}</p>
        <p className="mt-1 line-clamp-3 text-[11px] leading-tight text-black">{formatItemDisplayName(item)}</p>
      </div>

      {svg ? (
        <div className="my-2 flex w-full justify-center" dangerouslySetInnerHTML={{ __html: svg }} />
      ) : (
        <p className="my-2 text-[11px] text-black">No barcode — generate a code first</p>
      )}

      <div className="w-full">
        {code ? <p className="font-mono text-[12px] tracking-wide text-black">{code}</p> : null}
        {item.defaultPriceCents !== null ? (
          <p className="mt-1 text-[20px] font-black text-black">{formatCurrency(item.defaultPriceCents)}</p>
        ) : null}
      </div>
    </div>
  )
}

export default function LabelPrintPage() {
  const repo = useRepo()
  const toast = useToast()
  const [items, setItems] = useState<CatalogItem[] | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [working, setWorking] = useState(false)

  const load = useCallback(async () => {
    setItems(await repo.listCatalogItems())
  }, [repo])

  useEffect(() => {
    void load()
  }, [load])

  // The queue: anything that either has no scannable code at all, or has a
  // generated one whose label was never printed. A real manufacturer barcode
  // already on the box needs no label from us.
  const queue = useMemo(() => {
    if (!items) return []
    return items.filter((i) => i.active && (!labelCode(i) || (i.upcIsGenerated && !i.labelPrintedAt)))
  }, [items])

  const selectedItems = useMemo(
    () => (items ?? []).filter((i) => selected.has(i.id)),
    [items, selected],
  )

  const needsCode = useMemo(() => selectedItems.filter((i) => !labelCode(i)), [selectedItems])

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const generateCodes = async () => {
    setWorking(true)
    try {
      for (const item of needsCode) {
        const sku = await repo.generateSku(item.brand, item.model ?? item.name)
        await repo.updateCatalogItem(item.id, {
          brand: item.brand,
          model: item.model,
          name: item.name,
          defaultPriceCents: item.defaultPriceCents,
          category: item.category,
          sku,
          upc: sku,
          upcIsGenerated: true,
        })
      }
      await load()
      toast('success', `Generated ${needsCode.length} code${needsCode.length === 1 ? '' : 's'}.`)
    } catch (err) {
      console.error('generate codes failed', err)
      const detail = errorMessage(err)
      toast('error', detail ? `Could not generate codes: ${detail}` : 'Could not generate codes. Please try again.')
    } finally {
      setWorking(false)
    }
  }

  const printLabels = async () => {
    // `@page` can't be scoped with a selector, so a stylesheet-level rule
    // would force invoices and quote documents onto 4x6 paper too. Inject it
    // only around this print call, then take it back out.
    const pageRule = document.createElement('style')
    pageRule.textContent = '@page { size: 4in 6in; margin: 0.15in; }'
    document.head.appendChild(pageRule)
    try {
      window.print()
    } finally {
      pageRule.remove()
    }
    // Marked after the dialog opens rather than after it closes — the browser
    // never tells us whether the user actually printed. Over-marking is the
    // safer failure: a label can be reprinted from the item, but an item that
    // silently stays in the queue forever trains people to ignore the queue.
    try {
      await Promise.all(selectedItems.filter((i) => labelCode(i)).map((i) => repo.markLabelPrinted(i.id)))
      await load()
    } catch (err) {
      console.error('mark label printed failed', err)
    }
  }

  if (items === null) return <LoadingBlock label="Loading products…" />

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="no-print">
        <PageHeader
          back={{ to: '/app/inventory', label: 'Inventory' }}
          title="Print labels"
          subtitle="Stick a code on anything without one. After that it scans instantly, every time."
        />
      </div>

      {queue.length === 0 ? (
        <EmptyState
          title="Everything is labeled"
          message="Products you add without a manufacturer barcode will show up here, ready for a code and a label."
        />
      ) : (
        <>
          <Card className="no-print space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-base font-semibold text-ink">
                {selected.size} of {queue.length} selected
              </p>
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="secondary"
                  onClick={() => setSelected(new Set(selected.size === queue.length ? [] : queue.map((i) => i.id)))}
                >
                  {selected.size === queue.length ? 'Clear' : 'Select all'}
                </Button>
                {needsCode.length > 0 ? (
                  <Button disabled={working} onClick={() => void generateCodes()}>
                    <Tag className="h-5 w-5" aria-hidden="true" />
                    {working ? 'Generating…' : `Generate ${needsCode.length} code${needsCode.length === 1 ? '' : 's'}`}
                  </Button>
                ) : (
                  <Button disabled={selected.size === 0} onClick={() => void printLabels()}>
                    <Printer className="h-5 w-5" aria-hidden="true" /> Print {selected.size}
                  </Button>
                )}
              </div>
            </div>
            {needsCode.length > 0 ? (
              <p className="text-sm text-zinc-600">
                {needsCode.length} selected {needsCode.length === 1 ? 'product has' : 'products have'} no code yet —
                generate first, then print.
              </p>
            ) : null}
          </Card>

          <ul className="no-print space-y-2">
            {queue.map((item) => (
              <li key={item.id}>
                <label className="flex cursor-pointer items-center gap-3 rounded-xl border border-zinc-200 bg-white p-3">
                  <input
                    type="checkbox"
                    className="h-5 w-5 shrink-0 accent-brand"
                    checked={selected.has(item.id)}
                    onChange={() => toggle(item.id)}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block text-base font-bold text-ink">{formatItemDisplayName(item)}</span>
                    <span className="block text-sm text-zinc-500">
                      {labelCode(item) ?? 'No code yet'}
                      {item.defaultPriceCents !== null ? ` · ${formatCurrency(item.defaultPriceCents)}` : ''}
                    </span>
                  </span>
                </label>
              </li>
            ))}
          </ul>
        </>
      )}

      {/* The print surface. Hidden on screen, one 4x6" page per label when
          printed — see the @page rule in index.css. */}
      <div className="label-print-area hidden">
        {selectedItems.map((item) => (
          <LabelSheet key={item.id} item={item} />
        ))}
      </div>
    </div>
  )
}
