import type {
  CatalogItem,
  Customer,
  EmailMessage,
  Employee,
  ImportSource,
  Invoice,
  InvoicePaymentMethod,
  PackageTemplate,
  PackageTemplateSource,
  PaymentMethod,
  PriceKind,
  ProductApprovalStatus,
  ProductAvailability,
  ProductCategory,
  PublicQuote,
  Quote,
  QuoteBundle,
  QuoteEvent,
  QuoteOption,
  QuoteResponse,
  QuoteStatus,
  ResponseType,
  Shop,
  StockMovement,
  StockMovementType,
  TemplateType,
  Tier,
  VehicleType,
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
    /** Which universal configuration (e.g. 'truck_2x8') this was built against, if any. Optional — the fast/visual builder that sets this is a later phase. */
    configId?: string | null
    items: Array<{
      brand: string | null
      model: string | null
      name: string
      quantity: number
      description: string | null
      /** Optional — lets this item fill a configuration slot (see src/lib/audioConfigs.ts). */
      category?: ProductCategory | null
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
  // Everything below is optional — the manual "Product Catalog" settings
  // form only ever sets the fields above. These exist so a future importer
  // (Shopify, AI photo onboarding — both deferred, see
  // docs/CATALOG_AND_PACKAGES.md) can populate a full product record through
  // this same interface, rather than a parallel one.
  category?: ProductCategory | null
  description?: string | null
  sku?: string | null
  upc?: string | null
  msrpCents?: number | null
  promoPriceCents?: number | null
  minStaffPriceCents?: number | null
  costCents?: number | null
  priceSourceUrl?: string | null
  priceSourceName?: string | null
  priceKind?: PriceKind | null
  imageUrl?: string | null
  imageSourceUrl?: string | null
  sourceUrl?: string | null
  specs?: Record<string, unknown> | null
  active?: boolean
  availability?: ProductAvailability
  importSource?: ImportSource
  externalSourceProductId?: string | null
  identificationConfidence?: number | null
  approvalStatus?: ProductApprovalStatus
}

export interface NewPackageTemplateInput {
  name: string
  description: string
  configId: string | null
  vehicleTypes: VehicleType[]
  installedPriceCents: number | null
  laborIncluded: boolean
  source: PackageTemplateSource
  /** Omit to default to 'pending_review' — only an owner/manager can save one already-approved. */
  approvalStatus?: ProductApprovalStatus
  sourceQuoteId?: string | null
  sourceQuoteOptionId?: string | null
  items: Array<{
    brand: string | null
    model: string | null
    name: string
    quantity: number
    description: string | null
    category: ProductCategory | null
    imageUrl: string | null
  }>
}

/**
 * Records one stock-quantity change (a scan-to-invoice sale, a vendor
 * receipt, an outgoing order, or a manual adjustment) — see StockMovement.
 * This is the only way quantityOnHand on a catalog item changes; both repo
 * implementations must update it atomically alongside the ledger row (in
 * production, via the apply_stock_movement RPC — see migration 0011).
 */
export interface NewStockMovementInput {
  catalogItemId: string
  movementType: StockMovementType
  /** Signed: positive for receiving/adjustment-up, negative for sale/outgoing_order. */
  quantityDelta: number
  unitCostCents?: number | null
  /** Vendor name (receiving) or destination shop name (outgoing_order), free text. */
  counterpartyName?: string | null
  sourceInvoiceId?: string | null
  sourceOutgoingOrderId?: string | null
  note?: string | null
}

/**
 * A single finalized, itemized sale — the scan workspace's "invoice"
 * document type. Created as 'draft'; markInvoicePaid() is what actually
 * moves stock (a 'sale' movement per line item with a catalogItemId) —
 * creating the invoice alone never touches quantityOnHand, so a draft can
 * still be freely edited or abandoned before anything's really sold.
 */
export interface NewInvoiceInput {
  customerId?: string | null
  notes?: string | null
  items: Array<{
    /** Null for a one-off/custom line item with no catalog product behind it. */
    catalogItemId: string | null
    brand: string | null
    model: string | null
    name: string
    quantity: number
    unitPriceCents: number
    category?: ProductCategory | null
  }>
}

/**
 * Result of scanning/typing a barcode: either it matches something already
 * in this shop's catalog (the common case once a shop has scanned a
 * product once before), an external UPC database has it (production only —
 * demo mode never makes the real network call), or nothing knows about it
 * (caller falls back to a photo lookup or manual entry — later phases).
 */
export type UpcLookupResult =
  | { source: 'catalog'; catalogItem: CatalogItem }
  | { source: 'external'; name: string | null; brand: string | null; unitPriceCents: number | null; imageUrl: string | null; upc: string }
  | { source: 'not_found' }

/**
 * One AI+web-search candidate for a partially-typed SKU/model/name (e.g.
 * "NA-12F") when staff are adding a new catalog product — see
 * ProductSuggestField. Deliberately loose/optional-feeling even though every
 * field is present: the model is told to prefer returning fewer results (or
 * none) over guessing, so any field can come back null.
 */
export interface ProductSuggestion {
  name: string
  brand: string | null
  model: string | null
  unitPriceCents: number | null
  imageUrl: string | null
  sourceUrl: string | null
}

// ---------------------------------------------------------------------------
// Universal product resolver — the one canonical, typed contract behind
// barcode lookup, typed search, and (later) photo lookup. See
// docs/PRODUCT_RESOLVER.md. lookupProductByUpc/lookupProductSuggestions
// above keep their existing narrower shapes for backward compatibility with
// already-shipped call sites (ScanWorkspacePage, ProductSuggestField) — both
// now delegate to resolveProduct() underneath rather than making their own
// separate external calls.
// ---------------------------------------------------------------------------

/** Where a resolved candidate's data actually came from — never conflated with "this shop's own catalog," which is checked locally before resolveProduct is ever called. */
export type ProductResolutionSource = 'resolution_cache' | 'verified_web_source' | 'ai_extracted'

/** Whether a reference price is MSRP, a verified retail price, or unclear — distinct from a shop's own selling price/cost, which a candidate never carries (see CatalogItem.defaultPriceCents/costCents for that). */
export type ProductPriceKind = 'msrp' | 'retail' | 'unknown'

export type ProductConfidenceLevel = 'high' | 'probable' | 'low'

/**
 * One ranked candidate identity for a scanned barcode or typed query that
 * didn't match anything already in this shop's catalog. Always a
 * *suggestion* — nothing here is written to the shop's catalog or cart
 * until staff explicitly act on it (see ScanWorkspacePage's confirmation
 * UI). referencePriceCents is a reference/market price, never a shop's own
 * confirmed selling price — the two are never overwritten by each other.
 */
export interface ProductResolutionCandidate {
  id: string
  source: ProductResolutionSource
  brand: string | null
  model: string | null
  name: string
  /** Free-text category hint (e.g. "car subwoofer") — not a raw ProductCategory value; map it with the existing guessCategoryFromName heuristic rather than trusting an AI-invented enum value. */
  categoryHint: string | null
  upc: string | null
  imageUrl: string | null
  referencePriceCents: number | null
  priceKind: ProductPriceKind
  priceSourceUrl: string | null
  priceSourceName: string | null
  /** 0-1 self-reported confidence, already discounted server-side for things like an unconfirmed barcode match. */
  confidence: number
  confidenceLevel: ProductConfidenceLevel
  /** Short human-readable reasons supporting this match. */
  evidence: string[]
  /** Things staff should double-check before trusting this candidate (e.g. "barcode not directly confirmed"). */
  warnings: string[]
}

export type ProductResolveRequest = { kind: 'barcode'; code: string } | { kind: 'text'; query: string }

export interface ProductResolveResult {
  candidates: ProductResolutionCandidate[]
  /** The original code/query, always returned — even an empty-candidates result never loses what was scanned/typed, so the caller can fall back to a custom item with it prefilled. */
  retainedInput: string
}

export interface ShopifyImportOptions {
  /** Resume a prior run — pass back the nextCursor from its result. */
  afterCursor?: string | null
  /** Let Shopify's price win even over a price a staff member edited locally since the last sync. Defaults to false (never clobber a local edit). */
  overwriteLocalPrices?: boolean
}

export interface ShopifyImportResult {
  created: number
  updated: number
  unchanged: number
  skipped: number
  failed: number
  errors: Array<{ product: string; message: string }>
  hasMore: boolean
  nextCursor: string | null
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
  /** Owner/manager only in production — imports one page of the shop's Shopify catalog. Never call in demo mode (see docs/CATALOG_AND_PACKAGES.md). */
  runShopifyImport(options?: ShopifyImportOptions): Promise<ShopifyImportResult>

  /** Records a ledger entry and atomically updates the item's quantityOnHand. Returns the updated item alongside the recorded movement. */
  recordStockMovement(input: NewStockMovementInput): Promise<{ movement: StockMovement; catalogItem: CatalogItem }>
  /** Full shop history, or just one item's, newest first. */
  listStockMovements(catalogItemId?: string): Promise<StockMovement[]>

  /** Local catalog match by UPC/SKU only — lookupProductByUpc below wraps this with an external-lookup fallback. */
  findCatalogItemByCode(code: string): Promise<CatalogItem | null>
  /** Local catalog first, then (production only) an external UPC database. A future phase adds a photo-lookup fallback for codes nothing recognizes. */
  lookupProductByUpc(code: string): Promise<UpcLookupResult>
  /** AI+web-search autocomplete for a partially-typed SKU/model/name when adding a new catalog product. Demo mode never makes a real call — always resolves []. Production degrades to [] on any failure rather than throwing, same pattern as lookupProductByUpc. Delegates to resolveProduct() underneath. */
  lookupProductSuggestions(query: string): Promise<ProductSuggestion[]>
  /**
   * The universal resolver: called when a barcode or typed query doesn't
   * match anything already in this shop's catalog. Never throws and never
   * dead-ends — an empty candidate list is a valid, safe result (caller
   * falls back to a custom/temporary item using retainedInput). Demo mode
   * never makes a real AI/web call — see DemoRepository for its
   * deterministic simulated outcomes.
   */
  resolveProduct(request: ProductResolveRequest): Promise<ProductResolveResult>

  listInvoices(): Promise<Invoice[]>
  getInvoice(invoiceId: string): Promise<Invoice | null>
  /** Always created as 'draft' — never touches stock. */
  createInvoice(input: NewInvoiceInput): Promise<Invoice>
  /** Marks paid and records one 'sale' stock movement per line item that has a catalogItemId. */
  markInvoicePaid(invoiceId: string, paymentMethod: InvoicePaymentMethod, paymentAmountCents: number): Promise<Invoice>
  /** Emails a rendered copy of the invoice (recipientEmail is typed at send time — see ScanWorkspacePage — not a persisted Customer record). Never fakes real delivery in demo mode. */
  sendInvoiceEmail(invoiceId: string, recipientEmail: string, recipientName?: string): Promise<SendEmailResult>

  listPackageTemplates(): Promise<PackageTemplate[]>
  createPackageTemplate(input: NewPackageTemplateInput): Promise<PackageTemplate>
  /** Approve/reject a pending package. Enforced owner/manager-only at the DB layer (RLS trigger) in production. */
  setPackageTemplateApproval(templateId: string, status: ProductApprovalStatus): Promise<void>
  deletePackageTemplate(templateId: string): Promise<void>

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
  /**
   * Records a real customer view — but only when deliveryToken matches the
   * specific token embedded in an actually-sent email for this quote. A
   * null deliveryToken (the bare link staff use for "Open quote"/"Copy
   * link") is always a no-op — dashboard previews must never mark a quote
   * opened. See docs/QUOTE_TRACKING.md.
   */
  recordPublicView(publicToken: string, deliveryToken: string | null): Promise<void>
  submitPublicResponse(
    publicToken: string,
    responseType: ResponseType,
    optionId: string | null,
    message: string | null,
  ): Promise<void>
  optOutPublicQuote(publicToken: string): Promise<void>
}

export type {
  Shop,
  Quote,
  QuoteBundle,
  Customer,
  QuoteOption,
  QuoteEvent,
  QuoteResponse,
  EmailMessage,
  CatalogItem,
  PackageTemplate,
  StockMovement,
  Invoice,
}
