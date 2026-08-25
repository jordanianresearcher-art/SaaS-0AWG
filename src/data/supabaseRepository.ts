import { FunctionsHttpError, type SupabaseClient } from '@supabase/supabase-js'
import { sanitizeFinancingOffers } from '../lib/financing'
import { canonicalizeProductFields } from '../lib/productNaming'
import { globalMatchKey, globalToCandidate, toGlobalProductDraft } from '../lib/globalCatalog'
import { classifyBarcode } from '../lib/barcodeIdentity'
import { dedupeSuggestions, searchLocalCatalog } from '../lib/productSearch'
import type {
  Appointment,
  Bay,
  BusinessHoursDay,
  CatalogItem,
  Customer,
  EmailMessage,
  Employee,
  Invoice,
  InventoryDevice,
  InvoiceItem,
  InvoicePaymentMethod,
  PackageTemplate,
  PackageTemplateItem,
  ProductApprovalStatus,
  PublicQuote,
  Quote,
  QuoteBundle,
  QuoteEvent,
  QuoteItem,
  QuoteOption,
  QuoteResponse,
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
  NewServiceInput,
  NewInvoiceInput,
  NewPackageTemplateInput,
  NewQuoteInput,
  NewStockMovementInput,
  ProductConfidenceLevel,
  ProductPriceKind,
  ProductResolutionCandidate,
  ProductResolveRequest,
  ProductResolveResult,
  GlobalProductMatch,
  ProductLookupSelfTest,
  ProductSuggestion,
  ProductSuggestionResult,
  SendEmailResult,
  ShopifyImportOptions,
  ShopifyImportResult,
  ShopSettingsPatch,
  UpcLookupResult,
} from './repository'
import { dedupeCandidates, rankCandidates } from '../lib/productResolver'
import { computeInvoiceTotals } from '../lib/invoicePricing'
import { buildSkuBase, nextAvailableSku } from '../lib/sku'
import { newId } from '../lib/ids'
import { barcodeLookupForms } from '../lib/barcodeIdentity'

// Production repository. Row-level security scopes every query to shops the
// signed-in user belongs to; the anonymous public page goes through
// SECURITY DEFINER RPCs only. Rows are snake_case — mapped here once.

/* eslint-disable @typescript-eslint/no-explicit-any -- Supabase rows are untyped without codegen; mapped at this boundary only. */
type Row = Record<string, any>

/**
 * Turn a functions.invoke() failure into something a shop owner can act on.
 *
 * supabase-js surfaces every non-2xx as the same opaque string — "Edge
 * Function returned a non-2xx status code" — and throws away the body, which
 * is where the function actually said what was wrong. FunctionsHttpError keeps
 * that body on `context` (a Response), so this reads it.
 *
 * The case worth naming explicitly is a version skew: this app deploys to the
 * CDN, the Edge Function deploys separately with `supabase functions deploy`,
 * and nothing keeps them in step. A browser running new code can call a
 * function running old code, which rejects a request it has never heard of.
 * That looks like a broken key and isn't one.
 */
/** A product every car-audio resolver should know, used only by the health check. */
const SELF_TEST_QUERY = 'Kicker CompR 12 inch subwoofer'

export async function describeFunctionError(error: unknown): Promise<string> {
  if (!(error instanceof FunctionsHttpError)) {
    return error instanceof Error ? error.message : 'The lookup function could not be reached.'
  }

  const status = error.context?.status
  if (status === 404) {
    return 'The resolve-product function is not deployed to this project. Run: supabase functions deploy resolve-product'
  }

  let serverMessage = ''
  try {
    // `context` is a Response and can only be read once — but this is the
    // only reader, and only on the failure path.
    const body = await error.context?.clone?.().json?.()
    if (typeof body?.message === 'string') serverMessage = body.message
  } catch {
    // A non-JSON body (a proxy error page, an empty 500) tells us nothing
    // beyond the status, which is still worth reporting.
  }

  // The old function validated `kind` against barcode/text/photo only, so it
  // rejects the self-test outright. Seeing this means the deployed function
  // predates the self-test, not that anything is misconfigured.
  if (status === 400 && /missing (shopid|kind)/i.test(serverMessage)) {
    return (
      'The deployed resolve-product function is older than this app and does not support the self-test yet. ' +
      'Run: supabase functions deploy resolve-product'
    )
  }

  if (status === 401) {
    return 'The lookup function rejected the sign-in for this session. Sign out and back in, then try again.'
  }

  return serverMessage
    ? `The lookup function returned ${status}: ${serverMessage}`
    : `The lookup function returned ${status ?? 'an error'}.`
}

function mapShop(r: Row): Shop {
  return {
    id: r.id,
    name: r.name,
    slug: r.slug,
    phone: r.phone ?? '',
    email: r.email ?? '',
    replyToEmail: r.reply_to_email ?? r.email ?? '',
    address: r.address ?? '',
    website: r.website,
    logoUrl: r.logo_url,
    primaryColor: r.primary_color ?? '#1d4ed8',
    defaultPaymentMethod: r.default_payment_method,
    defaultPaymentHandle: r.default_payment_handle,
    // Sanitized rather than cast: a malformed row must degrade to "not shown"
    // instead of putting a broken link in a customer's email.
    financingOffers: sanitizeFinancingOffers(r.financing_offers),
    quoteExpirationDays: r.quote_expiration_days ?? 30,
    followUpScheduleDays: r.follow_up_schedule_days ?? [2, 3, 5],
    quoteDisclaimer: r.quote_disclaimer ?? '',
    defaultLowStockThreshold: r.default_low_stock_threshold ?? 3,
    lowStockAlertEmail: r.low_stock_alert_email ?? null,
    hasStaffAccessCode: r.has_staff_access_code ?? false,
    bookingDepositCents: r.booking_deposit_cents ?? null,
    // Default true: a pilot shop should get automatic follow-ups without configuring anything.
    autoFollowUpEnabled: r.auto_follow_up_enabled ?? true,
    contributesToGlobalCatalog: r.contributes_to_global_catalog ?? true,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }
}

function mapCustomer(r: Row): Customer {
  return {
    id: r.id,
    shopId: r.shop_id,
    firstName: r.first_name,
    lastName: r.last_name,
    phone: r.phone,
    email: r.email,
    vehicleYear: r.vehicle_year,
    vehicleMake: r.vehicle_make,
    vehicleModel: r.vehicle_model,
    vehicleTrim: r.vehicle_trim,
    source: r.source,
    emailContactPermissionConfirmed: r.email_contact_permission_confirmed,
    emailContactPermissionConfirmedAt: r.email_contact_permission_confirmed_at,
    emailOptOutAt: r.email_opt_out_at,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }
}

function mapQuote(r: Row): Quote {
  return {
    id: r.id,
    shopId: r.shop_id,
    customerId: r.customer_id,
    createdBy: r.created_by,
    publicToken: r.public_token,
    status: r.status,
    internalNotes: r.internal_notes,
    expirationDate: r.expiration_date,
    lastEmailedAt: r.last_emailed_at,
    nextFollowUpAt: r.next_follow_up_at,
    emailFollowUpAllowed: r.email_follow_up_allowed,
    wonAmountCents: r.won_amount_cents,
    windowTints: Array.isArray(r.window_tints) ? r.window_tints : [],
    showFullAddonTotal: r.show_full_addon_total ?? false,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }
}

function mapItem(r: Row): QuoteItem {
  return {
    id: r.id,
    quoteOptionId: r.quote_option_id,
    brand: r.brand,
    model: r.model,
    name: r.name,
    quantity: r.quantity,
    description: r.description,
    category: r.category ?? null,
    imageUrl: r.image_url ?? null,
    position: r.position,
  }
}

function mapOption(r: Row): QuoteOption {
  return {
    id: r.id,
    quoteId: r.quote_id,
    optionKind: r.option_kind,
    name: r.name,
    description: r.description ?? '',
    configId: r.config_id ?? null,
    priceCents: r.price_cents,
    laborIncluded: r.labor_included,
    depositPaymentMethod: r.deposit_payment_method,
    depositPaymentHandle: r.deposit_payment_handle,
    depositAmountCents: r.deposit_amount_cents,
    position: r.position,
    items: ((r.quote_items as Row[]) ?? []).map(mapItem).sort((a, b) => a.position - b.position),
  }
}

function mapEvent(r: Row): QuoteEvent {
  return {
    id: r.id,
    quoteId: r.quote_id,
    eventType: r.event_type,
    metadata: r.metadata ?? {},
    createdBy: r.created_by,
    createdAt: r.created_at,
  }
}

function mapResponse(r: Row): QuoteResponse {
  return {
    id: r.id,
    quoteId: r.quote_id,
    quoteOptionId: r.quote_option_id,
    responseType: r.response_type,
    message: r.message,
    createdAt: r.created_at,
  }
}

function mapEmail(r: Row): EmailMessage {
  return {
    id: r.id,
    shopId: r.shop_id,
    quoteId: r.quote_id,
    recipientEmail: r.recipient_email,
    templateType: r.template_type,
    subject: r.subject,
    status: r.status,
    providerMessageId: r.provider_message_id,
    errorMessage: r.error_message,
    sentBy: r.sent_by,
    createdAt: r.created_at,
    sentAt: r.sent_at,
    deliveryToken: r.delivery_token,
    firstViewedAt: r.first_viewed_at ?? null,
    viewCount: r.view_count ?? 0,
  }
}

