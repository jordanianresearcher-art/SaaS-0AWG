// Bulk catalog categorization tool: drag a product onto a category (or tap a
// product then tap a category — the same dual interaction model as the
// package builder's product tray), plus a one-click "Auto-categorize" pass
// over anything still uncategorized. Lives in Settings > Product Catalog.

import { useMemo, useState } from 'react'
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import { Search, Sparkles } from 'lucide-react'
import { PRODUCT_CATEGORIES, PRODUCT_CATEGORY_INFO } from '../lib/audioConfigs'
import { guessCategoryFromName } from '../lib/categorize'
import { formatCurrency } from '../lib/format'
import { useToast } from './Toast'
import { Button } from './ui'
import type { CatalogItem, ProductCategory } from '../types'

interface CatalogOrganizerProps {
  items: CatalogItem[]
  onSetCategory: (itemId: string, category: ProductCategory | null) => Promise<void>
}

export default function CatalogOrganizer({ items, onSetCategory }: CatalogOrganizerProps) {
  const toast = useToast()
  const [search, setSearch] = useState('')
  const [uncategorizedOnly, setUncategorizedOnly] = useState(true)
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null)
  const [autoRunning, setAutoRunning] = useState(false)

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor),
  )

  const counts = useMemo(() => {
    const byCategory = new Map<ProductCategory, number>()
    for (const item of items) {
      if (item.category) byCategory.set(item.category, (byCategory.get(item.category) ?? 0) + 1)
    }
    return byCategory
  }, [items])

  const uncategorizedCount = items.filter((i) => !i.category).length

  const q = search.trim().toLowerCase()
  const visibleItems = items
    .filter((i) => !uncategorizedOnly || !i.category)
    .filter((i) => !q || [i.name, i.brand, i.model].filter((v): v is string => Boolean(v)).some((s) => s.toLowerCase().includes(q)))

  async function assign(itemId: string, category: ProductCategory) {
    try {
      await onSetCategory(itemId, category)
      setSelectedItemId(null)
    } catch {
      toast('error', 'Could not update that product. Please try again.')
    }
  }

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event
    if (!over) return
    const itemId = active.data.current?.itemId as string | undefined
    const category = over.data.current?.category as ProductCategory | undefined
    if (!itemId || !category) return
    void assign(itemId, category)
  }

  async function runAutoCategorize() {
    const targets = items.filter((i) => !i.category)
    if (targets.length === 0) {
      toast('success', 'Nothing to auto-categorize — every product already has a category.')
      return
    }
    setAutoRunning(true)
    let categorized = 0
    for (const item of targets) {
      const guess = guessCategoryFromName(item.name, item.description)
      if (!guess) continue
      try {
        await onSetCategory(item.id, guess)
        categorized += 1
      } catch {
        // One failed update shouldn't stop the rest of the batch.
      }
    }
    setAutoRunning(false)
    const stillUnclear = targets.length - categorized
    toast(
      'success',
      stillUnclear > 0
        ? `Auto-categorized ${categorized} of ${targets.length} — ${stillUnclear} need a manual look.`
        : `Auto-categorized all ${categorized}.`,
    )
  }

  return (
    <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm text-zinc-600">
            Drag a product onto a category, or tap a product then tap a category. {uncategorizedCount} uncategorized.
          </p>
          <Button type="button" variant="secondary" disabled={autoRunning || uncategorizedCount === 0} onClick={() => void runAutoCategorize()}>
            <Sparkles className="h-5 w-5" aria-hidden="true" /> {autoRunning ? 'Categorizing…' : 'Auto-categorize'}
          </Button>
        </div>

        <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_20rem] lg:items-start lg:gap-6">
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex min-w-48 flex-1 items-center gap-2 rounded-lg border border-zinc-200 px-3">
                <Search className="h-4 w-4 shrink-0 text-zinc-400" aria-hidden="true" />
                <input
                  type="search"
                  placeholder="Search products…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="min-h-11 flex-1 bg-transparent text-sm outline-none"
                />
              </div>
              <label className="flex items-center gap-2 text-sm text-zinc-600">
                <input
                  type="checkbox"
                  checked={uncategorizedOnly}
                  onChange={(e) => setUncategorizedOnly(e.target.checked)}
                  className="h-4 w-4 accent-[#1d4ed8]"
                />
                Uncategorized only
              </label>
            </div>

            {visibleItems.length === 0 ? (
              <p className="text-sm text-zinc-500">{uncategorizedOnly ? 'Nothing uncategorized — nice.' : 'No products found.'}</p>
            ) : (
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {visibleItems.map((item) => (
                  <OrganizerItemCard
                    key={item.id}
                    item={item}
                    selected={selectedItemId === item.id}
                    onSelect={() => setSelectedItemId((id) => (id === item.id ? null : item.id))}
                  />
                ))}
              </div>
            )}
          </div>

          <div className="mt-4 grid grid-cols-2 gap-2 lg:mt-0 lg:sticky lg:top-0 lg:max-h-[75vh] lg:grid-cols-1 lg:overflow-y-auto lg:pl-1">
            {PRODUCT_CATEGORIES.map((category) => (
              <CategoryBin
                key={category}
                category={category}
                count={counts.get(category) ?? 0}
                selectable={selectedItemId !== null}
                onTapAssign={() => {
                  if (selectedItemId) void assign(selectedItemId, category)
                }}
              />
            ))}
          </div>
        </div>
      </div>
    </DndContext>
  )
}

function OrganizerItemCard({ item, selected, onSelect }: { item: CatalogItem; selected: boolean; onSelect: () => void }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: `organizer-${item.id}`,
    data: { itemId: item.id },
  })

  return (
    <div
      ref={setNodeRef}
      onClick={onSelect}
      style={transform ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)` } : undefined}
      className={`touch-none rounded-xl border bg-white p-2 text-left text-sm ${selected ? 'border-brand ring-2 ring-brand' : 'border-zinc-200'} ${
        isDragging ? 'z-10 opacity-70 shadow-lg' : ''
      }`}
      {...listeners}
      {...attributes}
    >
      <p className="line-clamp-2 font-semibold text-ink">
        {[item.brand, item.model].filter(Boolean).join(' ')}
        {item.brand || item.model ? ' — ' : ''}
        {item.name}
      </p>
      <p className="mt-0.5 text-xs text-zinc-500">
        {item.category ? PRODUCT_CATEGORY_INFO[item.category].label : 'Uncategorized'}
        {item.defaultPriceCents !== null ? ` · ${formatCurrency(item.defaultPriceCents)}` : ''}
      </p>
    </div>
  )
}

function CategoryBin({
  category,
  count,
  selectable,
  onTapAssign,
}: {
  category: ProductCategory
  count: number
  selectable: boolean
  onTapAssign: () => void
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `bin-${category}`, data: { category } })
  return (
    <button
      type="button"
      ref={setNodeRef}
      onClick={onTapAssign}
      className={`flex items-center justify-between gap-2 rounded-xl border-2 p-2.5 text-left text-sm transition-colors ${
        isOver ? 'border-brand bg-blue-50' : 'border-zinc-200 bg-white'
      } ${selectable ? 'hover:border-brand' : ''}`}
    >
      <span className="font-semibold text-ink">{PRODUCT_CATEGORY_INFO[category].label}</span>
      <span className="shrink-0 rounded-full bg-zinc-100 px-2 py-0.5 text-xs text-zinc-600">{count}</span>
    </button>
  )
}
