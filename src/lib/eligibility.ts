import type { Customer, Quote } from '../types'
import { isTerminal } from './status'

// Every email send — demo or production — must pass this check first.
// The Edge Function enforces the same rules server-side.

export interface SendEligibility {
  allowed: boolean
  reason: string | null
}

export function checkSendEligibility(
  customer: Pick<Customer, 'email' | 'emailContactPermissionConfirmed' | 'emailOptOutAt'>,
  quote: Pick<Quote, 'status' | 'emailFollowUpAllowed'>,
): SendEligibility {
  if (!customer.email) {
    return { allowed: false, reason: 'This customer has no email address on file.' }
  }
  if (!customer.emailContactPermissionConfirmed) {
    return { allowed: false, reason: 'Email permission was never confirmed for this customer.' }
  }
  if (customer.emailOptOutAt) {
    return { allowed: false, reason: 'This customer asked to stop receiving emails. Sends are blocked.' }
  }
  if (!quote.emailFollowUpAllowed) {
    return { allowed: false, reason: 'Follow-up emails are turned off for this quote.' }
  }
  if (isTerminal(quote.status)) {
    return { allowed: false, reason: 'This quote is closed. Reopen it before emailing.' }
  }
  return { allowed: true, reason: null }
}
