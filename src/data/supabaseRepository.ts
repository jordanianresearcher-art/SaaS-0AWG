import { FunctionsHttpError, type SupabaseClient } from '@supabase/supabase-js'
import type {
  CatalogItem,
  Customer,
  EmailMessage,
  Employee,
  Invoice,
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
  ShopifyImportOptions,
  ShopifyImportResult,
  ShopSettingsPatch,
  UpcLookupResult,
} from './repository'

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
    quoteExpirationDays: r.quote_expiration_days ?? 30,
    followUpScheduleDays: r.follow_up_schedule_days ?? [2, 3, 5],
    quoteDisclaimer: r.quote_disclaimer ?? '',
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
    position: r.position,
  }
}

function mapOption(r: Row): QuoteOption {
  return {
    id: r.id,
    quoteId: r.quote_id,
    tier: r.tier,
    name: r.name,
    description: r.description ?? '',
    configId: r.config_id ?? null,
    priceCents: r.price_cents,
    laborIncluded: r.labor_included,
    depositPaymentMethod: r.deposit_payment_method,
    depositPaymentHandle: r.deposit_payment_handle,
    depositAmountCents: r.deposit_amount_cents,
    recommended: r.recommended,
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
    if (patch.quoteExpirationDays !== undefined) row.quote_expiration_days = patch.quoteExpirationDays
    if (patch.followUpScheduleDays !== undefined) row.follow_up_schedule_days = patch.followUpScheduleDays
    if (patch.quoteDisclaimer !== undefined) row.quote_disclaimer = patch.quoteDisclaimer
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

  async findCatalogItemByCode(code: string): Promise<CatalogItem | null> {
    const trimmed = code.trim()
    if (!trimmed) return null
    // Two plain .eq() queries rather than a single .or() — a scanned/typed
    // code lands directly in a PostgREST filter string, and .or()'s syntax
    // treats commas/parens specially, so this avoids ever needing to escape
    // untrusted input into that mini-language at all.
    const { data: byUpc, error: upcError } = await this.supabase
      .from('catalog_items')
      .select('*')
      .eq('shop_id', this.shopId)
      .eq('upc', trimmed)
      .maybeSingle()
    if (upcError) throw upcError
    if (byUpc) return mapCatalogItem(byUpc as Row)

    const { data: bySku, error: skuError } = await this.supabase
      .from('catalog_items')
      .select('*')
      .eq('shop_id', this.shopId)
      .eq('sku', trimmed)
      .maybeSingle()
    if (skuError) throw skuError
    return bySku ? mapCatalogItem(bySku as Row) : null
  }

  async lookupProductByUpc(code: string): Promise<UpcLookupResult> {
    const item = await this.findCatalogItemByCode(code)
    if (item) return { source: 'catalog', catalogItem: item }

    // Any failure reaching the external lookup — a real "nothing known
    // about this code" 404, the function not deployed yet, a network
    // hiccup, whatever — lands the caller in the same place: fall back to
    // manual entry. From a cashier mid-scan, a hard-thrown error here is
    // worse than "not found," so this never throws; it just logs for
    // debugging and degrades gracefully like the rest of this lookup chain
    // already does (see productLookup's local-first, external-optional shape).
    try {
      const { data, error } = await this.supabase.functions.invoke('lookup-product-upc', { body: { code } })
      if (error) {
        if (!(error instanceof FunctionsHttpError) || error.context?.status !== 404) {
          console.error('lookup-product-upc failed', error)
        }
        return { source: 'not_found' }
      }
      return {
        source: 'external',
        name: data.name ?? null,
        brand: data.brand ?? null,
        unitPriceCents: data.unitPriceCents ?? null,
        imageUrl: data.imageUrl ?? null,
        upc: data.upc ?? code,
      }
    } catch (err) {
      console.error('lookup-product-upc failed', err)
      return { source: 'not_found' }
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
    const subtotalCents = input.items.reduce((sum, item) => sum + item.unitPriceCents * item.quantity, 0)
    // invoice_number is assigned by the assign_invoice_number trigger
    // (migration 0011) — never set client-side.
    const { data: invoice, error: invoiceError } = await this.supabase
      .from('invoices')
      .insert({
        shop_id: this.shopId,
        customer_id: input.customerId ?? null,
        status: 'draft',
        subtotal_cents: subtotalCents,
        total_cents: subtotalCents,
        notes: input.notes ?? null,
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
      })
      .select('*')
      .single()
    if (quoteError) throw quoteError

    for (const [i, opt] of input.options.entries()) {
      const { data: option, error: optionError } = await this.supabase
        .from('quote_options')
        .insert({
          quote_id: quote.id,
          tier: opt.tier,
          name: opt.name,
          description: opt.description,
          price_cents: opt.priceCents,
          labor_included: opt.laborIncluded,
          deposit_payment_method: opt.depositPaymentMethod,
          deposit_payment_handle: opt.depositPaymentHandle,
          deposit_amount_cents: opt.depositAmountCents,
          recommended: opt.recommended,
          config_id: opt.configId ?? null,
          position: i,
        })
        .select('id')
        .single()
      if (optionError) throw optionError
      if (opt.items.length > 0) {
        const { error: itemsError } = await this.supabase.from('quote_items').insert(
          opt.items.map((item, j) => ({
            quote_option_id: option.id,
            brand: item.brand,
            model: item.model,
            name: item.name,
            quantity: item.quantity,
            description: item.description,
            category: item.category ?? null,
            position: j,
          })),
        )
        if (itemsError) throw itemsError
      }
    }

    await this.addEvent(quote.id, 'created')
    return mapQuote(quote)
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

  /** Sends through the Edge Function; the Resend key never reaches this code. */
  async sendEmail(quoteId: string, templateType: TemplateType): Promise<SendEmailResult> {
    const { data, error } = await this.supabase.functions.invoke('send-quote-email', {
      body: { quoteId, templateType },
    })
    if (error) {
      return { ok: false, status: 'failed', message: 'The email could not be sent. Check your email setup and try again.' }
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

  async recordPublicView(publicToken: string): Promise<void> {
    await this.supabase.rpc('record_public_quote_view', { p_public_token: publicToken })
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
}
