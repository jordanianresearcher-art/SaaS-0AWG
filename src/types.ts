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

/**
 * What brought a won job back, as staff reported it at Mark won.
 *
 * NULL on a quote means the question was never asked — every win recorded
 * before 2026-09, plus anyone who skips it. That is deliberately distinct
 * from 'unsure', which means the app asked and nobody knew.
 *
 * The labels and the app/shop attribution split live in src/lib/winSource.ts,
 * and the same six values are enforced by a check constraint in migration
 * 0027. All three lists have to move together.
 */
export type WinSource =
  | 'quote_reply'
  | 'follow_up'
  | 'financing'
  | 'we_reached_out'
  | 'walked_in'
  | 'unsure'

/**
 * Replaces the old good/better/insane tier system: a quote has exactly one
 * 'main' package (the base price) and any number of 'addon' options, each
 * priced as the *incremental* cost to add that upsell on top of the main
 * package — not a full alternative price the way a tier used to be. See
 * src/lib/quotePricing.ts for the display math this shape enables (price
 * per add-on, running total with each add-on, an optional grand total with
 * everything).
 */
export type OptionKind = 'main' | 'addon'

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
  | 'edited'
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
  /** Staff corrected the final sale amount on an already-won quote. Metadata carries fromCents/toCents. */
  | 'won_amount_edited'
  /** Staff changed what they said brought a won job back. Metadata carries from/to as WinSource | null. */
  | 'win_source_edited'

/**
 * 'inventory' is a low-privilege, shared-device role: a phone/tablet/PC
 * joins with a shop access code (no email account) and gets read/write on
 * catalog_items/stock_movements/invoices/outgoing_orders only — RLS (see
 * migration 0017) walls it off from quotes, customers, and reporting at
 * the database layer, not just in the UI. See docs/INVENTORY_MERGE_PLAN.md.
 */
export type MembershipRole = 'owner' | 'manager' | 'staff' | 'inventory'

export type PaymentMethod = 'link' | 'zelle' | 'cashapp' | 'venmo' | 'paypal'

/** How an invoice was actually paid — broader than PaymentMethod above (that one is specifically for online deposit-payment links on a quote); an invoice is usually paid in person. */
export type InvoicePaymentMethod = 'cash' | 'card' | 'zelle' | 'cashapp' | 'venmo' | 'paypal' | 'link' | 'financed' | 'other'

export type InvoiceStatus = 'draft' | 'paid' | 'void'

export type OutgoingOrderStatus = 'draft' | 'sent'

/**
 * A stock-quantity change on a catalog item. Append-only — quantity_on_hand
 * is derived from these, never edited directly (see apply_stock_movement
 * RPC in migration 0011). 'sale' fires when an invoice's items are marked
 * paid; 'receiving'/'outgoing_order' come from those document types;
 * 'adjustment' covers manual corrections (recount, damage, etc).
 */
export type StockMovementType = 'receiving' | 'outgoing_order' | 'sale' | 'adjustment'

// Shared product taxonomy: what a catalog product IS (for slot-filling —
// see src/lib/audioConfigs.ts) and what vehicle body it fits (for
// configuration matching). Bare unions live here per this file's own
// convention (see TintBodyStyle/TintType below); labels and slot rules are
// business logic and stay in audioConfigs.ts.
export type ProductCategory =
  | 'subwoofer'
  | 'enclosure'
  | 'mono_amp'
  | 'multi_amp'
  // A 4- or 5-channel amp is common enough in car audio (front+rear
  // speakers, or front+rear+sub off the 5th channel) to warrant its own
  // category rather than the generic multi_amp bucket, which still covers
  // 2/3/6+-channel amps.
  | 'four_five_channel_amp'
  | 'wiring_kit'
  | 'integration'
  | 'bass_control'
  | 'battery'
  | 'big_three'
  | 'epicenter'
  | 'integration_module'
  | 'sound_treatment'
  | 'ofc_wiring'
  | 'door_speaker'
  | 'tweeter'
  | 'radio'
  | 'dsp'
  | 'camera'
  | 'fabrication'
  | 'labor'
  | 'accessory'
  | 'other'

export type VehicleType = 'truck' | 'car' | 'sedan' | 'hatchback' | 'suv'

export type ConfigShell = 'bass' | 'door_speakers' | 'full_system' | 'radio' | 'camera' | 'marine' | 'tint'

/** Whether a catalog price is MSRP, regular retail, a temporary sale price, or unconfirmed. */
export type PriceKind = 'msrp' | 'retail' | 'sale' | 'unknown'