function mapCatalogItem(r: Row): CatalogItem {
  return {
    id: r.id,
    shopId: r.shop_id,
    brand: r.brand,
    model: r.model,
    name: r.name,
    category: r.category ?? null,
    description: r.description ?? null,
    sku: r.sku ?? null,
    upc: r.upc ?? null,
    defaultPriceCents: r.default_price_cents,
    msrpCents: r.msrp_cents ?? null,
    promoPriceCents: r.promo_price_cents ?? null,
    minStaffPriceCents: r.min_staff_price_cents ?? null,
    costCents: r.cost_cents ?? null,
    priceSourceUrl: r.price_source_url ?? null,
    priceSourceName: r.price_source_name ?? null,
    priceKind: r.price_kind ?? null,
    priceCheckedAt: r.price_checked_at ?? null,
    imageUrl: r.image_url ?? null,
    imageSourceUrl: r.image_source_url ?? null,
    sourceUrl: r.source_url ?? null,
    specs: r.specs ?? null,
    active: r.active ?? true,
    availability: r.availability ?? 'not_tracked',
    importSource: r.import_source ?? 'manual',
    externalSourceProductId: r.external_source_product_id ?? null,
    identificationConfidence: r.identification_confidence ?? null,
    approvalStatus: r.approval_status ?? 'approved',
    position: r.position,
    quantityOnHand: r.quantity_on_hand ?? 0,
    upcIsGenerated: r.upc_is_generated ?? false,
    labelPrintedAt: r.label_printed_at ?? null,
    lowStockThreshold: r.low_stock_threshold ?? null,
    lastCountedAt: r.last_counted_at ?? null,
    lowStockAlerted: r.low_stock_alerted ?? false,
    lowStockAlertedAt: r.low_stock_alerted_at ?? null,
    shopifyProductId: r.shopify_product_id ?? null,
    shopifyVariantId: r.shopify_variant_id ?? null,
    shopifySyncedAt: r.shopify_synced_at ?? null,
    shopifySyncError: r.shopify_sync_error ?? null,
    shopifyMatchedExisting: r.shopify_matched_existing ?? false,
    shopifyStatus: r.shopify_status ?? 'active',
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }
}

function mapStockMovement(r: Row): StockMovement {
  return {
    id: r.id,
    shopId: r.shop_id,
    catalogItemId: r.catalog_item_id,
    movementType: r.movement_type,
    quantityDelta: r.quantity_delta,
    unitCostCents: r.unit_cost_cents ?? null,
    counterpartyName: r.counterparty_name ?? null,
    sourceInvoiceId: r.source_invoice_id ?? null,
    sourceOutgoingOrderId: r.source_outgoing_order_id ?? null,
    note: r.note ?? null,
    createdBy: r.created_by ?? null,
    createdAt: r.created_at,
  }
}

function mapService(r: Row): Service {
  return {
    id: r.id,
    shopId: r.shop_id,
    name: r.name,
    description: r.description ?? null,
    durationMinutes: r.duration_minutes,
    priceCents: r.price_cents ?? null,
    active: r.active ?? true,
    position: r.position,
    durationOverrides: ((r.service_duration_overrides as Row[]) ?? []).map((o) => ({
      bodyStyle: o.body_style,
      durationMinutes: o.duration_minutes,
    })),
  }
}

function mapBay(r: Row): Bay {
  return { id: r.id, shopId: r.shop_id, name: r.name, active: r.active ?? true, position: r.position }
}

function mapBusinessHoursDay(r: Row): BusinessHoursDay {
  return {
    dayOfWeek: r.day_of_week,
    isOpen: r.is_open,
    // Postgres `time` comes back as "HH:MM:SS" — trim to "HH:mm" to match
    // src/lib/scheduling.ts's timeStringToMinute contract.
    openTime: r.open_time ? String(r.open_time).slice(0, 5) : null,
    closeTime: r.close_time ? String(r.close_time).slice(0, 5) : null,
  }
}

function mapScheduleException(r: Row): ScheduleException {
  return {
    id: r.id,
    shopId: r.shop_id,
    date: r.exception_date,
    isClosed: r.is_closed,
    openTime: r.open_time ? String(r.open_time).slice(0, 5) : null,
    closeTime: r.close_time ? String(r.close_time).slice(0, 5) : null,
    note: r.note ?? null,
  }
}

function mapAppointment(r: Row): Appointment {
  return {
    id: r.id,
    shopId: r.shop_id,
    bayId: r.bay_id,
    customerId: r.customer_id,
    customerFirstName: r.customers?.first_name ?? '',
    customerLastName: r.customers?.last_name ?? null,
    customerPhone: r.customers?.phone ?? null,
    source: r.source,
    status: r.status,
    startsAt: r.starts_at,
    endsAt: r.ends_at,
    bodyStyle: r.body_style ?? null,
    notes: r.notes ?? null,
    publicToken: r.public_token,
    sourceQuoteId: r.source_quote_id ?? null,
    depositAmountCents: r.deposit_amount_cents ?? null,
    depositPaidAt: r.deposit_paid_at ?? null,
    reminderSentAt: r.reminder_sent_at ?? null,
    cancelledAt: r.cancelled_at ?? null,
    services: ((r.appointment_services as Row[]) ?? [])
      .sort((a, b) => a.position - b.position)
      .map((s) => ({ serviceId: s.service_id ?? null, name: s.name, durationMinutes: s.duration_minutes, priceCents: s.price_cents ?? null })),
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }
}

function mapInvoiceItem(r: Row): InvoiceItem {
  return {
    id: r.id,
    invoiceId: r.invoice_id,
    catalogItemId: r.catalog_item_id ?? null,
    brand: r.brand ?? null,
    model: r.model ?? null,
    name: r.name,
    quantity: r.quantity,
    unitPriceCents: r.unit_price_cents,
    category: r.category ?? null,
    discountPercent: r.discount_percent ?? 0,
    taxable: r.taxable ?? true,
    position: r.position,
  }
}

const INVOICE_SELECT = '*, invoice_items(*)'

function mapInvoice(r: Row): Invoice {
  return {
    id: r.id,
    shopId: r.shop_id,
    customerId: r.customer_id ?? null,
    invoiceNumber: r.invoice_number,
    status: r.status,
    paymentMethod: r.payment_method ?? null,
    paymentAmountCents: r.payment_amount_cents ?? null,
    paidAt: r.paid_at ?? null,
    subtotalCents: r.subtotal_cents,
    totalCents: r.total_cents,
    notes: r.notes ?? null,
    taxRate: r.tax_rate ?? 0,
    taxCents: r.tax_cents ?? 0,
    discountCents: r.discount_cents ?? 0,
    customerName: r.customer_name ?? null,
    customerPhone: r.customer_phone ?? null,
    customerEmail: r.customer_email ?? null,
    customerAddress: r.customer_address ?? null,
    vehicleYear: r.vehicle_year ?? null,
    vehicleMake: r.vehicle_make ?? null,
    vehicleModel: r.vehicle_model ?? null,
    createdBy: r.created_by ?? null,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    items: ((r.invoice_items as Row[]) ?? []).map(mapInvoiceItem).sort((a, b) => a.position - b.position),
  }
}

/**
 * Only sets a column when the caller actually passed that field — so
 * updateCatalogItem (a partial edit from the settings form, or a future
 * importer refreshing one field) never clobbers data it wasn't told to
 * touch. createCatalogItem applies the same builder; every column simply
 * lands at its schema default when the field is omitted on insert.
 */
function catalogItemRow(input: NewCatalogItemInput): Row {
  // Canonicalize on write — the single choke point every path funnels through
  // (manual entry, barcode/photo/text AI resolution, Shopify import). Doing it
  // here rather than at each call site is what makes "kicker", "KICKER" and
  // "Kicker Audio" one brand in the catalog instead of three.
  const canonical = canonicalizeProductFields(input)
  const row: Row = {
    brand: canonical.brand,
    model: canonical.model,
    name: canonical.name,
    default_price_cents: input.defaultPriceCents,
  }
  if (input.category !== undefined) row.category = input.category
  if (input.description !== undefined) row.description = input.description
  if (input.sku !== undefined) row.sku = input.sku
  if (input.upc !== undefined) row.upc = input.upc
  if (input.msrpCents !== undefined) row.msrp_cents = input.msrpCents
  if (input.promoPriceCents !== undefined) row.promo_price_cents = input.promoPriceCents
  if (input.minStaffPriceCents !== undefined) row.min_staff_price_cents = input.minStaffPriceCents
  if (input.costCents !== undefined) row.cost_cents = input.costCents
  if (input.priceSourceUrl !== undefined) row.price_source_url = input.priceSourceUrl
  if (input.priceSourceName !== undefined) row.price_source_name = input.priceSourceName
  if (input.priceKind !== undefined) row.price_kind = input.priceKind
  if (input.imageUrl !== undefined) row.image_url = input.imageUrl
  if (input.imageSourceUrl !== undefined) row.image_source_url = input.imageSourceUrl
  if (input.sourceUrl !== undefined) row.source_url = input.sourceUrl
  if (input.specs !== undefined) row.specs = input.specs
  if (input.active !== undefined) row.active = input.active
  if (input.availability !== undefined) row.availability = input.availability
  if (input.importSource !== undefined) row.import_source = input.importSource
  if (input.externalSourceProductId !== undefined) row.external_source_product_id = input.externalSourceProductId
  if (input.identificationConfidence !== undefined) row.identification_confidence = input.identificationConfidence
  if (input.approvalStatus !== undefined) row.approval_status = input.approvalStatus
  if (input.lowStockThreshold !== undefined) row.low_stock_threshold = input.lowStockThreshold
  if (input.upcIsGenerated !== undefined) row.upc_is_generated = input.upcIsGenerated
  // A price sourced from the web is only ever "just checked" when the
  // caller actually supplied a source — never stamped on a plain manual edit.
  if (input.priceSourceUrl !== undefined || input.priceSourceName !== undefined) {
    row.price_checked_at = new Date().toISOString()
  }
  return row
}

function mapPackageTemplateItem(r: Row): PackageTemplateItem {
  return {
    id: r.id,
    packageTemplateId: r.package_template_id,
    brand: r.brand,
    model: r.model,
    name: r.name,
    quantity: r.quantity,
    description: r.description,
    category: r.category ?? null,
    imageUrl: r.image_url ?? null,
    position: r.position,
  }
}

