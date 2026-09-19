import { describe, expect, it } from 'vitest'
import {
  buildReviewRequestSmsBody,
  decideReviewGate,
  formatPhoneDisplay,
  nextReviewCode,
  normalizeReviewPhone,
  REVIEW_CODE_ALPHABET,
  reviewFeedbackCopy,
  reviewStage,
  summarizeReviewRequests,
} from './reviewRequests'

const LINK = 'https://g.page/r/abc/review'
const gated = (over: Partial<Parameters<typeof decideReviewGate>[0]> = {}) =>
  decideReviewGate({ rating: 5, alreadyBlocked: false, reviewLink: LINK, gateEnabled: true, ...over })

describe('the gate', () => {
  it('sends a five-star customer to the shop’s review link', () => {
    expect(gated({ rating: 5 })).toEqual({ redirectTo: LINK, showFeedback: false, locksRedirect: false })
  })

  it('keeps four stars and below on the page, and asks what went wrong', () => {
    for (const rating of [1, 2, 3, 4]) {
      expect(gated({ rating })).toEqual({ redirectTo: null, showFeedback: true, locksRedirect: true })
    }
  })

  it('never sends a blocked customer to the link, however many times they tap five', () => {
    // The shop's explicit requirement: the redirect is cancelled permanently
    // once someone rates low. This is the one rule here that must never soften
    // into "unless they change their mind".
    for (const rating of [1, 2, 3, 4, 5]) {
      const decision = gated({ rating, alreadyBlocked: true })
      expect(decision.redirectTo).toBeNull()
      expect(decision.showFeedback).toBe(true)
    }
  })

  it('does not re-lock an already-locked request', () => {
    // locksRedirect drives a write. Re-reporting it on every revisit would
    // overwrite the timestamp that says when they actually rated low.
    expect(gated({ rating: 2, alreadyBlocked: true }).locksRedirect).toBe(false)
  })

  it('does not lock out a happy customer just because no link is set yet', () => {
    const decision = gated({ rating: 5, reviewLink: null })
    expect(decision).toEqual({ redirectTo: null, showFeedback: true, locksRedirect: false })
  })

  it('treats a blank or whitespace link as no link', () => {
    for (const link of ['', '   ', null]) {
      expect(gated({ rating: 5, reviewLink: link }).redirectTo).toBeNull()
    }
  })

  it('trims a link that was pasted with whitespace', () => {
    expect(gated({ rating: 5, reviewLink: `  ${LINK}  ` }).redirectTo).toBe(LINK)
  })

  it('hands back the link byte-for-byte, appending nothing', () => {
    // The customer should arrive as if they had scanned a QR code: no source
    // tag, no tracking parameter, no fragment of ours. A link that already
    // carries a query string arrives with that one and no other.
    for (const link of [
      'https://g.page/r/abc/review',
      'https://search.google.com/local/writereview?placeid=ChIJxyz',
      'https://example.com/review?utm_source=card&x=1#form',
      'https://example.com/review/',
    ]) {
      expect(gated({ rating: 5, reviewLink: link }).redirectTo).toBe(link)
    }
  })

  it('shows everyone the link when the gate is switched off, and still takes feedback', () => {
    // The version that does not put the shop's listing at risk.
    for (const rating of [1, 3, 5]) {
      expect(decideReviewGate({ rating, alreadyBlocked: false, reviewLink: LINK, gateEnabled: false })).toEqual({
        redirectTo: LINK,
        showFeedback: true,
        locksRedirect: false,
      })
    }
  })

  it('honours the permanent block even with the gate switched off', () => {
    expect(
      decideReviewGate({ rating: 5, alreadyBlocked: true, reviewLink: LINK, gateEnabled: false }).redirectTo,
    ).toBeNull()
  })

  it('respects a lower threshold when the shop sets one', () => {
    expect(gated({ rating: 4, minStars: 4 }).redirectTo).toBe(LINK)
    expect(gated({ rating: 3, minStars: 4 }).locksRedirect).toBe(true)
  })

  it('always returns a decision, so no star tap can land on a blank screen', () => {
    for (const rating of [0, 1, 5, 6, -1, 99]) {
      for (const alreadyBlocked of [true, false]) {
        for (const reviewLink of [LINK, null]) {
          for (const gateEnabled of [true, false]) {
            const d = decideReviewGate({ rating, alreadyBlocked, reviewLink, gateEnabled })
            expect(d.redirectTo === null || typeof d.redirectTo === 'string').toBe(true)
            expect(typeof d.showFeedback).toBe('boolean')
            // Nothing may ever redirect a blocked request.
            if (alreadyBlocked) expect(d.redirectTo).toBeNull()
          }
        }
      }
    }
  })
})

