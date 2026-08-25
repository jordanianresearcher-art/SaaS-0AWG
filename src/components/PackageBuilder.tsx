// Fast visual package builder: drag (or tap) products straight off the
// catalog tray into a flat product list — no vehicle-type/build-type/
// configuration picker in front of it. Optimized for phones/tablets — big
// cards, drag-and-drop via @dnd-kit (pointer + touch + keyboard, so it
// isn't mouse-only like native HTML5 drag-and-drop), a single search box
// that filters the local catalog live and falls back to a web search.
//
// This component owns no react-hook-form state itself — it's a
// self-contained draft editor. The caller (NewQuotePage's MainOptionEditor)
// reads PackageBuilderValue back out and applies it to the option's real
// items/price only when staff explicitly confirms.

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
import { GripVertical, Minus, Package, Plus, Trash2 } from 'lucide-react'
import { PRODUCT_CATEGORY_INFO } from '../lib/audioConfigs'
import {
  addCatalogItemToBuilder,
  addFreehandItemToBuilder,
  computeBuilderItemsSubtotalCents,
  customItemsSubtotalCents,
  removeBuilderItem,
  setBuilderItemQuantity,
  sortCatalogByUsage,
  type BuilderLineItem,
  type CustomBuilderItem,
} from '../lib/packageBuilder'
import { formatCurrency, formatWiringKitSpec, parseDollarsToCents } from '../lib/format'
import { CategoryIcon } from './categoryIcon'
import { ProductSuggestField } from './ProductSuggestField'
import { Button, Field, Input } from './ui'
import type { CatalogItem, ProductCategory } from '../types'
import { filterCatalog } from '../lib/catalogSearch'
import { formatItemDisplayName, formatItemShortName } from '../lib/productNaming'

export interface PackageBuilderValue {
  items: BuilderLineItem[]
  /** Dollar string — priced separately from the parts, per a direct field rather than a drag target. */
  laborPrice: string
  /** One-off items with no catalog product behind them (a fee, misc hardware, etc.). */
  customItems: CustomBuilderItem[]
  /** Dollar string — blank means "use the computed parts+labor+extras subtotal". */
  priceOverride: string
}

export function createEmptyPackageBuilderValue(): PackageBuilderValue {
  return { items: [], laborPrice: '', customItems: [], priceOverride: '' }
}

let customItemCounter = 0
function nextCustomItemId(): string {
  customItemCounter += 1
  return `custom-${customItemCounter}`
}

const DROP_ZONE_ID = 'builder-drop-zone'

interface PackageBuilderProps {
  catalogItems: CatalogItem[]
  value: PackageBuilderValue
  onChange: (next: PackageBuilderValue) => void
  /** Real-usage counts (see computeCatalogUsageCounts) — drives the tray's default "most used first" order. Omit for an unranked (catalog-position) order. */
  usageCounts?: Map<string, number>
}

