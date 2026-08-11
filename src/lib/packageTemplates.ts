// Turns a quote option into the input for a new, reusable package template.
// Deliberately a pure snapshot: every value is copied, nothing here holds a
// live reference back to the originating quote — editing or deleting that
// quote later must never change an already-saved package (see migration
// 0010_package_templates.sql's own comment on the same guarantee at the DB
// layer, where sourceQuoteId/sourceQuoteOptionId are provenance-only
// columns set null on delete, not real foreign-key dependencies).

import type { NewPackageTemplateInput } from '../data/repository'
import type { QuoteOption, VehicleType } from '../types'

export interface SaveAsPackageOptions {
  name: string
  vehicleTypes?: VehicleType[]
}

/** A package needs at least one product to be worth reusing. */
export function canSaveAsPackage(option: Pick<QuoteOption, 'items'>): boolean {
  return option.items.length > 0
}

export function quoteOptionToPackageTemplateDraft(
  option: QuoteOption,
  opts: SaveAsPackageOptions,
): NewPackageTemplateInput {
  return {
    name: opts.name.trim(),
    description: option.description,
    configId: option.configId,
    vehicleTypes: opts.vehicleTypes ?? [],
    installedPriceCents: option.priceCents,
    laborIncluded: option.laborIncluded,
    source: 'staff_saved',
    sourceQuoteId: option.quoteId,
    sourceQuoteOptionId: option.id,
    items: option.items.map((item) => ({
      brand: item.brand,
      model: item.model,
      name: item.name,
      quantity: item.quantity,
      description: item.description,
      category: item.category,
      // Carried straight through — a quote item snapshots its image at
      // add-time (see QuoteItem.imageUrl), so this is a real image, not a
      // live reference. Still just null for a freehand-typed item.
      imageUrl: item.imageUrl,
    })),
  }
}