export type ProductAvailability = 'not_tracked' | 'available' | 'low_stock' | 'out_of_stock' | 'special_order'

/** Where a catalog product's data originally came from. */
export type ImportSource = 'manual' | 'shopify' | 'ai_photo_import' | 'upc_lookup'

/** Whether an item's Shopify listing is pushed live or held as a draft (e.g. a generated-SKU item with no real photos yet — see src/lib/sku.ts). */
export type ShopifyListingStatus = 'active' | 'draft'

/** AI/import proposals never go live silently — this gates visibility to staff/customers. */
export type ProductApprovalStatus = 'approved' | 'pending_review' | 'rejected'

/** How a package template came to exist. 'ai_drafted' is a later phase (deferred) — declared now so the schema/type doesn't need revisiting when it ships. */
export type PackageTemplateSource = 'staff_saved' | 'ai_drafted'

/**
 * Which generic vehicle silhouette (see src/lib/carDiagrams.ts) and window
 * layout applies to a tint entry. Was a coarse 2-way sedan_coupe/
 * suv_wagon_van split; expanded to 7 real body shapes per explicit request
 * so the diagram and window checklist actually match what's in the shop.
 */
export type TintBodyStyle =
  | 'coupe'
  | 'sedan'
  | 'truck_single_cab'
  | 'truck_crew_cab'
  | 'suv_4_window'
  | 'suv_6_window'
  | 'minivan'

export type TintType = 'normal' | 'ceramic'

export type TintWindowPosition =
  | 'front_left'
  | 'front_right'
  | 'rear_left'
  | 'rear_right'
  | 'rear_quarter_left'
  | 'rear_quarter_right'
  | 'back_glass'

export interface WindowTintWindow {
  position: TintWindowPosition
  included: boolean
  /** One of TINT_VLT_PERCENTS when included, else null. */
  vltPercent: number | null
}

/** 'single' = one panel, 'double' = a big panoramic/dual-panel sunroof. */
export type SunroofType = 'single' | 'double'

export interface WindowTintConfig {
  name: string
  bodyStyle: TintBodyStyle
  tintType: TintType
  windows: WindowTintWindow[]
  /** Base job price, covers all included windows. */
  priceCents: number | null
  removeOldTint: boolean
  removeOldTintPriceCents: number | null
  windshieldIncluded: boolean
  windshieldVltPercent: number | null
  windshieldPriceCents: number | null
  sunroofIncluded: boolean
  sunroofType: SunroofType | null
  sunroofVltPercent: number | null
  sunroofPriceCents: number | null
}

/**
 * A third-party financing application the shop hands customers off to
 * (Snap, Acima, Progressive, …). `applicationUrl` is the shop's own
 * store-specific application link — normally captured by scanning the QR code
 * on the provider's counter card. See src/lib/financing.ts.
 */
export interface FinancingOffer {
  id: string
  name: string
  applicationUrl: string
  /**
   * Days the customer has to clear the balance at the cash price, per this
   * provider's own agreement. Snap's is 100, Acima's and Progressive's are 90.
   *
   * Null means the shop has not entered one, and the emails then say nothing
   * about a payoff window. That is the point: the number goes in a real
   * customer's inbox as a promise about someone else's contract, so it is
   * entered per provider by the shop rather than assumed by the app.
   */
  payoffDays: number | null
}

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
  defaultPaymentMethod: PaymentMethod | null
  defaultPaymentHandle: string | null
  financingOffers: FinancingOffer[]
  quoteExpirationDays: number
  followUpScheduleDays: number[]
  quoteDisclaimer: string
  /** Falls back for any catalog item with no lowStockThreshold of its own — see src/lib/inventory.ts's effectiveThreshold. */
  defaultLowStockThreshold: number
  /** Recipient for the low-stock digest; null = alerts off. */
  lowStockAlertEmail: string | null
  /** Whether a shared-device access code exists — never the code/hash itself (see rotateStaffAccessCode). */
  hasStaffAccessCode: boolean
  /** Shop-wide deposit amount for a self-serve booking; null/0 = no deposit required, self-serve confirms immediately. */
  bookingDepositCents: number | null
  /** When true, due follow-up emails send themselves. Per-quote pause is Quote.emailFollowUpAllowed. */
  autoFollowUpEnabled: boolean
  /**
   * When true, products this shop resolves are contributed to the shared
   * catalog — public product facts only, never pricing, cost, or stock
   * (src/lib/globalCatalog.ts enforces the boundary field by field).
   * Reading the shared catalog is always allowed regardless.
   */
  contributesToGlobalCatalog: boolean
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
  vehicleYear: number | null
  vehicleMake: string | null
  vehicleModel: string | null
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
  /** What component slot this fills (see src/lib/audioConfigs.ts). Null for items with no category set — they simply fill no slot. */
  category: ProductCategory | null
  /** Snapshotted from the catalog item (or resolved candidate) it was added from, if any — lets the customer email/quote page show a picture of what they're getting without a live join back to catalog_items. Null for a freehand-typed item. */
  imageUrl: string | null
  position: number
}

