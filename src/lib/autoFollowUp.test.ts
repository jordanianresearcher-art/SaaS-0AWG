import { describe, it, expect } from 'vitest'
import { decideAutoFollowUp, describeAutoFollowUp, type AutoFollowUpCandidate } from './autoFollowUp'

const NOW = new Date('2026-08-18T12:00:00Z')
const YESTERDAY = new Date('2026-08-17T12:00:00Z').toISOString()
const TOMORROW = new Date('2026-08-19T12:00:00Z').toISOString()

function candidate(overrides: Partial<AutoFollowUpCandidate> = {}): AutoFollowUpCandidate {
  return {
    status: 'emailed',
    nextFollowUpAt: YESTERDAY,
    emailFollowUpAllowed: true,
    expirationDate: '2026-09-30',
    customerEmail: 'marcus@example.com',
    customerEmailPermissionConfirmed: true,
    customerOptedOutAt: null,
    hasCustomerResponse: false,
    sentTemplates: ['initial'],
    ...overrides,
  }
}

describe('decideAutoFollowUp — sending', () => {
  it('sends the next stage when due', () => {
    expect(decideAutoFollowUp(candidate(), true, NOW)).toEqual({ send: true, template: 'check_in' })
  })

  it('walks the sequence in order', () => {
    expect(decideAutoFollowUp(candidate({ sentTemplates: ['initial', 'check_in'] }), true, NOW)).toEqual({
      send: true,
      template: 'financing_option',
    })
    expect(
      decideAutoFollowUp(candidate({ sentTemplates: ['initial', 'check_in', 'financing_option'] }), true, NOW),
    ).toEqual({ send: true, template: 'final_check_in' })
  })

  it('stops after the final check-in', () => {
    const d = decideAutoFollowUp(
      candidate({ sentTemplates: ['initial', 'check_in', 'financing_option', 'final_check_in'] }),
      true,
      NOW,
    )
    expect(d).toEqual({ send: false, reason: 'sequence_complete' })
  })

  it('sends exactly at the due moment, not a tick later', () => {
    const d = decideAutoFollowUp(candidate({ nextFollowUpAt: NOW.toISOString() }), true, NOW)
    expect(d.send).toBe(true)
  })
})