function mapPackageTemplate(r: Row): PackageTemplate {
  return {
    id: r.id,
    shopId: r.shop_id,
    name: r.name,
    description: r.description ?? '',
    configId: r.config_id ?? null,
    vehicleTypes: r.vehicle_types ?? [],
    installedPriceCents: r.installed_price_cents,
    laborIncluded: r.labor_included,
    source: r.source,
    approvalStatus: r.approval_status,
    sourceQuoteId: r.source_quote_id ?? null,
    sourceQuoteOptionId: r.source_quote_option_id ?? null,
    createdBy: r.created_by,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    items: ((r.package_template_items as Row[]) ?? []).map(mapPackageTemplateItem).sort((a, b) => a.position - b.position),
  }
}

const PACKAGE_TEMPLATE_SELECT = '*, package_template_items(*)'

const QUOTE_SELECT = `*, customers(*), quote_options(*, quote_items(*)), quote_events(*), quote_responses(*), email_messages(*)`

function mapBundle(r: Row): QuoteBundle {
  const byDateDesc = (a: { createdAt: string }, b: { createdAt: string }) =>
    b.createdAt.localeCompare(a.createdAt)
  return {
    quote: mapQuote(r),
    customer: mapCustomer(r.customers),
    options: ((r.quote_options as Row[]) ?? []).map(mapOption).sort((a, b) => a.position - b.position),
    events: ((r.quote_events as Row[]) ?? []).map(mapEvent).sort(byDateDesc),
    responses: ((r.quote_responses as Row[]) ?? []).map(mapResponse).sort(byDateDesc),
    emails: ((r.email_messages as Row[]) ?? []).map(mapEmail).sort(byDateDesc),
  }
}

export class SupabaseRepository implements DataRepository {
  readonly mode = 'production' as const

  constructor(
    private supabase: SupabaseClient,
    private shopId: string,
  ) {}

  async getShop(): Promise<Shop> {
    const { data, error } = await this.supabase.from('shops').select('*').eq('id', this.shopId).single()
    if (error) throw error
    return mapShop(data)
  }

  async updateShop(patch: ShopSettingsPatch): Promise<Shop> {
    const row: Row = {}
    if (patch.name !== undefined) row.name = patch.name
    if (patch.phone !== undefined) row.phone = patch.phone
    if (patch.email !== undefined) row.email = patch.email
    if (patch.replyToEmail !== undefined) row.reply_to_email = patch.replyToEmail
    if (patch.address !== undefined) row.address = patch.address
    if (patch.website !== undefined) row.website = patch.website
    if (patch.logoUrl !== undefined) row.logo_url = patch.logoUrl
    if (patch.primaryColor !== undefined) row.primary_color = patch.primaryColor
    if (patch.defaultPaymentMethod !== undefined) row.default_payment_method = patch.defaultPaymentMethod
    if (patch.defaultPaymentHandle !== undefined) row.default_payment_handle = patch.defaultPaymentHandle
    if (patch.financingOffers !== undefined) row.financing_offers = patch.financingOffers
    if (patch.quoteExpirationDays !== undefined) row.quote_expiration_days = patch.quoteExpirationDays
    if (patch.followUpScheduleDays !== undefined) row.follow_up_schedule_days = patch.followUpScheduleDays
    if (patch.quoteDisclaimer !== undefined) row.quote_disclaimer = patch.quoteDisclaimer
    if (patch.defaultLowStockThreshold !== undefined) row.default_low_stock_threshold = patch.defaultLowStockThreshold
    if (patch.lowStockAlertEmail !== undefined) row.low_stock_alert_email = patch.lowStockAlertEmail
    if (patch.bookingDepositCents !== undefined) row.booking_deposit_cents = patch.bookingDepositCents
    if (patch.autoFollowUpEnabled !== undefined) row.auto_follow_up_enabled = patch.autoFollowUpEnabled
    if (patch.contributesToGlobalCatalog !== undefined)
      row.contributes_to_global_catalog = patch.contributesToGlobalCatalog
    const { data, error } = await this.supabase
      .from('shops')
      .update(row)
      .eq('id', this.shopId)
      .select('*')
      .single()
    if (error) throw error
    return mapShop(data)
  }

  async listEmployees(): Promise<Employee[]> {
    const { data, error } = await this.supabase
      .from('shop_memberships')
      .select('id, shop_id, user_id, role, profiles(full_name)')
      .eq('shop_id', this.shopId)
    if (error) throw error
    return (data as Row[]).map((r) => ({
      id: r.user_id,
      shopId: r.shop_id,
      fullName: r.profiles?.full_name ?? 'Team member',
      role: r.role,
    }))
  }

  async listCatalogItems(): Promise<CatalogItem[]> {
    const { data, error } = await this.supabase
      .from('catalog_items')
      .select('*')
      .eq('shop_id', this.shopId)
      .order('position', { ascending: true })
    if (error) throw error
    return (data as Row[]).map(mapCatalogItem)
  }

  async createCatalogItem(input: NewCatalogItemInput): Promise<CatalogItem> {
    const { count } = await this.supabase
      .from('catalog_items')
      .select('id', { count: 'exact', head: true })
      .eq('shop_id', this.shopId)
    const { data, error } = await this.supabase
      .from('catalog_items')
      .insert({
        shop_id: this.shopId,
        ...catalogItemRow(input),
        position: count ?? 0,
      })
      .select('*')
      .single()
    if (error) throw error
    this.invalidateCatalogCache()
    const created = mapCatalogItem(data)
    // Offer it to the shared catalog after the create has already succeeded,
    // and never await it: identifying a product is work this shop did, and the
    // next shop should not have to pay for it again — but that is a background
    // courtesy, not part of what the operator asked for.
    void this.contributeToGlobalCatalog(created)
    return created
  }

  async updateCatalogItem(itemId: string, input: NewCatalogItemInput): Promise<CatalogItem> {
    const { data, error } = await this.supabase
      .from('catalog_items')
      .update(catalogItemRow(input))
      .eq('id', itemId)
      .select('*')
      .single()
    if (error) throw error
    this.invalidateCatalogCache()
    return mapCatalogItem(data)
  }

  async deleteCatalogItem(itemId: string): Promise<void> {
    const { error } = await this.supabase.from('catalog_items').delete().eq('id', itemId)
    if (error) throw error
    this.invalidateCatalogCache()
  }

  async runShopifyImport(options: ShopifyImportOptions = {}): Promise<ShopifyImportResult> {
    const { data, error } = await this.supabase.functions.invoke('shopify-import-catalog', {
      body: {
        shopId: this.shopId,
        afterCursor: options.afterCursor ?? null,
        overwriteLocalPrices: options.overwriteLocalPrices ?? false,
      },
    })
    if (error) {
      // The function returns a real, human-readable `message` in its JSON body
      // (e.g. "Only an owner or manager can run a Shopify catalog import.") —
      // supabase-js's own error.message is just a generic "non-2xx status code"
      // unless we read the body off the attached Response ourselves.
      if (error instanceof FunctionsHttpError) {
        const body = await error.context.json().catch(() => null)
        throw new Error(typeof body?.message === 'string' ? body.message : error.message)
      }
      throw error
    }
    // An import can rewrite the whole catalog; anything cached is now stale.
    this.invalidateCatalogCache()
    return data as ShopifyImportResult
  }

  async recordStockMovement(input: NewStockMovementInput): Promise<{ movement: StockMovement; catalogItem: CatalogItem }> {
    // apply_stock_movement (migration 0011) inserts the ledger row and
    // updates quantity_on_hand atomically in one transaction — the RPC
    // response is the inserted stock_movements row itself.
    const { data, error } = await this.supabase.rpc('apply_stock_movement', {
      p_catalog_item_id: input.catalogItemId,
      p_movement_type: input.movementType,
      p_quantity_delta: input.quantityDelta,
      p_unit_cost_cents: input.unitCostCents ?? null,
      p_counterparty_name: input.counterpartyName ?? null,
      p_source_invoice_id: input.sourceInvoiceId ?? null,
      p_source_outgoing_order_id: input.sourceOutgoingOrderId ?? null,
      p_note: input.note ?? null,
    })
    if (error) throw error
    const movement = mapStockMovement(data as Row)

    const { data: itemRow, error: itemError } = await this.supabase
      .from('catalog_items')
      .select('*')
      .eq('id', input.catalogItemId)
      .single()
    if (itemError) throw itemError
    return { movement, catalogItem: mapCatalogItem(itemRow as Row) }
  }

  async listStockMovements(catalogItemId?: string): Promise<StockMovement[]> {
    let query = this.supabase.from('stock_movements').select('*').order('created_at', { ascending: false })
    if (catalogItemId) query = query.eq('catalog_item_id', catalogItemId)
    const { data, error } = await query
    if (error) throw error
    return (data as Row[]).map(mapStockMovement)
  }

  async markCounted(catalogItemId: string, newQuantity: number): Promise<{ catalogItem: CatalogItem; movement: StockMovement | null }> {
    const { data: current, error: fetchError } = await this.supabase
      .from('catalog_items')
      .select('*')
      .eq('id', catalogItemId)
      .single()
    if (fetchError) throw fetchError
    const currentItem = mapCatalogItem(current as Row)

    let movement: StockMovement | null = null
    if (newQuantity !== currentItem.quantityOnHand) {
      const result = await this.recordStockMovement({
        catalogItemId,
        movementType: 'adjustment',
        quantityDelta: newQuantity - currentItem.quantityOnHand,
        note: 'Spot count adjustment',
      })
      movement = result.movement
    }

    const { data, error } = await this.supabase
      .from('catalog_items')
      .update({ last_counted_at: new Date().toISOString() })
      .eq('id', catalogItemId)
      .select('*')
      .single()
    if (error) throw error
    return { catalogItem: mapCatalogItem(data as Row), movement }
  }

  async uploadProductPhoto(base64Jpeg: string): Promise<string> {
    const bytes = Uint8Array.from(atob(base64Jpeg), (c) => c.charCodeAt(0))
    const path = `${this.shopId}/${newId()}.jpg`
    const { error } = await this.supabase.storage
      .from('shop-product-photos')
      .upload(path, bytes, { contentType: 'image/jpeg' })
    if (error) throw error
    const { data } = this.supabase.storage.from('shop-product-photos').getPublicUrl(path)
    return data.publicUrl
  }

