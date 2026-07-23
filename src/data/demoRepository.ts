import type {
  CatalogItem,
  Customer,
  Employee,
  PublicQuote,
  Quote,
  QuoteBundle,
  QuoteEvent,
  QuoteEventType,
  QuoteStatus,
  ResponseType,
  Shop,
  TemplateType,
} from '../types'
import type { DataRepository, NewCatalogItemInput, NewQuoteInput, SendEmailResult, ShopSettingsPatch } from './repository'
import { buildDemoData, DEMO_SEED_VERSION, type DemoDB } from './demoData'
import { advanceStatus, applyStaffStatus, VALID_RESPONSE_TYPES } from '../lib/status'
import { checkSendEligibility } from '../lib/eligibility'
import { nextFollowUpDateAfterSend } from '../lib/followUp'
import { newId } from '../lib/ids'

const STORAGE_KEY = '0gauge-demo-db'

/**
 * Demo-mode repository. All data lives in localStorage so a sales demo can be
 * carried around on a phone with no backend at all. Emails are never really
 * sent — sends are recorded honestly as `demo_sent`.
 */
export class DemoRepository implements DataRepository {
  readonly mode = 'demo' as const
  private db: DemoDB
  private storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

  constructor(storage?: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>) {
    this.storage = storage ?? window.localStorage
    this.db = this.load()
  }

  private load(): DemoDB {
    try {
      const raw = this.storage.getItem(STORAGE_KEY)
      if (raw) {
        const parsed = JSON.parse(raw) as DemoDB
        if (parsed.seedVersion === DEMO_SEED_VERSION) return parsed
      }
    } catch {
      // Corrupt storage — fall through to a fresh seed.
    }
    const fresh = buildDemoData()
    this.persist(fresh)
    return fresh
  }

  private persist(db?: DemoDB): void {
    try {
      this.storage.setItem(STORAGE_KEY, JSON.stringify(db ?? this.db))
    } catch {
      // Storage full/unavailable — demo keeps working in memory.
    }
  }

  resetDemoData(): void {
    this.storage.removeItem(STORAGE_KEY)
    this.db = buildDemoData()
    this.persist()
  }

  private quoteById(quoteId: string): Quote {
    const quote = this.db.quotes.find((q) => q.id === quoteId)
    if (!quote) throw new Error('Quote not found')
    return quote
  }

  private customerFor(quote: Quote): Customer {
    const customer = this.db.customers.find((c) => c.id === quote.customerId)
    if (!customer) throw new Error('Customer not found')
    return customer
  }

  private bundle(quote: Quote): QuoteBundle {
    return {
      quote,
      customer: this.customerFor(quote),
      options: this.db.options
        .filter((o) => o.quoteId === quote.id)
        .sort((a, b) => a.position - b.position),
      events: this.db.events
        .filter((e) => e.quoteId === quote.id)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
      responses: this.db.responses
        .filter((r) => r.quoteId === quote.id)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
      emails: this.db.emails
        .filter((e) => e.quoteId === quote.id)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    }
  }

  private addEvent(quoteId: string, eventType: QuoteEventType, metadata: QuoteEvent['metadata'] = {}, createdBy: string | null = 'demo-user-owner'): void {
    this.db.events.push({
      id: newId(),
      quoteId,
      eventType,
      metadata,
      createdBy,
      createdAt: new Date().toISOString(),
    })
  }

  async getShop(): Promise<Shop> {
    return this.db.shop
  }

  async updateShop(patch: ShopSettingsPatch): Promise<Shop> {
    this.db.shop = { ...this.db.shop, ...patch, updatedAt: new Date().toISOString() }
    this.persist()
    return this.db.shop
  }

  async listEmployees(): Promise<Employee[]> {
    return this.db.employees
  }

  async listCatalogItems(): Promise<CatalogItem[]> {
    return this.db.catalogItems.slice().sort((a, b) => a.position - b.position)
  }

  async createCatalogItem(input: NewCatalogItemInput): Promise<CatalogItem> {
    const item: CatalogItem = {
      id: newId(),
      shopId: this.db.shop.id,
      ...input,
      position: this.db.catalogItems.length,
    }
    this.db.catalogItems.push(item)
    this.persist()
    return item
  }

  async updateCatalogItem(itemId: string, input: NewCatalogItemInput): Promise<CatalogItem> {
    const item = this.db.catalogItems.find((i) => i.id === itemId)
    if (!item) throw new Error('Catalog item not found')
    Object.assign(item, input)
    this.persist()
    return item
  }

  async deleteCatalogItem(itemId: string): Promise<void> {
    this.db.catalogItems = this.db.catalogItems.filter((i) => i.id !== itemId)
    this.persist()
  }

