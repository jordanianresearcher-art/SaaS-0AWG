import { describe, expect, it } from 'vitest'
import { renderEmail, type EmailContext } from './emailTemplates'
import { buildDemoData } from '../data/demoData'
import type { TemplateType } from '../types'

function makeContext(): EmailContext {
  const db = buildDemoData(new Date('2026-07-17T12:00:00Z'))
  const quote = db.quotes[0]
  const customer = db.customers.find((c) => c.id === quote.customerId)!
  return {
    shop: db.shop,
    customer,
    quote,
    options: db.options.filter((o) => o.quoteId === quote.id),
    publicUrl: 'https://app.example.com/q/token-123',
    optOutUrl: 'https://app.example.com/q/token-123?stop=1',
  }
}

const ALL_TEMPLATES: TemplateType[] = ['initial', 'check_in', 'financing_option', 'payday_reminder', 'final_check_in']

describe('renderEmail', () => {
  it.each(ALL_TEMPLATES)('renders %s with the essentials', (template) => {
    const ctx = makeContext()
    const email = renderEmail(template, ctx)
    expect(email.subject.length).toBeGreaterThan(5)
    // Both parts drive to the public quote page and allow opting out.
    for (const body of [email.html, email.text]) {
      expect(body).toContain(ctx.publicUrl)
      expect(body).toContain(ctx.optOutUrl)
      expect(body).toContain(ctx.shop.name)
      expect(body).toContain(ctx.shop.phone)
      expect(body).toContain(ctx.shop.address)
      expect(body).toContain(ctx.customer.firstName)
    }
  })

  it('never includes the customer last name or phone', () => {
    const ctx = makeContext()
    for (const template of ALL_TEMPLATES) {
      const email = renderEmail(template, ctx)
      expect(email.html).not.toContain(ctx.customer.lastName as string)
      expect(email.html).not.toContain(ctx.customer.phone as string)
    }
  })

  it('mentions the expiration date when present', () => {
    const ctx = makeContext()
    const email = renderEmail('initial', ctx)
    expect(ctx.quote.expirationDate).toBeTruthy()
    expect(email.text).toContain('good through')
  })

  it('escapes HTML in shop-controlled fields', () => {
    const ctx = makeContext()
    ctx.shop = { ...ctx.shop, name: 'Shop <script>alert(1)</script>' }
    const email = renderEmail('initial', ctx)
    expect(email.html).not.toContain('<script>alert(1)</script>')
    expect(email.html).toContain('&lt;script&gt;')
  })

  it.each(ALL_TEMPLATES)('reads as a complete sentence with no vehicle on file (%s)', (template) => {
    const ctx = makeContext()
    ctx.customer = { ...ctx.customer, vehicleYear: null, vehicleMake: null, vehicleModel: null, vehicleTrim: null }
    const email = renderEmail(template, ctx)
    expect(email.subject).not.toMatch(/null|undefined/i)
    expect(email.text).not.toMatch(/null|undefined/i)
    expect(email.html).not.toMatch(/null|undefined/i)
  })

  it('shows a window tint teaser only on the initial email, only when a tint config exists', () => {
    const ctx = makeContext()
    expect(ctx.quote.windowTint).not.toBeNull() // fixture: the seeded F-150 quote has one

    const initialWithTint = renderEmail('initial', ctx)
    expect(initialWithTint.text).toContain('Includes window tint')

    const checkInWithTint = renderEmail('check_in', ctx)
    expect(checkInWithTint.text).not.toContain('Includes window tint')

    const ctxNoTint = { ...ctx, quote: { ...ctx.quote, windowTint: null } }
    const initialNoTint = renderEmail('initial', ctxNoTint)
    expect(initialNoTint.text).not.toContain('Includes window tint')
  })
})