  async generateSku(brand: string | null, model: string): Promise<string> {
    const base = buildSkuBase(brand, model)
    const [upcMatches, skuMatches] = await Promise.all([
      this.supabase.from('catalog_items').select('upc').eq('shop_id', this.shopId).like('upc', `${base}%`),
      this.supabase.from('catalog_items').select('sku').eq('shop_id', this.shopId).like('sku', `${base}%`),
    ])
    if (upcMatches.error) throw upcMatches.error
    if (skuMatches.error) throw skuMatches.error
    const taken = new Set<string>([
      ...(upcMatches.data as Row[]).map((r) => r.upc as string),
      ...(skuMatches.data as Row[]).map((r) => r.sku as string),
    ])
    return nextAvailableSku(base, taken)
  }

  async findCatalogItemByCode(code: string): Promise<CatalogItem | null> {
    const trimmed = code.trim()
    if (!trimmed) return null
    // Two plain .eq() queries rather than a single .or() — a scanned/typed
    // code lands directly in a PostgREST filter string, and .or()'s syntax
    // treats commas/parens specially, so this avoids ever needing to escape
    // untrusted input into that mini-language at all. Run concurrently
    // (Promise.all), not sequentially — a barcode almost never matches a
    // sku, so that second query used to add its full round-trip on top of
    // the first on every miss, real latency on the most common "not in
    // catalog yet" scan for no reason (each query is independent, one
    // doesn't need the other's result).
    const [upcResult, skuResult] = await Promise.all([
      this.supabase.from('catalog_items').select('*').eq('shop_id', this.shopId).eq('upc', trimmed).maybeSingle(),
      this.supabase.from('catalog_items').select('*').eq('shop_id', this.shopId).eq('sku', trimmed).maybeSingle(),
    ])
    if (upcResult.error) throw upcResult.error
    if (upcResult.data) return mapCatalogItem(upcResult.data as Row)
    if (skuResult.error) throw skuResult.error
    return skuResult.data ? mapCatalogItem(skuResult.data as Row) : null
  }

  async lookupProductByUpc(code: string, options: { fast?: boolean; brandHint?: string | null } = {}): Promise<UpcLookupResult> {
    const item = await this.findCatalogItemByCode(code)
    if (item) return { source: 'catalog', catalogItem: item }

    // The shared catalog, before anything that costs money or seconds. This
    // is the entire premise of the shared catalog and the barcode path was
    // the one route that skipped it — which is backwards, since scanning is
    // how most products enter a shop.
    //
    // Skipped only for store-assigned codes (GS1 prefix 2). Those are printed
    // by one retailer for its own shelves, so the same digits mean a
    // different product at a different shop, and a "match" would be actively
    // wrong rather than merely useless. A manufacturer's alphanumeric part
    // code is the opposite case: Nemesis Audio's own label is the same label
    // on every shop's shelf, so it is worth asking about even though no
    // barcode database will ever hold it.
    if (!classifyBarcode(code).storeAssigned) {
      const shared = await this.searchGlobalProducts(code)
      const exact = shared.find((g) => g.barcode === code.trim())
      if (exact) {
        const suggestion = globalToSuggestion(exact)
        // A platform-verified row is at least as trustworthy as the exact
        // UPCitemdb hit that already auto-populates, so it fills the form
        // outright. An unverified one is a shop's contribution: still shown
        // instantly and for free, but confirmed with a tap rather than
        // assumed.
        if (exact.verified) {
          return {
            source: 'external',
            name: suggestion.name,
            brand: suggestion.brand,
            unitPriceCents: suggestion.unitPriceCents,
            imageUrl: suggestion.imageUrl,
            upc: exact.barcode ?? code,
          }
        }
        return {
          source: 'candidates',
          candidates: [globalToCandidate(exact, code)],
          // Always the scanned code, never blank: if staff reject the shared
          // match, the fallback path prefills a custom item from this.
          retainedInput: code,
        }
      }
    }

    // Fast, confident path: a single high-confidence verified-source match
    // (today, that's an exact UPCitemdb hit) auto-populates without staff
    // confirmation, same behavior this method has always had. Anything
    // lower-confidence or AI-extracted comes back as 'candidates' with the
    // full ranked list already attached — see UpcLookupResult's doc
    // comment for why this matters: it lets the caller skip a second
    // resolveProduct() network round-trip just to re-fetch what this call
    // already resolved. This never throws — any failure (function not
    // deployed, no funded OPENAI_API_KEY/ANTHROPIC_API_KEY, a network
    // hiccup) degrades to not_found, worse than which would be a hard
    // error mid-scan.
    try {
      const result = await this.resolveProduct({ kind: 'barcode', code, fast: options.fast, brandHint: options.brandHint })
      const top = result.candidates[0]
      if (top && top.source === 'verified_web_source' && top.confidenceLevel === 'high') {
        return {
          source: 'external',
          name: top.name,
          brand: top.brand,
          unitPriceCents: top.referencePriceCents,
          imageUrl: top.imageUrl,
          upc: top.upc ?? code,
        }
      }
      if (result.candidates.length > 0) {
        return { source: 'candidates', candidates: result.candidates, retainedInput: result.retainedInput }
      }
      return { source: 'not_found' }
    } catch (err) {
      console.error('lookupProductByUpc failed', err)
      return { source: 'not_found' }
    }
  }

  /**
   * The two cheap sources, both of which can answer in well under a second:
   * the shop's own catalog (in memory after the first call) and the shared
   * catalog (one indexed RPC).
   *
   * Split out from the full lookup so the UI can render an answer while the
   * web search is still running. Previously both phases were awaited together
   * in a Promise.all, which meant a product the shop already stocks — the
   * single most common case while receiving a shipment — still took as long
   * as a grounded model call to appear. Parallel was the right instinct and
   * the wrong shape: the two calls did run at once, but the fast one could
   * not be *shown* until the slow one finished.
   *
   * Never throws. Both halves degrade to [] independently.
   */
  async suggestProductsFast(query: string, brandHint?: string | null): Promise<ProductSuggestion[]> {
    const trimmed = query.trim()
    if (trimmed.length < 2) return []

    const [items, shared] = await Promise.all([
      this.cachedCatalogItems().catch(() => [] as CatalogItem[]),
      this.searchGlobalProducts(trimmed),
    ])

    const local: ProductSuggestion[] = searchLocalCatalog(items, trimmed, brandHint).map((hit) => ({
      name: hit.name,
      brand: hit.brand,
      model: hit.model,
      unitPriceCents: hit.priceCents,
      imageUrl: hit.imageUrl,
      sourceUrl: null,
    }))

    return dedupeSuggestions([local, shared.map(globalToSuggestion)])
  }

  /**
   * The shop's own catalog, cached briefly in memory.
   *
   * Justified by the access pattern rather than by size: this is read on a
   * debounced keystroke, so without a cache every letter typed is a full
   * table fetch. The window is deliberately short — a product added on
   * another device should show up in autocomplete within seconds, and the
   * cache is dropped outright whenever this repository writes a catalog item
   * (see invalidateCatalogCache) so a shop never fails to find something they
   * just entered themselves.
   */
  private catalogCache: { items: CatalogItem[]; at: number } | null = null

  private async cachedCatalogItems(): Promise<CatalogItem[]> {
    const CACHE_MS = 30_000
    const cached = this.catalogCache
    if (cached && Date.now() - cached.at < CACHE_MS) return cached.items
    const items = await this.listCatalogItems()
    this.catalogCache = { items, at: Date.now() }
    return items
  }

  private invalidateCatalogCache(): void {
    this.catalogCache = null
  }

  /**
   * Everything suggestProductsFast finds, plus the web resolver's candidates
   * appended behind them.
   *
   * Kept as one call that returns the complete list so a caller that does not
   * want progressive rendering still gets a correct answer from a single
   * await. Callers that do want it run suggestProductsFast on a short timer
   * and this on a longer one; dedupeSuggestions guarantees the second result
   * is an extension of the first, never a reshuffle of it.
   */
  async lookupProductSuggestions(query: string, brandHint?: string | null): Promise<ProductSuggestionResult> {
    const trimmed = query.trim()
    if (trimmed.length < 2) return { suggestions: [], aiConfigured: true, aiError: null }

    const [fast, result] = await Promise.all([
      this.suggestProductsFast(trimmed, brandHint),
      this.resolveProduct({ kind: 'text', query: trimmed, brandHint }),
    ])

    const web: ProductSuggestion[] = result.candidates.map((c) => ({
      name: c.name,
      brand: c.brand,
      model: c.model,
      unitPriceCents: c.referencePriceCents,
      imageUrl: c.imageUrl,
      sourceUrl: c.priceSourceUrl,
    }))

    return {
      suggestions: dedupeSuggestions([fast, web]),
      aiConfigured: result.aiConfigured,
      aiError: result.aiError,
    }
  }

  async searchGlobalProducts(query: string): Promise<GlobalProductMatch[]> {
    const trimmed = query.trim()
    if (trimmed.length < 2) return []
    try {
      const { data, error } = await this.supabase.rpc('search_global_products', {
        p_query: trimmed,
        p_limit: 8,
      })
      if (error) {
        // Never throws: the shared catalog is an accelerant, not a dependency.
        // A shop mid-intake must not be blocked because a shared lookup failed.
        console.error('search_global_products failed', error)
        return []
      }
      return (Array.isArray(data) ? (data as Row[]) : []).map((r) => ({
        id: r.id as string,
        barcode: typeof r.barcode === 'string' ? r.barcode : null,
        brand: typeof r.brand === 'string' ? r.brand : null,
        model: typeof r.model === 'string' ? r.model : null,
        name: typeof r.name === 'string' ? r.name : '',
        category: (r.category ?? null) as GlobalProductMatch['category'],
        specs: (r.specs ?? null) as Record<string, unknown> | null,
        referencePriceCents: typeof r.reference_price_cents === 'number' ? r.reference_price_cents : null,
        priceKind: (r.price_kind ?? null) as GlobalProductMatch['priceKind'],
        imageUrl: typeof r.image_url === 'string' ? r.image_url : null,
        sourceUrl: typeof r.source_url === 'string' ? r.source_url : null,
        contributionCount: typeof r.contribution_count === 'number' ? r.contribution_count : 1,
        verified: r.verified === true,
      }))
    } catch (err) {
      console.error('search_global_products threw', err)
      return []
    }
  }

