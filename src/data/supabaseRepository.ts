import type { SupabaseClient } from '@supabase/supabase-js'
import type {
  CatalogItem,
  Customer,
  EmailMessage,
  Employee,
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
  TemplateType,
} from '../types'
import type { DataRepository, NewCatalogItemInput, NewQuoteInput, SendEmailResult, ShopSettingsPatch } from './repository'

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
    defaultPriceCents: r.default_price_cents,
    position: r.position,
  }
}

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
        brand: input.brand,
        model: input.model,
        name: input.name,
        default_price_cents: input.defaultPriceCents,
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
      .update({
        brand: input.brand,
        model: input.model,
        name: input.name,
        default_price_cents: input.defaultPriceCents,
      })
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
