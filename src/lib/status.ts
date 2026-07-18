import type { QuoteStatus, ResponseType, TemplateType } from '../types'

// Single source of truth for quote status labels, colors, and transitions.

export const STATUS_CONFIG: Record<QuoteStatus, { label: string; badgeClass: string; description: string }> = {
  draft: { label: 'Draft', badgeClass: 'bg-gray-100 text-gray-700', description: 'Not sent yet' },
  emailed: { label: 'Emailed', badgeClass: 'bg-blue-50 text-blue-700', description: 'Quote email sent' },
  viewed: { label: 'Viewed', badgeClass: 'bg-sky-100 text-sky-800', description: 'Customer opened the quote link' },
  responded: { label: 'Responded', badgeClass: 'bg-violet-100 text-violet-800', description: 'Customer replied on the quote page' },
  booked: { label: 'Appointment', badgeClass: 'bg-amber-100 text-amber-800', description: 'Appointment booked' },
  deposit_paid: { label: 'Deposit paid', badgeClass: 'bg-teal-100 text-teal-800', description: 'Deposit received' },
  won: { label: 'Won', badgeClass: 'bg-green-100 text-green-800', description: 'Job sold' },
  lost: { label: 'Lost', badgeClass: 'bg-red-100 text-red-700', description: 'Customer passed' },
  expired: { label: 'Expired', badgeClass: 'bg-gray-200 text-gray-600', description: 'Quote expired' },
}

/** Ordering used so passive events (viewed/responded) never move a quote backwards. */
const STATUS_RANK: Record<QuoteStatus, number> = {
  draft: 0,
  emailed: 1,
  viewed: 2,
  responded: 3,
  booked: 4,
  deposit_paid: 5,
  won: 6,
  lost: 6,
  expired: 6,
}

export const TERMINAL_STATUSES: QuoteStatus[] = ['won', 'lost', 'expired']

export function isTerminal(status: QuoteStatus): boolean {
  return TERMINAL_STATUSES.includes(status)
}

/**
 * Advance-only transition: returns the new status if `next` outranks the current
 * status, otherwise keeps the current one. Terminal statuses never change here.
 */
export function advanceStatus(current: QuoteStatus, next: QuoteStatus): QuoteStatus {
  if (isTerminal(current)) return current
  return STATUS_RANK[next] > STATUS_RANK[current] ? next : current
}

/** Staff actions may set these statuses directly (with terminal protection for won/lost handled in UI). */
export function applyStaffStatus(current: QuoteStatus, next: QuoteStatus): QuoteStatus {
  // Staff can always correct a quote forward, and can reopen lost -> booked etc.
  // Keep it simple: staff choices win, passive events use advanceStatus.
  void current
  return next
}

export const RESPONSE_CONFIG: Record<ResponseType, { label: string; publicLabel: string }> = {
  ready_to_book: { label: 'Ready to book', publicLabel: "I'm ready to book" },
  need_financing: { label: 'Needs financing', publicLabel: 'I need financing' },
  want_cheaper: { label: 'Wants cheaper option', publicLabel: 'I want a cheaper option' },
  after_payday: { label: 'Contact after payday', publicLabel: 'Contact me after payday' },
  question: { label: 'Has a question', publicLabel: 'I have a question' },
  not_interested: { label: 'No longer interested', publicLabel: "I'm no longer interested" },
  stop_emails: { label: 'Stop follow-up emails', publicLabel: 'Stop follow-up emails' },
}

export const VALID_RESPONSE_TYPES = Object.keys(RESPONSE_CONFIG) as ResponseType[]

export const TEMPLATE_CONFIG: Record<TemplateType, { label: string; shortLabel: string }> = {
  initial: { label: 'Initial quote email', shortLabel: 'Initial quote' },
  check_in: { label: 'Two-day check-in', shortLabel: 'Check-in' },
  financing_option: { label: 'Financing / lower-cost option', shortLabel: 'Financing option' },
  payday_reminder: { label: 'After-payday reminder', shortLabel: 'Payday reminder' },
  final_check_in: { label: 'Final check-in', shortLabel: 'Final check-in' },
}

export const VALID_TEMPLATE_TYPES = Object.keys(TEMPLATE_CONFIG) as TemplateType[]