  /**
   * Offer a product this shop has identified to the shared catalog.
   *
   * Fire-and-forget by design: it runs after the thing the operator actually
   * asked for has already succeeded, and a failure here must never surface as
   * an error on their screen. The RPC itself re-checks membership and the
   * shop's own toggle, so this is not the only gate.
   */
  private async contributeToGlobalCatalog(item: CatalogItem): Promise<void> {
    const draft = toGlobalProductDraft(item)
    const matchKey = draft ? globalMatchKey(draft) : null
    if (!draft || !matchKey) return
    try {
      await this.supabase.rpc('contribute_global_product', {
        p_shop_id: this.shopId,
        p_match_key: matchKey,
        p_barcode: draft.barcode,
        p_brand: draft.brand,
        p_model: draft.model,
        p_name: draft.name,
        p_category: draft.category,
        p_specs: draft.specs,
        p_reference_price_cents: draft.referencePriceCents,
        p_price_kind: draft.priceKind,
        p_image_url: draft.imageUrl,
        p_source_url: draft.sourceUrl,
      })
    } catch (err) {
      console.error('contribute_global_product failed', err)
    }
  }

  async testProductLookup(): Promise<ProductLookupSelfTest> {
    // aiConfigured stays null here on purpose: a call that failed in transport
    // never asked the function whether a key exists, so claiming either answer
    // would be a guess.
    const failed = (message: string): ProductLookupSelfTest => ({
      ok: false,
      aiConfigured: null,
      provider: null,
      model: null,
      rung: null,
      rungLabel: null,
      searchedWeb: null,
      retailers: [],
      candidateCount: 0,
      sample: null,
      elapsedMs: null,
      aiError: message,
      cached: false,
      functionVersion: null,
    })

    const started = Date.now()
    try {
      // Deliberately `kind: 'text'` and not a bespoke 'selftest' kind.
      //
      // A health check has to run on the OLDEST contract the deployment might
      // be running, not the newest — otherwise it fails on exactly the
      // deployments it exists to diagnose. The first version of this asked for
      // `kind: 'selftest'`, which every previously-deployed function rejects
      // outright, so it reported a broken key on a project whose only problem
      // was an un-deployed function. `kind: 'text'` has been supported since
      // the resolver shipped, and it exercises the same path a shop uses when
      // they type a model name — which is the thing being asked about.
      //
      // `noCache` is ignored by older deployments, which is fine: a cache hit
      // is reported rather than silently counted as a pass.
      //
      // `skipRetailers` keeps this an *AI* health check: newer deployments
      // answer typed queries from live retailer storefronts first, and a
      // retailer answering here would report "lookup healthy" over a dead AI
      // key -- the exact blind spot this test exists to remove. Also ignored
      // by older deployments.
      const { data, error } = await this.supabase.functions.invoke('resolve-product', {
        body: { shopId: this.shopId, kind: 'text', query: SELF_TEST_QUERY, noCache: true, skipRetailers: true },
      })
      if (error) {
        return failed(await describeFunctionError(error))
      }

      const row = (data ?? {}) as Row
      const candidates = Array.isArray(row.candidates) ? (row.candidates as Row[]) : []
      const top = candidates[0]
      const aiConfigured = row.aiConfigured === undefined ? null : row.aiConfigured !== false

      return {
        ok: candidates.length > 0,
        aiConfigured,
        provider: (row.provider as ProductLookupSelfTest['provider']) ?? null,
        model: typeof row.model === 'string' ? row.model : null,
        rung: typeof row.rung === 'number' ? row.rung : null,
        rungLabel: typeof row.rungLabel === 'string' ? row.rungLabel : null,
        searchedWeb: typeof row.searchedWeb === 'boolean' ? row.searchedWeb : null,
        retailers: Array.isArray(row.retailers)
          ? (row.retailers as Row[]).map((r) => ({
              name: String(r.name ?? 'store'),
              hits: typeof r.hits === 'number' ? r.hits : 0,
              ms: typeof r.ms === 'number' ? r.ms : 0,
              error: typeof r.error === 'string' ? r.error : null,
            }))
          : [],
        candidateCount: candidates.length,
        sample: typeof top?.name === 'string' ? top.name : null,
        elapsedMs: Date.now() - started,
        aiError: typeof row.aiError === 'string' ? row.aiError : null,
        cached: row.cached === true,
        functionVersion: typeof row.functionVersion === 'number' ? row.functionVersion : null,
      }
    } catch (err) {
      return failed(err instanceof Error ? err.message : 'The lookup function could not be reached.')
    }
  }

  async resolveProduct(request: ProductResolveRequest): Promise<ProductResolveResult> {
    const retainedInput = request.kind === 'barcode' ? request.code : request.kind === 'text' ? request.query : 'photo'

    // A code no database can hold never leaves the device. This runs AFTER
    // lookupProductByUpc's local-catalog check, which is the one place such a
    // code legitimately resolves — a store barcode bound during rapid intake
    // is found there and never reaches this line.
    if (request.kind === 'barcode' && barcodeLookupForms(request.code).length === 0) {
      return { candidates: [], retainedInput, aiConfigured: true, aiError: null, unresolvableBarcode: true }
    }
    // Same never-throw rule as everything else in this lookup chain: this
    // powers an autocomplete dropdown or a post-scan confirmation step, not
    // a blocking one, so any failure (function not deployed yet, no funded
    // OPENAI_API_KEY/ANTHROPIC_API_KEY, a network hiccup, a rate limit)
    // just means no candidates — never interrupts manual/custom-item entry.
    try {
      const { data, error } = await this.supabase.functions.invoke('resolve-product', {
        body: { shopId: this.shopId, ...request },
      })
      if (error) {
        const notDeployed = error instanceof FunctionsHttpError && error.context?.status === 404
        if (!notDeployed) console.error('resolve-product failed', error)
        return {
          candidates: [],
          retainedInput,
          aiConfigured: true,
          // A 404 from functions.invoke means the Edge Function itself was
          // never deployed to this project — the single most invisible way
          // lookup can be "broken", since it produces no logs anywhere and
          // looks identical to a search that found nothing. Say so.
          aiError: notDeployed ? 'the resolve-product function is not deployed to this project' : null,
          unresolvableBarcode: false,
        }
      }
      const raw = Array.isArray(data?.candidates) ? (data.candidates as Row[]) : []
      const mapped: ProductResolutionCandidate[] = raw
        .map((c) => ({
          id: typeof c.id === 'string' ? c.id : newId(),
          source: (['resolution_cache', 'verified_web_source', 'ai_extracted'] as const).includes(c.source)
            ? (c.source as ProductResolutionCandidate['source'])
            : 'ai_extracted',
          brand: typeof c.brand === 'string' ? c.brand : null,
          model: typeof c.model === 'string' ? c.model : null,
          name: typeof c.name === 'string' ? c.name : '',
          categoryHint: typeof c.categoryHint === 'string' ? c.categoryHint : null,
          upc: typeof c.upc === 'string' ? c.upc : null,
          imageUrl: typeof c.imageUrl === 'string' ? c.imageUrl : null,
          referencePriceCents: typeof c.referencePriceCents === 'number' ? c.referencePriceCents : null,
          priceKind: (['msrp', 'retail', 'unknown'] as const).includes(c.priceKind) ? (c.priceKind as ProductPriceKind) : 'unknown',
          priceSourceUrl: typeof c.priceSourceUrl === 'string' ? c.priceSourceUrl : null,
          priceSourceName: typeof c.priceSourceName === 'string' ? c.priceSourceName : null,
          confidence: typeof c.confidence === 'number' ? c.confidence : 0,
          confidenceLevel: (['high', 'probable', 'low'] as const).includes(c.confidenceLevel)
            ? (c.confidenceLevel as ProductConfidenceLevel)
            : 'low',
          evidence: Array.isArray(c.evidence) ? c.evidence.filter((e: unknown): e is string => typeof e === 'string') : [],
          warnings: Array.isArray(c.warnings) ? c.warnings.filter((w: unknown): w is string => typeof w === 'string') : [],
        }))
        .filter((c) => c.name.length > 0)
      return {
        candidates: rankCandidates(dedupeCandidates(mapped), retainedInput),
        retainedInput,
        // Only a definite `false` from the function means unconfigured. An
        // older deploy that doesn't send the field, or any transport
        // failure, must not be reported to the shop as "lookup isn't set
        // up" — that would send them chasing a config problem they don't have.
        aiConfigured: (data as Row)?.aiConfigured !== false,
        aiError: typeof (data as Row)?.aiError === 'string' ? ((data as Row).aiError as string) : null,
        unresolvableBarcode: (data as Row)?.unresolvableBarcode === true,
      }
    } catch (err) {
      console.error('resolve-product failed', err)
      return { candidates: [], retainedInput, aiConfigured: true, aiError: null, unresolvableBarcode: false }
    }
  }

  async listInvoices(): Promise<Invoice[]> {
    const { data, error } = await this.supabase
      .from('invoices')
      .select(INVOICE_SELECT)
      .eq('shop_id', this.shopId)
      .order('invoice_number', { ascending: false })
    if (error) throw error
    return (data as Row[]).map(mapInvoice)
  }

  async getInvoice(invoiceId: string): Promise<Invoice | null> {
    const { data, error } = await this.supabase.from('invoices').select(INVOICE_SELECT).eq('id', invoiceId).maybeSingle()
    if (error) throw error
    return data ? mapInvoice(data as Row) : null
  }

