import { describe, expect, it } from 'vitest'
import { followUpBucket, suggestNextTemplate, nextFollowUpDateAfterSend } from './followUp'

const NOW = new Date('2026-07-17T15:00:00Z')

function quoteWith(overrides: Partial<Parameters<typeof followUpBucket>[0]> = {}) {
  return {
    status: 'emailed' as const,
    nextFollowUpAt: null as string | null,
    emailFollowUpAllowed: true,
    ...overrides,
  }
}

describe('followUpBucket', () => {
  it('is overdue when the date has passed', () => {
    expect(followUpBucket(quoteWith({ nextFollowUpAt: '2026-07-15T09:00:00Z' }), false, NOW)).toBe('overdue')
  })
  it('is due today on the same calendar day', () => {
    expect(followUpBucket(quoteWith({ nextFollowUpAt: '2026-07-17T22:00:00Z' }), false, NOW)).toBe('due_today')
  })
  it('is due soon within three days', () => {
    expect(followUpBucket(quoteWith({ nextFollowUpAt: '2026-07-19T09:00:00Z' }), false, NOW)).toBe('due_soon')
  })
  it('is none when scheduled far out', () => {
    expect(followUpBucket(quoteWith({ nextFollowUpAt: '2026-08-17T09:00:00Z' }), false, NOW)).toBe('none')
  })
  it('is none with no date', () => {
    expect(followUpBucket(quoteWith(), false, NOW)).toBe('none')
  })
  it('is waiting when the customer responded', () => {
    expect(followUpBucket(quoteWith({ status: 'responded' }), false, NOW)).toBe('waiting')
  })
  it('is disabled when the customer opted out', () => {
    expect(followUpBucket(quoteWith({ nextFollowUpAt: '2026-07-15T09:00:00Z' }), true, NOW)).toBe('disabled')
  })
  it('is disabled when follow-up is turned off', () => {
    expect(followUpBucket(quoteWith({ emailFollowUpAllowed: false }), false, NOW)).toBe('disabled')
  })
  it('is excluded (null) for terminal quotes', () => {
    expect(followUpBucket(quoteWith({ status: 'won' }), false, NOW)).toBeNull()
    expect(followUpBucket(quoteWith({ status: 'lost' }), false, NOW)).toBeNull()
  })
})

describe('suggestNextTemplate', () => {
  it('suggests the initial email before anything was sent', () => {
    expect(suggestNextTemplate([])).toBe('initial')
  })
  it('ignores failed emails when deciding', () => {
    expect(suggestNextTemplate([{ templateType: 'initial', status: 'failed' }])).toBe('initial')
  })
  it('suggests the check-in after the initial', () => {
    expect(suggestNextTemplate([{ templateType: 'initial', status: 'sent' }])).toBe('check_in')
  })
  it('suggests financing after the check-in', () => {
    expect(
      suggestNextTemplate([
        { templateType: 'initial', status: 'sent' },
        { templateType: 'check_in', status: 'sent' },
      ]),
    ).toBe('financing_option')
  })
  it('suggests the final check-in at the end of the sequence', () => {
    expect(
      suggestNextTemplate([
        { templateType: 'initial', status: 'sent' },
        { templateType: 'check_in', status: 'sent' },
        { templateType: 'financing_option', status: 'sent' },
      ]),
    ).toBe('final_check_in')
  })
  it('suggests the payday reminder when the customer asked for it', () => {
    expect(suggestNextTemplate([{ templateType: 'initial', status: 'demo_sent' }], 'after_payday')).toBe(
      'payday_reminder',
    )
  })
  it('counts demo sends like real sends', () => {
    expect(suggestNextTemplate([{ templateType: 'initial', status: 'demo_sent' }])).toBe('check_in')
  })
})

describe('nextFollowUpDateAfterSend', () => {
  const sentAt = new Date('2026-07-17T10:00:00Z')

  it('schedules 2 days after the initial email by default', () => {
    const next = nextFollowUpDateAfterSend('initial', sentAt)
    expect(next?.toISOString()).toBe('2026-07-19T10:00:00.000Z')
  })
  it('uses the shop schedule when configured', () => {
    const next = nextFollowUpDateAfterSend('initial', sentAt, [4, 3, 5])
    expect(next?.toISOString()).toBe('2026-07-21T10:00:00.000Z')
  })
  it('schedules nothing after the final check-in', () => {
    expect(nextFollowUpDateAfterSend('final_check_in', sentAt)).toBeNull()
  })
})
