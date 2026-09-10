import { differenceInCalendarDays, startOfDay } from 'date-fns'
import type { Quote, TemplateType, EmailMessage } from '../types'
import { isTerminal } from './status'
import { isSequenceComplete } from './autoFollowUp'

// Follow-up queue buckets and the suggested manual email sequence.
//
// The first email is always a human decision. The three that follow send
// themselves once a shop has automation on (see autoFollowUp.ts), and then
// stop — which is what the 'finished' bucket exists to catch.

export type FollowUpBucket =
  | 'overdue'
  | 'due_today'
  | 'due_soon'
  | 'waiting'
  /** Every automatic email has gone out. Nothing left to send; needs a verdict. */
  | 'finished'
  | 'none'
  | 'disabled'

export const BUCKET_CONFIG: Record<FollowUpBucket, { label: string; hint: string }> = {
  overdue: { label: 'Overdue', hint: 'Follow-up date has passed — reach out now' },
  due_today: { label: 'Due today', hint: 'Scheduled for today' },
  due_soon: { label: 'Due soon', hint: 'Coming up in the next 3 days' },
  waiting: { label: 'Waiting on customer', hint: 'Customer responded — reply or call them' },
  finished: {
    label: 'Out of emails — what happened?',
    hint: 'Every follow-up has gone out. Say whether it turned into work.',
  },
  none: { label: 'No follow-up scheduled', hint: 'Pick a date so these do not slip' },
  disabled: { label: 'Follow-up off', hint: 'Customer opted out or follow-up was turned off' },
}

export const BUCKET_ORDER: FollowUpBucket[] = ['overdue', 'due_today', 'waiting', 'finished', 'due_soon', 'none', 'disabled']

export function followUpBucket(
  quote: Pick<Quote, 'status' | 'nextFollowUpAt' | 'emailFollowUpAllowed'>,
  optedOut: boolean,
  now: Date = new Date(),
  /** Templates already delivered. Omit only where the caller genuinely has no email history. */
  sentTemplates: TemplateType[] = [],
): FollowUpBucket | null {
  if (isTerminal(quote.status)) return null
  if (optedOut || !quote.emailFollowUpAllowed) return 'disabled'
  if (quote.status === 'responded') return 'waiting'
  // A quote that has run out of emails has not slipped through a crack — it
  // finished. Telling staff to "pick a date so these do not slip" is the wrong
  // instruction and it is why 27 of this pilot's quotes sat with no verdict
  // while its win rate was computed against a denominator nobody had closed.
  if (!quote.nextFollowUpAt && isSequenceComplete(sentTemplates)) return 'finished'
  if (!quote.nextFollowUpAt) return 'none'
  const diff = differenceInCalendarDays(startOfDay(new Date(quote.nextFollowUpAt)), startOfDay(now))
  if (diff < 0) return 'overdue'
  if (diff === 0) return 'due_today'
  if (diff <= 3) return 'due_soon'
  return 'none'
}

/**
 * Suggested manual sequence: initial → 2-day check-in → 5-day financing /
 * alternative package → 10-day final check-in. If the customer asked to be
 * contacted after payday, suggest the payday reminder instead.
 */
export function suggestNextTemplate(
  emails: Pick<EmailMessage, 'templateType' | 'status'>[],
  lastResponseType?: string | null,
): TemplateType {
  const delivered = emails.filter((e) => e.status === 'sent' || e.status === 'demo_sent')
  if (delivered.length === 0) return 'initial'
  if (lastResponseType === 'after_payday') return 'payday_reminder'
  const sentTypes = new Set(delivered.map((e) => e.templateType))
  if (!sentTypes.has('check_in')) return 'check_in'
  if (!sentTypes.has('financing_option')) return 'financing_option'
  return 'final_check_in'
}

/** Days after the previous email that each sequence step is suggested. */
export const SEQUENCE_OFFSETS: Record<TemplateType, number> = {
  initial: 0,
  check_in: 2,
  financing_option: 3, // day 5 overall
  payday_reminder: 3,
  final_check_in: 5, // day 10 overall
}

/** Next follow-up date after sending a given template, from the shop's schedule or defaults. */
export function nextFollowUpDateAfterSend(
  template: TemplateType,
  sentAt: Date,
  scheduleDays?: number[],
): Date | null {
  if (template === 'final_check_in') return null
  const defaultsAfter: Record<TemplateType, number | null> = {
    initial: 2,
    check_in: 3,
    financing_option: 5,
    payday_reminder: 5,
    final_check_in: null,
  }
  const days = defaultsAfter[template]
  if (days === null) return null
  // If the shop configured a custom cadence, use its first matching gap.
  const stepIndex: Record<TemplateType, number> = {
    initial: 0,
    check_in: 1,
    financing_option: 2,
    payday_reminder: 2,
    final_check_in: 3,
  }
  const custom = scheduleDays?.[stepIndex[template]]
  const gap = typeof custom === 'number' && custom > 0 ? custom : days
  const next = new Date(sentAt)
  next.setDate(next.getDate() + gap)
  return next
}