/** A shop-saved product staff can reuse across quotes instead of retyping it. */
export interface CatalogItem {
  id: string
  shopId: string
  brand: string | null
  model: string | null
  name: string
  category: ProductCategory | null
  description: string | null
  sku: string | null
  upc: string | null
  /** The shop's actual selling price — distinct from msrpCents/promoPriceCents below. */
  defaultPriceCents: number | null
  msrpCents: number | null
  promoPriceCents: number | null
  minStaffPriceCents: number | null
  costCents: number | null
  priceSourceUrl: string | null
  priceSourceName: string | null
  priceKind: PriceKind | null
  priceCheckedAt: string | null
  imageUrl: string | null
  imageSourceUrl: string | null
  sourceUrl: string | null
  /** Category-varying structured specs (subwoofer size, impedance, RMS, etc.) — schemaless by design. */
  specs: Record<string, unknown> | null
  active: boolean
  availability: ProductAvailability
  importSource: ImportSource
  externalSourceProductId: string | null
  /** 0-1; null for manually-entered products. */
  identificationConfidence: number | null
  approvalStatus: ProductApprovalStatus
  position: number
  /** Real, ledger-tracked stock count — kept in sync by apply_stock_movement, never hand-edited directly. Opt-in: 0 by default, quoting never requires it. */
  quantityOnHand: number
  /** True when `upc` was generated by this app (see src/lib/upc.ts) rather than a real, looked-up manufacturer code. */
  upcIsGenerated: boolean
  /** Null = still needs a label printed (only meaningful when upcIsGenerated is true). */
  labelPrintedAt: string | null
  /** Per-item override; null falls back to Shop.defaultLowStockThreshold — see src/lib/inventory.ts. */
  lowStockThreshold: number | null
  /** When stock was last physically confirmed via the spot-check flow (/app/inventory/check). Null sorts as most-overdue. */
  lastCountedAt: string | null
  /** True while quantityOnHand is currently below threshold *and* an alert has already fired for this dip — cleared once stock rises back above threshold, so a digest doesn't re-alert on every check. */
  lowStockAlerted: boolean
  lowStockAlertedAt: string | null
  /** Shopify *push* bookkeeping — distinct from the Shopify *import* this app already does (see src/lib/shopifyImport.ts). Null until a push has run. */
  shopifyProductId: string | null
  shopifyVariantId: string | null
  shopifySyncedAt: string | null
  shopifySyncError: string | null
  /** True when this item's Shopify listing was matched to a pre-existing product (price/quantity only) rather than one this app created and fully controls. */
  shopifyMatchedExisting: boolean
  shopifyStatus: ShopifyListingStatus
  createdAt: string
  updatedAt: string
}

/** An append-only stock-quantity change on a catalog item. See StockMovementType. */
export interface StockMovement {
  id: string
  shopId: string
  catalogItemId: string
  movementType: StockMovementType
  /** Signed: positive for receiving/adjustment-up, negative for sale/outgoing_order. */
  quantityDelta: number
  unitCostCents: number | null
  /** Vendor name (receiving) or destination shop name (outgoing_order), free text. */
  counterpartyName: string | null
  sourceInvoiceId: string | null
  sourceOutgoingOrderId: string | null
  note: string | null
  createdBy: string | null
  createdAt: string
}

export interface InvoiceItem {
  id: string
  invoiceId: string
  /** Null for a custom line item with no catalog product behind it (a fee, misc part). */
  catalogItemId: string | null
  brand: string | null
  model: string | null
  name: string
  quantity: number
  unitPriceCents: number
  category: ProductCategory | null
  /** Per-line discount, e.g. a walk-in price break on one item without discounting the whole invoice. */
  discountPercent: number
  /** Whether this line counts toward the invoice's tax_cents — false for e.g. labor in a no-tax-on-labor jurisdiction. */
  taxable: boolean
  position: number
}

