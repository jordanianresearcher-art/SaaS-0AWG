import { describe, expect, it } from 'vitest'
import { computeInvoiceTotals } from './invoicePricing'

describe('computeInvoiceTotals', () => {
  it('sums line items with no tax/discount', () => {
    const totals = computeInvoiceTotals([{ unitPriceCents: 1000, quantity: 2 }])
    expect(totals).toEqual({ subtotalCents: 2000, taxCents: 0, discountCents: 0, totalCents: 2000 })
  })

  it('applies per-line discount before tax', () => {
    const totals = computeInvoiceTotals([{ unitPriceCents: 1000, quantity: 1, discountPercent: 10 }])
    expect(totals.subtotalCents).toBe(900)
  })

  it('taxes only taxable lines', () => {
    const totals = computeInvoiceTotals(
      [
        { unitPriceCents: 10000, quantity: 1, taxable: true },
        { unitPriceCents: 5000, quantity: 1, taxable: false }, // e.g. labor
      ],
      0.0825,
    )
    expect(totals.subtotalCents).toBe(15000)
    expect(totals.taxCents).toBe(Math.round(10000 * 0.0825))
    expect(totals.totalCents).toBe(15000 + Math.round(10000 * 0.0825))
  })

  it('applies a flat invoice-level discount after tax', () => {
    const totals = computeInvoiceTotals([{ unitPriceCents: 10000, quantity: 1 }], 0, 1500)
    expect(totals.totalCents).toBe(10000 - 1500)
  })

  it('never returns a negative total', () => {
    const totals = computeInvoiceTotals([{ unitPriceCents: 100, quantity: 1 }], 0, 10000)
    expect(totals.totalCents).toBe(0)
  })
})