describe('reviewStage', () => {
  const req = (over: Partial<Parameters<typeof reviewStage>[0]> = {}) =>
    reviewStage({ firstOpenedAt: null, rating: null, feedback: null, ...over })

  it('walks sent → opened → rated → feedback', () => {
    expect(req()).toBe('sent')
    expect(req({ firstOpenedAt: '2026-09-18T10:00:00Z' })).toBe('opened')
    expect(req({ firstOpenedAt: '2026-09-18T10:00:00Z', rating: 5 })).toBe('rated')
    expect(req({ firstOpenedAt: '2026-09-18T10:00:00Z', rating: 2, feedback: 'Took too long' })).toBe('feedback')
  })

  it('counts a one-star rating as rated, not as unopened', () => {
    expect(req({ firstOpenedAt: '2026-09-18T10:00:00Z', rating: 1 })).toBe('rated')
  })

  it('ignores whitespace-only feedback', () => {
    expect(req({ firstOpenedAt: '2026-09-18T10:00:00Z', rating: 3, feedback: '   ' })).toBe('rated')
  })
})

describe('summarizeReviewRequests', () => {
  const rows = [
    { firstOpenedAt: '2026-09-18T10:00:00Z', rating: 5, feedback: null },
    { firstOpenedAt: '2026-09-18T10:00:00Z', rating: 5, feedback: null },
    { firstOpenedAt: '2026-09-18T10:00:00Z', rating: 2, feedback: 'Waited two hours' },
    { firstOpenedAt: '2026-09-18T10:00:00Z', rating: null, feedback: null },
    { firstOpenedAt: null, rating: null, feedback: null },
  ]

  it('splits who saw the link from who the shop needs to hear about', () => {
    const s = summarizeReviewRequests(rows)
    expect(s).toMatchObject({ sent: 5, opened: 4, rated: 3, promoters: 2, detractors: 1, feedback: 1 })
  })

  it('averages only the ratings actually given', () => {
    expect(summarizeReviewRequests(rows).averageRating).toBeCloseTo(4)
  })

  it('reports rates against the right denominators', () => {
    const s = summarizeReviewRequests(rows)
    expect(s.openRate).toBeCloseTo(4 / 5)
    expect(s.ratingRate).toBeCloseTo(3 / 4)
  })

  it('returns null rather than a misleading zero with nothing to divide by', () => {
    const s = summarizeReviewRequests([])
    expect(s.averageRating).toBeNull()
    expect(s.openRate).toBeNull()
    expect(s.ratingRate).toBeNull()
    expect(s.sent).toBe(0)
  })

  it('moves the promoter line when the threshold moves', () => {
    const s = summarizeReviewRequests([{ firstOpenedAt: 'x', rating: 4, feedback: null }], 4)
    expect(s.promoters).toBe(1)
    expect(s.detractors).toBe(0)
  })
})

describe('phone handling', () => {
  it('accepts whatever staff type off a slip of paper', () => {
    for (const raw of ['214-555-0100', '(214) 555 0100', '+1 214 555 0100', '2145550100']) {
      expect(normalizeReviewPhone(raw)).toBe('2145550100')
    }
  })

  it('refuses something that cannot be texted', () => {
    for (const raw of ['', '   ', 'call me', '12345']) expect(normalizeReviewPhone(raw)).toBeNull()
  })

  it('shows a US number the way a person writes it', () => {
    expect(formatPhoneDisplay('2145550100')).toBe('(214) 555-0100')
    expect(formatPhoneDisplay('+1 214 555 0100')).toBe('(214) 555-0100')
  })

  it('leaves anything it does not recognise alone rather than mangling it', () => {
    expect(formatPhoneDisplay('+44 20 7946 0958')).toBe('+44 20 7946 0958')
    expect(formatPhoneDisplay(null)).toBe('')
  })
})

describe('the text itself', () => {
  it('names the shop and carries the link', () => {
    const body = buildReviewRequestSmsBody({ firstName: 'Marcus', shopName: 'Super Car Audio', reviewUrl: 'https://x.co/r/t' })
    expect(body).toContain('Marcus')
    expect(body).toContain('Super Car Audio')
    expect(body).toContain('https://x.co/r/t')
  })

  it('reads properly with no name on the slip', () => {
    const body = buildReviewRequestSmsBody({ firstName: null, shopName: 'Super Car Audio', reviewUrl: 'https://x.co/r/t' })
    expect(body).not.toMatch(/^,/)
    expect(body).not.toMatch(/undefined|null/)
    expect(body.startsWith('thanks for coming')).toBe(true)
  })

  it('stays short enough to read on a lock screen', () => {
    const body = buildReviewRequestSmsBody({
      firstName: 'Marcus',
      shopName: 'Super Car Audio',
      reviewUrl: 'https://app.0gauge.com/r/0f8c1d2e-3b4a-5c6d-7e8f-9a0b1c2d3e4f',
    })
    expect(body.length).toBeLessThan(160)
  })
})

