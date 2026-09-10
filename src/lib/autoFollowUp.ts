// Decides whether a quote should get an automatic follow-up email right now,
// and which one.
//
// This replaces the product's original "a human presses Send for every email"
// stance. The reason for the change is practical: the owner answers their own
// phone, and a 4-touch cadence never survives a busy week by hand — which is
// exactly where the recovered revenue lives.
//
// Because this now runs unattended, the rules are deliberately conservative:
// every ambiguous case stops the machine rather than risking one unwanted email
// to a real customer. A shop's reputation is worth more than a marginal send.
//
// NOTE: supabase/functions/send-quote-followups mirrors this logic server-side
// (Deno cannot import from src/). Update both together — this copy is what the
// UI predicts with, that copy is what actually sends.

import type { QuoteStatus, TemplateType } from '../types'

export interface AutoFollowUpCandidate {
  status: QuoteStatus
  /** ISO timestamp, or null when no follow-up is scheduled. */
  nextFollowUpAt: string | null
  emailFollowUpAllowed: boolean
  /** ISO date, or null when the quote never expires. */
  expirationDate: string | null
  customerEmail: string | null
  customerEmailPermissionConfirmed: boolean
  /** ISO timestamp when the customer opted out, or null. */
  customerOptedOutAt: string | null
  /** True once the customer has answered the quote in any way. */
  hasCustomerResponse: boolean
  /** Templates already delivered for this quote (sent or demo_sent). */
  sentTemplates: TemplateType[]
}

export type AutoFollowUpDecision =
  | { send: false; reason: AutoFollowUpSkipReason }
  | { send: true; template: TemplateType }

export type AutoFollowUpSkipReason =
  | 'shop_disabled'
  | 'quote_disabled'
  | 'opted_out'
  | 'no_email'
  | 'no_permission'
  | 'terminal_status'
  | 'expired'
  | 'customer_responded'
  | 'not_due'
  | 'never_sent'
  | 'sequence_complete'

export const SKIP_REASON_LABEL: Record<AutoFollowUpSkipReason, string> = {
  shop_disabled: 'Automatic follow-ups are turned off for this shop',
  quote_disabled: 'Follow-ups are paused on this quote',
  opted_out: 'Customer opted out of emails',
  no_email: 'No email address on file',
  no_permission: 'Email permission was never confirmed',
  terminal_status: 'Quote is closed or already booked',
  expired: 'Quote has expired',
  customer_responded: 'Customer replied — waiting on you',
  not_due: 'Not due yet',
  never_sent: 'The first quote email has not been sent yet',
  sequence_complete: 'Follow-up sequence finished',
}

/** Order the automatic sequence walks. `payday_reminder` is never chosen automatically — see decideAutoFollowUp. */
const AUTO_SEQUENCE: TemplateType[] = ['check_in', 'financing_option', 'final_check_in']

/**
 * Has this quote run out of automatic emails?
 *
 * True means the machine has said everything it is going to say. It is not a
 * failure state and it is not "no follow-up scheduled" — the quote finished
 * the sequence, and the only thing left is a human deciding whether it turned
 * into money. See the 'finished' bucket in src/lib/followUp.ts.
 */
export function isSequenceComplete(sentTemplates: TemplateType[]): boolean {
  const sent = new Set(sentTemplates)
  return AUTO_SEQUENCE.every((t) => sent.has(t))
}

/**
 * The only statuses an automatic follow-up may be sent for.
 *
 * An allowlist rather than a "not terminal" check, for two reasons. First,
 * `isTerminal()` in status.ts covers only won/lost/expired — but automation has
 * to stop much earlier than that: emailing "still thinking it over?" to someone
 * who already booked an appointment or paid a deposit is worse than sending
 * nothing at all. Second, an allowlist fails safe — a status added later gets
 * silence by default instead of unexpected mail to a real customer.
 */
const AUTO_SENDABLE_STATUSES: QuoteStatus[] = ['emailed', 'viewed']

export function decideAutoFollowUp(
  candidate: AutoFollowUpCandidate,
  shopAutoFollowUpEnabled: boolean,
  now: Date = new Date(),
): AutoFollowUpDecision {
  if (!shopAutoFollowUpEnabled) return { send: false, reason: 'shop_disabled' }
  if (!candidate.emailFollowUpAllowed) return { send: false, reason: 'quote_disabled' }
  if (candidate.customerOptedOutAt) return { send: false, reason: 'opted_out' }
  if (!candidate.customerEmail) return { send: false, reason: 'no_email' }
  if (!candidate.customerEmailPermissionConfirmed) return { send: false, reason: 'no_permission' }
  if (!AUTO_SENDABLE_STATUSES.includes(candidate.status)) return { send: false, reason: 'terminal_status' }

  // A customer who answered gets a human, not a robot. This deliberately stops
  // even for 'after_payday' — staff can still send that one by hand from the
  // follow-ups queue. Auto-emailing someone who just said "I'm ready to book"
  // would be worse than sending nothing.
  if (candidate.hasCustomerResponse) return { send: false, reason: 'customer_responded' }

  if (candidate.expirationDate) {
    // Compare against end-of-day so a quote doesn't go silent on its last
    // valid morning.
    const expiry = new Date(`${candidate.expirationDate}T23:59:59`)
    if (!Number.isNaN(expiry.getTime()) && expiry.getTime() < now.getTime()) {
      return { send: false, reason: 'expired' }
    }
  }

  // Automation only continues a conversation a human started. The first email
  // is always a deliberate staff action.
  if (candidate.sentTemplates.length === 0) return { send: false, reason: 'never_sent' }

  if (!candidate.nextFollowUpAt) return { send: false, reason: 'not_due' }
  const due = new Date(candidate.nextFollowUpAt)
  if (Number.isNaN(due.getTime()) || due.getTime() > now.getTime()) {
    return { send: false, reason: 'not_due' }
  }

  const sent = new Set(candidate.sentTemplates)
  const next = AUTO_SEQUENCE.find((t) => !sent.has(t))
  if (!next) return { send: false, reason: 'sequence_complete' }

  return { send: true, template: next }
}

/**
 * What the UI shows for a quote in the follow-ups queue: either the next
 * automatic send and when, or why the machine is staying quiet.
 */
export function describeAutoFollowUp(
  candidate: AutoFollowUpCandidate,
  shopAutoFollowUpEnabled: boolean,
  now: Date = new Date(),
): { willSend: boolean; template: TemplateType | null; detail: string } {
  const decision = decideAutoFollowUp(candidate, shopAutoFollowUpEnabled, now)
  if (decision.send) {
    return { willSend: true, template: decision.template, detail: 'Sending automatically' }
  }
  if (decision.reason === 'not_due' && candidate.nextFollowUpAt) {
    // Still on the rails — just early. Confirm the next step would actually be
    // sendable once the date arrives, so the queue doesn't promise a send that
    // the sequence has already finished.
    const asIfDue = decideAutoFollowUp(
      { ...candidate, nextFollowUpAt: new Date(0).toISOString() },
      shopAutoFollowUpEnabled,
      now,
    )
    if (asIfDue.send) {
      return { willSend: true, template: asIfDue.template, detail: 'Scheduled' }
    }
    return { willSend: false, template: null, detail: SKIP_REASON_LABEL[asIfDue.reason] }
  }
  return { willSend: false, template: null, detail: SKIP_REASON_LABEL[decision.reason] }
}
