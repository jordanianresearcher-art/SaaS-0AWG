// Regression tests against a real shop's real inventory.
//
// Every other test in this suite uses invented products, and invented
// products are quietly forgiving: they have tidy model numbers, valid
// barcodes, and names in a consistent format. The 123 rows in
// __fixtures__/shopProducts.json are the actual catalog of the shop piloting
// this app, exported from their spreadsheet, and they are not tidy — brands
// live in the name column for some rows and nowhere for others, a third of
// the "barcodes" are internal codes or serial numbers, and one product's
// entire name is "KICKER".
//
// That mess is the point. These tests pin the two pure paths that decide
// whether a staff member finds a product, against the data they will really
// be typing about. Quantities were dropped from the fixture: the tests do not
// need them, and stock levels are the one genuinely private field in it.

import { describe, expect, it } from 'vitest'
import { barcodeLookupForms, classifyBarcode } from './barcodeIdentity'
import { normalizeModelKey, searchLocalCatalog } from './productSearch'
import type { CatalogItem } from '../types'
import fixture from './__fixtures__/shopProducts.json'

interface Row {
  barcode: string
  model: string
  name: string
}

const rows = fixture as Row[]

function asCatalogItem(row: Row, index: number): CatalogItem {
  return {
    id: `fixture-${index}`,
    shopId: 'fixture-shop',
    brand: null,
    model: row.model || null,
    name: row.name,
    category: null,
    description: null,
    sku: null,
    upc: /^\d+$/.test(row.barcode) ? row.barcode : null,
    defaultPriceCents: null,
    msrpCents: null,
    promoPriceCents: null,
    minStaffPriceCents: null,
    costCents: null,
    priceSourceUrl: null,
    priceSourceName: null,
    priceKind: null,
    priceCheckedAt: null,
    imageUrl: null,
    imageSourceUrl: null,
    sourceUrl: null,
    quantityOnHand: 1,
    position: index,
  } as CatalogItem
}

const catalog = rows.map(asCatalogItem)

describe('the pilot shop\'s real barcodes', () => {
  it('has enough rows to be worth testing against', () => {
    expect(rows.length).toBeGreaterThanOrEqual(100)
  })

  it('accepts every genuine retail barcode for lookup', () => {
    // A retail barcode the classifier refuses to look up is the worst
    // possible bug here: the shop scans a perfectly good UPC and is told
    // nothing can identify it, with no network call ever attempted.
    const rejected = rows
      .filter((r) => /^\d{8}$|^\d{12,13}$/.test(r.barcode))
      .filter((r) => barcodeLookupForms(r.barcode).length === 0)
      .map((r) => `${r.barcode} (${r.model})`)
    expect(rejected).toEqual([])
  })

  it('reads the check digit correctly on every retail barcode', () => {
    // These codes are printed on real boxes, so they are all valid by
    // construction. Any check-digit failure here means gs1CheckDigit is
    // wrong, not that the shop mistyped 88 numbers.
    const invalid = rows
      .filter((r) => /^\d{8}$|^\d{12,13}$/.test(r.barcode))
      .filter((r) => classifyBarcode(r.barcode).checkDigitValid === false)
      .map((r) => `${r.barcode} (${r.model})`)
    expect(invalid).toEqual([])
  })

  it('recognises internal codes and serial numbers as unresolvable', () => {
    // Nemesis Audio ships boxes labelled like "FR-M800.4D11250239" — the
    // model with a serial run on the end. No database has that, and firing a
    // web search at it wastes seconds and tokens to arrive at "not found".
    const serial = rows.find((r) => r.barcode.startsWith('FR-M800.4D'))
    expect(serial).toBeDefined()
    expect(barcodeLookupForms(serial!.barcode)).toEqual([])
  })

  it('splits into retail and internal codes in roughly the proportion the shop sees', () => {
    // Documents the reality that drove the whole "identify it once by hand,
    // then never again" design: about a quarter of what this shop scans can
    // never be resolved from any database, no matter how good the AI is.
    const lookupable = rows.filter((r) => barcodeLookupForms(r.barcode).length > 0)
    expect(lookupable.length).toBeGreaterThan(rows.length / 2)
    expect(lookupable.length).toBeLessThan(rows.length)
  })
})

describe('finding the pilot shop\'s real products by typing', () => {
  /** The three ways staff actually type a model: as printed, run together, and half of it. */
  function typedVariants(model: string): string[] {
    const bare = normalizeModelKey(model)
    return [model.toLowerCase(), bare, bare.slice(0, Math.max(4, Math.ceil(bare.length / 2)))]
  }

  it('surfaces the right product for every way its model gets typed', () => {
    const misses: string[] = []
    for (const row of rows) {
      if (!row.model) continue
      for (const query of typedVariants(row.model)) {
        const hits = searchLocalCatalog(catalog, query)
        if (!hits.some((h) => h.model === row.model)) {
          misses.push(`${JSON.stringify(query)} did not surface ${row.model}`)
        }
      }
    }
    expect(misses).toEqual([])
  })

  it('finds a product by scanning its full barcode', () => {
    const withUpc = rows.find((r) => /^\d{12}$/.test(r.barcode))!
    const hits = searchLocalCatalog(catalog, withUpc.barcode)
    expect(hits[0]?.model).toBe(withUpc.model)
  })

  it('ranks an exact model above a product that merely contains it', () => {
    // "TWS.4" typed exactly should not be outranked by some longer model
    // that happens to include those characters.
    const hits = searchLocalCatalog(catalog, 'TWS.4')
    expect(hits[0]?.model).toBe('TWS.4')
  })

  it('returns nothing rather than noise for a query that matches no product', () => {
    expect(searchLocalCatalog(catalog, 'zzzzqqqq')).toEqual([])
  })
})
