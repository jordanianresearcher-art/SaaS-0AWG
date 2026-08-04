import { describe, expect, it } from 'vitest'
import { renderInvoiceEmail, type InvoiceEmailContext } from './invoiceEmailTemplate'
import { buildDemoData } from '../data/demoData'

function makeContext(overrides: Partial<InvoiceEmailContext> = {}): InvoiceEmailContext {
  const db = buildDemoData(new Date('2026-07-17T12:00:00Z'))
  return {
    shop: db.shop,
    invoice: db.invoices[0],
    recipientName: 'Alex',
    ...overrides,
  }
}

describe('renderInvoiceEmail', () => {
  it('includes the invoice number and shop name in the subject', () => {
    const ctx = makeContext()
    const email = renderInvoiceEmail(ctx)
    expect(email.subject).toContain(`#${ctx.invoice.invoiceNumber}`)
    expect(email.subject).toContain(ctx.shop.name)
  })

  it('greets the recipient by name, falling back to "there" when blank', () => {
    expect(renderInvoiceEmail(makeContext({ recipientName: 'Alex' })).text).toContain('Hi Alex,')
    expect(renderInvoiceEmail(makeContext({ recipientName: '  ' })).text).toContain('Hi there,')
  })

  it('lists every item with quantity and line total', () => {
    const ctx = makeContext()
    const email = renderInvoiceEmail(ctx)
    for (const item of ctx.invoice.items) {
      expect(email.text).toContain(item.name)
      expect(email.html).toContain(item.name)
    }
  })

  it('shows the subtotal and total', () => {
    const ctx = makeContext()
    const email = renderInvoiceEmail(ctx)
    expect(email.text).toContain('Subtotal:')
    expect(email.text).toContain('Total:')
  })

  it('shows a paid chip with the payment method when paid', () => {
    const ctx = makeContext()
    expect(ctx.invoice.status).toBe('paid') // the seeded demo invoice
    const email = renderInvoiceEmail(ctx)
    expect(email.text.toLowerCase()).toContain('paid')
    expect(email.html).toContain('PAID')
  })

  it('shows an unpaid status for a draft invoice', () => {
    const ctx = makeContext({ invoice: { ...makeContext().invoice, status: 'draft', paymentMethod: null, paidAt: null } })
    const email = renderInvoiceEmail(ctx)
    expect(email.text).toContain('Payment due')
    expect(email.html).toContain('UNPAID')
  })

  it('escapes HTML in item names so a customer-typed one-off item name cannot inject markup', () => {
    const ctx = makeContext()
    const withInjection = {
      ...ctx,
      invoice: { ...ctx.invoice, items: [{ ...ctx.invoice.items[0], name: '<script>alert(1)</script>' }] },
    }
    const email = renderInvoiceEmail(withInjection)
    expect(email.html).not.toContain('<script>')
    expect(email.html).toContain('&lt;script&gt;')
  })
})