  async createInvoice(input: NewInvoiceInput): Promise<Invoice> {
    const totals = computeInvoiceTotals(input.items, input.taxRate ?? 0, input.discountCents ?? 0)
    // invoice_number is assigned by the assign_invoice_number trigger
    // (migration 0011) — never set client-side.
    const { data: invoice, error: invoiceError } = await this.supabase
      .from('invoices')
      .insert({
        shop_id: this.shopId,
        customer_id: input.customerId ?? null,
        status: 'draft',
        subtotal_cents: totals.subtotalCents,
        total_cents: totals.totalCents,
        tax_rate: input.taxRate ?? 0,
        tax_cents: totals.taxCents,
        discount_cents: totals.discountCents,
        notes: input.notes ?? null,
        customer_name: input.customerName ?? null,
        customer_phone: input.customerPhone ?? null,
        customer_email: input.customerEmail ?? null,
        customer_address: input.customerAddress ?? null,
        vehicle_year: input.vehicleYear ?? null,
        vehicle_make: input.vehicleMake ?? null,
        vehicle_model: input.vehicleModel ?? null,
      })
      .select('id')
      .single()
    if (invoiceError) throw invoiceError

    if (input.items.length > 0) {
      const { error: itemsError } = await this.supabase.from('invoice_items').insert(
        input.items.map((item, i) => ({
          invoice_id: invoice.id,
          catalog_item_id: item.catalogItemId,
          brand: item.brand,
          model: item.model,
          name: item.name,
          quantity: item.quantity,
          unit_price_cents: item.unitPriceCents,
          category: item.category ?? null,
          discount_percent: item.discountPercent ?? 0,
          taxable: item.taxable ?? true,
          position: i,
        })),
      )
      if (itemsError) throw itemsError
    }

    const { data, error } = await this.supabase.from('invoices').select(INVOICE_SELECT).eq('id', invoice.id).single()
    if (error) throw error
    return mapInvoice(data as Row)
  }

  async markInvoicePaid(invoiceId: string, paymentMethod: InvoicePaymentMethod, paymentAmountCents: number): Promise<Invoice> {
    const { data: existing, error: existingError } = await this.supabase
      .from('invoices')
      .select(INVOICE_SELECT)
      .eq('id', invoiceId)
      .single()
    if (existingError) throw existingError
    if (existing.status === 'paid') return mapInvoice(existing as Row) // idempotent — never double-record the stock movements below

    const { error: updateError } = await this.supabase
      .from('invoices')
      .update({
        status: 'paid',
        payment_method: paymentMethod,
        payment_amount_cents: paymentAmountCents,
        paid_at: new Date().toISOString(),
      })
      .eq('id', invoiceId)
    if (updateError) throw updateError

    // One 'sale' movement per line item that's actually a real catalog
    // product — a custom/one-off line (catalogItemId null) has no stock to
    // decrement. Sequential (not parallel) round trips, matching this
    // codebase's general caution around concurrent Edge Function/RPC calls.
    for (const item of (existing.invoice_items as Row[]) ?? []) {
      if (!item.catalog_item_id) continue
      const { error: movementError } = await this.supabase.rpc('apply_stock_movement', {
        p_catalog_item_id: item.catalog_item_id,
        p_movement_type: 'sale',
        p_quantity_delta: -item.quantity,
        p_source_invoice_id: invoiceId,
      })
      if (movementError) throw movementError
    }

    const { data, error } = await this.supabase.from('invoices').select(INVOICE_SELECT).eq('id', invoiceId).single()
    if (error) throw error
    return mapInvoice(data as Row)
  }

  async sendInvoiceEmail(invoiceId: string, recipientEmail: string, recipientName?: string): Promise<SendEmailResult> {
    const { data, error } = await this.supabase.functions.invoke('send-invoice-email', {
      body: { invoiceId, recipientEmail, recipientName },
    })
    if (error) {
      if (error instanceof FunctionsHttpError) {
        const body = await error.context.json().catch(() => null)
        return { ok: false, status: 'failed', message: typeof body?.message === 'string' ? body.message : 'The email could not be sent.' }
      }
      return { ok: false, status: 'failed', message: 'The email could not be sent. Check your connection and try again.' }
    }
    const result = data as { ok: boolean; message?: string }
    return result.ok
      ? { ok: true, status: 'sent', message: 'Email accepted by the email provider.' }
      : { ok: false, status: 'failed', message: result.message ?? 'The email could not be sent.' }
  }

  async listPackageTemplates(): Promise<PackageTemplate[]> {
    const { data, error } = await this.supabase
      .from('package_templates')
      .select(PACKAGE_TEMPLATE_SELECT)
      .eq('shop_id', this.shopId)
      .order('created_at', { ascending: false })
    if (error) throw error
    return (data as Row[]).map(mapPackageTemplate)
  }

  async createPackageTemplate(input: NewPackageTemplateInput): Promise<PackageTemplate> {
    const { data: template, error: templateError } = await this.supabase
      .from('package_templates')
      .insert({
        shop_id: this.shopId,
        name: input.name,
        description: input.description,
        config_id: input.configId,
        vehicle_types: input.vehicleTypes,
        installed_price_cents: input.installedPriceCents,
        labor_included: input.laborIncluded,
        source: input.source,
        approval_status: input.approvalStatus ?? 'pending_review',
        source_quote_id: input.sourceQuoteId ?? null,
        source_quote_option_id: input.sourceQuoteOptionId ?? null,
      })
      .select('id')
      .single()
    if (templateError) throw templateError

    if (input.items.length > 0) {
      const { error: itemsError } = await this.supabase.from('package_template_items').insert(
        input.items.map((item, i) => ({
          package_template_id: template.id,
          brand: item.brand,
          model: item.model,
          name: item.name,
          quantity: item.quantity,
          description: item.description,
          category: item.category,
          image_url: item.imageUrl,
          position: i,
        })),
      )
      if (itemsError) throw itemsError
    }

    const { data, error } = await this.supabase
      .from('package_templates')
      .select(PACKAGE_TEMPLATE_SELECT)
      .eq('id', template.id)
      .single()
    if (error) throw error
    return mapPackageTemplate(data)
  }

  async setPackageTemplateApproval(templateId: string, status: ProductApprovalStatus): Promise<void> {
    const { error } = await this.supabase.from('package_templates').update({ approval_status: status }).eq('id', templateId)
    if (error) throw error
  }

  async deletePackageTemplate(templateId: string): Promise<void> {
    const { error } = await this.supabase.from('package_templates').delete().eq('id', templateId)
    if (error) throw error
  }

  async listQuoteBundles(): Promise<QuoteBundle[]> {
    const { data, error } = await this.supabase
      .from('quotes')
      .select(QUOTE_SELECT)
      .eq('shop_id', this.shopId)
      .order('created_at', { ascending: false })
    if (error) throw error
    return (data as Row[]).map(mapBundle)
  }

  async getQuoteBundle(quoteId: string): Promise<QuoteBundle | null> {
    const { data, error } = await this.supabase
      .from('quotes')
      .select(QUOTE_SELECT)
      .eq('id', quoteId)
      .maybeSingle()
    if (error) throw error
    return data ? mapBundle(data) : null
  }

  async createQuote(input: NewQuoteInput): Promise<Quote> {
    const now = new Date().toISOString()
    const { data: customer, error: customerError } = await this.supabase
      .from('customers')
      .insert({
        shop_id: this.shopId,
        first_name: input.customer.firstName,
        last_name: input.customer.lastName,
        email: input.customer.email,
        phone: input.customer.phone,
        vehicle_year: input.customer.vehicleYear,
        vehicle_make: input.customer.vehicleMake,
        vehicle_model: input.customer.vehicleModel,
        vehicle_trim: input.customer.vehicleTrim,
        source: input.customer.source,
        email_contact_permission_confirmed: input.customer.emailContactPermissionConfirmed,
        email_contact_permission_confirmed_at: input.customer.emailContactPermissionConfirmed ? now : null,
      })
      .select('*')
      .single()
    if (customerError) throw customerError

    const { data: user } = await this.supabase.auth.getUser()
    const { data: quote, error: quoteError } = await this.supabase
      .from('quotes')
      .insert({
        shop_id: this.shopId,
        customer_id: customer.id,
        created_by: user.user?.id ?? null,
        status: 'draft',
        internal_notes: input.quote.internalNotes,
        expiration_date: input.quote.expirationDate,
        next_follow_up_at: input.quote.nextFollowUpAt,
        window_tints: input.quote.windowTints,
        show_full_addon_total: input.quote.showFullAddonTotal ?? false,
      })
      .select('*')
      .single()
    if (quoteError) throw quoteError

    for (const [i, opt] of input.options.entries()) {
      await this.insertOption(quote.id, opt, i)
    }

    await this.addEvent(quote.id, 'created')
    return mapQuote(quote)
  }

  /** Inserts one option plus its items. Shared by createQuote and updateQuote so the column mapping can't drift between the two paths. */
  private async insertOption(quoteId: string, opt: NewQuoteInput['options'][number], position: number): Promise<void> {
    const { data: option, error: optionError } = await this.supabase
      .from('quote_options')
      .insert({
        quote_id: quoteId,
        option_kind: opt.optionKind,
        name: opt.name,
        description: opt.description,
        price_cents: opt.priceCents,
        labor_included: opt.laborIncluded,
        deposit_payment_method: opt.depositPaymentMethod,
        deposit_payment_handle: opt.depositPaymentHandle,
        deposit_amount_cents: opt.depositAmountCents,
        config_id: opt.configId ?? null,
        position,
      })
      .select('id')
      .single()
    if (optionError) throw optionError
    if (opt.items.length === 0) return
    const { error: itemsError } = await this.supabase.from('quote_items').insert(
      opt.items.map((item, j) => ({
        quote_option_id: option.id,
        brand: item.brand,
        model: item.model,
        name: item.name,
        quantity: item.quantity,
        description: item.description,
        category: item.category ?? null,
        image_url: item.imageUrl ?? null,
        position: j,
      })),
    )
    if (itemsError) throw itemsError
  }