export default function PackageBuilder({ catalogItems, value, onChange, usageCounts }: PackageBuilderProps) {
  const laborCents = value.laborPrice.trim() ? (parseDollarsToCents(value.laborPrice) ?? 0) : 0
  const subtotalCents =
    computeBuilderItemsSubtotalCents(value.items, catalogItems) + laborCents + customItemsSubtotalCents(value.customItems)
  const overrideCents = value.priceOverride.trim() ? parseDollarsToCents(value.priceOverride) : null
  const finalPriceCents = overrideCents ?? subtotalCents

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor),
  )

  function addCatalogItem(item: CatalogItem) {
    onChange({ ...value, items: addCatalogItemToBuilder(value.items, item) })
  }

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event
    if (!over || over.id !== DROP_ZONE_ID) return
    const dragData = active.data.current as { catalogItem: CatalogItem } | undefined
    if (!dragData) return
    addCatalogItem(dragData.catalogItem)
  }

  return (
    <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
      <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-start lg:gap-6">
        <div className="space-y-4">
          <BuilderDropZone
            items={value.items}
            onQuantityChange={(rowId, quantity) => onChange({ ...value, items: setBuilderItemQuantity(value.items, rowId, quantity) })}
            onRemove={(rowId) => onChange({ ...value, items: removeBuilderItem(value.items, rowId) })}
          />

          <div className="rounded-xl bg-zinc-50 p-3">
            <Field label="Installation labor price" htmlFor="builder-labor-price">
              <Input
                id="builder-labor-price"
                inputMode="decimal"
                placeholder="$150"
                value={value.laborPrice}
                onChange={(e) => onChange({ ...value, laborPrice: e.target.value })}
              />
            </Field>
          </div>

          <div className="space-y-2 rounded-xl bg-zinc-50 p-3">
            <p className="text-sm font-semibold text-ink">Extra / custom items</p>
            {value.customItems.map((item) => (
              <div key={item.id} className="grid grid-cols-[1fr_5rem_3.5rem_auto] gap-2">
                <Input
                  aria-label="Item name"
                  placeholder="What is it?"
                  value={item.name}
                  onChange={(e) =>
                    onChange({
                      ...value,
                      customItems: value.customItems.map((i) => (i.id === item.id ? { ...i, name: e.target.value } : i)),
                    })
                  }
                />
                <Input
                  aria-label="Price"
                  inputMode="decimal"
                  placeholder="$0"
                  value={item.price}
                  onChange={(e) =>
                    onChange({
                      ...value,
                      customItems: value.customItems.map((i) => (i.id === item.id ? { ...i, price: e.target.value } : i)),
                    })
                  }
                />
                <Input
                  aria-label="Quantity"
                  type="number"
                  min={1}
                  inputMode="numeric"
                  value={item.quantity}
                  onChange={(e) =>
                    onChange({
                      ...value,
                      customItems: value.customItems.map((i) =>
                        i.id === item.id ? { ...i, quantity: Math.max(1, Number(e.target.value) || 1) } : i,
                      ),
                    })
                  }
                />
                <button
                  type="button"
                  aria-label="Remove item"
                  onClick={() => onChange({ ...value, customItems: value.customItems.filter((i) => i.id !== item.id) })}
                  className="flex h-11 w-11 items-center justify-center rounded-xl text-zinc-400 hover:bg-red-100 hover:text-red-600"
                >
                  <Trash2 className="h-5 w-5" aria-hidden="true" />
                </button>
              </div>
            ))}
            <Button
              type="button"
              variant="ghost"
              onClick={() =>
                onChange({ ...value, customItems: [...value.customItems, { id: nextCustomItemId(), name: '', price: '', quantity: 1 }] })
              }
            >
              <Plus className="h-5 w-5" aria-hidden="true" /> Add extra item
            </Button>
          </div>

          <div className="space-y-2 rounded-xl border border-zinc-200 p-3">
            <p className="text-sm text-zinc-600">Parts + labor + extras subtotal: {formatCurrency(subtotalCents)}</p>
            <Field label="Installed price to quote" htmlFor="builder-price-override">
              <Input
                id="builder-price-override"
                inputMode="decimal"
                placeholder={(subtotalCents / 100).toFixed(2)}
                value={value.priceOverride}
                onChange={(e) => onChange({ ...value, priceOverride: e.target.value })}
              />
            </Field>
            <p className="text-right text-base font-bold text-ink">Total: {formatCurrency(finalPriceCents)}</p>
          </div>
        </div>

        {/* Catalog tray sits on the right on wide screens (drag leftward onto the
           list) and stays put while the item list scrolls; on phones/tablets it
           just follows below. */}
        <div className="mt-4 lg:sticky lg:top-0 lg:mt-0 lg:max-h-[75vh] lg:overflow-y-auto lg:pl-1">
          <CatalogTray
            catalogItems={catalogItems}
            usageCounts={usageCounts ?? EMPTY_USAGE}
            onTapAdd={addCatalogItem}
            onAddFreehand={(item) => onChange({ ...value, items: addFreehandItemToBuilder(value.items, item) })}
          />
        </div>
      </div>
    </DndContext>
  )
}

const EMPTY_USAGE = new Map<string, number>()