/** A single finalized, itemized sale — printed, paid, and tracked. Flat (no tiers), unlike Quote/QuoteOption. */
export interface Invoice {
  id: string
  shopId: string
  customerId: string | null
  /** Sequential per shop (1, 2, 3, ...) — a human-friendly number to print/reference, distinct from id. */
  invoiceNumber: number
  status: InvoiceStatus
  paymentMethod: InvoicePaymentMethod | null
  paymentAmountCents: number | null
  paidAt: string | null
  subtotalCents: number
  totalCents: number
  notes: string | null
  taxRate: number
  taxCents: number
  discountCents: number
  /** Walk-in customer details typed at sale time — not a persisted Customer record (a real customer record is what NewQuotePage's fuller intake is for). */
  customerName: string | null
  customerPhone: string | null
  customerEmail: string | null
  customerAddress: string | null
  vehicleYear: number | null
  vehicleMake: string | null
  vehicleModel: string | null
  createdBy: string | null
  createdAt: string
  updatedAt: string
  items: InvoiceItem[]
}

export interface OutgoingOrderItem {
  id: string
  outgoingOrderId: string
  catalogItemId: string | null
  brand: string | null
  model: string | null
  name: string
  quantity: number
  category: ProductCategory | null
  position: number
}

/** Stock sent to another shop — same shape as Invoice minus payment. */
export interface OutgoingOrder {
  id: string
  shopId: string
  orderNumber: number
  destinationName: string
  status: OutgoingOrderStatus
  notes: string | null
  createdBy: string | null
  createdAt: string
  updatedAt: string
  items: OutgoingOrderItem[]
}

export interface QuoteOption {
  id: string
  quoteId: string
  optionKind: OptionKind
  name: string
  description: string
  /** Which universal configuration (e.g. 'bass_2x8') this option was built against, if any. References AUDIO_CONFIGURATIONS seed data, not a DB table. */
  configId: string | null
  /** For a 'main' option, the full package price. For an 'addon' option, the *incremental* price to add it on top of the main package — see quotePricing.ts. */
  priceCents: number
  laborIncluded: boolean
  depositPaymentMethod: PaymentMethod | null
  depositPaymentHandle: string | null
  depositAmountCents: number | null
  position: number
  items: QuoteItem[]
}

export interface PackageTemplateItem {
  id: string
  packageTemplateId: string
  brand: string | null
  model: string | null
  name: string
  quantity: number
  description: string | null
  category: ProductCategory | null
  /** Snapshotted at save time — stays put even if the source product's image later changes. */
  imageUrl: string | null
  position: number
}

/**
 * A shop-specific, reusable package built against a universal configuration
 * (see src/lib/audioConfigs.ts) from real catalog products. Created either
 * by a staff member saving a quote option (source: 'staff_saved') or, in a
 * later phase, an AI onboarding draft (source: 'ai_drafted') — either way it
 * stays 'pending_review' until an owner/manager approves it. A snapshot:
 * sourceQuoteId/sourceQuoteOptionId are provenance only, never a live
 * reference — editing or deleting the original quote never changes an
 * already-saved package.
 */
export interface PackageTemplate {
  id: string
  shopId: string
  name: string
  description: string
  configId: string | null
  vehicleTypes: VehicleType[]
  installedPriceCents: number | null
  laborIncluded: boolean
  source: PackageTemplateSource
  approvalStatus: ProductApprovalStatus
  sourceQuoteId: string | null
  sourceQuoteOptionId: string | null
  createdBy: string | null
  createdAt: string
  updatedAt: string
  items: PackageTemplateItem[]
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
  windowTints: WindowTintConfig[]
  /** Staff opt-in: show one extra "everything included" total line (main + every add-on) alongside the per-add-on incremental pricing. Off by default. */
  showFullAddonTotal: boolean
  /** What brought this job back. null = never asked; see WinSource. */
  winSource: WinSource | null
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
  /** Opaque per-send token embedded in this email's actual quote link (see send-quote-email) — distinct from the quote's own public_token, which staff use for previews and which never marks a quote opened. */
  deliveryToken: string
  /** Set once, by the trusted record_quote_delivery_view RPC, the first time a real customer opens this specific delivered link. Never set by a staff preview. */
  firstViewedAt: string | null
  /** Deduplicated open count for this delivery — first view sets firstViewedAt and fires a quote_viewed event; repeats only bump this. */
  viewCount: number
}

export interface Employee {
  id: string
  shopId: string
  fullName: string
  role: MembershipRole
}

/**
 * One phone/tablet/PC that joined via a shop access code (role 'inventory'
 * — see join_shop_with_access_code, migration 0017). Named by the device
 * itself at join time so stock_movements.created_by reads back as a real
 * station ("Front counter iPad") rather than an anonymous id.
 */
