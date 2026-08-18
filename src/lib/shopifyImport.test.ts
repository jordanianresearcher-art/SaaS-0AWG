import { describe, expect, it } from 'vitest'
import {
  guessCategoryFromProductType,
  mapShopifyVariantToCatalogItem,
  planCatalogItemSync,
  priceLikelyEditedSinceSync,
  type ShopifyProduct,
} from './shopifyImport'
import type { CatalogItem } from '../types'

// Fixture shaped from a real Super Car Audio (supercaraudio.com) product,
// fetched live via the Shopify Admin API during this round.
const NA_8SLM: ShopifyProduct = {
  id: 'gid://shopify/Product/7903334301786',
  title: 'Nemesis Audio NA-8SLM V.2 8-Inch 450W RMS Shallow Mount Subwoofer',
  handle: 'nemesis-audio-na-8slm-v2-8-inch-450w-rms-shallow-mount-subwoofer',
  vendor: 'Nemesis Audio',
  productType: 'Subwoofer',
  description: 'The Nemesis Audio NA-8SLM V.2 is an 8-inch shallow mount subwoofer for tight-space bass systems.',
  status: 'ACTIVE',
  featuredImageUrl: 'https://cdn.shopify.com/s/files/1/0734/6339/8490/files/323356a3-NA-8SLM-V.2-RIGHT-1024x1024-1.png',
  variants: [
    {
      id: 'gid://shopify/ProductVariant/43336100216922',
      title: 'Default Title',
      sku: 'NA-8SLM-V2',
      barcode: null,
      price: '149.99',
      compareAtPrice: null,
      inventoryQuantity: 9,
      imageUrl: null,
    },
  ],
}

describe('guessCategoryFromProductType', () => {
  it('recognizes the real productType strings this shop actually uses', () => {
    expect(guessCategoryFromProductType('Subwoofer')).toBe('subwoofer')
    expect(guessCategoryFromProductType('Coaxial Speaker')).toBe('door_speaker')
    expect(guessCategoryFromProductType('Midrange Speaker')).toBe('door_speaker')
  })

  it('returns null for null or unrecognized product types rather than guessing', () => {
    expect(guessCategoryFromProductType(null)).toBeNull()
    expect(guessCategoryFromProductType('Archived Duplicate')).toBeNull()
    expect(guessCategoryFromProductType('Gift Card')).toBeNull()
  })
})

describe('mapShopifyVariantToCatalogItem', () => {
  it('maps a real single-variant product correctly', () => {
    const input = mapShopifyVariantToCatalogItem(NA_8SLM, NA_8SLM.variants[0], 'supercaraudio.com')
    expect(input.name).toBe(NA_8SLM.title) // Default Title -- no suffix appended
    expect(input.brand).toBe('Nemesis Audio')
    expect(input.model).toBe('NA-8SLM-V2')
    expect(input.sku).toBe('NA-8SLM-V2')
    expect(input.category).toBe('subwoofer')
    expect(input.defaultPriceCents).toBe(14999)
    expect(input.msrpCents).toBeNull() // no compareAtPrice on this listing
    expect(input.availability).toBe('available') // inventoryQuantity 9 > 3
    expect(input.active).toBe(true)
    expect(input.importSource).toBe('shopify')
    expect(input.approvalStatus).toBe('approved')
    expect(input.externalSourceProductId).toBe(NA_8SLM.variants[0].id)
    expect(input.sourceUrl).toBe(`https://supercaraudio.com/products/${NA_8SLM.handle}`)
  })

  it('records msrpCents only when compareAtPrice is genuinely higher than the current price', () => {
    const onSale = { ...NA_8SLM.variants[0], price: '119.99', compareAtPrice: '149.99' }
    const input = mapShopifyVariantToCatalogItem(NA_8SLM, onSale, 'supercaraudio.com')
    expect(input.defaultPriceCents).toBe(11999)
    expect(input.msrpCents).toBe(14999)

    // A compareAtPrice that's lower or equal isn't a real "was" price -- ignore it.
    const bogus = { ...NA_8SLM.variants[0], price: '149.99', compareAtPrice: '100.00' }
    expect(mapShopifyVariantToCatalogItem(NA_8SLM, bogus, 'supercaraudio.com').msrpCents).toBeNull()
  })

  it('appends the variant title for a genuinely multi-variant product', () => {
    const product: ShopifyProduct = {
      ...NA_8SLM,
      variants: [
        { ...NA_8SLM.variants[0], title: 'Black' },
        { ...NA_8SLM.variants[0], id: 'gid://shopify/ProductVariant/999', title: 'Silver' },
      ],
    }
    const input = mapShopifyVariantToCatalogItem(product, product.variants[1], 'supercaraudio.com')
    expect(input.name).toBe(`${NA_8SLM.title} — Silver`)
  })

  it('maps availability from inventory quantity thresholds', () => {
    const zero = mapShopifyVariantToCatalogItem(NA_8SLM, { ...NA_8SLM.variants[0], inventoryQuantity: 0 }, 'd')
    const low = mapShopifyVariantToCatalogItem(NA_8SLM, { ...NA_8SLM.variants[0], inventoryQuantity: 2 }, 'd')
    const untracked = mapShopifyVariantToCatalogItem(NA_8SLM, { ...NA_8SLM.variants[0], inventoryQuantity: null }, 'd')
    expect(zero.availability).toBe('out_of_stock')
    expect(low.availability).toBe('low_stock')
    expect(untracked.availability).toBe('not_tracked')
  })

  it('marks a non-ACTIVE Shopify product inactive rather than skipping it', () => {
    const archived: ShopifyProduct = { ...NA_8SLM, status: 'ARCHIVED' }
    expect(mapShopifyVariantToCatalogItem(archived, archived.variants[0], 'd').active).toBe(false)
  })
})

