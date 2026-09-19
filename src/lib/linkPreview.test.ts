import { describe, expect, it } from 'vitest'
import { DEFAULT_PREVIEW, previewForPath, previewMetaTags } from './linkPreview'

describe('previewForPath', () => {
  it('names the page a customer is being sent to, not the software', () => {
    // The whole complaint: a text from the shop previewed as "0Gauge Recovery".
    expect(previewForPath('/r/k7m4xqrt').title).toBe('Leave us a review')
    expect(previewForPath('/q/0f8c1d2e-3b4a-5c6d-7e8f-9a0b1c2d3e4f').title).toBe('Your quote')
    expect(previewForPath('/book/super-car-audio').title).toBe('Book your appointment')
    expect(previewForPath('/booking/0f8c1d2e-3b4a').title).toBe('Your appointment')
  })

  it('never puts the product name in front of a customer', () => {
    for (const path of ['/r/abc', '/q/abc', '/book/abc', '/booking/abc', '/ask/abc']) {
      const preview = previewForPath(path)
      expect(`${preview.title} ${preview.description}`).not.toMatch(/0gauge|recovery/i)
    }
  })

  it('keeps the product name on the platform front door', () => {
    for (const path of ['/', '/login', '/signup', '/app/quotes', '/demo']) {
      expect(previewForPath(path)).toEqual(DEFAULT_PREVIEW)
    }
  })

  it('needs a token after the prefix to promise a customer page', () => {
    // A bare /r is not a review link. Promising one previews a page that
    // renders "this link has expired", which is worse than saying nothing.
    expect(previewForPath('/r')).toEqual(DEFAULT_PREVIEW)
    expect(previewForPath('/quotes')).toEqual(DEFAULT_PREVIEW)
    expect(previewForPath('/bookkeeping')).toEqual(DEFAULT_PREVIEW)
  })

  it('matches from the start, so a token containing a prefix does not fool it', () => {
    expect(previewForPath('/q/see-the/r/eview')).toEqual(previewForPath('/q/x'))
  })

  it('ignores a query string and a fragment', () => {
    // The opt-out link is /q/<token>?stop=1 and still previews as a quote.
    expect(previewForPath('/q/abc?stop=1')).toEqual(previewForPath('/q/abc'))
    expect(previewForPath('/r/abc#thanks')).toEqual(previewForPath('/r/abc'))
  })

  it('falls back rather than throwing on nothing at all', () => {
    expect(previewForPath(null)).toEqual(DEFAULT_PREVIEW)
    expect(previewForPath(undefined)).toEqual(DEFAULT_PREVIEW)
    expect(previewForPath('')).toEqual(DEFAULT_PREVIEW)
  })
})

describe('previewMetaTags', () => {
  it('emits the tags messaging apps actually read', () => {
    const html = previewMetaTags(previewForPath('/r/k7m4xqrt'))
    expect(html).toContain('<meta property="og:title" content="Leave us a review">')
    expect(html).toContain('property="og:description"')
    expect(html).toContain('name="twitter:card" content="summary"')
  })

  it('escapes a quote so it cannot break out of the attribute', () => {
    const html = previewMetaTags({ title: 'He said "hi" & <b>left</b>', description: 'x' })
    expect(html).toContain('&quot;hi&quot;')
    expect(html).toContain('&amp;')
    expect(html).toContain('&lt;b&gt;')
    // One opening quote and one closing quote per attribute, nothing loose.
    expect(html).not.toMatch(/content="[^"]*"[^"]*"[^">]*>/)
  })

  it('leaves out og:url, which it cannot know without guessing', () => {
    expect(previewMetaTags(DEFAULT_PREVIEW)).not.toContain('og:url')
  })
})