  async updateQuote(quoteId: string, input: NewQuoteInput): Promise<Quote> {
    const { data: existing, error: existingError } = await this.supabase
      .from('quotes')
      .select('id, customer_id')
      .eq('id', quoteId)
      .single()
    if (existingError) throw existingError

    const now = new Date().toISOString()
    const { error: customerError } = await this.supabase
      .from('customers')
      .update({
        first_name: input.customer.firstName,
        last_name: input.customer.lastName,
        email: input.customer.email,
        phone: input.customer.phone,
        vehicle_year: input.customer.vehicleYear,
        vehicle_make: input.customer.vehicleMake,
        vehicle_model: input.customer.vehicleModel,
        vehicle_trim: input.customer.vehicleTrim,
        source: input.customer.source,
        email_contact_permission_confirmed: input.customer.emailContactPermissionConfirmed,
        // Only stamp the confirmation time on the transition into confirmed —
        // re-saving an already-confirmed customer must not keep moving it.
        ...(input.customer.emailContactPermissionConfirmed ? { email_contact_permission_confirmed_at: now } : {}),
      })
      .eq('id', existing.customer_id)
    if (customerError) throw customerError

    // status / public_token / last_emailed_at are deliberately untouched —
    // editing what a quote says must not reset where it is in its lifecycle
    // or invalidate a link already sitting in a customer's inbox.
    const { data: quote, error: quoteError } = await this.supabase
      .from('quotes')
      .update({
        internal_notes: input.quote.internalNotes,
        expiration_date: input.quote.expirationDate,
        next_follow_up_at: input.quote.nextFollowUpAt,
        window_tints: input.quote.windowTints,
        show_full_addon_total: input.quote.showFullAddonTotal ?? false,
      })
      .eq('id', quoteId)
      .select('*')
      .single()
    if (quoteError) throw quoteError

    // Full replace: quote_items cascade off quote_options, so dropping the
    // options is enough to clear both levels before reinserting.
    const { error: deleteError } = await this.supabase.from('quote_options').delete().eq('quote_id', quoteId)
    if (deleteError) throw deleteError
    for (const [i, opt] of input.options.entries()) {
      await this.insertOption(quoteId, opt, i)
    }

    await this.addEvent(quoteId, 'edited')
    return mapQuote(quote)
  }

  async deleteQuote(quoteId: string): Promise<void> {
    const { error } = await this.supabase.from('quotes').delete().eq('id', quoteId)
    if (error) throw error
  }

  private async addEvent(quoteId: string, eventType: string, metadata: Row = {}): Promise<void> {
    const { data: user } = await this.supabase.auth.getUser()
    await this.supabase.from('quote_events').insert({
      quote_id: quoteId,
      event_type: eventType,
      metadata,
      created_by: user.user?.id ?? null,
    })
  }

  async setQuoteStatus(quoteId: string, status: QuoteStatus, wonAmountCents?: number | null): Promise<void> {
    const patch: Row = { status }
    if (status === 'won') {
      patch.won_amount_cents = wonAmountCents ?? null
      patch.next_follow_up_at = null
    }
    if (status === 'lost') patch.next_follow_up_at = null
    const { error } = await this.supabase.from('quotes').update(patch).eq('id', quoteId)
    if (error) throw error
    const eventType =
      status === 'won'
        ? 'marked_won'
        : status === 'lost'
          ? 'marked_lost'
          : status === 'booked'
            ? 'appointment_booked'
            : status === 'deposit_paid'
              ? 'deposit_paid'
              : null
    if (eventType) {
      await this.addEvent(quoteId, eventType, status === 'won' ? { wonAmountCents: wonAmountCents ?? null } : {})
    }
  }

  async rescheduleFollowUp(quoteId: string, nextFollowUpAt: string | null): Promise<void> {
    const { error } = await this.supabase
      .from('quotes')
      .update({ next_follow_up_at: nextFollowUpAt })
      .eq('id', quoteId)
    if (error) throw error
    await this.addEvent(quoteId, 'follow_up_rescheduled', { nextFollowUpAt })
  }

  async setFollowUpAllowed(quoteId: string, allowed: boolean): Promise<void> {
    const patch: Row = { email_follow_up_allowed: allowed }
    if (!allowed) patch.next_follow_up_at = null
    const { error } = await this.supabase.from('quotes').update(patch).eq('id', quoteId)
    if (error) throw error
    if (!allowed) await this.addEvent(quoteId, 'follow_up_disabled')
  }

  async markContacted(quoteId: string): Promise<void> {
    await this.addEvent(quoteId, 'marked_contacted')
  }

  async updateInternalNotes(quoteId: string, notes: string | null): Promise<void> {
    const { error } = await this.supabase.from('quotes').update({ internal_notes: notes }).eq('id', quoteId)
    if (error) throw error
  }

  async setShowFullAddonTotal(quoteId: string, show: boolean): Promise<void> {
    const { error } = await this.supabase.from('quotes').update({ show_full_addon_total: show }).eq('id', quoteId)
    if (error) throw error
  }

  /** Sends through the Edge Function; the Resend key never reaches this code. */
  async sendEmail(quoteId: string, templateType: TemplateType): Promise<SendEmailResult> {
    const { data, error } = await this.supabase.functions.invoke('send-quote-email', {
      body: { quoteId, templateType },
    })
    if (error) {
      // The function returns a real, human-readable `message` in its JSON
      // body (e.g. "RESEND_API_KEY is not set" or a column/schema error) —
      // supabase-js's own error.message is just a generic "non-2xx status
      // code" unless the body is read off the attached Response ourselves.
      // Previously this branch threw away that detail entirely, which is
      // exactly why "Check your email setup and try again" gave no signal
      // toward the real cause. Mirrors sendInvoiceEmail's handling above.
      if (error instanceof FunctionsHttpError) {
        const body = await error.context.json().catch(() => null)
        return {
          ok: false,
          status: 'failed',
          message: typeof body?.message === 'string' ? body.message : 'The email could not be sent. Check your email setup and try again.',
        }
      }
      return { ok: false, status: 'failed', message: 'The email could not be sent. Check your connection and try again.' }
    }
    const result = data as { ok: boolean; message?: string }
    return result.ok
      ? { ok: true, status: 'sent', message: 'Email accepted by the email provider.' }
      : { ok: false, status: 'failed', message: result.message ?? 'The email could not be sent.' }
  }

  // ---- Public (anonymous) surface: SECURITY DEFINER RPCs only -------------

  async getPublicQuote(publicToken: string): Promise<PublicQuote | null> {
    const { data, error } = await this.supabase.rpc('get_public_quote', { p_public_token: publicToken })
    if (error) throw error
    return (data as PublicQuote | null) ?? null
  }

  async recordPublicView(publicToken: string, deliveryToken: string | null): Promise<void> {
    // The bare public link (staff previews, old un-tokened links) carries
    // no delivery token -- nothing to record, by construction, rather than
    // by trusting a "this is just a preview" flag from the caller.
    if (!deliveryToken) return
    await this.supabase.rpc('record_quote_delivery_view', {
      p_public_token: publicToken,
      p_delivery_token: deliveryToken,
    })
  }

  async submitPublicResponse(
    publicToken: string,
    responseType: ResponseType,
    optionId: string | null,
    message: string | null,
  ): Promise<void> {
    const { error } = await this.supabase.rpc('submit_public_quote_response', {
      p_public_token: publicToken,
      p_response_type: responseType,
      p_option_id: optionId,
      p_message: message,
    })
    if (error) throw error
  }

  async optOutPublicQuote(publicToken: string): Promise<void> {
    const { error } = await this.supabase.rpc('opt_out_public_quote_email', { p_public_token: publicToken })
    if (error) throw error
  }

  async rotateStaffAccessCode(): Promise<string> {
    const { data, error } = await this.supabase.rpc('rotate_staff_access_code', { p_shop_id: this.shopId })
    if (error) throw error
    return data as string
  }

  async listInventoryDevices(): Promise<InventoryDevice[]> {
    const { data, error } = await this.supabase
      .from('shop_memberships')
      .select('id, device_name, created_at')
      .eq('shop_id', this.shopId)
      .eq('role', 'inventory')
      .order('created_at', { ascending: false })
    if (error) throw error
    return (data as Row[]).map((r) => ({ id: r.id, deviceName: r.device_name ?? null, joinedAt: r.created_at }))
  }

  async revokeInventoryDevice(membershipId: string): Promise<void> {
    const { error } = await this.supabase.rpc('revoke_inventory_device', { p_membership_id: membershipId })
    if (error) throw error
  }

  // -------------------------------------------------------------------
  // Booking (staff side) — see migration 0021_booking_core.sql.
  // -------------------------------------------------------------------

  async listServices(): Promise<Service[]> {
    const { data, error } = await this.supabase
      .from('services')
      .select('*, service_duration_overrides(body_style, duration_minutes)')
      .eq('shop_id', this.shopId)
      .order('position')
    if (error) throw error
    return (data as Row[]).map(mapService)
  }

  async saveService(serviceId: string | null, input: NewServiceInput): Promise<Service> {
    const row = {
      shop_id: this.shopId,
      name: input.name,
      description: input.description,
      duration_minutes: input.durationMinutes,
      price_cents: input.priceCents,
    }
    const { data, error } = await (serviceId
      ? this.supabase.from('services').update(row).eq('id', serviceId).select('*').single()
      : this.supabase.from('services').insert(row).select('*').single())
    if (error) throw error
    const id = (data as Row).id as string

    // Overrides are always fully replaced — same "never a delta" contract
    // financingOffers uses, for the same reason: the caller (a settings
    // form) always has the complete current list, so there's no partial
    // update to reconcile.
    await this.supabase.from('service_duration_overrides').delete().eq('service_id', id)
    if (input.durationOverrides.length > 0) {
      const { error: overrideError } = await this.supabase.from('service_duration_overrides').insert(
        input.durationOverrides.map((o) => ({ service_id: id, body_style: o.bodyStyle, duration_minutes: o.durationMinutes })),
      )
      if (overrideError) throw overrideError
    }

    return mapService({ ...(data as Row), service_duration_overrides: input.durationOverrides.map((o) => ({
      body_style: o.bodyStyle,
      duration_minutes: o.durationMinutes,
    })) })
  }