describe('decideAutoFollowUp — the hard stops', () => {
  it('respects the shop-wide off switch', () => {
    expect(decideAutoFollowUp(candidate(), false, NOW)).toEqual({ send: false, reason: 'shop_disabled' })
  })

  it('respects a per-quote pause', () => {
    expect(decideAutoFollowUp(candidate({ emailFollowUpAllowed: false }), true, NOW)).toEqual({
      send: false,
      reason: 'quote_disabled',
    })
  })

  it('never emails someone who opted out', () => {
    expect(decideAutoFollowUp(candidate({ customerOptedOutAt: YESTERDAY }), true, NOW)).toEqual({
      send: false,
      reason: 'opted_out',
    })
  })

  it('requires an address and confirmed permission', () => {
    expect(decideAutoFollowUp(candidate({ customerEmail: null }), true, NOW).send).toBe(false)
    expect(decideAutoFollowUp(candidate({ customerEmailPermissionConfirmed: false }), true, NOW)).toEqual({
      send: false,
      reason: 'no_permission',
    })
  })

  it('stops on a closed quote', () => {
    for (const status of ['won', 'lost', 'expired'] as const) {
      expect(decideAutoFollowUp(candidate({ status }), true, NOW)).toEqual({
        send: false,
        reason: 'terminal_status',
      })
    }
  })

  it('stops once the customer has booked or paid — never nag someone already sold', () => {
    for (const status of ['booked', 'deposit_paid'] as const) {
      expect(decideAutoFollowUp(candidate({ status }), true, NOW)).toEqual({
        send: false,
        reason: 'terminal_status',
      })
    }
  })

  it('only auto-sends for a quote that is out and quiet', () => {
    expect(decideAutoFollowUp(candidate({ status: 'emailed' }), true, NOW).send).toBe(true)
    expect(decideAutoFollowUp(candidate({ status: 'viewed' }), true, NOW).send).toBe(true)
    // A draft was never sent — automation must not be its first contact.
    expect(decideAutoFollowUp(candidate({ status: 'draft' }), true, NOW).send).toBe(false)
  })

  it('stops the moment the customer says anything — a human takes over', () => {
    expect(decideAutoFollowUp(candidate({ hasCustomerResponse: true }), true, NOW)).toEqual({
      send: false,
      reason: 'customer_responded',
    })
  })

  it('stops on an expired quote but not on its last valid day', () => {
    expect(decideAutoFollowUp(candidate({ expirationDate: '2026-08-01' }), true, NOW)).toEqual({
      send: false,
      reason: 'expired',
    })
    // Expires today — still sendable this morning.
    expect(decideAutoFollowUp(candidate({ expirationDate: '2026-08-18' }), true, NOW).send).toBe(true)
  })

  it('treats a missing expiration as never expiring', () => {
    expect(decideAutoFollowUp(candidate({ expirationDate: null }), true, NOW).send).toBe(true)
  })

  it('waits until the follow-up date arrives', () => {
    expect(decideAutoFollowUp(candidate({ nextFollowUpAt: TOMORROW }), true, NOW)).toEqual({
      send: false,
      reason: 'not_due',
    })
    expect(decideAutoFollowUp(candidate({ nextFollowUpAt: null }), true, NOW)).toEqual({
      send: false,
      reason: 'not_due',
    })
  })

  it('never starts a conversation on its own — the first email is always human', () => {
    expect(decideAutoFollowUp(candidate({ sentTemplates: [] }), true, NOW)).toEqual({
      send: false,
      reason: 'never_sent',
    })
  })

  it('does not choke on an unparseable date', () => {
    expect(decideAutoFollowUp(candidate({ nextFollowUpAt: 'not-a-date' }), true, NOW).send).toBe(false)
    expect(decideAutoFollowUp(candidate({ expirationDate: 'garbage' }), true, NOW).send).toBe(true)
  })

  it('checks opt-out before anything a shop setting could override', () => {
    // Even with everything else wrong, opt-out must be the reported reason —
    // it is the rule with legal weight.
    const d = decideAutoFollowUp(
      candidate({ customerOptedOutAt: YESTERDAY, customerEmail: null, status: 'lost' }),
      true,
      NOW,
    )
    expect(d).toEqual({ send: false, reason: 'opted_out' })
  })
})

describe('describeAutoFollowUp', () => {
  it('reports an imminent send', () => {
    const d = describeAutoFollowUp(candidate(), true, NOW)
    expect(d.willSend).toBe(true)
    expect(d.template).toBe('check_in')
  })

  it('reports a future send as scheduled, not stopped', () => {
    const d = describeAutoFollowUp(candidate({ nextFollowUpAt: TOMORROW }), true, NOW)
    expect(d.willSend).toBe(true)
    expect(d.template).toBe('check_in')
    expect(d.detail).toBe('Scheduled')
  })

  it('does not promise a future send when the sequence is already finished', () => {
    const d = describeAutoFollowUp(
      candidate({
        nextFollowUpAt: TOMORROW,
        sentTemplates: ['initial', 'check_in', 'financing_option', 'final_check_in'],
      }),
      true,
      NOW,
    )
    expect(d.willSend).toBe(false)
    expect(d.detail).toMatch(/finished/i)
  })

  it('explains why it is staying quiet in words a shop owner understands', () => {
    expect(describeAutoFollowUp(candidate({ customerOptedOutAt: YESTERDAY }), true, NOW).detail).toMatch(/opted out/i)
    expect(describeAutoFollowUp(candidate({ hasCustomerResponse: true }), true, NOW).detail).toMatch(/replied/i)
    expect(describeAutoFollowUp(candidate(), false, NOW).detail).toMatch(/turned off/i)
  })
})