describe('what the feedback screen says', () => {
  const copy = (rating: number) => reviewFeedbackCopy(rating, 'Super Car Audio')

  it('apologises at one through three, and only there', () => {
    for (const rating of [1, 2, 3]) expect(copy(rating).heading.toLowerCase()).toContain('sorry')
  })

  it('never apologises to a four-star customer', () => {
    // They were mostly happy. Telling them they had a worse time than they did
    // reads as a script, and a script is what stops people writing the one
    // sentence the shop needs.
    const four = copy(4)
    const all = `${four.heading} ${four.body} ${four.placeholder}`.toLowerCase()
    expect(all).not.toContain('sorry')
    expect(all).not.toContain('missed the mark')
    expect(all).not.toContain('let you down')
  })

  it('asks a four-star customer how to make it better', () => {
    expect(copy(4).heading.toLowerCase()).toContain('better')
    expect(copy(4).placeholder.toLowerCase()).toContain('five')
  })

  it('never apologises to a five-star customer either', () => {
    const five = copy(5)
    expect(`${five.heading} ${five.body}`.toLowerCase()).not.toContain('sorry')
    expect(five.heading.toLowerCase()).toContain('thanks')
  })

  it('names the shop rather than saying "us"', () => {
    for (const rating of [1, 3, 4, 5]) expect(copy(rating).body).toContain('Super Car Audio')
  })

  it('always returns every field filled, at any rating', () => {
    for (const rating of [1, 2, 3, 4, 5]) {
      const c = copy(rating)
      for (const value of [c.heading, c.body, c.placeholder, c.submitLabel]) {
        expect(value.length).toBeGreaterThan(0)
        expect(value).not.toMatch(/undefined|null|\[object/)
      }
    }
  })

  it('promises the feedback is private wherever it apologises', () => {
    for (const rating of [1, 2, 3]) expect(copy(rating).body.toLowerCase()).toContain('not posted anywhere')
  })
})

describe('the texted link code', () => {
  it('is eight readable characters, with nothing a person misreads', () => {
    const code = nextReviewCode(() => false)
    expect(code).toHaveLength(8)
    expect(code).toMatch(/^[a-hjkmnp-z2-9]{8}$/)
    // The whole point of the alphabet: these four are the ones that get
    // mistaken for each other when a code is read aloud or typed by hand.
    for (const ambiguous of ['i', 'l', 'o', '0', '1']) {
      expect(REVIEW_CODE_ALPHABET).not.toContain(ambiguous)
    }
  })

  it('never hands back a code already in use', () => {
    // A fixed random source makes every draw identical, which is the
    // collision case a chance-based test would essentially never reach.
    const constant = () => 0.5
    const first = nextReviewCode(() => false, constant)
    const second = nextReviewCode((code) => code === first, constant)
    expect(second).not.toBe(first)
  })

  it('terminates against a random source that only ever collides', () => {
    // A plain retry loop would spin forever here. It lengthens instead.
    const constant = () => 0.5
    const taken = new Set([nextReviewCode(() => false, constant)])
    for (let i = 0; i < 3; i += 1) {
      const code = nextReviewCode((c) => taken.has(c), constant)
      expect(taken.has(code)).toBe(false)
      expect(code.length).toBeGreaterThan(8)
      taken.add(code)
    }
  })

  it('produces distinct codes from a real random source', () => {
    const seen = new Set<string>()
    for (let i = 0; i < 500; i += 1) seen.add(nextReviewCode((c) => seen.has(c)))
    expect(seen.size).toBe(500)
  })

  it('is short enough to sit on one line of a text message', () => {
    const body = buildReviewRequestSmsBody({
      firstName: 'Sebawe',
      shopName: 'Super Car Audio',
      reviewUrl: `https://app.supercaraudio.com/r/${nextReviewCode(() => false)}`,
    })
    // The link that prompted this change was 36 characters of hex and wrapped
    // across four lines, reading like a phishing attempt.
    expect(body.length).toBeLessThan(120)
  })
})
