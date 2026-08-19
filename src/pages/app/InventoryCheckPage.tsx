// Spot-check flow: confirm physical stock counts a few items at a time,
// flash-card style, biased toward whatever's most overdue (see
// pickOverdueItem) so a quick walk down the shelves actually covers the
// items that need it most. Every confirm goes through markCounted, which
// always stamps lastCountedAt and — only when the count actually changed —
// records a real 'adjustment' stock movement.

import { useEffect, useMemo, useState } from 'react'
import { Minus, Plus } from 'lucide-react'
import { useRepo } from '../../data/AppDataContext'
import { useToast } from '../../components/Toast'
import { Button, Card, EmptyState, LoadingBlock, PageHeader, Select } from '../../components/ui'
import { CategoryIcon } from '../../components/categoryIcon'
import { PRODUCT_CATEGORY_INFO, PRODUCT_CATEGORIES } from '../../lib/audioConfigs'
import { pickOverdueItem } from '../../lib/inventory'
import { formatDateTime } from '../../lib/format'
import type { CatalogItem } from '../../types'

function lastCountedLabel(iso: string | null): string {
  if (!iso) return 'Never counted'
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000)
  if (days <= 0) return 'Counted today'
  if (days === 1) return 'Counted 1 day ago'
  return `Counted ${days} days ago`
}

export default function InventoryCheckPage() {
  const repo = useRepo()
  const toast = useToast()
  const [items, setItems] = useState<CatalogItem[] | null>(null)
  const [category, setCategory] = useState('')
  const [current, setCurrent] = useState<CatalogItem | null>(null)
  const [draftQty, setDraftQty] = useState(0)
  const [saving, setSaving] = useState(false)
  const [checkedCount, setCheckedCount] = useState(0)

  useEffect(() => {
    void repo.listCatalogItems().then(setItems)
  }, [repo])

  const categories = useMemo(() => PRODUCT_CATEGORIES.filter((c) => (items ?? []).some((i) => i.category === c)), [items])

  const pool = useMemo(() => (items ?? []).filter((i) => !category || i.category === category), [items, category])

  useEffect(() => {
    const next = pickOverdueItem(pool)
    setCurrent(next)
    setDraftQty(next?.quantityOnHand ?? 0)
    // Re-pick whenever the filtered pool identity changes (category switch,
    // or the very first load) — not on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [category, items === null])

  function handleSkip() {
    if (!current) return
    const rest = pool.filter((i) => i.id !== current.id)
    const next = pickOverdueItem(rest.length > 0 ? rest : pool)
    setCurrent(next)
    setDraftQty(next?.quantityOnHand ?? 0)
  }

  async function handleConfirm() {
    if (!current || !items) return
    setSaving(true)
    try {
      const result = await repo.markCounted(current.id, draftQty)
      const updatedItems = items.map((i) => (i.id === current.id ? result.catalogItem : i))
      setItems(updatedItems)
      setCheckedCount((c) => c + 1)
      const rest = updatedItems.filter((i) => (!category || i.category === category) && i.id !== current.id)
      const next = pickOverdueItem(rest)
      setCurrent(next)
      setDraftQty(next?.quantityOnHand ?? 0)
    } catch (err) {
      toast('error', err instanceof Error ? err.message : 'Could not save the count.')
    } finally {
      setSaving(false)
    }
  }

  if (!items) return <LoadingBlock label="Loading inventory…" />

  return (
    <div className="mx-auto max-w-xl space-y-5">
      <PageHeader
        back={{ to: '/app/inventory', label: 'Inventory' }}
        title="Check inventory"
        subtitle={checkedCount > 0 ? `${checkedCount} checked this session` : 'Confirm stock counts, one item at a time.'}
      />

      {categories.length > 0 ? (
        <Select value={category} onChange={(e) => setCategory(e.target.value)} aria-label="Filter by category">
          <option value="">All categories</option>
          {categories.map((c) => (
            <option key={c} value={c}>
              {PRODUCT_CATEGORY_INFO[c].label}
            </option>
          ))}
        </Select>
      ) : null}

      {pool.length === 0 ? (
        <EmptyState title="Nothing to check" message="No items in this category yet." />
      ) : current ? (
        <Card className="space-y-4">
          {current.imageUrl ? (
            <img src={current.imageUrl} alt="" className="h-40 w-full rounded-xl border border-zinc-200 object-cover" />
          ) : (
            <span className="flex h-40 w-full items-center justify-center rounded-xl bg-zinc-100 text-zinc-400">
              <CategoryIcon category={current.category} className="h-12 w-12" />
            </span>
          )}
          <div>
            <div className="text-xl font-black text-ink">{current.name}</div>
            <div className="text-base text-zinc-600">{[current.brand, current.category ? PRODUCT_CATEGORY_INFO[current.category].label : null].filter(Boolean).join(' · ') || '—'}</div>
            <div className="mt-1 text-sm text-zinc-500">{lastCountedLabel(current.lastCountedAt)}{current.lastCountedAt ? ` (${formatDateTime(current.lastCountedAt)})` : ''}</div>
          </div>

          <div className="flex flex-col items-center gap-2 py-2">
            <span className="text-sm font-semibold text-zinc-600">Current count</span>
            <div className="flex items-center gap-4">
              <button
                type="button"
                onClick={() => setDraftQty((q) => Math.max(0, q - 1))}
                disabled={saving}
                className="flex h-14 w-14 items-center justify-center rounded-xl border border-zinc-300 text-zinc-700 hover:bg-zinc-50 disabled:opacity-50"
                aria-label="Decrease"
              >
                <Minus className="h-6 w-6" aria-hidden="true" />
              </button>
              <span className="w-16 text-center text-4xl font-black text-ink">{draftQty}</span>
              <button
                type="button"
                onClick={() => setDraftQty((q) => q + 1)}
                disabled={saving}
                className="flex h-14 w-14 items-center justify-center rounded-xl border border-zinc-300 text-zinc-700 hover:bg-zinc-50 disabled:opacity-50"
                aria-label="Increase"
              >
                <Plus className="h-6 w-6" aria-hidden="true" />
              </button>
            </div>
          </div>

          <div className="flex gap-3">
            <Button variant="secondary" className="flex-1" onClick={handleSkip} disabled={saving}>
              Skip
            </Button>
            <Button className="flex-1" onClick={handleConfirm} disabled={saving}>
              {saving ? 'Saving…' : 'Confirm & next'}
            </Button>
          </div>
        </Card>
      ) : null}
    </div>
  )
}
