// Fast visual package builder: pick a vehicle type, pick a configuration
// (e.g. "Truck 2×8"), then fill its component slots by dragging (or
// tapping) products from the shop's catalog. Optimized for phones/tablets
// — big cards, drag-and-drop via @dnd-kit (pointer + touch + keyboard, so
// it isn't mouse-only like native HTML5 drag-and-drop), search instead of
// long dropdowns.
//
// This component owns no react-hook-form state itself — it's a
// self-contained draft editor. The caller (NewQuotePage's OptionEditor)
// reads PackageBuilderValue back out and applies it to the option's real
// items/price/configId fields only when staff explicitly confirms.

import { useState } from 'react'
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
import { GripVertical, Package, Search, Trash2 } from 'lucide-react'
import {
  PRODUCT_CATEGORY_INFO,
  VEHICLE_TYPE_INFO,
  VEHICLE_TYPES,
  configurationsForVehicleType,
  getConfiguration,
  validatePackageSlots,
  type ConfigSlot,
} from '../lib/audioConfigs'
import {
  addToSlot,
  catalogItemsForSlot,
  computeComponentSubtotalCents,
  removeFromSlot,
  requiresCompatibilityConfirmation,
  resolveBuilderCatalog,
  setSlotQuantity,
  type SlotAssignment,
  type SlotAssignments,
} from '../lib/packageBuilder'
import { formatCurrency, parseDollarsToCents } from '../lib/format'
import { useToast } from './Toast'
import { Field, Input } from './ui'
import type { CatalogItem, VehicleType } from '../types'

export interface PackageBuilderValue {
  vehicleType: VehicleType | null
  configId: string | null
  assignments: SlotAssignments
  /** Dollar string — priced separately from the parts, per a direct field rather than a drag target. */
  laborPrice: string
  /** Dollar string — blank means "use the computed parts+labor subtotal". */
  priceOverride: string
  confirmed: boolean
}

export function createEmptyPackageBuilderValue(): PackageBuilderValue {
  return { vehicleType: null, configId: null, assignments: {}, laborPrice: '', priceOverride: '', confirmed: false }
}

interface PackageBuilderProps {
  catalogItems: CatalogItem[]
  value: PackageBuilderValue
  onChange: (next: PackageBuilderValue) => void
}

