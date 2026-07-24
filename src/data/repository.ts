import type {
  CatalogItem,
  Customer,
  EmailMessage,
  Employee,
  PaymentMethod,
  PublicQuote,
  Quote,
  QuoteBundle,
  QuoteEvent,
  QuoteOption,
  QuoteResponse,
  QuoteStatus,
  ResponseType,
  Shop,
  TemplateType,
  Tier,
  WindowTintConfig,
} from '../types'

// Single abstraction both modes implement. Demo mode persists to localStorage;
// production mode talks to Supabase (tables + RPCs + Edge Function).

export interface NewQuoteInput {
  customer: {
    firstName: string
    lastName: string | null
    email: string
    phone: string | null
    vehicleYear: number | null
    vehicleMake: string | null
    vehicleModel: string | null
    vehicleTrim: string | null
    source: string | null
    emailContactPermissionConfirmed: boolean
  }
  quote: {
    internalNotes: string | null
    expirationDate: string | null
    nextFollowUpAt: string | null
    windowTints: WindowTintConfig[]
  }
  options: Array<{
    tier: Tier
    name: string
    description: string
    priceCents: number
    laborIncluded: boolean
    depositPaymentMethod: PaymentMethod | null
    depositPaymentHandle: string | null
    depositAmountCents: number | null
    recommended: boolean
    items: Array<{
      brand: string | null
      model: string | null
      name: string
      quantity: number
      description: string | null
    }>
  }>
}

export interface SendEmailResult {
  ok: boolean
  status: 'sent' | 'demo_sent' | 'failed'
  message: string
}

export interface ShopSettingsPatch {
  name?: string
  phone?: string
  email?: string
  replyToEmail?: string
  address?: string
  website?: string | null
  logoUrl?: string | null
  primaryColor?: string
  defaultPaymentMethod?: PaymentMethod | null
  defaultPaymentHandle?: string | null
  quoteExpirationDays?: number
  followUpScheduleDays?: number[]
  quoteDisclaimer?: string
}

export interface NewCatalogItemInput {
  brand: string | null
  model: string | null
  name: string
  defaultPriceCents: number | null
}

export interface DataRepository {
  readonly mode: 'demo' | 'production'

  getShop(): Promise<Shop>
  updateShop(patch: ShopSettingsPatch): Promise<Shop>
  listEmployees(): Promise<Employee[]>

  listCatalogItems(): Promise<CatalogItem[]>
  createCatalogItem(input: NewCatalogItemInput): Promise<CatalogItem>
  updateCatalogItem(itemId: string, input: NewCatalogItemInput): Promise<CatalogItem>
  deleteCatalogItem(itemId: string): Promise<void>

  listQuoteBundles(): Promise<QuoteBundle[]>
  getQuoteBundle(quoteId: string): Promise<QuoteBundle | null>
  createQuote(input: NewQuoteInput): Promise<Quote>

  /** Staff status actions: booked, deposit paid, won (with amount), lost. */
  setQuoteStatus(quoteId: string, status: QuoteStatus, wonAmountCents?: number | null): Promise<void>
  rescheduleFollowUp(quoteId: string, nextFollowUpAt: string | null): Promise<void>
  setFollowUpAllowed(quoteId: string, allowed: boolean): Promise<void>
  markContacted(quoteId: string): Promise<void>
  updateInternalNotes(quoteId: string, notes: string | null): Promise<void>

  /** Sends (or demo-sends) an email after eligibility passes. Never fakes real delivery. */
  sendEmail(quoteId: string, templateType: TemplateType): Promise<SendEmailResult>

  // Anonymous public-quote surface (RPC-backed in production).
  getPublicQuote(publicToken: string): Promise<PublicQuote | null>
  recordPublicView(publicToken: string): Promise<void>
  submitPublicResponse(
    publicToken: string,
    responseType: ResponseType,
    optionId: string | null,
    message: string | null,
  ): Promise<void>
  optOutPublicQuote(publicToken: string): Promise<void>
}

export type { Shop, Quote, QuoteBundle, Customer, QuoteOption, QuoteEvent, QuoteResponse, EmailMessage, CatalogItem }
