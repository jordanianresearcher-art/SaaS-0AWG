import { describe, it, expect } from 'vitest'
import { detectQuoteFlavor, flavorCopy, preheaderHtml, type QuoteFlavor } from './quoteFlavor'
import type { TemplateType, WindowTintConfig } from '../types'

const TEMPLATES: TemplateType[] = ['initial', 'check_in', 'financing_option', 'payday_reminder', 'final_check_in']
const FLAVORS: QuoteFlavor[] = ['audio', 'tint', 'mixed']

const tint = { name: 'Front two' } as unknown as WindowTintConfig
const item = { brand: null, model: null, name: 'Sub', quantity: 1, description: null } as never

describe('detectQuoteFlavor', () => {
  it('is tint when the quote carries tint and no products', () => {
    expect(detectQuoteFlavor({ windowTints: [tint] }, [{ items: [] }])).toBe('tint')
  })

  it('is audio when there are products and no tint', () => {
    expect(detectQuoteFlavor({ windowTints: [] }, [{ items: [item] }])).toBe('audio')
  })

  it('is mixed when the quote carries both', () => {
    expect(detectQuoteFlavor({ windowTints: [tint] }, [{ items: [item] }])).toBe('mixed')
  })

  it('finds products in any option, not just the first', () => {
    expect(detectQuoteFlavor({ windowTints: [tint] }, [{ items: [] }, { items: [item] }])).toBe('mixed')
  })

  it('falls back to audio for a labor-only quote rather than guessing', () => {
    expect(detectQuoteFlavor({ windowTints: [] }, [{ items: [] }])).toBe('audio')
    expect(detectQuoteFlavor({ windowTints: [] }, [])).toBe('audio')
  })
})

describe('flavorCopy', () => {
  const ctx = { shopName: 'Big Tex Audio', vehicle: '2021 Ford F-150', firstName: 'Marcus' }

  it('gives every flavor and stage a subject and a preheader', () => {
    for (const flavor of FLAVORS) {
      for (const template of TEMPLATES) {
        const copy = flavorCopy(flavor, template, ctx)
        expect(copy.subject.length).toBeGreaterThan(5)
        expect(copy.preheader.length).toBeGreaterThan(10)
      }
    }
  })

  it('leads with bass for audio and heat for tint', () => {
    expect(flavorCopy('audio', 'initial', ctx).subject).toMatch(/bass/i)
    expect(flavorCopy('tint', 'initial', ctx).subject).toMatch(/heat|tint/i)
  })

  it('never repeats a subject across the follow-up cadence — later touches would read as spam', () => {
    for (const flavor of FLAVORS) {
      const subjects = TEMPLATES.map((t) => flavorCopy(flavor, t, ctx).subject)
      expect(new Set(subjects).size).toBe(subjects.length)
    }
  })

  it('keeps preheaders short enough to survive inbox truncation', () => {
    for (const flavor of FLAVORS) {
      for (const template of TEMPLATES) {
        expect(flavorCopy(flavor, template, ctx).preheader.length).toBeLessThanOrEqual(100)
      }
    }
  })

  it('never renders a null vehicle into the subject', () => {
    for (const flavor of FLAVORS) {
      for (const template of TEMPLATES) {
        const copy = flavorCopy(flavor, template, { ...ctx, vehicle: null })
        expect(copy.subject).not.toMatch(/null|undefined/)
        expect(copy.preheader).not.toMatch(/null|undefined/)
      }
    }
  })

  it('uses the vehicle when there is one', () => {
    expect(flavorCopy('audio', 'initial', ctx).subject).toContain('2021 Ford F-150')
  })
})

describe('preheaderHtml', () => {
  it('is hidden from the rendered body but present in the markup', () => {
    const html = preheaderHtml('Your quote is ready')
    expect(html).toContain('display:none')
    expect(html).toContain('Your quote is ready')
  })

  it('pads so the body greeting does not bleed into the inbox preview', () => {
    expect(preheaderHtml('x')).toContain('&zwnj;')
  })

  it('escapes markup in the text', () => {
    const html = preheaderHtml('5 < 10 & <b>bold</b>')
    expect(html).toContain('&lt;')
    expect(html).toContain('&amp;')
    expect(html).not.toContain('<b>')
  })
})