export interface InventoryDevice {
  /** shop_memberships row id — pass to revokeInventoryDevice. */
  id: string
  deviceName: string | null
  joinedAt: string
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
  /** Feeds the "Book my install" CTA -> /book/:shopSlug?quote=<token>. */
  shopSlug: string
  shopLogoUrl: string | null
  shopPhone: string
  shopEmail: string
  shopAddress: string
  shopPrimaryColor: string
  financingOffers: FinancingOffer[]
  quoteDisclaimer: string
  customerFirstName: string
  vehicle: { year: number | null; make: string | null; model: string | null; trim: string | null }
  windowTints: WindowTintConfig[]
  status: QuoteStatus
  expirationDate: string | null
  optedOut: boolean
  showFullAddonTotal: boolean
  options: Array<{
    id: string
    optionKind: OptionKind
    name: string
    description: string
    priceCents: number
    laborIncluded: boolean
    depositPaymentMethod: PaymentMethod | null
    depositPaymentHandle: string | null
    depositAmountCents: number | null
    items: Array<{ brand: string | null; model: string | null; name: string; quantity: number; description: string | null; imageUrl: string | null }>
  }>
}

// ---------------------------------------------------------------------------
// Booking — see docs/MVP_PLAN.md §5 and src/lib/scheduling.ts. Capacity is
// bays, not staff; body-style duration overrides mirror TintBodyStyle.
// ---------------------------------------------------------------------------

export interface ServiceDurationOverride {
  bodyStyle: TintBodyStyle
  durationMinutes: number
}

export interface Service {
  id: string
  shopId: string
  name: string
  description: string | null
  durationMinutes: number
  priceCents: number | null
  active: boolean
  position: number
  durationOverrides: ServiceDurationOverride[]
}

export interface Bay {
  id: string
  shopId: string
  name: string
  active: boolean
  position: number
}

export interface BusinessHoursDay {
  /** 0 = Sunday .. 6 = Saturday, matching JS Date#getDay(). */
  dayOfWeek: number
  isOpen: boolean
  /** "HH:mm", 24-hour. Null when isOpen is false. */
  openTime: string | null
  closeTime: string | null
}

export interface ScheduleException {
  id: string
  shopId: string
  /** "YYYY-MM-DD", shop-local calendar date. */
  date: string
  isClosed: boolean
  openTime: string | null
  closeTime: string | null
  note: string | null
}

export type AppointmentStatus = 'confirmed' | 'awaiting_deposit' | 'cancelled' | 'completed' | 'no_show'
export type AppointmentSource = 'staff' | 'self_serve' | 'from_quote'

export interface AppointmentServiceLine {
  /** Snapshot — the Service this line was booked from may since be edited or deleted. */
  serviceId: string | null
  name: string
  durationMinutes: number
  priceCents: number | null
}

export interface Appointment {
  id: string
  shopId: string
  bayId: string
  customerId: string
  /** Denormalized from the customer row so the calendar can show who's coming in — and build a tap-to-text reminder — without a second query per appointment. */
  customerFirstName: string
  customerLastName: string | null
  customerPhone: string | null
  source: AppointmentSource
  status: AppointmentStatus
  /** ISO timestamp. */
  startsAt: string
  endsAt: string
  bodyStyle: TintBodyStyle | null
  notes: string | null
  publicToken: string
  sourceQuoteId: string | null
  depositAmountCents: number | null
  depositPaidAt: string | null
  reminderSentAt: string | null
  cancelledAt: string | null
  services: AppointmentServiceLine[]
  createdAt: string
  updatedAt: string
}

/** Everything the public booking wizard (/book/:shopSlug) needs before an appointment exists. PII-free by construction — busyBlocks carry only bay + time, never a customer name. */
export interface PublicBookingPage {
  shopId: string
  shopName: string
  shopPhone: string
  shopAddress: string
  shopPrimaryColor: string
  bookingDepositCents: number | null
  services: Service[]
  bayIds: string[]
  businessHours: BusinessHoursDay[]
  scheduleExceptions: ScheduleException[]
  busyBlocks: Array<{ bayId: string; startsAt: string; endsAt: string }>
}

/** Sanitized shape for the manage page (/booking/:publicToken) — one customer's own appointment, reached with no account. */
export interface PublicAppointment {
  publicToken: string
  status: AppointmentStatus
  startsAt: string
  endsAt: string
  customerFirstName: string
  shopName: string
  shopPhone: string
  shopAddress: string
  shopPrimaryColor: string
  depositAmountCents: number | null
  depositPaidAt: string | null
  services: Array<{ name: string; durationMinutes: number }>
}
