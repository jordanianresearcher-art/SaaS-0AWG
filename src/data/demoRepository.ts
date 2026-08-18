import type {
  Appointment,
  Bay,
  BusinessHoursDay,
  CatalogItem,
  Customer,
  Employee,
  Invoice,
  InventoryDevice,
  InvoicePaymentMethod,
  PackageTemplate,
  ProductApprovalStatus,
  PublicQuote,
  Quote,
  QuoteBundle,
  QuoteEvent,
  QuoteEventType,
  QuoteOption,
  QuoteStatus,
  ResponseType,
  ScheduleException,
  Service,
  Shop,
  StockMovement,
  TemplateType,
} from '../types'
import type {
  DataRepository,
  NewAppointmentInput,
  NewCatalogItemInput,
  NewInvoiceInput,
  NewPackageTemplateInput,
  NewQuoteInput,
  NewServiceInput,
  NewStockMovementInput,
  ProductResolutionCandidate,
  ProductResolveRequest,
  ProductResolveResult,
  ProductSuggestion,
  SendEmailResult,
  ShopifyImportResult,
  ShopSettingsPatch,
  UpcLookupResult,
} from './repository'
import { buildDemoData, DEMO_SEED_VERSION, type DemoDB } from './demoData'
import { advanceStatus, applyStaffStatus, VALID_RESPONSE_TYPES } from '../lib/status'
import { checkSendEligibility } from '../lib/eligibility'
import { nextFollowUpDateAfterSend } from '../lib/followUp'
import { computeInvoiceTotals } from '../lib/invoicePricing'
import { buildSkuBase, nextAvailableSku } from '../lib/sku'
import { newId } from '../lib/ids'

const STORAGE_KEY = '0gauge-demo-db'

// A fixed, never-real barcode used purely so demo mode and Playwright smoke
// tests can exercise the "unknown barcode -> resolver finds candidates" UI
// deterministically, with zero network calls. Any other unrecognized code
// genuinely resolves to no candidates, same as a real unresolvable scan.
export const DEMO_UNRESOLVED_BARCODE = '999999999999'