export default function PackageBuilder({ catalogItems, value, onChange }: PackageBuilderProps) {
  const toast = useToast()
  const [selectedSlotKey, setSelectedSlotKey] = useState<string | null>(null)
  const [search, setSearch] = useState('')

  const config = value.configId ? getConfiguration(value.configId) : null
  const laborPriceCents = value.laborPrice.trim() ? parseDollarsToCents(value.laborPrice) : null
  const { catalog: builderCatalog, assignments: builderAssignments } = resolveBuilderCatalog(
    config,
    catalogItems,
    value.assignments,
    laborPriceCents,
  )
  const subtotalCents = computeComponentSubtotalCents(builderAssignments, builderCatalog)
  const overrideCents = value.priceOverride.trim() ? parseDollarsToCents(value.priceOverride) : null
  const finalPriceCents = overrideCents ?? subtotalCents

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor),
  )

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event
    if (!over) return
    const dragData = active.data.current as { catalogItemId: string; category: string | null } | undefined
    const dropData = over.data.current as { slotKey: string; category: string } | undefined
    if (!dragData || !dropData) return
    if (dragData.category !== dropData.category) {
      toast('error', "That product doesn't match this slot's category.")
      return
    }
    onChange({ ...value, assignments: addToSlot(value.assignments, dropData.slotKey, dragData.catalogItemId) })
    setSelectedSlotKey(dropData.slotKey)
  }

  const nonLaborSlots = config ? config.slots.filter((s) => s.category !== 'labor') : []
  const selectedSlot = selectedSlotKey ? (nonLaborSlots.find((s) => s.key === selectedSlotKey) ?? null) : null
  const slotResults = config ? validatePackageSlots(config, Object.values(builderAssignments).flatMap((list) =>
    list.map((a) => ({ category: builderCatalog.find((i) => i.id === a.catalogItemId)?.category ?? null, quantity: a.quantity })),
  )) : null

  return (
    <div className="space-y-5">
      <div>
        <p className="mb-1.5 text-sm font-semibold text-ink">Vehicle type</p>
        <div className="flex flex-wrap gap-2">
          {VEHICLE_TYPES.map((vt) => (
            <button
              key={vt}
              type="button"
              aria-pressed={value.vehicleType === vt}
              onClick={() => {
                setSelectedSlotKey(null)
                onChange({ ...value, vehicleType: vt, configId: value.vehicleType === vt ? value.configId : null })
              }}
              className={`min-h-11 rounded-xl border-2 px-3.5 text-sm font-semibold transition-colors ${
                value.vehicleType === vt ? 'border-brand bg-blue-50 text-ink' : 'border-zinc-200 text-zinc-600 hover:border-zinc-300'
              }`}
            >
              {VEHICLE_TYPE_INFO[vt].label}
            </button>
          ))}
        </div>
      </div>

      {value.vehicleType ? (
        <div>
          <p className="mb-1.5 text-sm font-semibold text-ink">Configuration</p>
          <div className="flex flex-wrap gap-2">
            {configurationsForVehicleType(value.vehicleType).map((c) => (
              <button
                key={c.id}
                type="button"
                aria-pressed={value.configId === c.id}
                onClick={() => {
                  setSelectedSlotKey(null)
                  onChange({ ...value, configId: c.id })
                }}
                className={`min-h-11 rounded-xl border-2 px-3.5 text-sm font-semibold transition-colors ${
                  value.configId === c.id ? 'border-brand bg-blue-50 text-ink' : 'border-zinc-200 text-zinc-600 hover:border-zinc-300'
                }`}
              >
                {c.label}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {config ? (
        <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
          <p className="text-sm text-zinc-600">{config.description}</p>

          <div className="grid gap-3 sm:grid-cols-2">
            {nonLaborSlots.map((slot) => {
              const result = slotResults?.slots.find((s) => s.slot.key === slot.key)
              return (
                <SlotCard
                  key={slot.key}
                  slot={slot}
                  status={result?.status ?? 'missing'}
                  assignments={value.assignments[slot.key] ?? []}
                  catalogItems={catalogItems}
                  selected={selectedSlotKey === slot.key}
                  onSelect={() => setSelectedSlotKey(slot.key)}
                  onQuantityChange={(catalogItemId, quantity) =>
                    onChange({ ...value, assignments: setSlotQuantity(value.assignments, slot.key, catalogItemId, quantity) })
                  }
                  onRemove={(catalogItemId) =>
                    onChange({ ...value, assignments: removeFromSlot(value.assignments, slot.key, catalogItemId) })
                  }
                />
              )
            })}
          </div>

          <ProductTray
            catalogItems={catalogItems}
            selectedSlot={selectedSlot}
            search={search}
            onSearchChange={setSearch}
            onTapAdd={(catalogItemId) => {
              if (!selectedSlotKey) {
                toast('error', 'Tap a slot above first, then tap a product to add it there.')
                return
              }
              onChange({ ...value, assignments: addToSlot(value.assignments, selectedSlotKey, catalogItemId) })
            }}
          />

          <div className="rounded-xl bg-zinc-50 p-3">
            <Field
              label="Installation labor price"
              htmlFor="builder-labor-price"
              hint="Priced separately from the parts above — not a catalog product."
            >
              <Input
                id="builder-labor-price"
                inputMode="decimal"
                placeholder="$150"
                value={value.laborPrice}
                onChange={(e) => onChange({ ...value, laborPrice: e.target.value })}
              />
            </Field>
          </div>

          <div className="space-y-2 rounded-xl border border-zinc-200 p-3">
            <p className="text-sm text-zinc-600">Parts + labor subtotal: {formatCurrency(subtotalCents)}</p>
            <Field
              label="Installed price to quote"
              htmlFor="builder-price-override"
              hint="Defaults to the subtotal above — override for package pricing."
            >
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

          {requiresCompatibilityConfirmation() ? (
            <label className="flex items-start gap-2.5 rounded-xl bg-amber-50 p-3 text-sm text-ink">
              <input
                type="checkbox"
                className="mt-0.5 h-5 w-5 accent-[#1d4ed8]"
                checked={value.confirmed}
                onChange={(e) => onChange({ ...value, confirmed: e.target.checked })}
              />
              <span>
                <strong>Compatibility not verified.</strong> Nothing here checks that these parts actually work together —
                confirm you&apos;ve checked that yourself before using this in a quote.
              </span>
            </label>
          ) : null}
        </DndContext>
      ) : null}
    </div>
  )
}

function SlotCard({
  slot,
  status,
  assignments,
  catalogItems,
  selected,
  onSelect,
  onQuantityChange,
  onRemove,
}: {
  slot: ConfigSlot
  status: 'filled' | 'under' | 'missing'
  assignments: SlotAssignment[]
  catalogItems: CatalogItem[]
  selected: boolean
  onSelect: () => void
  onQuantityChange: (catalogItemId: string, quantity: number) => void
  onRemove: (catalogItemId: string) => void
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `slot-${slot.key}`, data: { slotKey: slot.key, category: slot.category } })
  const byId = new Map(catalogItems.map((i) => [i.id, i]))

  const borderClass =
    status === 'filled'
      ? 'border-green-300 bg-green-50'
      : slot.requirement === 'required'
        ? 'border-red-200 bg-red-50'
        : 'border-zinc-200 bg-white'

  return (
    <div
      ref={setNodeRef}
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onSelect()
        }
      }}
      className={`rounded-xl border-2 p-3 text-left transition-colors ${borderClass} ${selected ? 'ring-2 ring-brand' : ''} ${
        isOver ? '!border-brand' : ''
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-bold text-ink">{slot.label}</p>
        <span
          className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold ${
            slot.requirement === 'required'
              ? 'bg-red-100 text-red-700'
              : slot.requirement === 'recommended'
                ? 'bg-amber-100 text-amber-700'
                : 'bg-zinc-100 text-zinc-600'
          }`}
        >
          {slot.requirement === 'required' ? 'Required' : slot.requirement === 'recommended' ? 'Recommended' : 'Optional'}
        </span>
      </div>
      {slot.note ? <p className="mt-0.5 text-xs text-zinc-500">{slot.note}</p> : null}
      {assignments.length === 0 ? (
        <p className="mt-2 text-sm text-zinc-500">{isOver ? 'Drop it here' : 'Tap to select, then drag or tap a product below'}</p>
      ) : (
        <div className="mt-2 space-y-1.5">
          {assignments.map((a) => {
            const item = byId.get(a.catalogItemId)
            if (!item) return null
            return (
              <div key={a.catalogItemId} className="flex items-center gap-2 rounded-lg bg-white p-1.5 text-sm">
                <span className="flex-1 truncate">{item.name}</span>
                <input
                  type="number"
                  min={1}
                  value={a.quantity}
                  onClick={(e) => e.stopPropagation()}
                  onChange={(e) => onQuantityChange(a.catalogItemId, Math.max(1, Number(e.target.value) || 1))}
                  aria-label={`${item.name} quantity`}
                  className="w-12 rounded border border-zinc-200 px-1 text-center"
                />
                <span className="shrink-0 text-zinc-500">
                  {item.defaultPriceCents !== null ? formatCurrency(item.defaultPriceCents) : '—'}
                </span>
                <button
                  type="button"
                  aria-label={`Remove ${item.name}`}
                  onClick={(e) => {
                    e.stopPropagation()
                    onRemove(a.catalogItemId)
                  }}
                  className="shrink-0 text-zinc-400 hover:text-red-600"
                >
                  <Trash2 className="h-4 w-4" aria-hidden="true" />
                </button>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

function ProductTray({
  catalogItems,
  selectedSlot,
  search,
  onSearchChange,
  onTapAdd,
}: {
  catalogItems: CatalogItem[]
  selectedSlot: ConfigSlot | null
  search: string
  onSearchChange: (v: string) => void
  onTapAdd: (catalogItemId: string) => void
}) {
  const base = selectedSlot
    ? catalogItemsForSlot(catalogItems, selectedSlot)
    : catalogItems.filter((i) => i.active && i.approvalStatus === 'approved')
  const q = search.trim().toLowerCase()
  const filtered = q
    ? base.filter((i) => [i.name, i.brand, i.model].filter(Boolean).some((s) => s!.toLowerCase().includes(q)))
    : base

  return (
    <div>
      <div className="mb-2 flex items-center gap-2 rounded-lg border border-zinc-200 px-3">
        <Search className="h-4 w-4 shrink-0 text-zinc-400" aria-hidden="true" />
        <input
          type="search"
          placeholder={selectedSlot ? `Search ${PRODUCT_CATEGORY_INFO[selectedSlot.category].label.toLowerCase()}…` : 'Search all products…'}
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          className="min-h-11 flex-1 bg-transparent text-sm outline-none"
        />
      </div>
      {filtered.length === 0 ? (
        <p className="text-sm text-zinc-500">
          {selectedSlot ? `No ${PRODUCT_CATEGORY_INFO[selectedSlot.category].label.toLowerCase()} in your catalog yet.` : 'No products found.'}
        </p>
      ) : (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4">
          {filtered.map((item) => (
            <ProductTrayCard key={item.id} item={item} onTapAdd={() => onTapAdd(item.id)} />
          ))}
        </div>
      )}
    </div>
  )
}

function ProductTrayCard({ item, onTapAdd }: { item: CatalogItem; onTapAdd: () => void }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: `tray-${item.id}`,
    data: { catalogItemId: item.id, category: item.category },
  })

  return (
    <div
      ref={setNodeRef}
      onClick={onTapAdd}
      style={transform ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)` } : undefined}
      className={`flex touch-none flex-col items-start gap-1 rounded-xl border border-zinc-200 bg-white p-2 text-left ${
        isDragging ? 'z-10 opacity-70 shadow-lg' : ''
      }`}
      {...listeners}
      {...attributes}
    >
      <div className="flex h-16 w-full items-center justify-center rounded-lg bg-blue-50">
        {item.imageUrl ? (
          <img src={item.imageUrl} alt="" className="h-full w-full rounded-lg object-contain" />
        ) : (
          <Package className="h-6 w-6 text-brand" aria-hidden="true" />
        )}
      </div>
      <p className="line-clamp-2 text-xs font-semibold text-ink">{item.name}</p>
      <p className="text-xs text-zinc-500">{item.defaultPriceCents !== null ? formatCurrency(item.defaultPriceCents) : 'No price'}</p>
      <span className="flex items-center gap-1 text-[10px] text-zinc-400">
        <GripVertical className="h-3 w-3" aria-hidden="true" /> Drag or tap
      </span>
    </div>
  )
}
