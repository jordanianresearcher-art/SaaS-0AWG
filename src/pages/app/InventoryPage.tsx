// The inventory list: search, filter, and see stock at a glance. Anyone
// with inventory access (a full staff account, or a shared device joined
// via /join — see migration 0017) lands here to look something up or add
// stock; scanning to sell/receive still happens in /app/scan.

import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { ClipboardCheck, Plus, Search } from 'lucide-react'
import { useAppData, useRepo } from '../../data/AppDataContext'
import { Badge, EmptyState, Input, LinkButton, LoadingBlock, Select } from '../../components/ui'
import { CategoryIcon } from '../../components/categoryIcon'
import { PRODUCT_CATEGORY_INFO, PRODUCT_CATEGORIES } from '../../lib/audioConfigs'
import { computeInventorySummary, isLowStock, needsUpc } from '../../lib/inventory'
import { formatCurrency } from '../../lib/format'
import type { CatalogItem } from '../../types'

type SortKey = 'name' | 'price' | 'quantity'

export default function InventoryPage() {
  const repo = useRepo()
  const { shop } = useAppData()
  const [items, setItems] = useState<CatalogItem[] | null>(null)
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState('')
  const [lowStockOnly, setLowStockOnly] = useState(false)
  const [needsUpcOnly, setNeedsUpcOnly] = useState(false)
  const [sort, setSort] = useState<SortKey>('name')

  useEffect(() => {
    void repo.listCatalogItems().then(setItems)
  }, [repo])

  const defaultThreshold = shop?.defaultLowStockThreshold ?? 3

  const categories = useMemo(
    () => PRODUCT_CATEGORIES.filter((c) => (items ?? []).some((i) => i.category === c)),
    [items],
  )

  const filtered = useMemo(() => {
    if (!items) return []
    const q = query.trim().toLowerCase()
    return items
      .filter((i) => !category || i.category === category)
      .filter((i) => !lowStockOnly || isLowStock(i, defaultThreshold))
      .filter((i) => !needsUpcOnly || needsUpc(i))
      .filter(
        (i) =>
          !q ||
          i.name.toLowerCase().includes(q) ||
          i.brand?.toLowerCase().includes(q) ||
          i.model?.toLowerCase().includes(q) ||
          i.upc?.toLowerCase().includes(q) ||
          i.sku?.toLowerCase().includes(q),
      )
      .sort((a, b) => {
        if (sort === 'price') return (b.defaultPriceCents ?? 0) - (a.defaultPriceCents ?? 0)
        if (sort === 'quantity') return a.quantityOnHand - b.quantityOnHand
        return a.name.localeCompare(b.name)
      })
  }, [items, query, category, lowStockOnly, needsUpcOnly, sort, defaultThreshold])

  const summary = useMemo(() => computeInventorySummary(items ?? [], defaultThreshold), [items, defaultThreshold])

  if (!items) return <LoadingBlock label="Loading inventory…" />

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-3xl font-black text-ink">Inventory</h1>
          <p className="text-base text-zinc-600">
            {summary.totalSkus} products · {summary.totalUnits} units on hand · {formatCurrency(summary.totalValueCents)} value
          </p>
        </div>
        <div className="flex gap-2">
          <LinkButton to="/app/inventory/check" variant="secondary">
            <ClipboardCheck className="h-5 w-5" aria-hidden="true" /> Check stock
          </LinkButton>
          <LinkButton to="/app/inventory/new">
            <Plus className="h-5 w-5" aria-hidden="true" /> Add item
          </LinkButton>
        </div>
      </div>

      <div className="space-y-3">
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-3.5 h-5 w-5 -translate-y-1/2 text-zinc-400" aria-hidden="true" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search name, brand, UPC, SKU…"
            className="pl-11"
            aria-label="Search inventory"
          />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Select value={sort} onChange={(e) => setSort(e.target.value as SortKey)} className="w-auto min-w-0" aria-label="Sort by">
            <option value="name">Sort: Name</option>
            <option value="price">Sort: Price</option>
            <option value="quantity">Sort: Quantity (lowest first)</option>
          </Select>
          {categories.length > 0 ? (
            <Select value={category} onChange={(e) => setCategory(e.target.value)} className="w-auto min-w-0" aria-label="Filter by category">
              <option value="">All categories</option>
              {categories.map((c) => (
                <option key={c} value={c}>
                  {PRODUCT_CATEGORY_INFO[c].label}
                </option>
              ))}
            </Select>
          ) : null}
          <button
            type="button"
            onClick={() => setLowStockOnly((v) => !v)}
            className={`min-h-11 rounded-xl border px-3 text-sm font-semibold whitespace-nowrap ${
              lowStockOnly ? 'border-amber-400 bg-amber-50 text-amber-900' : 'border-zinc-300 text-zinc-700'
            }`}
          >
            Low stock ({summary.lowStockCount})
          </button>
          <button
            type="button"
            onClick={() => setNeedsUpcOnly((v) => !v)}
            className={`min-h-11 rounded-xl border px-3 text-sm font-semibold whitespace-nowrap ${
              needsUpcOnly ? 'border-brand bg-blue-50 text-brand' : 'border-zinc-300 text-zinc-700'
            }`}
          >
            Needs UPC ({summary.needsUpcCount})
          </button>
        </div>
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          title={items.length === 0 ? 'No inventory yet' : 'No matches'}
          message={
            items.length === 0
              ? 'Scan a barcode or add a product by hand to start tracking stock.'
              : 'Try a different search or clear a filter.'
          }
          action={
            items.length === 0 ? (
              <LinkButton to="/app/inventory/new">
                <Plus className="h-5 w-5" aria-hidden="true" /> Add item
              </LinkButton>
            ) : undefined
          }
        />
      ) : (
        <ul className="divide-y divide-zinc-200 overflow-hidden rounded-2xl border border-zinc-200 bg-white">
          {filtered.map((item) => {
            const low = isLowStock(item, defaultThreshold)
            return (
              <li key={item.id}>
                <Link to={`/app/inventory/${item.id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-zinc-50">
                  {item.imageUrl ? (
                    <img src={item.imageUrl} alt="" className="h-12 w-12 shrink-0 rounded-lg border border-zinc-200 object-cover" />
                  ) : (
                    <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-zinc-100 text-zinc-400">
                      <CategoryIcon category={item.category} className="h-6 w-6" />
                    </span>
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <span className="truncate font-semibold text-ink">{item.name}</span>
                      {needsUpc(item) ? (
                        <Badge className="shrink-0 bg-blue-50 text-brand" title="No barcode on file">
                          No UPC
                        </Badge>
                      ) : null}
                    </div>
                    <div className="truncate text-sm text-zinc-500">
                      {[item.brand, item.category ? PRODUCT_CATEGORY_INFO[item.category].label : null].filter(Boolean).join(' · ') || '—'}
                    </div>
                  </div>
                  <div className="shrink-0 text-right">
                    <div className="font-semibold text-ink">{item.defaultPriceCents != null ? formatCurrency(item.defaultPriceCents) : '—'}</div>
                    <div className={`text-sm ${low ? 'font-semibold text-amber-700' : 'text-zinc-500'}`}>
                      {item.quantityOnHand} in stock{low ? ' · low' : ''}
                    </div>
                  </div>
                </Link>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
