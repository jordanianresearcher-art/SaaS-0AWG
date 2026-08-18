import { FunctionsHttpError, type SupabaseClient } from '@supabase/supabase-js'
import { sanitizeFinancingOffers } from '../lib/financing'
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
  ProductSuggestion,
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

// Production repository. Row-level security scopes every query to shops the
// signed-in user belongs to; the anonymous public page goes through
// SECURITY DEFINER RPCs only. Rows are snake_case — mapped here once.

/* eslint-disable @typescript-eslint/no-explicit-any -- Supabase rows are untyped without codegen; mapped at this boundary only. */
type Row = Record<string, any>

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
  const row: Row = {
    brand: input.brand,
    model: input.model,
    name: input.name,
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
    return mapCatalogItem(data)
  }

  async updateCatalogItem(itemId: string, input: NewCatalogItemInput): Promise<CatalogItem> {
    const { data, error } = await this.supabase
      .from('catalog_items')
      .update(catalogItemRow(input))
      .eq('id', itemId)
      .select('*')
      .single()
    if (error) throw error
    return mapCatalogItem(data)
  }

  async deleteCatalogItem(itemId: string): Promise<void> {
    const { error } = await this.supabase.from('catalog_items').delete().eq('id', itemId)
    if (error) throw error
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

  async lookupProductSuggestions(query: string, brandHint?: string | null): Promise<ProductSuggestion[]> {
    const trimmed = query.trim()
    if (trimmed.length < 2) return []
    const result = await this.resolveProduct({ kind: 'text', query: trimmed, brandHint })
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
    const retainedInput = request.kind === 'barcode' ? request.code : request.kind === 'text' ? request.query : 'photo'
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
        if (!(error instanceof FunctionsHttpError) || error.context?.status !== 404) {
          console.error('resolve-product failed', error)
        }
        return { candidates: [], retainedInput }
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
      return { candidates: rankCandidates(dedupeCandidates(mapped), retainedInput), retainedInput }
    } catch (err) {
      console.error('resolve-product failed', err)
      return { candidates: [], retainedInput }
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
      .select('*, appointment_services(service_id, name, duration_minutes, price_cents, position)')
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

  async markAppointmentReminderSent(appointmentId: string): Promise<void> {
    const { error } = await this.supabase
      .from('appointments')
      .update({ reminder_sent_at: new Date().toISOString() })
      .eq('id', appointmentId)
    if (error) throw error
  }
}
