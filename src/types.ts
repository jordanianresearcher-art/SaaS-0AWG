// Central domain types shared by demo mode, production mode, and tests.

export type QuoteStatus =
  | 'draft'
  | 'emailed'
  | 'viewed'
  | 'responded'
  | 'booked'
  | 'deposit_paid'
  | 'won'
  | 'lost'
  | 'expired'

export type Tier = 'good' | 'better' | 'insane' | 'custom'

export type TemplateType =
  | 'initial'
  | 'check_in'
  | 'financing_option'
  | 'payday_reminder'
  | 'final_check_in'

export type ResponseType =
  | 'ready_to_book'
  | 'need_financing'
  | 'want_cheaper'
  | 'after_payday'
  | 'question'
  | 'not_interested'
  | 'stop_emails'

export type EmailStatus = 'previewed' | 'sending' | 'sent' | 'failed' | 'demo_sent'

export type QuoteEventType =
  | 'created'
  | 'email_sent'
  | 'email_demo_sent'
  | 'email_failed'
  | 'quote_viewed'
  | 'customer_responded'
  | 'appointment_booked'
  | 'deposit_paid'
  | 'marked_won'
  | 'marked_lost'
  | 'follow_up_rescheduled'
  | 'follow_up_disabled'
  | 'email_opt_out'
  | 'marked_contacted'

export type MembershipRole = 'owner' | 'manager' | 'staff'

export interface Shop {
  id: string
  name: string
  slug: string
  phone: string
  email: string
  replyToEmail: string
  address: string
  website: string | null
  logoUrl: string | null
  primaryColor: string
  defaultPaymentLink: string | null
  quoteExpirationDays: number
  followUpScheduleDays: number[]
  quoteDisclaimer: string
  createdAt: string
  updatedAt: string
}

export interface Customer {
  id: string
  shopId: string
  firstName: string
  lastName: string | null
  phone: string | null
  email: string
  vehicleYear: number
  vehicleMake: string
  vehicleModel: string
  vehicleTrim: string | null
  source: string | null
  emailContactPermissionConfirmed: boolean
  emailContactPermissionConfirmedAt: string | null
  emailOptOutAt: string | null
  createdAt: string
  updatedAt: string
}

export interface QuoteItem {
  id: string
  quoteOptionId: string
  brand: string | null
  model: string | null
  name: string
  quantity: number
  description: string | null
  position: number
}

export interface QuoteOption {
  id: string
  quoteId: string
  tier: Tier
  name: string
  description: string
  priceCents: number
  laborIncluded: boolean
  depositLink: string | null
  recommended: boolean
  position: number
  items: QuoteItem[]
}

export interface Quote {
  id: string
  shopId: string
  customerId: string
  createdBy: string | null
  publicToken: string
  status: QuoteStatus
  internalNotes: string | null
  expirationDate: string | null
  lastEmailedAt: string | null
  nextFollowUpAt: string | null
  emailFollowUpAllowed: boolean
  wonAmountCents: number | null
  createdAt: string
  updatedAt: string
}

export interface QuoteEvent {
  id: string
  quoteId: string
  eventType: QuoteEventType
  metadata: Record<string, string | number | boolean | null>
  createdBy: string | null
  createdAt: string
}

export interface QuoteResponse {
  id: string
  quoteId: string
  quoteOptionId: string | null
  responseType: ResponseType
  message: string | null
  createdAt: string
}

export interface EmailMessage {
  id: string
  shopId: string
  quoteId: string
  recipientEmail: string
  templateType: TemplateType
  subject: string
  status: EmailStatus
  providerMessageId: string | null
  errorMessage: string | null
  sentBy: string | null
  createdAt: string
  sentAt: string | null
}

export interface Employee {
  id: string
  shopId: string
  fullName: string
  role: MembershipRole
}

/** A quote joined with everything the app screens need. */
export interface QuoteBundle {
  quote: Quote
  customer: Customer
  options: QuoteOption[]
  events: QuoteEvent[]
  responses: QuoteResponse[]
  emails: EmailMessage[]
}

/** Sanitized shape returned to the anonymous public quote page. */
export interface PublicQuote {
  shopName: string
  shopLogoUrl: string | null
  shopPhone: string
  shopEmail: string
  shopAddress: string
  shopPrimaryColor: string
  quoteDisclaimer: string
  customerFirstName: string
  vehicle: { year: number; make: string; model: string; trim: string | null }
  status: QuoteStatus
  expirationDate: string | null
  optedOut: boolean
  options: Array<{
    id: string
    tier: Tier
    name: string
    description: string
    priceCents: number
    laborIncluded: boolean
    depositLink: string | null
    recommended: boolean
    items: Array<{ brand: string | null; model: string | null; name: string; quantity: number; description: string | null }>
  }>
}
