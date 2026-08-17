// Invoice tax/discount math — shared by DemoRepository and SupabaseRepository
// so subtotal/tax/total are computed identically in both (neither repo
// relies on a DB trigger to sum these; see createInvoice in each). Ported
// from car-audio-inventory's pos_invoices flow (subtotal, per-jurisdiction
// tax_rate applied only to taxable lines, a flat invoice-level discount).

export interface InvoiceLineInput {
  unitPriceCents: number
  quantity: number
  /** 0-100. Applied to this line before tax. */
  discountPercent?: number
  /** Defaults true. */
  taxable?: boolean
}

export interface InvoiceTotals {
  subtotalCents: number
  taxCents: number
  discountCents: number
  totalCents: number
}

/** taxRate is 0-1 (e.g. 0.0825 for 8.25%), applied only to taxable lines' post-line-discount amount. discountCents is a flat invoice-level discount applied after tax. */
export function computeInvoiceTotals(items: InvoiceLineInput[], taxRate = 0, discountCents = 0): InvoiceTotals {
  let subtotalCents = 0
  let taxableCents = 0
  for (const item of items) {
    const lineCents = item.unitPriceCents * item.quantity
    const discounted = Math.round(lineCents * (1 - (item.discountPercent ?? 0) / 100))
    subtotalCents += discounted
    if (item.taxable ?? true) taxableCents += discounted
  }
  const taxCents = Math.round(taxableCents * taxRate)
  const totalCents = Math.max(0, subtotalCents + taxCents - discountCents)
  return { subtotalCents, taxCents, discountCents, totalCents }
}
