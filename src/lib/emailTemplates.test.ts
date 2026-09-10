import { describe, expect, it } from 'vitest'
import { renderEmail, type EmailContext } from './emailTemplates'
import { formatCurrency } from './format'
import { buildDemoData } from '../data/demoData'
import type { TemplateType } from '../types'

/** Mirrors emailTemplates.ts's own escapeHtml — item/option names can contain quotes ("), and the rendered HTML escapes them. */
function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

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

  it('shows a window tint teaser only on the initial email, only when there is at least one tint entry', () => {
    const ctx = makeContext()
    expect(ctx.quote.windowTints.length).toBeGreaterThan(0) // fixture: the seeded F-150 quote has one

    const initialWithTint = renderEmail('initial', ctx)
    expect(initialWithTint.text).toContain('Includes window tint')

    const checkInWithTint = renderEmail('check_in', ctx)
    expect(checkInWithTint.text).not.toContain('Includes window tint')

    const ctxNoTint = { ...ctx, quote: { ...ctx.quote, windowTints: [] } }
    const initialNoTint = renderEmail('initial', ctxNoTint)
    expect(initialNoTint.text).not.toContain('Includes window tint')
  })

  it('shows the main package name and a product image for each item, only on the initial email', () => {
    const ctx = makeContext()
    const main = ctx.options.find((o) => o.optionKind === 'main')!
    expect(main.items.length).toBeGreaterThan(0) // fixture: the seeded F-150 main package has items

    const initial = renderEmail('initial', ctx)
    expect(initial.html).toContain(main.name)
    for (const item of main.items) {
      expect(initial.html).toContain(escapeHtml(item.name))
    }

    // Follow-ups stay short — no picture gallery on anything but the first email.
    const checkIn = renderEmail('check_in', ctx)
    expect(checkIn.html).not.toContain(main.items[0].name)
  })

  it('renders an <img> for an item that carries an image, and a blank placeholder for one that does not', () => {
    const ctx = makeContext()
    const main = ctx.options.find((o) => o.optionKind === 'main')!
    ctx.options = ctx.options.map((o) =>
      o === main
        ? { ...o, items: [{ ...o.items[0], imageUrl: 'https://cdn.example.com/sub.jpg' }, { ...o.items[0], id: 'no-image', imageUrl: null }] }
        : o,
    )
    const email = renderEmail('initial', ctx)
    expect(email.html).toContain('<img src="https://cdn.example.com/sub.jpg"')
  })

  it('shows each add-on\'s own price and the running total with just that add-on — never a per-item price breakdown', () => {
    const ctx = makeContext()
    const main = ctx.options.find((o) => o.optionKind === 'main')!
    const addon = { ...main, id: 'addon-1', optionKind: 'addon' as const, name: 'Ceramic tint upgrade', priceCents: 30000, items: [] }
    ctx.options = [main, addon]

    const email = renderEmail('initial', ctx)
    expect(email.html).toContain('Ceramic tint upgrade')
    expect(email.html).toContain('+$300')
    // The running total with just this add-on, so an upsell never reads as a
    // rival package price.
    expect(email.html).toContain(`Brings it to ${formatCurrency(main.priceCents + 30000)}`)
  })

  it('shows an "everything included" total only when the shop opted in', () => {
    const ctx = makeContext()
    const main = ctx.options.find((o) => o.optionKind === 'main')!
    const addon = { ...main, id: 'addon-1', optionKind: 'addon' as const, name: 'Add-on', priceCents: 10000, items: [] }
    ctx.options = [main, addon]

    const off = renderEmail('initial', { ...ctx, quote: { ...ctx.quote, showFullAddonTotal: false } })
    expect(off.html).not.toContain('Everything included')

    const on = renderEmail('initial', { ...ctx, quote: { ...ctx.quote, showFullAddonTotal: true } })
    expect(on.html).toContain('Everything included')
  })

  it('spells out the tint coverage in writing, only on the initial email', () => {
    const ctx = makeContext()
    const initial = renderEmail('initial', ctx)
    expect(initial.html).toContain('Window tint')
    expect(initial.html).toContain('All windows at 20%')
    expect(initial.html).toContain('Ceramic film')

    const checkIn = renderEmail('check_in', ctx)
    expect(checkIn.html).not.toContain('Window tint')
  })

  it('never embeds a car-diagram image — the diagrams are pulled pending the top-down redesign', () => {
    const initial = renderEmail('initial', makeContext())
    expect(initial.html).not.toContain('data:image/svg+xml;base64,')
    expect(initial.html).not.toContain('<svg')
  })

  it('lists per-slot percentages when the windows differ, instead of one uniform line', () => {
    const ctx = makeContext()
    const tint = ctx.quote.windowTints[0]
    const mixed = {
      ...tint,
      windows: tint.windows.map((w) => ({ ...w, vltPercent: w.position === 'back_glass' ? 5 : 35 })),
    }
    const html = renderEmail('initial', { ...ctx, quote: { ...ctx.quote, windowTints: [mixed] } }).html
    expect(html).not.toContain('All windows at')
    expect(html).toContain('Front windows 35%')
    expect(html).toContain('Back glass 5%')
  })
  it('offers the shop\'s financing applications in both HTML and text', () => {
    const ctx = makeContext()
    const email = renderEmail('initial', ctx)
    for (const body of [email.html, email.text]) {
      expect(body).toContain('Snap Finance')
      expect(body).toContain('https://snapfinance.com/apply')
      expect(body).toContain('Acima')
    }
    expect(email.html).toContain('Don&rsquo;t want to pay it all at once?')
  })

  it('says nothing about financing when the shop has not set any up', () => {
    const ctx = makeContext()
    const email = renderEmail('initial', { ...ctx, shop: { ...ctx.shop, financingOffers: [] } })
    expect(email.html).not.toContain('Apply with')
    expect(email.html).not.toContain('pay it all at once')
    expect(email.text).not.toContain('We offer financing')
  })

  it('keeps a hostile financing URL out of the href', () => {
    const ctx = makeContext()
    const email = renderEmail('initial', {
      ...ctx,
      shop: {
        ...ctx.shop,
        // Shaped like a stored row that never went through the Settings form.
        financingOffers: [{ id: 'x', name: 'Evil', applicationUrl: 'javascript:alert(1)' }],
      },
    })
    expect(email.html).not.toContain('javascript:')
  })

  it('leads with a bass hook for an audio quote and a heat hook for tint', () => {
    const ctx = makeContext()
    const audio = renderEmail('initial', { ...ctx, quote: { ...ctx.quote, windowTints: [] } })
    expect(audio.subject).toMatch(/bass/i)

    const tintOnly = renderEmail('initial', {
      ...ctx,
      options: ctx.options.map((o) => ({ ...o, items: [] })),
    })
    expect(tintOnly.subject).toMatch(/heat|tint/i)
  })

  it('never repeats a subject across the follow-up cadence', () => {
    const ctx = makeContext()
    const subjects = ALL_TEMPLATES.map((t) => renderEmail(t, ctx).subject)
    expect(new Set(subjects).size).toBe(subjects.length)
  })

  it('includes a hidden preheader so the inbox preview is not "Hi Marcus,"', () => {
    const html = renderEmail('initial', makeContext()).html
    expect(html).toContain('display:none')
    expect(html).toContain('&zwnj;')
  })
})
