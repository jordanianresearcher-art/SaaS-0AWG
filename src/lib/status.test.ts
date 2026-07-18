import { describe, expect, it } from 'vitest'
import { advanceStatus, isTerminal, STATUS_CONFIG, VALID_RESPONSE_TYPES } from './status'
import type { QuoteStatus } from '../types'

describe('advanceStatus', () => {
  it('moves draft forward to emailed', () => {
    expect(advanceStatus('draft', 'emailed')).toBe('emailed')
  })
  it('moves emailed forward to viewed', () => {
    expect(advanceStatus('emailed', 'viewed')).toBe('viewed')
  })
  it('never moves backwards (viewed does not downgrade booked)', () => {
    expect(advanceStatus('booked', 'viewed')).toBe('booked')
  })
  it('never downgrades responded to emailed on re-send', () => {
    expect(advanceStatus('responded', 'emailed')).toBe('responded')
  })
  it('never changes terminal statuses', () => {
    expect(advanceStatus('won', 'viewed')).toBe('won')
    expect(advanceStatus('lost', 'responded')).toBe('lost')
    expect(advanceStatus('expired', 'booked')).toBe('expired')
  })
})

describe('isTerminal', () => {
  it('marks won/lost/expired terminal', () => {
    expect(isTerminal('won')).toBe(true)
    expect(isTerminal('lost')).toBe(true)
    expect(isTerminal('expired')).toBe(true)
    expect(isTerminal('booked')).toBe(false)
  })
})

describe('status configuration', () => {
  it('covers every status', () => {
    const statuses: QuoteStatus[] = [
      'draft', 'emailed', 'viewed', 'responded', 'booked', 'deposit_paid', 'won', 'lost', 'expired',
    ]
    for (const s of statuses) {
      expect(STATUS_CONFIG[s].label).toBeTruthy()
    }
  })
  it('exposes exactly the approved public response values', () => {
    expect(VALID_RESPONSE_TYPES).toEqual([
      'ready_to_book', 'need_financing', 'want_cheaper', 'after_payday', 'question', 'not_interested', 'stop_emails',
    ])
  })
})
