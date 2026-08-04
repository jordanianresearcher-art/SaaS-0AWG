import type {
  CatalogItem,
  Customer,
  Employee,
  Invoice,
  InvoicePaymentMethod,
  PackageTemplate,
  ProductApprovalStatus,
  PublicQuote,
  Quote,
  QuoteBundle,
  QuoteEvent,
  QuoteEventType,
  QuoteStatus,
  ResponseType,
  Shop,
  StockMovement,
  TemplateType,
} from '../types'
import type {
  DataRepository,
  NewCatalogItemInput,
  NewInvoiceInput,
  NewPackageTemplateInput,
  NewQuoteInput,
  NewStockMovementInput,
  SendEmailResult,
  ShopifyImportResult,
  ShopSettingsPatch,
  UpcLookupResult,
} from './repository'
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
    const now = new Date().toISOString()
    const item: CatalogItem = {
      id: newId(),
      shopId: this.db.shop.id,
      brand: input.brand,
      model: input.model,
      name: input.name,
      category: input.category ?? null,
      description: input.description ?? null,
      sku: input.sku ?? null,
      upc: input.upc ?? null,
      defaultPriceCents: input.defaultPriceCents,
      msrpCents: input.msrpCents ?? null,
      promoPriceCents: input.promoPriceCents ?? null,
      minStaffPriceCents: input.minStaffPriceCents ?? null,
      costCents: input.costCents ?? null,
      priceSourceUrl: input.priceSourceUrl ?? null,
      priceSourceName: input.priceSourceName ?? null,
      priceKind: input.priceKind ?? null,
      priceCheckedAt: input.priceSourceUrl || input.priceSourceName ? now : null,
      imageUrl: input.imageUrl ?? null,
      imageSourceUrl: input.imageSourceUrl ?? null,
      sourceUrl: input.sourceUrl ?? null,
      specs: input.specs ?? null,
      active: input.active ?? true,
      availability: input.availability ?? 'not_tracked',
      importSource: input.importSource ?? 'manual',
      externalSourceProductId: input.externalSourceProductId ?? null,
      identificationConfidence: input.identificationConfidence ?? null,
      approvalStatus: input.approvalStatus ?? 'approved',
      position: this.db.catalogItems.length,
      quantityOnHand: 0,
      upcIsGenerated: false,
      labelPrintedAt: null,
      createdAt: now,
      updatedAt: now,
    }
    this.db.catalogItems.push(item)
    this.persist()
    return item
  }

  // Only sets a field when the caller actually passed it — same reasoning
  // as supabaseRepository.ts's catalogItemRow: a partial edit (e.g. from the
  // settings form, which only ever sends brand/model/name/defaultPriceCents)
  // must never clobber data it wasn't told to touch, like an imported image.
  async updateCatalogItem(itemId: string, input: NewCatalogItemInput): Promise<CatalogItem> {
    const item = this.db.catalogItems.find((i) => i.id === itemId)
    if (!item) throw new Error('Catalog item not found')
    item.brand = input.brand
    item.model = input.model
    item.name = input.name
    item.defaultPriceCents = input.defaultPriceCents
    if (input.category !== undefined) item.category = input.category
    if (input.description !== undefined) item.description = input.description
    if (input.sku !== undefined) item.sku = input.sku
    if (input.upc !== undefined) item.upc = input.upc
    if (input.msrpCents !== undefined) item.msrpCents = input.msrpCents
    if (input.promoPriceCents !== undefined) item.promoPriceCents = input.promoPriceCents
    if (input.minStaffPriceCents !== undefined) item.minStaffPriceCents = input.minStaffPriceCents
    if (input.costCents !== undefined) item.costCents = input.costCents
    if (input.priceSourceUrl !== undefined) item.priceSourceUrl = input.priceSourceUrl
    if (input.priceSourceName !== undefined) item.priceSourceName = input.priceSourceName
    if (input.priceKind !== undefined) item.priceKind = input.priceKind
    if (input.imageUrl !== undefined) item.imageUrl = input.imageUrl
    if (input.imageSourceUrl !== undefined) item.imageSourceUrl = input.imageSourceUrl
    if (input.sourceUrl !== undefined) item.sourceUrl = input.sourceUrl
    if (input.specs !== undefined) item.specs = input.specs
    if (input.active !== undefined) item.active = input.active
    if (input.availability !== undefined) item.availability = input.availability
    if (input.importSource !== undefined) item.importSource = input.importSource
    if (input.externalSourceProductId !== undefined) item.externalSourceProductId = input.externalSourceProductId
    if (input.identificationConfidence !== undefined) item.identificationConfidence = input.identificationConfidence
    if (input.approvalStatus !== undefined) item.approvalStatus = input.approvalStatus
    if (input.priceSourceUrl !== undefined || input.priceSourceName !== undefined) {
      item.priceCheckedAt = new Date().toISOString()
    }
    item.updatedAt = new Date().toISOString()
    this.persist()
    return item
  }

  async deleteCatalogItem(itemId: string): Promise<void> {
    this.db.catalogItems = this.db.catalogItems.filter((i) => i.id !== itemId)
    this.persist()
  }

  async runShopifyImport(): Promise<ShopifyImportResult> {
    // Demo mode must never make real external calls (Shopify, AI, or web
    // search) — this action only makes sense against a real Supabase
    // project with real Shopify credentials configured.
    throw new Error('Shopify import is only available in production mode.')
  }

  async recordStockMovement(input: NewStockMovementInput): Promise<{ movement: StockMovement; catalogItem: CatalogItem }> {
    const item = this.db.catalogItems.find((i) => i.id === input.catalogItemId)
    if (!item) throw new Error('Catalog item not found')

    const movement: StockMovement = {
      id: newId(),
      shopId: this.db.shop.id,
      catalogItemId: input.catalogItemId,
      movementType: input.movementType,
      quantityDelta: input.quantityDelta,
      unitCostCents: input.unitCostCents ?? null,
      counterpartyName: input.counterpartyName ?? null,
      sourceInvoiceId: input.sourceInvoiceId ?? null,
      sourceOutgoingOrderId: input.sourceOutgoingOrderId ?? null,
      note: input.note ?? null,
      createdBy: 'demo-user-owner',
      createdAt: new Date().toISOString(),
    }
    this.db.stockMovements.push(movement)
    // Same "one place updates the derived count" invariant the RPC enforces
    // in production (see apply_stock_movement in migration 0011) — nothing
    // else in this class touches quantityOnHand directly.
    item.quantityOnHand += input.quantityDelta
    item.updatedAt = new Date().toISOString()
    this.persist()
    return { movement, catalogItem: item }
  }

  async listStockMovements(catalogItemId?: string): Promise<StockMovement[]> {
    const all = catalogItemId
      ? this.db.stockMovements.filter((m) => m.catalogItemId === catalogItemId)
      : this.db.stockMovements
    // Newest first. Ties on createdAt (two movements recorded in the same
    // millisecond — easy to hit with rapid scan-to-invoice usage) break by
    // insertion order instead, since array push order is always chronological.
    return all
      .map((movement, insertionIndex) => ({ movement, insertionIndex }))
      .sort((a, b) => b.movement.createdAt.localeCompare(a.movement.createdAt) || b.insertionIndex - a.insertionIndex)
      .map(({ movement }) => movement)
  }

  async findCatalogItemByCode(code: string): Promise<CatalogItem | null> {
    const trimmed = code.trim()
    if (!trimmed) return null
    return this.db.catalogItems.find((i) => i.upc === trimmed || i.sku === trimmed) ?? null
  }

  async lookupProductByUpc(code: string): Promise<UpcLookupResult> {
    // Demo mode must never make a real external call (same rule as
    // runShopifyImport) — a local miss is just a miss here.
    const item = await this.findCatalogItemByCode(code)
    return item ? { source: 'catalog', catalogItem: item } : { source: 'not_found' }
  }

  async listInvoices(): Promise<Invoice[]> {
    return this.db.invoices.slice().sort((a, b) => b.invoiceNumber - a.invoiceNumber)
  }

  async getInvoice(invoiceId: string): Promise<Invoice | null> {
    return this.db.invoices.find((inv) => inv.id === invoiceId) ?? null
  }

  async createInvoice(input: NewInvoiceInput): Promise<Invoice> {
    const now = new Date().toISOString()
    const invoiceId = newId()
    const subtotalCents = input.items.reduce((sum, item) => sum + item.unitPriceCents * item.quantity, 0)
    const nextNumber = this.db.invoices.reduce((max, inv) => Math.max(max, inv.invoiceNumber), 0) + 1
    const invoice: Invoice = {
      id: invoiceId,
      shopId: this.db.shop.id,
      customerId: input.customerId ?? null,
      invoiceNumber: nextNumber,
      status: 'draft',
      paymentMethod: null,
      paymentAmountCents: null,
      paidAt: null,
      subtotalCents,
      totalCents: subtotalCents,
      notes: input.notes ?? null,
      createdBy: 'demo-user-owner',
      createdAt: now,
      updatedAt: now,
      items: input.items.map((item, i) => ({
        id: newId(),
        invoiceId,
        catalogItemId: item.catalogItemId,
        brand: item.brand,
        model: item.model,
        name: item.name,
        quantity: item.quantity,
        unitPriceCents: item.unitPriceCents,
        category: item.category ?? null,
        position: i,
      })),
    }
    this.db.invoices.push(invoice)
    this.persist()
    return invoice
  }

  async markInvoicePaid(invoiceId: string, paymentMethod: InvoicePaymentMethod, paymentAmountCents: number): Promise<Invoice> {
    const invoice = this.db.invoices.find((inv) => inv.id === invoiceId)
    if (!invoice) throw new Error('Invoice not found')
    if (invoice.status === 'paid') return invoice // idempotent — never double-record the stock movements below

    const now = new Date().toISOString()
    invoice.status = 'paid'
    invoice.paymentMethod = paymentMethod
    invoice.paymentAmountCents = paymentAmountCents
    invoice.paidAt = now
    invoice.updatedAt = now

    // One 'sale' movement per line item that's actually a real catalog
    // product — a custom/one-off line (catalogItemId null) has no stock to
    // decrement. Calls the same recordStockMovement this class already
    // exposes so the atomicity/bookkeeping logic lives in exactly one place.
    for (const item of invoice.items) {
      if (!item.catalogItemId) continue
      await this.recordStockMovement({
        catalogItemId: item.catalogItemId,
        movementType: 'sale',
        quantityDelta: -item.quantity,
        sourceInvoiceId: invoice.id,
      })
    }

    this.persist()
    return invoice
  }

  async sendInvoiceEmail(invoiceId: string, recipientEmail: string): Promise<SendEmailResult> {
    // Demo mode must never make a real send — same rule as sendEmail's
    // demo_sent path for quotes.
    const invoice = this.db.invoices.find((inv) => inv.id === invoiceId)
    if (!invoice) return { ok: false, status: 'failed', message: 'Invoice not found.' }
    return { ok: true, status: 'demo_sent', message: `Demo mode — would have emailed invoice #${invoice.invoiceNumber} to ${recipientEmail}.` }
  }

  async listPackageTemplates(): Promise<PackageTemplate[]> {
    return this.db.packageTemplates.slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  }

  async createPackageTemplate(input: NewPackageTemplateInput): Promise<PackageTemplate> {
    const now = new Date().toISOString()
    const templateId = newId()
    const template: PackageTemplate = {
      id: templateId,
      shopId: this.db.shop.id,
      name: input.name,
      description: input.description,
      configId: input.configId,
      vehicleTypes: input.vehicleTypes,
      installedPriceCents: input.installedPriceCents,
      laborIncluded: input.laborIncluded,
      source: input.source,
      approvalStatus: input.approvalStatus ?? 'pending_review',
      sourceQuoteId: input.sourceQuoteId ?? null,
      sourceQuoteOptionId: input.sourceQuoteOptionId ?? null,
      createdBy: 'demo-user-staff',
      createdAt: now,
      updatedAt: now,
      items: input.items.map((item, i) => ({
        id: newId(),
        packageTemplateId: templateId,
        ...item,
        position: i,
      })),
    }
    this.db.packageTemplates.push(template)
    this.persist()
    return template
  }

  async setPackageTemplateApproval(templateId: string, status: ProductApprovalStatus): Promise<void> {
    const template = this.db.packageTemplates.find((p) => p.id === templateId)
    if (!template) throw new Error('Package template not found')
    template.approvalStatus = status
    template.updatedAt = new Date().toISOString()
    this.persist()
  }

  async deletePackageTemplate(templateId: string): Promise<void> {
    this.db.packageTemplates = this.db.packageTemplates.filter((p) => p.id !== templateId)
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
      windowTints: input.quote.windowTints,
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
        configId: opt.configId ?? null,
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
          category: item.category ?? null,
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
      windowTints: quote.windowTints,
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