function BuilderDropZone({
  items,
  onQuantityChange,
  onRemove,
}: {
  items: BuilderLineItem[]
  onQuantityChange: (rowId: string, quantity: number) => void
  onRemove: (rowId: string) => void
}) {
  const { setNodeRef, isOver } = useDroppable({ id: DROP_ZONE_ID })

  return (
    <div
      ref={setNodeRef}
      className={`min-h-32 rounded-xl border-2 border-dashed p-3 transition-colors ${
        isOver ? 'border-brand bg-brand-tint' : 'border-zinc-200'
      }`}
    >
      {items.length === 0 ? (
        <div className="flex min-h-24 flex-col items-center justify-center gap-1.5 text-center text-zinc-400">
          <Package className="h-7 w-7" aria-hidden="true" />
          <p className="text-sm font-medium">Drag products here from the right, or tap one to add it</p>
        </div>
      ) : (
        <ul className="space-y-2">
          {items.map((item) => (
            <li key={item.id} className="flex items-center gap-3 rounded-lg bg-white p-2 shadow-sm">
              <span className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-brand-tint">
                {item.imageUrl ? (
                  <img src={item.imageUrl} alt="" className="h-full w-full object-contain" />
                ) : (
                  <CategoryIcon category={item.category} className="h-5 w-5 text-brand" />
                )}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold text-ink">
                  {formatItemDisplayName(item)}
                </span>
                {/* A web-lookup row shows the price it will count as, so the
                    subtotal never contains money nobody can see the source
                    of. Catalog rows price live from the catalog and their
                    price is visible on the tray card instead. */}
                {item.catalogItemId === null && item.unitPriceCents !== null ? (
                  <span className="block text-xs text-zinc-500">{formatCurrency(item.unitPriceCents)} each</span>
                ) : null}
              </span>
              <span className="flex shrink-0 items-center gap-1">
                <button
                  type="button"
                  aria-label={`Decrease ${item.name} quantity`}
                  onClick={() => onQuantityChange(item.id, item.quantity - 1)}
                  className="flex h-9 w-9 items-center justify-center rounded-lg text-zinc-500 hover:bg-zinc-100"
                >
                  <Minus className="h-4 w-4" aria-hidden="true" />
                </button>
                <span className="w-6 text-center text-sm font-bold text-ink">{item.quantity}</span>
                <button
                  type="button"
                  aria-label={`Increase ${item.name} quantity`}
                  onClick={() => onQuantityChange(item.id, item.quantity + 1)}
                  className="flex h-9 w-9 items-center justify-center rounded-lg text-zinc-500 hover:bg-zinc-100"
                >
                  <Plus className="h-4 w-4" aria-hidden="true" />
                </button>
              </span>
              <button
                type="button"
                aria-label={`Remove ${item.name}`}
                onClick={() => onRemove(item.id)}
                className="shrink-0 text-zinc-400 hover:text-red-600"
              >
                <Trash2 className="h-4 w-4" aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

type SortMode = 'usage' | 'name' | 'price'

function CatalogTray({
  catalogItems,
  usageCounts,
  onTapAdd,
  onAddFreehand,
}: {
  catalogItems: CatalogItem[]
  usageCounts: Map<string, number>
  onTapAdd: (item: CatalogItem) => void
  onAddFreehand: (item: { brand: string | null; model: string | null; name: string; category: ProductCategory | null; imageUrl: string | null; unitPriceCents: number | null }) => void
}) {
  const [search, setSearch] = useState('')
  const [category, setCategory] = useState<ProductCategory | null>(null)
  const [sort, setSort] = useState<SortMode>('usage')

  const usageSorted = useMemo(() => sortCatalogByUsage(catalogItems, usageCounts), [catalogItems, usageCounts])
  const presentCategories = useMemo(
    () => Array.from(new Set(catalogItems.map((i) => i.category).filter((c): c is ProductCategory => c !== null))),
    [catalogItems],
  )

  const filtered = filterCatalog(
    usageSorted
      .filter((i) => i.active && i.approvalStatus === 'approved')
      .filter((i) => !category || i.category === category),
    search,
  )
  const ordered =
    sort === 'name'
      ? [...filtered].sort((a, b) => a.name.localeCompare(b.name))
      : sort === 'price'
        ? [...filtered].sort((a, b) => (a.defaultPriceCents ?? Number.MAX_SAFE_INTEGER) - (b.defaultPriceCents ?? Number.MAX_SAFE_INTEGER))
        : filtered

  return (
    <div className="space-y-3">
      <ProductSuggestField
        id="builder-catalog-search"
        value={search}
        onChange={setSearch}
        onSelect={(s) => onAddFreehand({ brand: s.brand, model: s.model, name: s.name, category: null, imageUrl: s.imageUrl, unitPriceCents: s.unitPriceCents })}
        placeholder="Search your catalog or the web…"
      />

      {presentCategories.length > 1 ? (
        <div className="flex flex-wrap gap-1.5">
          <button
            type="button"
            aria-pressed={category === null}
            onClick={() => setCategory(null)}
            className={`min-h-8 rounded-lg border-2 px-2.5 text-xs font-semibold transition-colors ${
              category === null ? 'border-brand bg-brand-tint text-ink' : 'border-zinc-200 text-zinc-600 hover:border-zinc-300'
            }`}
          >
            All
          </button>
          {presentCategories.map((c) => (
            <button
              key={c}
              type="button"
              aria-pressed={category === c}
              onClick={() => setCategory(category === c ? null : c)}
              className={`flex min-h-8 items-center gap-1 rounded-lg border-2 px-2.5 text-xs font-semibold transition-colors ${
                category === c ? 'border-brand bg-brand-tint text-ink' : 'border-zinc-200 text-zinc-600 hover:border-zinc-300'
              }`}
            >
              <CategoryIcon category={c} className="h-3.5 w-3.5" /> {PRODUCT_CATEGORY_INFO[c].label}
            </button>
          ))}
        </div>
      ) : null}

      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-semibold text-zinc-500">
          {ordered.length} product{ordered.length === 1 ? '' : 's'}
        </span>
        <select
          aria-label="Sort products"
          value={sort}
          onChange={(e) => setSort(e.target.value as SortMode)}
          className="rounded-lg border border-zinc-200 bg-white px-2 py-1 text-xs font-medium text-zinc-600"
        >
          <option value="usage">Most used</option>
          <option value="name">Name A–Z</option>
          <option value="price">Price: low to high</option>
        </select>
      </div>

      {ordered.length === 0 ? (
        <p className="text-sm text-zinc-500">No matching products in your catalog — search above to look it up on the web.</p>
      ) : (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-2">
          {ordered.map((item) => (
            <CatalogTrayCard key={item.id} item={item} onTapAdd={() => onTapAdd(item)} />
          ))}
        </div>
      )}
    </div>
  )
}

function CatalogTrayCard({ item, onTapAdd }: { item: CatalogItem; onTapAdd: () => void }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: `tray-${item.id}`,
    data: { catalogItem: item },
  })

  return (
    <div
      ref={setNodeRef}
      onClick={onTapAdd}
      title="Drag or tap to add"
      style={transform ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)` } : undefined}
      className={`relative flex touch-none flex-col items-start gap-1 rounded-xl border border-zinc-200 bg-white p-2 text-left ${
        isDragging ? 'z-10 opacity-70 shadow-lg' : ''
      }`}
      {...listeners}
      {...attributes}
    >
      <span className="absolute top-1.5 right-1.5 text-zinc-300" aria-hidden="true">
        <GripVertical className="h-3.5 w-3.5" />
      </span>
      <div className="flex h-20 w-full items-center justify-center rounded-lg bg-brand-tint">
        {item.imageUrl ? (
          <img src={item.imageUrl} alt="" className="h-full w-full rounded-lg object-contain" />
        ) : (
          <CategoryIcon category={item.category} className="h-7 w-7 text-brand" />
        )}
      </div>
      <p className="line-clamp-2 text-xs font-semibold text-ink">{formatItemShortName(item)}</p>
      {formatWiringKitSpec(item.specs) ? (
        <span className="rounded bg-zinc-100 px-1.5 py-0.5 text-[11px] font-medium text-zinc-600">{formatWiringKitSpec(item.specs)}</span>
      ) : null}
      <p className="text-xs text-zinc-500">{item.defaultPriceCents !== null ? formatCurrency(item.defaultPriceCents) : '—'}</p>
    </div>
  )
}