describe('priceLikelyEditedSinceSync', () => {
  it('is false when the item has never been synced', () => {
    expect(priceLikelyEditedSinceSync({ updatedAt: '2026-01-01T00:00:00Z', priceCheckedAt: null })).toBe(false)
  })

  it('is false when nothing has touched the row since the last sync', () => {
    expect(
      priceLikelyEditedSinceSync({ updatedAt: '2026-01-01T00:00:00Z', priceCheckedAt: '2026-01-01T00:00:00Z' }),
    ).toBe(false)
  })

  it('is true when the row was updated well after the last sync stamp', () => {
    expect(
      priceLikelyEditedSinceSync({ updatedAt: '2026-01-02T00:00:00Z', priceCheckedAt: '2026-01-01T00:00:00Z' }),
    ).toBe(true)
  })
})

function makeExisting(overrides: Partial<CatalogItem> = {}): CatalogItem {
  return {
    id: 'cat-1',
    shopId: 'shop-1',
    brand: 'Nemesis Audio',
    model: 'NA-8SLM-V2',
    name: NA_8SLM.title,
    category: 'subwoofer',
    description: NA_8SLM.description,
    sku: 'NA-8SLM-V2',
    upc: null,
    defaultPriceCents: 14999,
    msrpCents: null,
    promoPriceCents: null,
    minStaffPriceCents: null,
    costCents: null,
    priceSourceUrl: null,
    priceSourceName: 'Shopify',
    priceKind: 'retail',
    priceCheckedAt: '2026-01-01T00:00:00Z',
    imageUrl: NA_8SLM.featuredImageUrl,
    imageSourceUrl: null,
    sourceUrl: `https://supercaraudio.com/products/${NA_8SLM.handle}`,
    specs: null,
    active: true,
    availability: 'available',
    importSource: 'shopify',
    externalSourceProductId: NA_8SLM.variants[0].id,
    identificationConfidence: null,
    approvalStatus: 'approved',
    position: 0,
    quantityOnHand: 0,
    upcIsGenerated: false,
    labelPrintedAt: null,
    lowStockThreshold: null,
    lastCountedAt: null,
    lowStockAlerted: false,
    lowStockAlertedAt: null,
    shopifyProductId: null,
    shopifyVariantId: null,
    shopifySyncedAt: null,
    shopifySyncError: null,
    shopifyMatchedExisting: false,
    shopifyStatus: 'active',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  }
}

describe('planCatalogItemSync', () => {
  const mapped = mapShopifyVariantToCatalogItem(NA_8SLM, NA_8SLM.variants[0], 'supercaraudio.com')

  it('creates when nothing exists yet for this variant', () => {
    expect(planCatalogItemSync(undefined, mapped)).toEqual({ action: 'create', input: mapped })
  })

  it('reports unchanged on an identical re-run', () => {
    expect(planCatalogItemSync(makeExisting(), mapped).action).toBe('unchanged')
  })

  it('updates price when Shopify changed it and nobody has touched the row locally', () => {
    const raised = mapShopifyVariantToCatalogItem(
      NA_8SLM,
      { ...NA_8SLM.variants[0], price: '169.99' },
      'supercaraudio.com',
    )
    const plan = planCatalogItemSync(makeExisting(), raised)
    expect(plan.action).toBe('update')
    expect(plan.input?.defaultPriceCents).toBe(16999)
  })

  it('never silently overwrites a price a staff member edited since the last sync', () => {
    const staffEdited = makeExisting({ defaultPriceCents: 12999, updatedAt: '2026-01-05T00:00:00Z' })
    const plan = planCatalogItemSync(staffEdited, mapped)
    expect(plan.action).toBe('skipped')
  })

  it('still flows through a non-price change (e.g. Shopify title edit) while protecting the local price', () => {
    const staffEdited = makeExisting({ defaultPriceCents: 12999, updatedAt: '2026-01-05T00:00:00Z' })
    const retitled = { ...mapped, name: 'New Product Title From Shopify' }
    const plan = planCatalogItemSync(staffEdited, retitled)
    expect(plan.action).toBe('update')
    expect(plan.input?.name).toBe('New Product Title From Shopify')
    expect(plan.input?.defaultPriceCents).toBe(12999) // untouched
  })

  it('does overwrite the local price when the caller explicitly opts in', () => {
    const staffEdited = makeExisting({ defaultPriceCents: 12999, updatedAt: '2026-01-05T00:00:00Z' })
    const plan = planCatalogItemSync(staffEdited, mapped, { overwriteLocalPrices: true })
    expect(plan.action).toBe('update')
    expect(plan.input?.defaultPriceCents).toBe(14999)
  })

  it('re-categorizes an already-imported row once Shopify productType/tags are fixed and re-imported', () => {
    // e.g. a shop originally imported before its productType was recognized, landing category: null
    const uncategorized = makeExisting({ category: null })
    const plan = planCatalogItemSync(uncategorized, mapped) // mapped resolves to 'subwoofer' for this fixture
    expect(plan.action).toBe('update')
    expect(plan.input?.category).toBe('subwoofer')
  })
})