  async listQuoteBundles(): Promise<QuoteBundle[]> {
    return this.db.quotes
      .slice()
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map((q) => this.bundle(q))
  }

  async getQuoteBundle(quoteId: string): Promise<QuoteBundle | null> {
    const quote = this.db.quotes.find((q) => q.id === quoteId)
    return quote ? this.bundle(quote) : null
  }

  async createQuote(input: NewQuoteInput): Promise<Quote> {
    const now = new Date().toISOString()
    const customer: Customer = {
      id: newId(),
      shopId: this.db.shop.id,
      ...input.customer,
      emailContactPermissionConfirmedAt: input.customer.emailContactPermissionConfirmed ? now : null,
      emailOptOutAt: null,
      createdAt: now,
      updatedAt: now,
    }
    const quote: Quote = {
      id: newId(),
      shopId: this.db.shop.id,
      customerId: customer.id,
      createdBy: 'demo-user-owner',
      publicToken: newId(),
      status: 'draft',
      internalNotes: input.quote.internalNotes,
      expirationDate: input.quote.expirationDate,
      lastEmailedAt: null,
      nextFollowUpAt: input.quote.nextFollowUpAt,
      emailFollowUpAllowed: true,
      wonAmountCents: null,
      windowTint: input.quote.windowTint,
      createdAt: now,
      updatedAt: now,
    }
    this.db.customers.push(customer)
    this.db.quotes.push(quote)
    input.options.forEach((opt, i) => {
      const optionId = newId()
      this.db.options.push({
        id: optionId,
        quoteId: quote.id,
        tier: opt.tier,
        name: opt.name,
        description: opt.description,
        priceCents: opt.priceCents,
        laborIncluded: opt.laborIncluded,
        depositPaymentMethod: opt.depositPaymentMethod,
        depositPaymentHandle: opt.depositPaymentHandle,
        depositAmountCents: opt.depositAmountCents,
        recommended: opt.recommended,
        position: i,
        items: opt.items.map((item, j) => ({
          id: newId(),
          quoteOptionId: optionId,
          ...item,
          position: j,
        })),
      })
    })
    this.addEvent(quote.id, 'created')
    this.persist()
    return quote
  }

  private touch(quote: Quote): void {
    quote.updatedAt = new Date().toISOString()
  }

  async setQuoteStatus(quoteId: string, status: QuoteStatus, wonAmountCents?: number | null): Promise<void> {
    const quote = this.quoteById(quoteId)
    quote.status = applyStaffStatus(quote.status, status)
    if (status === 'won') {
      quote.wonAmountCents = wonAmountCents ?? null
      quote.nextFollowUpAt = null
      this.addEvent(quoteId, 'marked_won', { wonAmountCents: wonAmountCents ?? null })
    } else if (status === 'lost') {
      quote.nextFollowUpAt = null
      this.addEvent(quoteId, 'marked_lost')
    } else if (status === 'booked') {
      this.addEvent(quoteId, 'appointment_booked')
    } else if (status === 'deposit_paid') {
      this.addEvent(quoteId, 'deposit_paid')
    }
    this.touch(quote)
    this.persist()
  }

  async rescheduleFollowUp(quoteId: string, nextFollowUpAt: string | null): Promise<void> {
    const quote = this.quoteById(quoteId)
    quote.nextFollowUpAt = nextFollowUpAt
    this.addEvent(quoteId, 'follow_up_rescheduled', { nextFollowUpAt })
    this.touch(quote)
    this.persist()
  }

  async setFollowUpAllowed(quoteId: string, allowed: boolean): Promise<void> {
    const quote = this.quoteById(quoteId)
    quote.emailFollowUpAllowed = allowed
    if (!allowed) {
      quote.nextFollowUpAt = null
      this.addEvent(quoteId, 'follow_up_disabled')
    }
    this.touch(quote)
    this.persist()
  }

  async markContacted(quoteId: string): Promise<void> {
    const quote = this.quoteById(quoteId)
    this.addEvent(quoteId, 'marked_contacted')
    if (quote.status === 'responded') {
      // Waiting-on-customer resolved by a call/visit; keep status as responded
      // but push the follow-up out two days so the queue reflects the touch.
      const next = new Date()
      next.setDate(next.getDate() + 2)
      quote.nextFollowUpAt = next.toISOString()
    }
    this.touch(quote)
    this.persist()
  }

  async updateInternalNotes(quoteId: string, notes: string | null): Promise<void> {
    const quote = this.quoteById(quoteId)
    quote.internalNotes = notes
    this.touch(quote)
    this.persist()
  }