const DEMO_RESOLVED_CANDIDATES: ProductResolutionCandidate[] = [
  {
    id: 'demo-candidate-1',
    source: 'verified_web_source',
    brand: 'DS18',
    model: 'PRO-X8.4',
    name: 'PRO-X8.4 4-Channel Amplifier',
    categoryHint: 'car audio amplifiers',
    upc: DEMO_UNRESOLVED_BARCODE,
    imageUrl: null,
    referencePriceCents: 24999,
    priceKind: 'msrp',
    priceSourceUrl: 'https://example.com/demo/ds18-pro-x84',
    priceSourceName: 'Demo source',
    confidence: 0.72,
    confidenceLevel: 'probable',
    evidence: ['Demo data — simulates a resolved barcode match for testing.'],
    warnings: [],
  },
  {
    id: 'demo-candidate-2',
    source: 'ai_extracted',
    brand: 'DS18',
    model: 'PRO-X4.2K',
    name: 'PRO-X4.2K 4-Channel Amplifier (compact)',
    categoryHint: 'car audio amplifiers',
    upc: DEMO_UNRESOLVED_BARCODE,
    imageUrl: null,
    referencePriceCents: 19999,
    priceKind: 'retail',
    priceSourceUrl: 'https://example.com/demo/ds18-pro-x42k',
    priceSourceName: 'Demo source',
    confidence: 0.31,
    confidenceLevel: 'low',
    evidence: ['Demo data — a lower-confidence second guess.'],
    warnings: ["This barcode wasn't directly confirmed by a source — verify it matches before relying on this match."],
  },
]

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
      upcIsGenerated: input.upcIsGenerated ?? false,
      labelPrintedAt: null,
      lowStockThreshold: input.lowStockThreshold ?? null,
      lastCountedAt: null,
      lowStockAlerted: false,
      lowStockAlertedAt: null,
      shopifyProductId: null,
      shopifyVariantId: null,
      shopifySyncedAt: null,
      shopifySyncError: null,
      shopifyMatchedExisting: false,
      shopifyStatus: 'active',
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
    if (input.lowStockThreshold !== undefined) item.lowStockThreshold = input.lowStockThreshold
    if (input.upcIsGenerated !== undefined) item.upcIsGenerated = input.upcIsGenerated
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

  async markCounted(catalogItemId: string, newQuantity: number): Promise<{ catalogItem: CatalogItem; movement: StockMovement | null }> {
    const item = this.db.catalogItems.find((i) => i.id === catalogItemId)
    if (!item) throw new Error('Catalog item not found')

    let movement: StockMovement | null = null
    if (newQuantity !== item.quantityOnHand) {
      const result = await this.recordStockMovement({
        catalogItemId,
        movementType: 'adjustment',
        quantityDelta: newQuantity - item.quantityOnHand,
        note: 'Spot count adjustment',
      })
      movement = result.movement
    }
    item.lastCountedAt = new Date().toISOString()
    item.updatedAt = item.lastCountedAt
    this.persist()
    return { catalogItem: item, movement }
  }

  async uploadProductPhoto(base64Jpeg: string): Promise<string> {
    // No network call, ever (same rule as runShopifyImport/lookupProductByUpc)
    // — a data: URI is a real, persistable image (survives a reload via
    // localStorage), unlike an object URL, which would break on reload.
    return `data:image/jpeg;base64,${base64Jpeg}`
  }

  async generateSku(brand: string | null, model: string): Promise<string> {
    const base = buildSkuBase(brand, model)
    const taken = new Set(
      this.db.catalogItems.flatMap((i) => [i.upc, i.sku].filter((v): v is string => v !== null && v.startsWith(base))),
    )
    return nextAvailableSku(base, taken)
  }

  async findCatalogItemByCode(code: string): Promise<CatalogItem | null> {
    const trimmed = code.trim()
    if (!trimmed) return null
    return this.db.catalogItems.find((i) => i.upc === trimmed || i.sku === trimmed) ?? null
  }

  // Takes no options parameter on purpose (TypeScript allows a narrower
  // implementation than the interface): `fast` and `brandHint` only shape a
  // real network lookup, and demo mode never makes one.
  async lookupProductByUpc(code: string): Promise<UpcLookupResult> {
    // Demo mode must never make a real external call (same rule as
    // runShopifyImport) — a local miss falls through to the same
    // deterministic resolveProduct() simulation ScanWorkspacePage's own
    // fallback used to call separately, just returned here directly so
    // demo mode matches production's single-round-trip shape (see
    // UpcLookupResult's 'candidates' case).
    const item = await this.findCatalogItemByCode(code)
    if (item) return { source: 'catalog', catalogItem: item }
    const result = await this.resolveProduct({ kind: 'barcode', code })
    if (result.candidates.length > 0) {
      return { source: 'candidates', candidates: result.candidates, retainedInput: result.retainedInput }
    }
    return { source: 'not_found' }
  }

  async lookupProductSuggestions(query: string): Promise<ProductSuggestion[]> {
    const result = await this.resolveProduct({ kind: 'text', query })
    return result.candidates.map((c) => ({
      name: c.name,
      brand: c.brand,
      model: c.model,
      unitPriceCents: c.referencePriceCents,
      imageUrl: c.imageUrl,
      sourceUrl: c.priceSourceUrl,
    }))
  }

  async resolveProduct(request: ProductResolveRequest): Promise<ProductResolveResult> {
    // Demo mode must never make a real AI/web-search call. Free-text
    // queries always resolve to no candidates (same as before this
    // resolver existed — there's no meaningful local fallback for
    // autocomplete). Barcodes simulate two honest, deterministic outcomes
    // so the "never dead-end" scanner UI is exercisable without a network:
    // one fixed "known unknown" code returns a couple of plausible-looking
    // candidates, and everything else genuinely resolves to nothing.
    if (request.kind === 'text') {
      return { candidates: [], retainedInput: request.query.trim() }
    }
    if (request.kind === 'photo') {
      // Same rule: no real vision call in demo mode. Deterministically
      // "succeeds" with the same canned candidates as the fixed unresolved
      // barcode, purely so the photo-lookup confirmation UI is exercisable
      // in demo/Playwright without a camera or network access.
      return { candidates: DEMO_RESOLVED_CANDIDATES, retainedInput: 'photo' }
    }
    const code = request.code.trim()
    if (code === DEMO_UNRESOLVED_BARCODE) {
      return { candidates: DEMO_RESOLVED_CANDIDATES, retainedInput: code }
    }
    return { candidates: [], retainedInput: code }
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
    const totals = computeInvoiceTotals(input.items, input.taxRate ?? 0, input.discountCents ?? 0)
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
      subtotalCents: totals.subtotalCents,
      totalCents: totals.totalCents,
      notes: input.notes ?? null,
      taxRate: input.taxRate ?? 0,
      taxCents: totals.taxCents,
      discountCents: totals.discountCents,
      customerName: input.customerName ?? null,
      customerPhone: input.customerPhone ?? null,
      customerEmail: input.customerEmail ?? null,
      customerAddress: input.customerAddress ?? null,
      vehicleYear: input.vehicleYear ?? null,
      vehicleMake: input.vehicleMake ?? null,
      vehicleModel: input.vehicleModel ?? null,
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
        discountPercent: item.discountPercent ?? 0,
        taxable: item.taxable ?? true,
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
      showFullAddonTotal: input.quote.showFullAddonTotal ?? false,
      createdAt: now,
      updatedAt: now,
    }
    this.db.customers.push(customer)
    this.db.quotes.push(quote)
    this.db.options.push(...this.buildOptions(quote.id, input.options))
    this.addEvent(quote.id, 'created')
    this.persist()
    return quote
  }

  /** Builds this quote's option rows from form input. Shared by createQuote and updateQuote so the two paths can't drift. */
  private buildOptions(quoteId: string, options: NewQuoteInput['options']): QuoteOption[] {
    return options.map((opt, i) => {
      const optionId = newId()
      return {
        id: optionId,
        quoteId,
        optionKind: opt.optionKind,
        name: opt.name,
        description: opt.description,
        configId: opt.configId ?? null,
        priceCents: opt.priceCents,
        laborIncluded: opt.laborIncluded,
        depositPaymentMethod: opt.depositPaymentMethod,
        depositPaymentHandle: opt.depositPaymentHandle,
        depositAmountCents: opt.depositAmountCents,
        position: i,
        items: opt.items.map((item, j) => ({
          id: newId(),
          quoteOptionId: optionId,
          ...item,
          category: item.category ?? null,
          imageUrl: item.imageUrl ?? null,
          position: j,
        })),
      }
    })
  }

  async updateQuote(quoteId: string, input: NewQuoteInput): Promise<Quote> {
    const quote = this.db.quotes.find((q) => q.id === quoteId)
    if (!quote) throw new Error('Quote not found')
    const now = new Date().toISOString()

    const customer = this.db.customers.find((c) => c.id === quote.customerId)
    if (customer) {
      Object.assign(customer, input.customer, {
        // Only stamp on the transition into confirmed — re-saving an
        // already-confirmed customer must not keep moving the timestamp.
        emailContactPermissionConfirmedAt: input.customer.emailContactPermissionConfirmed
          ? (customer.emailContactPermissionConfirmedAt ?? now)
          : null,
        updatedAt: now,
      })
    }

    // status / publicToken / lastEmailedAt deliberately untouched — editing
    // what a quote says must not reset its lifecycle or invalidate a link
    // already sitting in a customer's inbox.
    quote.internalNotes = input.quote.internalNotes
    quote.expirationDate = input.quote.expirationDate
    quote.nextFollowUpAt = input.quote.nextFollowUpAt
    quote.windowTints = input.quote.windowTints
    quote.showFullAddonTotal = input.quote.showFullAddonTotal ?? false
    quote.updatedAt = now

    // Full replace, matching SupabaseRepository's delete-and-reinsert.
    this.db.options = this.db.options.filter((o) => o.quoteId !== quoteId)
    this.db.options.push(...this.buildOptions(quoteId, input.options))

    this.addEvent(quoteId, 'edited')
    this.persist()
    return quote
  }

  async deleteQuote(quoteId: string): Promise<void> {
    // Mirrors the production on-delete-cascade by hand: every child row
    // keyed to this quote goes with it. Items need no pass of their own —
    // they live nested inside their option rows in this in-memory shape.
    this.db.options = this.db.options.filter((o) => o.quoteId !== quoteId)
    this.db.events = this.db.events.filter((e) => e.quoteId !== quoteId)
    this.db.responses = this.db.responses.filter((r) => r.quoteId !== quoteId)
    this.db.emails = this.db.emails.filter((e) => e.quoteId !== quoteId)
    this.db.quotes = this.db.quotes.filter((q) => q.id !== quoteId)
    this.persist()
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

  async setShowFullAddonTotal(quoteId: string, show: boolean): Promise<void> {
    const quote = this.quoteById(quoteId)
    quote.showFullAddonTotal = show
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
      // A real (not deterministic) token, matching production's shape —
      // lets a demo/Playwright test grab it from the created row and
      // simulate visiting the actual delivered link with ?d=<token>.
      deliveryToken: newId(),
      firstViewedAt: null,
      viewCount: 0,
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
      financingOffers: shop.financingOffers,
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
      showFullAddonTotal: quote.showFullAddonTotal,
      options: this.db.options
        .filter((o) => o.quoteId === quote.id)
        .sort((a, b) => (a.optionKind === 'main' ? 0 : 1) - (b.optionKind === 'main' ? 0 : 1) || a.position - b.position)
        .map((o) => ({
          id: o.id,
          optionKind: o.optionKind,
          name: o.name,
          description: o.description,
          priceCents: o.priceCents,
          laborIncluded: o.laborIncluded,
          depositPaymentMethod: o.depositPaymentMethod,
          depositPaymentHandle: o.depositPaymentHandle,
          depositAmountCents: o.depositAmountCents,
          items: o.items.map((i) => ({
            brand: i.brand,
            model: i.model,
            name: i.name,
            quantity: i.quantity,
            description: i.description,
            imageUrl: i.imageUrl,
          })),
        })),
    }
  }

  async recordPublicView(publicToken: string, deliveryToken: string | null): Promise<void> {
    // Mirrors record_quote_delivery_view's trust rule: only a real,
    // matching delivery token (from an actually-sent email) can ever
    // record a view or advance status. The bare public link staff use for
    // "Open quote"/"Copy link" carries no token — nothing to look up, so
    // this is a no-op, same as a staff preview should be.
    if (!deliveryToken) return
    const quote = this.quoteByToken(publicToken)
    if (!quote || quote.status === 'draft') return
    const email = this.db.emails.find(
      (e) => e.quoteId === quote.id && e.deliveryToken === deliveryToken && (e.status === 'sent' || e.status === 'demo_sent'),
    )
    if (!email) return

    if (!email.firstViewedAt) {
      const now = new Date().toISOString()
      email.firstViewedAt = now
      email.viewCount += 1
      this.addEvent(quote.id, 'quote_viewed', { source: 'email_delivery' }, null)
      quote.status = advanceStatus(quote.status, 'viewed')
      this.touch(quote)
    } else {
      email.viewCount += 1
    }
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

  async rotateStaffAccessCode(): Promise<string> {
    // Demo-only plaintext, regenerated each call — real production rotation
    // (see migration 0017's rotate_staff_access_code) never stores or
    // returns the code again after this point; demo mode has no real
    // security boundary to protect, so a fixed prefix is fine here.
    const code = `DEMO-${Math.floor(1000 + Math.random() * 9000)}`
    this.db.staffAccessCode = code
    this.db.shop.hasStaffAccessCode = true
    this.db.inventoryDevices = []
    this.persist()
    return code
  }

  async listInventoryDevices(): Promise<InventoryDevice[]> {
    return this.db.inventoryDevices.slice().sort((a, b) => b.joinedAt.localeCompare(a.joinedAt))
  }

  async revokeInventoryDevice(membershipId: string): Promise<void> {
    this.db.inventoryDevices = this.db.inventoryDevices.filter((d) => d.id !== membershipId)
    this.persist()
  }

  // -------------------------------------------------------------------
  // Booking (staff side) — see migration 0021_booking_core.sql for the
  // production shape this mirrors.
  // -------------------------------------------------------------------

  async listServices(): Promise<Service[]> {
    return this.db.services.slice().sort((a, b) => a.position - b.position)
  }

  async saveService(serviceId: string | null, input: NewServiceInput): Promise<Service> {
    if (serviceId) {
      const existing = this.db.services.find((s) => s.id === serviceId)
      if (!existing) throw new Error('Service not found')
      Object.assign(existing, { ...input })
      this.persist()
      return existing
    }
    const service: Service = {
      id: newId(),
      shopId: this.db.shop.id,
      active: true,
      position: this.db.services.length,
      ...input,
    }
    this.db.services.push(service)
    this.persist()
    return service
  }

  async deleteService(serviceId: string): Promise<void> {
    this.db.services = this.db.services.filter((s) => s.id !== serviceId)
    this.persist()
  }

  async listBays(): Promise<Bay[]> {
    return this.db.bays.slice().sort((a, b) => a.position - b.position)
  }

  async saveBay(bayId: string | null, name: string): Promise<Bay> {
    if (bayId) {
      const existing = this.db.bays.find((b) => b.id === bayId)
      if (!existing) throw new Error('Bay not found')
      existing.name = name
      this.persist()
      return existing
    }
    const bay: Bay = { id: newId(), shopId: this.db.shop.id, name, active: true, position: this.db.bays.length }
    this.db.bays.push(bay)
    this.persist()
    return bay
  }

  async deleteBay(bayId: string): Promise<void> {
    this.db.bays = this.db.bays.filter((b) => b.id !== bayId)
    this.persist()
  }

  async listBusinessHours(): Promise<BusinessHoursDay[]> {
    return this.db.businessHours.slice().sort((a, b) => a.dayOfWeek - b.dayOfWeek)
  }

  async saveBusinessHours(hours: BusinessHoursDay[]): Promise<BusinessHoursDay[]> {
    this.db.businessHours = hours.map((h) => ({ ...h }))
    this.persist()
    return this.listBusinessHours()
  }

  async listScheduleExceptions(): Promise<ScheduleException[]> {
    return this.db.scheduleExceptions.slice().sort((a, b) => a.date.localeCompare(b.date))
  }

  async saveScheduleException(
    exceptionId: string | null,
    ex: Omit<ScheduleException, 'id' | 'shopId'>,
  ): Promise<ScheduleException> {
    if (exceptionId) {
      const existing = this.db.scheduleExceptions.find((e) => e.id === exceptionId)
      if (!existing) throw new Error('Schedule exception not found')
      Object.assign(existing, ex)
      this.persist()
      return existing
    }
    const created: ScheduleException = { id: newId(), shopId: this.db.shop.id, ...ex }
    this.db.scheduleExceptions.push(created)
    this.persist()
    return created
  }

  async deleteScheduleException(exceptionId: string): Promise<void> {
    this.db.scheduleExceptions = this.db.scheduleExceptions.filter((e) => e.id !== exceptionId)
    this.persist()
  }

  async listAppointments(rangeStart: string, rangeEnd: string): Promise<Appointment[]> {
    return this.db.appointments
      .filter((a) => a.startsAt >= rangeStart && a.startsAt < rangeEnd)
      .slice()
      .sort((a, b) => a.startsAt.localeCompare(b.startsAt))
  }

  async createAppointment(input: NewAppointmentInput): Promise<Appointment> {
    let customerId = input.customerId
    if (!customerId) {
      if (!input.customerFirstName) throw new Error('Name is required')
      const customer: Customer = {
        id: newId(),
        shopId: this.db.shop.id,
        firstName: input.customerFirstName,
        lastName: input.customerLastName ?? null,
        // Customer.email is non-nullable app-wide (quotes always need one to
        // send to) — booking's own validation allows phone-only, so this
        // follows the same "empty string, not null" convention as everywhere
        // else a customer might not have an email on file.
        email: input.customerEmail ?? '',
        phone: input.customerPhone ?? null,
        vehicleYear: null,
        vehicleMake: null,
        vehicleModel: null,
        vehicleTrim: null,
        source: 'staff_booking',
        emailContactPermissionConfirmed: false,
        emailContactPermissionConfirmedAt: null,
        emailOptOutAt: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }
      this.db.customers.push(customer)
      customerId = customer.id
    }

    const totalMinutes = input.services.reduce((sum, s) => sum + s.durationMinutes, 0)
    const startsAt = new Date(input.startsAt)
    const endsAtIso = new Date(startsAt.getTime() + totalMinutes * 60_000).toISOString()

    // Same guarantee the production exclusion constraint provides — demo
    // mode must never silently double-book either, or the calendar demo
    // teaches the wrong lesson.
    const conflict = this.db.appointments.some(
      (a) =>
        a.bayId === input.bayId &&
        a.status !== 'cancelled' &&
        input.startsAt < a.endsAt &&
        endsAtIso > a.startsAt,
    )
    if (conflict) throw new Error('That bay is already booked for part of this time.')

    const appointment: Appointment = {
      id: newId(),
      shopId: this.db.shop.id,
      bayId: input.bayId,
      customerId,
      source: input.source,
      status: 'confirmed',
      startsAt: input.startsAt,
      endsAt: endsAtIso,
      bodyStyle: input.bodyStyle,
      notes: input.notes,
      publicToken: newId(),
      sourceQuoteId: input.sourceQuoteId ?? null,
      depositAmountCents: null,
      depositPaidAt: null,
      reminderSentAt: null,
      cancelledAt: null,
      services: input.services.map((s) => ({ serviceId: s.serviceId, name: s.name, durationMinutes: s.durationMinutes, priceCents: s.priceCents })),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }
    this.db.appointments.push(appointment)
    this.persist()
    return appointment
  }

  async setAppointmentStatus(appointmentId: string, status: Appointment['status']): Promise<void> {
    const appt = this.db.appointments.find((a) => a.id === appointmentId)
    if (!appt) return
    appt.status = status
    if (status === 'cancelled') appt.cancelledAt = new Date().toISOString()
    appt.updatedAt = new Date().toISOString()
    this.persist()
  }

  async markAppointmentReminderSent(appointmentId: string): Promise<void> {
    const appt = this.db.appointments.find((a) => a.id === appointmentId)
    if (!appt) return
    appt.reminderSentAt = new Date().toISOString()
    this.persist()
  }

  // -------------------------------------------------------------------
  // Anonymous booking surface — not part of DataRepository (same as
  // getPublicQuote/submitPublicResponse aren't authenticated-only either),
  // called directly by src/data/publicBooking.ts the way publicQuote.ts
  // calls the public-quote equivalents. Demo mode has exactly one shop, so
  // "resolve by slug" degenerates to "is this that shop's slug".
  //
  // Not production-equivalent on one point, by design: this never checks
  // real availability the way migration 0021's book_appointment RPC does
  // (business hours, exceptions, the exclusion constraint) — the demo
  // booking wizard's own client-side availableSlotsForDay call is what
  // keeps a demo user from picking a bad time in the first place, so this
  // only needs to guard against the same-bay-overlap case a stale demo
  // session could still hit.
  // -------------------------------------------------------------------

  async getPublicBookingPage(shopSlug: string): Promise<import('../types').PublicBookingPage | null> {
    // Shop.active isn't exposed on the client type (only checked server-side
    // in production, e.g. send-quote-email) — demo mode has no way to
    // deactivate its one shop anyway, so slug match alone is the right check here.
    if (this.db.shop.slug !== shopSlug) return null
    return {
      shopId: this.db.shop.id,
      shopName: this.db.shop.name,
      shopPhone: this.db.shop.phone,
      shopAddress: this.db.shop.address,
      shopPrimaryColor: this.db.shop.primaryColor,
      bookingDepositCents: this.db.shop.bookingDepositCents,
      services: this.db.services.filter((s) => s.active),
      bayIds: this.db.bays.filter((b) => b.active).map((b) => b.id),
      businessHours: this.db.businessHours,
      scheduleExceptions: this.db.scheduleExceptions,
      busyBlocks: this.db.appointments
        .filter((a) => a.status !== 'cancelled')
        .map((a) => ({ bayId: a.bayId, startsAt: a.startsAt, endsAt: a.endsAt })),
    }
  }

  async bookAppointmentPublic(
    shopSlug: string,
    input: {
      serviceIds: string[]
      startsAt: string
      bodyStyle: string | null
      customerFirstName: string
      customerLastName: string | null
      customerEmail: string | null
      customerPhone: string | null
      sourceQuotePublicToken: string | null
      notes: string | null
    },
  ): Promise<{ publicToken: string; status: 'confirmed' | 'awaiting_deposit' }> {
    if (this.db.shop.slug !== shopSlug) throw new Error('Shop not found')

    const services = this.db.services.filter((s) => input.serviceIds.includes(s.id) && s.active)
    if (services.length === 0) throw new Error('No bookable services matched')
    const totalMinutes = services.reduce((sum, s) => {
      const override = s.durationOverrides.find((o) => o.bodyStyle === input.bodyStyle)
      return sum + (override?.durationMinutes ?? s.durationMinutes)
    }, 0)
    const endsAt = new Date(new Date(input.startsAt).getTime() + totalMinutes * 60_000).toISOString()

    let customerId: string
    let sourceQuoteId: string | null = null
    if (input.sourceQuotePublicToken) {
      const quote = this.quoteByToken(input.sourceQuotePublicToken)
      if (!quote) throw new Error('Quote not found')
      customerId = quote.customerId
      sourceQuoteId = quote.id
    } else {
      if (!input.customerFirstName.trim()) throw new Error('Name is required')
      if (!input.customerEmail?.trim() && !input.customerPhone?.trim()) {
        throw new Error('An email or phone number is required')
      }
      const customer: Customer = {
        id: newId(),
        shopId: this.db.shop.id,
        firstName: input.customerFirstName,
        lastName: input.customerLastName,
        email: input.customerEmail ?? '',
        phone: input.customerPhone,
        vehicleYear: null,
        vehicleMake: null,
        vehicleModel: null,
        vehicleTrim: null,
        source: 'self_serve_booking',
        emailContactPermissionConfirmed: false,
        emailContactPermissionConfirmedAt: null,
        emailOptOutAt: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }
      this.db.customers.push(customer)
      customerId = customer.id
    }

    const availableBay = this.db.bays.find(
      (b) =>
        b.active &&
        !this.db.appointments.some(
          (a) => a.bayId === b.id && a.status !== 'cancelled' && input.startsAt < a.endsAt && endsAt > a.startsAt,
        ),
    )
    if (!availableBay) throw new Error('That time was just booked by someone else. Please pick another.')

    const status: 'confirmed' | 'awaiting_deposit' =
      this.db.shop.bookingDepositCents && this.db.shop.bookingDepositCents > 0 ? 'awaiting_deposit' : 'confirmed'

    const appointment: Appointment = {
      id: newId(),
      shopId: this.db.shop.id,
      bayId: availableBay.id,
      customerId,
      source: sourceQuoteId ? 'from_quote' : 'self_serve',
      status,
      startsAt: input.startsAt,
      endsAt,
      bodyStyle: input.bodyStyle as Appointment['bodyStyle'],
      notes: input.notes,
      publicToken: newId(),
      sourceQuoteId,
      depositAmountCents: status === 'awaiting_deposit' ? this.db.shop.bookingDepositCents : null,
      depositPaidAt: null,
      reminderSentAt: null,
      cancelledAt: null,
      services: services.map((s) => {
        const override = s.durationOverrides.find((o) => o.bodyStyle === input.bodyStyle)
        return { serviceId: s.id, name: s.name, durationMinutes: override?.durationMinutes ?? s.durationMinutes, priceCents: s.priceCents }
      }),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }
    this.db.appointments.push(appointment)
    this.persist()
    return { publicToken: appointment.publicToken, status }
  }

  async getPublicAppointment(publicToken: string): Promise<import('../types').PublicAppointment | null> {
    const appt = this.db.appointments.find((a) => a.publicToken === publicToken)
    if (!appt) return null
    const customer = this.db.customers.find((c) => c.id === appt.customerId)
    return {
      publicToken: appt.publicToken,
      status: appt.status,
      startsAt: appt.startsAt,
      endsAt: appt.endsAt,
      customerFirstName: customer?.firstName ?? '',
      shopName: this.db.shop.name,
      shopPhone: this.db.shop.phone,
      shopAddress: this.db.shop.address,
      shopPrimaryColor: this.db.shop.primaryColor,
      depositAmountCents: appt.depositAmountCents,
      depositPaidAt: appt.depositPaidAt,
      services: appt.services.map((s) => ({ name: s.name, durationMinutes: s.durationMinutes })),
    }
  }

  async cancelAppointmentPublic(publicToken: string): Promise<void> {
    const appt = this.db.appointments.find((a) => a.publicToken === publicToken)
    if (!appt || appt.status === 'cancelled' || appt.status === 'completed') {
      throw new Error('Appointment not found or already cancelled')
    }
    appt.status = 'cancelled'
    appt.cancelledAt = new Date().toISOString()
    appt.updatedAt = new Date().toISOString()
    this.persist()
  }

  /** Demo-only stand-in for the real Stripe flow (Phase 4) — flips a deposit to paid instantly with no payment. */
  async fakeDepositPaidPublic(publicToken: string): Promise<void> {
    const appt = this.db.appointments.find((a) => a.publicToken === publicToken)
    if (!appt) return
    appt.depositPaidAt = new Date().toISOString()
    appt.status = 'confirmed'
    appt.updatedAt = new Date().toISOString()
    this.persist()
  }
}