  async deleteService(serviceId: string): Promise<void> {
    const { error } = await this.supabase.from('services').delete().eq('id', serviceId)
    if (error) throw error
  }

  async listBays(): Promise<Bay[]> {
    const { data, error } = await this.supabase.from('bays').select('*').eq('shop_id', this.shopId).order('position')
    if (error) throw error
    return (data as Row[]).map(mapBay)
  }

  async saveBay(bayId: string | null, name: string): Promise<Bay> {
    const row = { shop_id: this.shopId, name }
    const { data, error } = await (bayId
      ? this.supabase.from('bays').update(row).eq('id', bayId).select('*').single()
      : this.supabase.from('bays').insert(row).select('*').single())
    if (error) throw error
    return mapBay(data as Row)
  }

  async deleteBay(bayId: string): Promise<void> {
    const { error } = await this.supabase.from('bays').delete().eq('id', bayId)
    if (error) throw error
  }

  async listBusinessHours(): Promise<BusinessHoursDay[]> {
    const { data, error } = await this.supabase
      .from('business_hours')
      .select('*')
      .eq('shop_id', this.shopId)
      .order('day_of_week')
    if (error) throw error
    return (data as Row[]).map(mapBusinessHoursDay)
  }

  async saveBusinessHours(hours: BusinessHoursDay[]): Promise<BusinessHoursDay[]> {
    // One row per day of week, upserted on the (shop_id, day_of_week)
    // unique constraint migration 0021 defines — every Settings save writes
    // all 7 days at once, matching how the migration itself backfills them.
    const rows = hours.map((h) => ({
      shop_id: this.shopId,
      day_of_week: h.dayOfWeek,
      is_open: h.isOpen,
      open_time: h.isOpen ? h.openTime : null,
      close_time: h.isOpen ? h.closeTime : null,
    }))
    const { data, error } = await this.supabase
      .from('business_hours')
      .upsert(rows, { onConflict: 'shop_id,day_of_week' })
      .select('*')
    if (error) throw error
    return (data as Row[]).map(mapBusinessHoursDay).sort((a, b) => a.dayOfWeek - b.dayOfWeek)
  }

  async listScheduleExceptions(): Promise<ScheduleException[]> {
    const { data, error } = await this.supabase
      .from('schedule_exceptions')
      .select('*')
      .eq('shop_id', this.shopId)
      .order('exception_date')
    if (error) throw error
    return (data as Row[]).map(mapScheduleException)
  }

  async saveScheduleException(
    exceptionId: string | null,
    ex: Omit<ScheduleException, 'id' | 'shopId'>,
  ): Promise<ScheduleException> {
    const row = {
      shop_id: this.shopId,
      exception_date: ex.date,
      is_closed: ex.isClosed,
      open_time: ex.isClosed ? null : ex.openTime,
      close_time: ex.isClosed ? null : ex.closeTime,
      note: ex.note,
    }
    const { data, error } = await (exceptionId
      ? this.supabase.from('schedule_exceptions').update(row).eq('id', exceptionId).select('*').single()
      : this.supabase.from('schedule_exceptions').insert(row).select('*').single())
    if (error) throw error
    return mapScheduleException(data as Row)
  }

  async deleteScheduleException(exceptionId: string): Promise<void> {
    const { error } = await this.supabase.from('schedule_exceptions').delete().eq('id', exceptionId)
    if (error) throw error
  }

  async listAppointments(rangeStart: string, rangeEnd: string): Promise<Appointment[]> {
    const { data, error } = await this.supabase
      .from('appointments')
      .select('*, customers(first_name, last_name, phone), appointment_services(service_id, name, duration_minutes, price_cents, position)')
      .eq('shop_id', this.shopId)
      .gte('starts_at', rangeStart)
      .lt('starts_at', rangeEnd)
      .order('starts_at')
    if (error) throw error
    return (data as Row[]).map(mapAppointment)
  }

  async createAppointment(input: NewAppointmentInput): Promise<Appointment> {
    let customerId = input.customerId
    if (!customerId) {
      if (!input.customerFirstName) throw new Error('Name is required')
      const { data: customer, error: customerError } = await this.supabase
        .from('customers')
        .insert({
          shop_id: this.shopId,
          first_name: input.customerFirstName,
          last_name: input.customerLastName ?? null,
          // customers.email is NOT NULL at the DB level (quotes always need
          // one) — booking allows phone-only, so this follows the same
          // "empty string, not null" convention the rest of the app uses.
          email: input.customerEmail ?? '',
          phone: input.customerPhone ?? null,
          source: 'staff_booking',
        })
        .select('*')
        .single()
      if (customerError) throw customerError
      customerId = (customer as Row).id as string
    }

    const totalMinutes = input.services.reduce((sum, s) => sum + s.durationMinutes, 0)
    const startsAt = new Date(input.startsAt)
    const endsAt = new Date(startsAt.getTime() + totalMinutes * 60_000).toISOString()

    const { data: user } = await this.supabase.auth.getUser()
    const { data: appt, error: apptError } = await this.supabase
      .from('appointments')
      .insert({
        shop_id: this.shopId,
        bay_id: input.bayId,
        customer_id: customerId,
        source: input.source,
        starts_at: input.startsAt,
        ends_at: endsAt,
        body_style: input.bodyStyle,
        notes: input.notes,
        source_quote_id: input.sourceQuoteId ?? null,
        created_by: user.user?.id ?? null,
      })
      .select('*')
      .single()
    if (apptError) throw apptError
    const appointmentId = (appt as Row).id as string

    const { error: servicesError } = await this.supabase.from('appointment_services').insert(
      input.services.map((s, i) => ({
        appointment_id: appointmentId,
        service_id: s.serviceId,
        name: s.name,
        duration_minutes: s.durationMinutes,
        price_cents: s.priceCents,
        position: i,
      })),
    )
    if (servicesError) throw servicesError

    // Fire-and-forget confirmation email — staff already told the customer
    // verbally on the phone in the common case, but a written confirmation
    // with the manage/cancel link is still worth sending, and never worth
    // blocking "Book & send" on. Same trust model as notifyHighIntent: a
    // failure here must never surface to the person who just booked.
    void this.supabase.functions.invoke('send-booking-email', { body: { publicToken: (appt as Row).public_token } }).catch((err) => {
      console.error('send-booking-email failed', err)
    })

    return mapAppointment({
      ...(appt as Row),
      appointment_services: input.services.map((s, i) => ({
        service_id: s.serviceId, name: s.name, duration_minutes: s.durationMinutes, price_cents: s.priceCents, position: i,
      })),
    })
  }

  async setAppointmentStatus(appointmentId: string, status: Appointment['status']): Promise<void> {
    const row: Row = { status }
    if (status === 'cancelled') row.cancelled_at = new Date().toISOString()
    const { error } = await this.supabase.from('appointments').update(row).eq('id', appointmentId)
    if (error) throw error
  }

  async rescheduleAppointment(appointmentId: string, input: { startsAt: string; bayId: string }): Promise<void> {
    // Duration comes from the snapshotted service lines, not the live catalog
    // — a service whose length was edited since booking must not silently
    // stretch or shrink an appointment that is only being moved.
    const { data: services, error: servicesError } = await this.supabase
      .from('appointment_services')
      .select('duration_minutes')
      .eq('appointment_id', appointmentId)
    if (servicesError) throw servicesError

    const totalMinutes = (services ?? []).reduce((sum: number, s: Row) => sum + ((s.duration_minutes as number) ?? 0), 0)
    if (totalMinutes <= 0) throw new Error('That appointment has no services on it, so it has no length to move.')

    const endsAt = new Date(new Date(input.startsAt).getTime() + totalMinutes * 60_000).toISOString()
    const { error } = await this.supabase
      .from('appointments')
      .update({ starts_at: input.startsAt, bay_id: input.bayId, ends_at: endsAt })
      .eq('id', appointmentId)
      .eq('shop_id', this.shopId)

    if (error) {
      // 23P01 is Postgres's exclusion_violation: the gist constraint from
      // migration 0021 refused because that bay is busy. Someone else booked
      // it between this screen loading and Save being pressed — a race the
      // database closes and the UI only has to explain.
      if ((error as { code?: string }).code === '23P01') {
        throw new Error('That bay is already booked at the new time. Pick another slot.')
      }
      throw error
    }
  }

  async markLabelPrinted(catalogItemId: string): Promise<void> {
    const { error } = await this.supabase
      .from('catalog_items')
      .update({ label_printed_at: new Date().toISOString() })
      .eq('id', catalogItemId)
      .eq('shop_id', this.shopId)
    if (error) throw error
  }

  async markAppointmentReminderSent(appointmentId: string): Promise<void> {
    const { error } = await this.supabase
      .from('appointments')
      .update({ reminder_sent_at: new Date().toISOString() })
      .eq('id', appointmentId)
    if (error) throw error
  }
}

/**
 * A shared-catalog row as an autocomplete suggestion.
 *
 * `referencePriceCents` is a web/manufacturer reference, never another shop's
 * selling price — the shared catalog deliberately carries no shop pricing (see
 * globalCatalog.ts). So what lands in `unitPriceCents` here is a starting
 * point for staff to overwrite, not a competitor's number leaking sideways.
 */
function globalToSuggestion(g: GlobalProductMatch): ProductSuggestion {
  return {
    name: g.name,
    brand: g.brand,
    model: g.model,
    unitPriceCents: g.referencePriceCents,
    imageUrl: g.imageUrl,
    sourceUrl: g.sourceUrl,
  }
}