  async sendEmail(quoteId: string, templateType: TemplateType): Promise<SendEmailResult> {
    const quote = this.quoteById(quoteId)
    const customer = this.customerFor(quote)
    const eligibility = checkSendEligibility(customer, quote)
    if (!eligibility.allowed) {
      return { ok: false, status: 'failed', message: eligibility.reason ?? 'Sending is blocked.' }
    }
    const now = new Date()
    this.db.emails.push({
      id: newId(),
      shopId: this.db.shop.id,
      quoteId,
      recipientEmail: customer.email,
      templateType,
      subject: `Your quote from ${this.db.shop.name}`,
      status: 'demo_sent',
      providerMessageId: null,
      errorMessage: null,
      sentBy: 'demo-user-owner',
      createdAt: now.toISOString(),
      sentAt: now.toISOString(),
    })
    quote.lastEmailedAt = now.toISOString()
    quote.status = advanceStatus(quote.status, 'emailed')
    const next = nextFollowUpDateAfterSend(templateType, now, this.db.shop.followUpScheduleDays)
    quote.nextFollowUpAt = next ? next.toISOString() : null
    this.addEvent(quoteId, 'email_demo_sent', { templateType })
    this.touch(quote)
    this.persist()
    return {
      ok: true,
      status: 'demo_sent',
      message: 'Demo email recorded. No real email was sent — this is demo mode.',
    }
  }

  // ---- Public (anonymous) surface -----------------------------------------

  private quoteByToken(publicToken: string): Quote | null {
    return this.db.quotes.find((q) => q.publicToken === publicToken) ?? null
  }

  async getPublicQuote(publicToken: string): Promise<PublicQuote | null> {
    const quote = this.quoteByToken(publicToken)
    if (!quote || quote.status === 'draft') return null
    const customer = this.customerFor(quote)
    const shop = this.db.shop
    // Sanitized: no last name, phone, email, notes, or internal metadata.
    return {
      shopName: shop.name,
      shopLogoUrl: shop.logoUrl,
      shopPhone: shop.phone,
      shopEmail: shop.email,
      shopAddress: shop.address,
      shopPrimaryColor: shop.primaryColor,
      quoteDisclaimer: shop.quoteDisclaimer,
      customerFirstName: customer.firstName,
      vehicle: {
        year: customer.vehicleYear,
        make: customer.vehicleMake,
        model: customer.vehicleModel,
        trim: customer.vehicleTrim,
      },
      windowTint: quote.windowTint,
      status: quote.status,
      expirationDate: quote.expirationDate,
      optedOut: customer.emailOptOutAt !== null,
      options: this.db.options
        .filter((o) => o.quoteId === quote.id)
        .sort((a, b) => a.position - b.position)
        .map((o) => ({
          id: o.id,
          tier: o.tier,
          name: o.name,
          description: o.description,
          priceCents: o.priceCents,
          laborIncluded: o.laborIncluded,
          depositPaymentMethod: o.depositPaymentMethod,
          depositPaymentHandle: o.depositPaymentHandle,
          depositAmountCents: o.depositAmountCents,
          recommended: o.recommended,
          items: o.items.map((i) => ({
            brand: i.brand,
            model: i.model,
            name: i.name,
            quantity: i.quantity,
            description: i.description,
          })),
        })),
    }
  }

  async recordPublicView(publicToken: string): Promise<void> {
    const quote = this.quoteByToken(publicToken)
    if (!quote || quote.status === 'draft') return
    this.addEvent(quote.id, 'quote_viewed', {}, null)
    quote.status = advanceStatus(quote.status, 'viewed')
    this.touch(quote)
    this.persist()
  }

  async submitPublicResponse(
    publicToken: string,
    responseType: ResponseType,
    optionId: string | null,
    message: string | null,
  ): Promise<void> {
    const quote = this.quoteByToken(publicToken)
    if (!quote) throw new Error('Quote not found')
    if (!VALID_RESPONSE_TYPES.includes(responseType)) throw new Error('Invalid response')
    if (responseType === 'stop_emails') {
      await this.optOutPublicQuote(publicToken)
      return
    }
    this.db.responses.push({
      id: newId(),
      quoteId: quote.id,
      quoteOptionId: optionId,
      responseType,
      message: message ? message.slice(0, 500) : null,
      createdAt: new Date().toISOString(),
    })
    this.addEvent(quote.id, 'customer_responded', { responseType }, null)
    quote.status = advanceStatus(quote.status, 'responded')
    this.touch(quote)
    this.persist()
  }

  async optOutPublicQuote(publicToken: string): Promise<void> {
    const quote = this.quoteByToken(publicToken)
    if (!quote) return
    const customer = this.customerFor(quote)
    customer.emailOptOutAt = new Date().toISOString()
    customer.updatedAt = customer.emailOptOutAt
    quote.emailFollowUpAllowed = false
    quote.nextFollowUpAt = null
    this.addEvent(quote.id, 'email_opt_out', {}, null)
    this.touch(quote)
    this.persist()
  }
}
