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
  PackageTemplate,
  PackageTemplateItem,
  Quote,
  QuoteEvent,
  QuoteMessage,
  QuoteOption,
  QuoteResponse,
  ScheduleException,
  Service,
  Shop,
  StockMovement,
  WindowTintConfig,
  WinSource,
} from '../types'
import { computeDefaultDepositCents } from '../lib/paymentMethods'
import { createDefaultWindowTintFormValues, windowTintFormValuesToConfig } from '../lib/windowTint'

// Seeded fictional Dallas shop used by demo mode. Everything is generated
// relative to "now" so the follow-up queue and reports always look alive.

export interface DemoDB {
  shop: Shop
  employees: Employee[]
  customers: Customer[]
  quotes: Quote[]
  options: QuoteOption[]
  events: QuoteEvent[]
  responses: QuoteResponse[]
  emails: EmailMessage[]
  catalogItems: CatalogItem[]
  packageTemplates: PackageTemplate[]
  stockMovements: StockMovement[]
  invoices: Invoice[]
  /** Demo-only plaintext (never how production works — see rotateStaffAccessCode) so /join can be demoed with no backend. */
  staffAccessCode: string
  inventoryDevices: InventoryDevice[]
  services: Service[]
  bays: Bay[]
  businessHours: BusinessHoursDay[]
  scheduleExceptions: ScheduleException[]
  appointments: Appointment[]
  quoteMessages: QuoteMessage[]
  /** Bumped when the seed shape changes so stale localStorage is discarded. */
  seedVersion: number
}

export const DEMO_SEED_VERSION = 18

const SHOP_ID = 'demo-shop'

function daysAgo(now: Date, days: number, hour = 10): string {
  const d = new Date(now)
  d.setDate(d.getDate() - days)
  d.setHours(hour, 15, 0, 0)
  return d.toISOString()
}

function daysAhead(now: Date, days: number, hour = 10): string {
  const d = new Date(now)
  d.setDate(d.getDate() + days)
  d.setHours(hour, 0, 0, 0)
  return d.toISOString()
}

interface QuoteSeed {
  key: string
  customer: Omit<Customer, 'id' | 'shopId' | 'createdAt' | 'updatedAt' | 'emailContactPermissionConfirmedAt'>
  quote: Pick<
    Quote,
    'status' | 'internalNotes' | 'emailFollowUpAllowed' | 'wonAmountCents'
  > & {
    createdDaysAgo: number
    expirationDaysAhead: number | null
    lastEmailedDaysAgo: number | null
    nextFollowUpInDays: number | null
    windowTints?: WindowTintConfig[]
    winSource?: WinSource
  }
  /** First entry is always the main package; any further entries are add-ons priced as the incremental cost on top of it (see OptionKind in types.ts). */
  options: Array<{
    optionKind: QuoteOption['optionKind']
    name: string
    description: string
    priceCents: number
    items: Array<{ brand: string; model: string; name: string; quantity: number }>
  }>
  emails: Array<{ templateType: EmailMessage['templateType']; daysAgo: number; status: EmailMessage['status'] }>
  events: Array<{ type: QuoteEvent['eventType']; daysAgo: number; meta?: Record<string, string | number | boolean | null> }>
  responses: Array<{ type: QuoteResponse['responseType']; daysAgo: number; message: string | null; optionIndex?: number }>
}

const SEEDS: QuoteSeed[] = [
  {
    key: 'f150-marcus',
    customer: {
      firstName: 'Marcus', lastName: 'Bell', phone: '214-555-0142', email: 'marcus.bell@example.com',
      vehicleYear: 2022, vehicleMake: 'Ford', vehicleModel: 'F-150', vehicleTrim: 'Lariat',
      source: 'Walk-in', emailContactPermissionConfirmed: true, emailOptOutAt: null,
    },
    quote: {
      status: 'viewed', internalNotes: 'Wants clean install, keeps rear seat storage. Leaning Better.',
      emailFollowUpAllowed: true, wonAmountCents: null,
      createdDaysAgo: 4, expirationDaysAhead: 26, lastEmailedDaysAgo: 3, nextFollowUpInDays: 0,
      windowTints: [
        windowTintFormValuesToConfig({
          ...createDefaultWindowTintFormValues('truck_crew_cab', 'Full vehicle'),
          tintType: 'ceramic',
          price: '450',
          windows: createDefaultWindowTintFormValues('truck_crew_cab').windows.map((w) => ({ ...w, vltPercent: 20 })),
          windshieldIncluded: true,
          windshieldVltPercent: 70,
          windshieldPrice: '120',
        }),
      ],
    },
    options: [
      {
        optionKind: 'main', name: 'Complete system', description: 'Real low end with a hidden 10" sub under the rear seat.',
        priceCents: 289900,
        items: [
          { brand: 'JL Audio', model: 'XD600/6v2', name: '6-channel amplifier', quantity: 1 },
          { brand: 'JL Audio', model: 'Stealthbox', name: 'Under-seat 10" subwoofer', quantity: 1 },
          { brand: 'Focal', model: 'PS 165', name: 'Front component speakers', quantity: 1 },
        ],
      },
      {
        optionKind: 'addon', name: 'DSP tune + show-truck front stage', description: 'Full front-stage rebuild with a dedicated DSP tune.',
        priceCents: 260000,
        items: [
          { brand: 'Audison', model: 'Forza AF M8.14 bit', name: 'DSP amplifier', quantity: 1 },
          { brand: 'Focal', model: 'ES 165 K2', name: 'K2 Power front stage', quantity: 1 },
          { brand: 'JL Audio', model: '12TW3', name: 'Custom sub enclosure build', quantity: 1 },
        ],
      },
    ],
    emails: [{ templateType: 'initial', daysAgo: 3, status: 'demo_sent' }],
    events: [
      { type: 'created', daysAgo: 4 },
      { type: 'email_demo_sent', daysAgo: 3, meta: { templateType: 'initial' } },
      { type: 'quote_viewed', daysAgo: 2 },
    ],
    responses: [],
  },
  {
    key: 'silverado-dana',
    customer: {
      firstName: 'Dana', lastName: 'Whitfield', phone: '972-555-0178', email: 'dana.whitfield@example.com',
      vehicleYear: 2021, vehicleMake: 'Chevrolet', vehicleModel: 'Silverado 1500', vehicleTrim: 'LT',
      source: 'Phone call', emailContactPermissionConfirmed: true, emailOptOutAt: null,
    },
    quote: {
      status: 'responded', internalNotes: 'Asked about financing on the Better package.',
      emailFollowUpAllowed: true, wonAmountCents: null,
      createdDaysAgo: 6, expirationDaysAhead: 24, lastEmailedDaysAgo: 4, nextFollowUpInDays: 1,
    },
    options: [
      {
        optionKind: 'main', name: 'Complete system', description: 'Amp + shallow sub behind the seat.',
        priceCents: 259900,
        items: [
          { brand: 'Alpine', model: 'S-A55V', name: '5-channel amplifier', quantity: 1 },
          { brand: 'Alpine', model: 'SS-SB10', name: 'Shallow 10" loaded enclosure', quantity: 1 },
        ],
      },
    ],
    emails: [
      { templateType: 'initial', daysAgo: 4, status: 'demo_sent' },
    ],
    events: [
      { type: 'created', daysAgo: 6 },
      { type: 'email_demo_sent', daysAgo: 4, meta: { templateType: 'initial' } },
      { type: 'quote_viewed', daysAgo: 3 },
      { type: 'customer_responded', daysAgo: 3, meta: { responseType: 'need_financing' } },
    ],
    responses: [
      { type: 'need_financing', daysAgo: 3, message: 'Can I split this over a few months?', optionIndex: 0 },
    ],
  },
  {
    key: 'ram-luis',
    customer: {
      firstName: 'Luis', lastName: 'Herrera', phone: '469-555-0111', email: 'luis.herrera@example.com',
      vehicleYear: 2023, vehicleMake: 'RAM', vehicleModel: '1500', vehicleTrim: 'Big Horn',
      source: 'Referral', emailContactPermissionConfirmed: true, emailOptOutAt: null,
    },
    quote: {
      status: 'won', internalNotes: 'Came back after the check-in email. Booked Saturday install.',
      emailFollowUpAllowed: true, wonAmountCents: 319900,
      createdDaysAgo: 12, expirationDaysAhead: 18, lastEmailedDaysAgo: 9, nextFollowUpInDays: null,
      // Matches the note above and the email history: the check-in email is
      // what brought Luis back, so the demo's recovered revenue is a win the
      // app can actually claim.
      winSource: 'follow_up',
    },
    options: [
      {
        optionKind: 'main', name: 'Complete system', description: 'Full four-door speaker swap with amp and sub.',
        priceCents: 319900,
        items: [
          { brand: 'Rockford Fosgate', model: 'T400X4ad', name: '4-channel amplifier', quantity: 1 },
          { brand: 'Rockford Fosgate', model: 'T1650', name: 'Power series speakers', quantity: 2 },
          { brand: 'Rockford Fosgate', model: 'P3-1X12', name: '12" sub in ported enclosure', quantity: 1 },
        ],
      },
    ],
    emails: [
      { templateType: 'initial', daysAgo: 11, status: 'demo_sent' },
      { templateType: 'check_in', daysAgo: 9, status: 'demo_sent' },
    ],
    events: [
      { type: 'created', daysAgo: 12 },
      { type: 'email_demo_sent', daysAgo: 11, meta: { templateType: 'initial' } },
      { type: 'email_demo_sent', daysAgo: 9, meta: { templateType: 'check_in' } },
      { type: 'quote_viewed', daysAgo: 8 },
      { type: 'customer_responded', daysAgo: 8, meta: { responseType: 'ready_to_book' } },
      { type: 'appointment_booked', daysAgo: 7 },
      { type: 'deposit_paid', daysAgo: 7 },
      { type: 'marked_won', daysAgo: 5, meta: { wonAmountCents: 319900, winSource: 'follow_up' } },
    ],
    responses: [{ type: 'ready_to_book', daysAgo: 8, message: 'Saturday work for the install?', optionIndex: 0 }],
  },
  {
    key: 'sierra-pat',
    customer: {
      firstName: 'Pat', lastName: 'Okafor', phone: '214-555-0190', email: 'pat.okafor@example.com',
      vehicleYear: 2020, vehicleMake: 'GMC', vehicleModel: 'Sierra 2500HD', vehicleTrim: 'AT4',
      source: 'Google', emailContactPermissionConfirmed: true, emailOptOutAt: null,
    },
    quote: {
      status: 'emailed', internalNotes: null,
      emailFollowUpAllowed: true, wonAmountCents: null,
      createdDaysAgo: 8, expirationDaysAhead: 22, lastEmailedDaysAgo: 7, nextFollowUpInDays: -2,
    },
    options: [
      {
        optionKind: 'main', name: 'Complete system', description: 'Speakers plus hideaway sub and amp.',
        priceCents: 219900,
        items: [
          { brand: 'Kicker', model: 'Hideaway HS10', name: 'Compact powered sub', quantity: 1 },
          { brand: 'Kicker', model: 'KEY500.1', name: 'Mono amplifier', quantity: 1 },
        ],
      },
      {
        optionKind: 'addon', name: 'Full custom system with DSP', description: 'Upgrade to a DSP 5-channel amp and a custom build.',
        priceCents: 250000,
        items: [{ brand: 'JL Audio', model: 'VX1000/5i', name: 'DSP 5-channel amp + custom build', quantity: 1 }],
      },
    ],
    emails: [{ templateType: 'initial', daysAgo: 7, status: 'demo_sent' }],
    events: [
      { type: 'created', daysAgo: 8 },
      { type: 'email_demo_sent', daysAgo: 7, meta: { templateType: 'initial' } },
    ],
    responses: [],
  },
  {
    key: 'f150-draft',
    customer: {
      firstName: 'Renee', lastName: 'Castillo', phone: null, email: 'renee.castillo@example.com',
      vehicleYear: 2019, vehicleMake: 'Ford', vehicleModel: 'F-150', vehicleTrim: 'XLT',
      source: 'Walk-in', emailContactPermissionConfirmed: true, emailOptOutAt: null,
    },
    quote: {
      status: 'draft', internalNotes: 'Came in Tuesday, still deciding between sub options. Send tonight.',
      emailFollowUpAllowed: true, wonAmountCents: null,
      createdDaysAgo: 1, expirationDaysAhead: 29, lastEmailedDaysAgo: null, nextFollowUpInDays: null,
    },
    options: [
      {
        optionKind: 'main', name: 'Complete system', description: 'Powered sub that fits under the seat.',
        priceCents: 99900,
        items: [{ brand: 'JL Audio', model: 'ACP110LG-TW1', name: 'Powered 10" Stealthbox', quantity: 1 }],
      },
    ],
    emails: [],
    events: [{ type: 'created', daysAgo: 1 }],
    responses: [],
  },
  {
    key: 'tahoe-gloria',
    customer: {
      firstName: 'Gloria', lastName: 'Nguyen', phone: '972-555-0155', email: 'gloria.nguyen@example.com',
      vehicleYear: 2018, vehicleMake: 'Chevrolet', vehicleModel: 'Tahoe', vehicleTrim: null,
      source: 'Facebook', emailContactPermissionConfirmed: true, emailOptOutAt: null,
    },
    quote: {
      status: 'booked', internalNotes: 'Appointment Thursday 9am. Wants the Good package.',
      emailFollowUpAllowed: true, wonAmountCents: null,
      createdDaysAgo: 9, expirationDaysAhead: 21, lastEmailedDaysAgo: 6, nextFollowUpInDays: 3,
    },
    options: [
      {
        optionKind: 'main', name: 'Complete system', description: 'Replace blown factory speakers, add clean power.',
        priceCents: 164900,
        items: [
          { brand: 'Pioneer', model: 'TS-A652F', name: 'Front + rear speakers', quantity: 1 },
          { brand: 'Pioneer', model: 'GM-D8704', name: '4-channel amplifier', quantity: 1 },
        ],
      },
      {
        optionKind: 'addon', name: '12" sub + sound deadening', description: 'Adds a loaded 12" enclosure and sound deadening.',
        priceCents: 100000,
        items: [{ brand: 'Pioneer', model: 'TS-WX1210AH', name: 'Loaded 12" enclosure', quantity: 1 }],
      },
    ],
    emails: [
      { templateType: 'initial', daysAgo: 8, status: 'demo_sent' },
      { templateType: 'check_in', daysAgo: 6, status: 'demo_sent' },
    ],
    events: [
      { type: 'created', daysAgo: 9 },
      { type: 'email_demo_sent', daysAgo: 8, meta: { templateType: 'initial' } },
      { type: 'quote_viewed', daysAgo: 7 },
      { type: 'email_demo_sent', daysAgo: 6, meta: { templateType: 'check_in' } },
      { type: 'customer_responded', daysAgo: 5, meta: { responseType: 'ready_to_book' } },
      { type: 'appointment_booked', daysAgo: 4 },
    ],
    responses: [{ type: 'ready_to_book', daysAgo: 5, message: null, optionIndex: 0 }],
  },
  {
    key: 'ram-lost',
    customer: {
      firstName: 'Troy', lastName: 'Simmons', phone: '469-555-0132', email: 'troy.simmons@example.com',
      vehicleYear: 2017, vehicleMake: 'RAM', vehicleModel: '2500', vehicleTrim: 'Laramie',
      source: 'Walk-in', emailContactPermissionConfirmed: true, emailOptOutAt: null,
    },
    quote: {
      status: 'lost', internalNotes: 'Went with a buddy install. Keep on file for the next truck.',
      emailFollowUpAllowed: false, wonAmountCents: null,
      createdDaysAgo: 13, expirationDaysAhead: null, lastEmailedDaysAgo: 10, nextFollowUpInDays: null,
    },
    options: [
      {
        optionKind: 'main', name: 'Complete system', description: 'Basic sub + amp package.',
        priceCents: 119900,
        items: [{ brand: 'MTX', model: 'TNP212D2', name: 'Dual 12" package with amp', quantity: 1 }],
      },
    ],
    emails: [
      { templateType: 'initial', daysAgo: 12, status: 'demo_sent' },
      { templateType: 'check_in', daysAgo: 10, status: 'demo_sent' },
    ],
    events: [
      { type: 'created', daysAgo: 13 },
      { type: 'email_demo_sent', daysAgo: 12, meta: { templateType: 'initial' } },
      { type: 'email_demo_sent', daysAgo: 10, meta: { templateType: 'check_in' } },
      { type: 'customer_responded', daysAgo: 9, meta: { responseType: 'not_interested' } },
      { type: 'marked_lost', daysAgo: 9 },
    ],
    responses: [{ type: 'not_interested', daysAgo: 9, message: 'Going a different route, thanks though.' }],
  },
  {
    key: 'mustang-april',
    customer: {
      firstName: 'April', lastName: 'Danvers', phone: '214-555-0166', email: 'april.danvers@example.com',
      vehicleYear: 2024, vehicleMake: 'Ford', vehicleModel: 'Mustang', vehicleTrim: 'GT',
      source: 'Instagram', emailContactPermissionConfirmed: true, emailOptOutAt: null,
    },
    quote: {
      status: 'responded', internalNotes: 'Payday is the 1st — she asked us to ping her after.',
      emailFollowUpAllowed: true, wonAmountCents: null,
      createdDaysAgo: 5, expirationDaysAhead: 25, lastEmailedDaysAgo: 4, nextFollowUpInDays: 0,
      // Two named scenarios, same as she's comparing two pricing options —
      // showcases a quote carrying more than one tint entry.
      windowTints: [
        windowTintFormValuesToConfig({
          ...createDefaultWindowTintFormValues('coupe', 'Full vehicle, ceramic'),
          tintType: 'ceramic',
          price: '380',
          removeOldTint: true,
          removeOldTintPrice: '50',
          windows: createDefaultWindowTintFormValues('coupe').windows.map((w) => ({
            ...w,
            vltPercent: w.position === 'back_glass' ? 5 : 35,
          })),
          windshieldIncluded: false,
          windshieldVltPercent: null,
          windshieldPrice: '',
        }),
        windowTintFormValuesToConfig({
          ...createDefaultWindowTintFormValues('coupe', 'Front two only, normal film'),
          tintType: 'normal',
          price: '150',
          windows: createDefaultWindowTintFormValues('coupe').windows.map((w) => ({
            ...w,
            included: w.position === 'front_left' || w.position === 'front_right',
            vltPercent: w.position === 'front_left' || w.position === 'front_right' ? 35 : null,
          })),
        }),
      ],
    },
    options: [
      {
        optionKind: 'main', name: 'Complete system', description: 'Keep the factory dash, upgrade everything behind it.',
        priceCents: 234900,
        items: [
          { brand: 'Morel', model: 'Maximo Ultra 602', name: 'Component front stage', quantity: 1 },
          { brand: 'Helix', model: 'M FOUR DSP', name: 'DSP amplifier', quantity: 1 },
        ],
      },
      {
        optionKind: 'addon', name: 'Competition-grade front stage', description: 'Upgrade to a flagship front stage build with twin 10s.',
        priceCents: 265000,
        items: [{ brand: 'Focal', model: 'Utopia M', name: 'Flagship front stage build', quantity: 1 }],
      },
    ],
    emails: [{ templateType: 'initial', daysAgo: 4, status: 'demo_sent' }],
    events: [
      { type: 'created', daysAgo: 5 },
      { type: 'email_demo_sent', daysAgo: 4, meta: { templateType: 'initial' } },
      { type: 'quote_viewed', daysAgo: 4 },
      { type: 'customer_responded', daysAgo: 4, meta: { responseType: 'after_payday' } },
    ],
    responses: [{ type: 'after_payday', daysAgo: 4, message: 'Get paid on the 1st, hit me up after.' }],
  },
  // Appended last on purpose — demo seeds are positional and inserting one
  // earlier renumbers ids that seeded stock movements already reference.
  //
  // This is the quote that has run out of emails: all three automatic
  // follow-ups have gone out, nothing is scheduled, and nobody has said what
  // happened. In the real pilot twenty-seven quotes looked exactly like this
  // and the win rate was being computed against them. It seeds the "Out of
  // emails — what happened?" bucket so the demo shows the close-out, which is
  // the only thing that keeps that number honest.
  {
    key: 'tundra-omar',
    customer: {
      firstName: 'Omar', lastName: 'Haddad', phone: '469-555-0142', email: 'omar.haddad@example.com',
      vehicleYear: 2021, vehicleMake: 'Toyota', vehicleModel: 'Tundra', vehicleTrim: 'SR5',
      source: 'Walk-in', emailContactPermissionConfirmed: true, emailOptOutAt: null,
    },
    quote: {
      status: 'viewed', internalNotes: 'Opened it twice. Went quiet after the last email.',
      emailFollowUpAllowed: true, wonAmountCents: null,
      createdDaysAgo: 16, expirationDaysAhead: 14, lastEmailedDaysAgo: 3, nextFollowUpInDays: null,
    },
    options: [
      {
        optionKind: 'main', name: 'Rear bass package', description: 'Single 12 under the back seat with a compact amp.',
        priceCents: 149900,
        items: [
          { brand: 'Kicker', model: 'CompR 12', name: '12" subwoofer', quantity: 1 },
          { brand: 'Kicker', model: 'CXA800.1', name: 'Mono amplifier', quantity: 1 },
        ],
      },
    ],
    emails: [
      { templateType: 'initial', daysAgo: 15, status: 'demo_sent' },
      { templateType: 'check_in', daysAgo: 12, status: 'demo_sent' },
      { templateType: 'financing_option', daysAgo: 8, status: 'demo_sent' },
      { templateType: 'final_check_in', daysAgo: 3, status: 'demo_sent' },
    ],
    events: [
      { type: 'created', daysAgo: 16 },
      { type: 'email_demo_sent', daysAgo: 15, meta: { templateType: 'initial' } },
      { type: 'quote_viewed', daysAgo: 14 },
      { type: 'email_demo_sent', daysAgo: 12, meta: { templateType: 'check_in' } },
      { type: 'email_demo_sent', daysAgo: 8, meta: { templateType: 'financing_option' } },
      { type: 'quote_viewed', daysAgo: 7 },
      { type: 'email_demo_sent', daysAgo: 3, meta: { templateType: 'final_check_in' } },
    ],
    responses: [],
  },
]

export function buildDemoData(now: Date = new Date()): DemoDB {
  const shop: Shop = {
    id: SHOP_ID,
    name: 'Big Tex Audio',
    slug: 'big-tex-audio',
    contributesToGlobalCatalog: true,
    phone: '214-555-0100',
    email: 'shop@bigtexaudio.example.com',
    replyToEmail: 'quotes@bigtexaudio.example.com',
    address: '4820 Ross Ave, Dallas, TX 75204',
    website: 'https://bigtexaudio.example.com',
    logoUrl: null,
    primaryColor: '#1d4ed8',
    defaultPaymentMethod: 'cashapp',
    defaultPaymentHandle: '$BigTexAudio',
    financingOffers: [
      { id: 'demo-financing-snap', name: 'Snap Finance', applicationUrl: 'https://snapfinance.com/apply', payoffDays: 100 },
      { id: 'demo-financing-acima', name: 'Acima', applicationUrl: 'https://acima.com/apply', payoffDays: 90 },
    ],
    quoteExpirationDays: 30,
    followUpScheduleDays: [2, 3, 5],
    quoteDisclaimer:
      'Final pricing and compatibility may require vehicle inspection. Products and availability are subject to confirmation by the shop.',
    defaultLowStockThreshold: 3,
    lowStockAlertEmail: 'shop@bigtexaudio.example.com',
    hasStaffAccessCode: true,
    // $20, so the demo shows the awaiting_deposit self-serve path without
    // needing Stripe configured — demo mode fakes payment (see DemoRepository).
    bookingDepositCents: 2000,
    autoFollowUpEnabled: true,
    createdAt: daysAgo(now, 40),
    updatedAt: daysAgo(now, 40),
  }

  const employees: Employee[] = [
    { id: 'demo-user-owner', shopId: SHOP_ID, fullName: 'Ray Delgado', role: 'owner' },
    { id: 'demo-user-manager', shopId: SHOP_ID, fullName: 'Tina Brooks', role: 'manager' },
    { id: 'demo-user-staff', shopId: SHOP_ID, fullName: 'Cole Whitaker', role: 'staff' },
  ]

  const customers: Customer[] = []
  const quotes: Quote[] = []
  const options: QuoteOption[] = []
  const events: QuoteEvent[] = []
  const responses: QuoteResponse[] = []
  const emails: EmailMessage[] = []

  for (const seed of SEEDS) {
    const customerId = `demo-cust-${seed.key}`
    const quoteId = `demo-quote-${seed.key}`
    const created = daysAgo(now, seed.quote.createdDaysAgo)

    customers.push({
      ...seed.customer,
      id: customerId,
      shopId: SHOP_ID,
      emailContactPermissionConfirmedAt: seed.customer.emailContactPermissionConfirmed ? created : null,
      createdAt: created,
      updatedAt: created,
    })

    quotes.push({
      id: quoteId,
      shopId: SHOP_ID,
      customerId,
      createdBy: 'demo-user-staff',
      publicToken: `demo-token-${seed.key}`,
      status: seed.quote.status,
      internalNotes: seed.quote.internalNotes,
      expirationDate:
        seed.quote.expirationDaysAhead !== null ? daysAhead(now, seed.quote.expirationDaysAhead) : null,
      lastEmailedAt: seed.quote.lastEmailedDaysAgo !== null ? daysAgo(now, seed.quote.lastEmailedDaysAgo) : null,
      nextFollowUpAt:
        seed.quote.nextFollowUpInDays !== null
          ? seed.quote.nextFollowUpInDays >= 0
            ? daysAhead(now, seed.quote.nextFollowUpInDays)
            : daysAgo(now, -seed.quote.nextFollowUpInDays)
          : null,
      emailFollowUpAllowed: seed.quote.emailFollowUpAllowed,
      wonAmountCents: seed.quote.wonAmountCents,
      windowTints: seed.quote.windowTints ?? [],
      showFullAddonTotal: false,
      winSource: seed.quote.winSource ?? null,
      createdAt: created,
      updatedAt: created,
    })

    seed.options.forEach((opt, i) => {
      const optionId = `demo-opt-${seed.key}-${i}`
      options.push({
        id: optionId,
        quoteId,
        optionKind: opt.optionKind,
        name: opt.name,
        description: opt.description,
        configId: null,
        priceCents: opt.priceCents,
        laborIncluded: true,
        depositPaymentMethod: shop.defaultPaymentMethod,
        depositPaymentHandle: shop.defaultPaymentHandle,
        depositAmountCents: computeDefaultDepositCents(opt.priceCents),
        position: i,
        items: opt.items.map((item, j) => ({
          id: `demo-item-${seed.key}-${i}-${j}`,
          quoteOptionId: optionId,
          brand: item.brand,
          model: item.model,
          name: item.name,
          quantity: item.quantity,
          description: null,
          category: null,
          imageUrl: null,
          position: j,
        })),
      })
    })

    seed.events.forEach((ev, i) => {
      events.push({
        id: `demo-event-${seed.key}-${i}`,
        quoteId,
        eventType: ev.type,
        metadata: ev.meta ?? {},
        createdBy: ev.type === 'quote_viewed' || ev.type === 'customer_responded' ? null : 'demo-user-staff',
        createdAt: daysAgo(now, ev.daysAgo, 11 + i),
      })
    })

    seed.responses.forEach((r, i) => {
      responses.push({
        id: `demo-resp-${seed.key}-${i}`,
        quoteId,
        quoteOptionId: r.optionIndex !== undefined ? `demo-opt-${seed.key}-${r.optionIndex}` : null,
        responseType: r.type,
        message: r.message,
        createdAt: daysAgo(now, r.daysAgo, 14),
      })
    })

    seed.emails.forEach((e, i) => {
      emails.push({
        id: `demo-email-${seed.key}-${i}`,
        shopId: SHOP_ID,
        quoteId,
        recipientEmail: seed.customer.email,
        templateType: e.templateType,
        subject: `Your quote from ${shop.name}`,
        status: e.status,
        providerMessageId: null,
        errorMessage: null,
        sentBy: 'demo-user-staff',
        createdAt: daysAgo(now, e.daysAgo, 9),
        sentAt: daysAgo(now, e.daysAgo, 9),
        // Deterministic per-seed token — not a real send, but keeps the
        // shape consistent with sendEmail()'s real (crypto-random) one so
        // demo data and freshly-sent demo emails behave the same way.
        deliveryToken: `demo-delivery-${seed.key}-${i}`,
        firstViewedAt: null,
        viewCount: 0,
      })
    })
  }

  // MSRP is deliberately higher than the shop's defaultPriceCents on a few
  // rows below, to demo the msrp-vs-selling-price distinction; every row is
  // importSource: 'manual' / approvalStatus: 'approved' since none of this
  // came through an (unimplemented) Shopify/AI import. Bundled, self-
  // contained products (a loaded enclosure, a sub+amp kit) are left with
  // category: null on purpose — forcing them into one slot would be exactly
  // the kind of fake compatibility claim this catalog model is meant to avoid.
  let catalogPosition = 0
  function demoCatalogItem(
    fields: Pick<CatalogItem, 'brand' | 'model' | 'name' | 'category' | 'defaultPriceCents'> &
      Partial<Pick<CatalogItem, 'msrpCents' | 'specs' | 'quantityOnHand' | 'lowStockThreshold' | 'lastCountedAt' | 'upc'>>,
  ): CatalogItem {
    return {
      id: `demo-cat-${catalogPosition + 1}`,
      shopId: SHOP_ID,
      brand: fields.brand,
      model: fields.model,
      name: fields.name,
      category: fields.category,
      description: null,
      sku: null,
      upc: fields.upc ?? null,
      defaultPriceCents: fields.defaultPriceCents,
      msrpCents: fields.msrpCents ?? null,
      promoPriceCents: null,
      minStaffPriceCents: null,
      costCents: null,
      priceSourceUrl: null,
      priceSourceName: null,
      priceKind: null,
      priceCheckedAt: null,
      imageUrl: null,
      imageSourceUrl: null,
      sourceUrl: null,
      specs: fields.specs ?? null,
      active: true,
      availability: 'available',
      importSource: 'manual',
      externalSourceProductId: null,
      identificationConfidence: null,
      approvalStatus: 'approved',
      position: catalogPosition++,
      quantityOnHand: fields.quantityOnHand ?? 6,
      upcIsGenerated: false,
      labelPrintedAt: null,
      lowStockThreshold: fields.lowStockThreshold ?? null,
      lastCountedAt: fields.lastCountedAt ?? null,
      lowStockAlerted: false,
      lowStockAlertedAt: null,
      shopifyProductId: null,
      shopifyVariantId: null,
      shopifySyncedAt: null,
      shopifySyncError: null,
      shopifyMatchedExisting: false,
      shopifyStatus: 'active',
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    }
  }

  const catalogItems: CatalogItem[] = [
    demoCatalogItem({
      brand: 'Kicker', model: 'CompR 12', name: '12" subwoofer', category: 'subwoofer',
      defaultPriceCents: 14900, msrpCents: 17900, specs: { subwooferSizeInches: 12, impedanceOhms: 2 },
      upc: '612825397048', lastCountedAt: daysAgo(now, 2),
      // Matches the seeded stock movements below: received 10, sold 4.
      quantityOnHand: 6,
    }),
    demoCatalogItem({
      brand: 'Kicker', model: 'CWRT8', name: '8" shallow subwoofer', category: 'subwoofer',
      defaultPriceCents: 9900, msrpCents: 12900, specs: { subwooferSizeInches: 8, impedanceOhms: 4 },
    }),
    demoCatalogItem({
      brand: 'Q-Power', model: 'QBOMB12V', name: 'Ported 12" enclosure', category: 'enclosure',
      defaultPriceCents: 8900,
    }),
    demoCatalogItem({
      brand: 'Rockford Fosgate', model: 'R500X1D', name: 'Mono amplifier', category: 'mono_amp',
      defaultPriceCents: 19900, msrpCents: 22900, specs: { rmsWatts: 500 },
      // Matches the seeded stock movements below: received 6, sold 1 (via demo-invoice-1).
      quantityOnHand: 5,
    }),
    demoCatalogItem({
      brand: 'Rockford Fosgate', model: 'RFK4X', name: '4-gauge amp wiring kit', category: 'wiring_kit',
      defaultPriceCents: 5900, specs: { gaugeAwg: 4, wireMaterial: 'cca' },
      // Matches the seeded stock movements below: received 8, sold 2.
      quantityOnHand: 6,
    }),
    demoCatalogItem({
      brand: 'Rockford Fosgate', model: 'RFK4X-OFC', name: '4-gauge OFC amp wiring kit', category: 'wiring_kit',
      defaultPriceCents: 8900, specs: { gaugeAwg: 4, wireMaterial: 'ofc' },
    }),
    demoCatalogItem({
      brand: 'Rockford Fosgate', model: 'RFK0X', name: '0-gauge amp wiring kit', category: 'wiring_kit',
      defaultPriceCents: 9900, specs: { gaugeAwg: 0, wireMaterial: 'cca' },
    }),
    demoCatalogItem({
      brand: 'Rockford Fosgate', model: 'RFK0X-OFC', name: '0-gauge OFC amp wiring kit', category: 'wiring_kit',
      defaultPriceCents: 14900, specs: { gaugeAwg: 0, wireMaterial: 'ofc' },
    }),
    demoCatalogItem({
      brand: 'Kicker', model: 'KEY200.4', name: '4-channel smart amp', category: 'four_five_channel_amp',
      defaultPriceCents: 24900, msrpCents: 29900,
    }),
    demoCatalogItem({
      brand: 'Focal', model: 'PS 165', name: 'Front component speakers', category: 'door_speaker',
      defaultPriceCents: 29900,
    }),
    demoCatalogItem({
      brand: 'Pioneer', model: 'TS-A652F', name: 'Front + rear speakers', category: 'door_speaker',
      defaultPriceCents: 12900,
    }),
    demoCatalogItem({
      brand: 'Focal', model: 'TN-52', name: '1" silk dome tweeters', category: 'tweeter',
      defaultPriceCents: 8900, upc: '883281024681',
      // Below its own threshold on purpose — demos the low-stock badge/filter.
      quantityOnHand: 2, lowStockThreshold: 4,
    }),
    demoCatalogItem({
      brand: 'PAC', model: 'RP5-GM31', name: 'Factory radio integration harness', category: 'integration_module',
      defaultPriceCents: 6900,
    }),
    demoCatalogItem({
      brand: 'Audio Control', model: 'DM-608', name: '8-channel DSP with app control', category: 'dsp',
      defaultPriceCents: 39900, msrpCents: 44900,
    }),
    demoCatalogItem({
      brand: 'Alpine', model: 'iLX-W670', name: 'CarPlay receiver', category: 'radio',
      defaultPriceCents: 44900,
    }),
    demoCatalogItem({
      brand: 'Kicker', model: 'iQ', name: 'In-dash bass knob', category: 'bass_control',
      defaultPriceCents: 4900,
    }),
    demoCatalogItem({
      brand: 'XS Power', model: 'D3400', name: 'AGM battery upgrade', category: 'battery',
      defaultPriceCents: 24900,
    }),
    demoCatalogItem({
      brand: null, model: null, name: 'Standard bass install labor', category: 'labor',
      defaultPriceCents: 15000,
    }),
    demoCatalogItem({
      brand: 'JL Audio', model: 'Stealthbox', name: 'Under-seat 10" loaded subwoofer enclosure', category: null,
      defaultPriceCents: 54900,
    }),
    demoCatalogItem({
      brand: 'MTX', model: 'TNP212D2', name: 'Dual 12" package with amp', category: null,
      defaultPriceCents: 39900,
    }),
    // Last on purpose: demo ids are positional (demo-cat-N) and the seeded
    // stock movements below reference items by those ids, so new seed items
    // append rather than shift everything after them.
    // An integration part, so the vehicle-fitment flow (detail-page lookup,
    // inventory chooser) is exercisable in demo mode.
    demoCatalogItem({
      brand: 'Metra', model: '99-8215', name: 'Single/double DIN dash kit', category: 'integration',
      defaultPriceCents: 2499, msrpCents: 2999,
      specs: {
        vehicleFitment: [
          { make: 'Toyota', model: 'Tacoma', year_start: 2005, year_end: 2015, note: null },
        ],
      },
      quantityOnHand: 4,
    }),
  ]

  // Package templates: one built the "fast builder" way (approved, no
  // originating quote), one saved from a real quote option (approved,
  // provenance intact), and one still pending_review — showing the owner
  // review queue with a genuinely incomplete build (no wiring kit yet).
  let packagePosition = 0
  function packageItem(
    fields: Pick<PackageTemplateItem, 'brand' | 'model' | 'name' | 'quantity' | 'category'>,
  ): PackageTemplateItem {
    return {
      id: `demo-pkg-item-${packagePosition}`,
      packageTemplateId: '', // filled in below once the template id is known
      brand: fields.brand,
      model: fields.model,
      name: fields.name,
      quantity: fields.quantity,
      description: null,
      category: fields.category,
      imageUrl: null,
      position: packagePosition++,
    }
  }

  function demoPackageTemplate(fields: {
    id: string
    name: string
    description: string
    configId: string
    vehicleTypes: PackageTemplate['vehicleTypes']
    installedPriceCents: number
    approvalStatus: PackageTemplate['approvalStatus']
    sourceQuoteId?: string | null
    sourceQuoteOptionId?: string | null
    items: PackageTemplateItem[]
  }): PackageTemplate {
    packagePosition = 0
    return {
      id: fields.id,
      shopId: SHOP_ID,
      name: fields.name,
      description: fields.description,
      configId: fields.configId,
      vehicleTypes: fields.vehicleTypes,
      installedPriceCents: fields.installedPriceCents,
      laborIncluded: true,
      source: 'staff_saved',
      approvalStatus: fields.approvalStatus,
      sourceQuoteId: fields.sourceQuoteId ?? null,
      sourceQuoteOptionId: fields.sourceQuoteOptionId ?? null,
      createdBy: 'demo-user-owner',
      createdAt: daysAgo(now, 20),
      updatedAt: daysAgo(now, 20),
      items: fields.items.map((item, i) => ({ ...item, packageTemplateId: fields.id, position: i })),
    }
  }

  const packageTemplates: PackageTemplate[] = [
    demoPackageTemplate({
      id: 'demo-pkg-truck-2x8',
      name: 'Truck 2×8 Starter',
      description: 'Punchier, deeper bass without giving up the back seat.',
      configId: 'bass_2x8',
      vehicleTypes: ['truck'],
      installedPriceCents: 79900,
      approvalStatus: 'approved',
      items: [
        packageItem({ brand: 'Kicker', model: 'CWRT8', name: '8" shallow subwoofer', quantity: 2, category: 'subwoofer' }),
        packageItem({ brand: null, model: null, name: 'Sealed dual 8" enclosure', quantity: 1, category: 'enclosure' }),
        packageItem({ brand: 'Rockford Fosgate', model: 'R500X1D', name: 'Mono amplifier', quantity: 1, category: 'mono_amp' }),
        packageItem({ brand: 'Rockford Fosgate', model: 'RFK4X', name: '4-gauge amp wiring kit', quantity: 1, category: 'wiring_kit' }),
        packageItem({ brand: null, model: null, name: 'Standard bass install labor', quantity: 1, category: 'labor' }),
      ],
    }),
    demoPackageTemplate({
      id: 'demo-pkg-car-1x12',
      name: 'Daily Bass 1×12',
      description: 'One clean 12-inch sub for daily-driver bass, nothing flashy.',
      configId: 'bass_1x12',
      vehicleTypes: ['car', 'sedan', 'hatchback', 'suv'],
      installedPriceCents: 59900,
      approvalStatus: 'approved',
      // Saved from a real quote — provenance kept for reference; editing or
      // deleting that quote later never changes this package (see migration
      // 0010_package_templates.sql: these are ON DELETE SET NULL, not a live join).
      sourceQuoteId: 'demo-quote-f150-marcus',
      sourceQuoteOptionId: 'demo-opt-f150-marcus-0',
      items: [
        packageItem({ brand: 'Kicker', model: 'CompR 12', name: '12" subwoofer', quantity: 1, category: 'subwoofer' }),
        packageItem({ brand: 'Q-Power', model: 'QBOMB12V', name: 'Ported 12" enclosure', quantity: 1, category: 'enclosure' }),
        packageItem({ brand: 'Rockford Fosgate', model: 'R500X1D', name: 'Mono amplifier', quantity: 1, category: 'mono_amp' }),
        packageItem({ brand: 'Rockford Fosgate', model: 'RFK4X', name: '4-gauge amp wiring kit', quantity: 1, category: 'wiring_kit' }),
        packageItem({ brand: null, model: null, name: 'Standard bass install labor', quantity: 1, category: 'labor' }),
      ],
    }),
    demoPackageTemplate({
      id: 'demo-pkg-truck-2x10-draft',
      name: 'Weekend Special 2×10 (draft)',
      description: 'Bigger sound for the weekend crowd — still missing a wiring kit.',
      configId: 'bass_2x10',
      vehicleTypes: ['truck'],
      installedPriceCents: 94900,
      approvalStatus: 'pending_review',
      items: [
        packageItem({ brand: 'Kicker', model: 'CompR 12', name: '10" subwoofer', quantity: 2, category: 'subwoofer' }),
        packageItem({ brand: null, model: null, name: 'Ported dual 10" enclosure', quantity: 1, category: 'enclosure' }),
        packageItem({ brand: 'Rockford Fosgate', model: 'R500X1D', name: 'Mono amplifier', quantity: 1, category: 'mono_amp' }),
        packageItem({ brand: null, model: null, name: 'Standard bass install labor', quantity: 1, category: 'labor' }),
      ],
    }),
  ]

  // A short, realistic ledger history for a couple of items so the
  // inventory history view isn't empty in a fresh demo: received 10 subs
  // from Kicker, sold 4 of them (net quantityOnHand of 6, matching the
  // demoCatalogItem default above).
  function stockMovement(fields: {
    id: string
    catalogItemId: string
    movementType: StockMovement['movementType']
    quantityDelta: number
    counterpartyName?: string | null
    sourceInvoiceId?: string | null
    daysAgoCount: number
  }): StockMovement {
    return {
      id: fields.id,
      shopId: SHOP_ID,
      catalogItemId: fields.catalogItemId,
      movementType: fields.movementType,
      quantityDelta: fields.quantityDelta,
      unitCostCents: null,
      counterpartyName: fields.counterpartyName ?? null,
      sourceInvoiceId: fields.sourceInvoiceId ?? null,
      sourceOutgoingOrderId: null,
      note: null,
      createdBy: 'demo-user-owner',
      createdAt: daysAgo(now, fields.daysAgoCount),
    }
  }

  // A walk-in scan-to-invoice sale: one mono amp, paid cash, printed on the
  // spot — showcases the invoice document type end to end (its 'sale' stock
  // movement is linked back via sourceInvoiceId, unlike the two legacy sales
  // below which predate invoice tracking).
  const demoInvoices: Invoice[] = [
    {
      id: 'demo-invoice-1',
      shopId: SHOP_ID,
      customerId: null,
      invoiceNumber: 1,
      status: 'paid',
      paymentMethod: 'cash',
      paymentAmountCents: 19900,
      paidAt: daysAgo(now, 3),
      subtotalCents: 19900,
      totalCents: 19900,
      notes: null,
      taxRate: 0,
      taxCents: 0,
      discountCents: 0,
      customerName: null,
      customerPhone: null,
      customerEmail: null,
      customerAddress: null,
      vehicleYear: null,
      vehicleMake: null,
      vehicleModel: null,
      createdBy: 'demo-user-owner',
      createdAt: daysAgo(now, 3),
      updatedAt: daysAgo(now, 3),
      items: [
        {
          id: 'demo-invoice-item-1',
          invoiceId: 'demo-invoice-1',
          catalogItemId: 'demo-cat-4',
          brand: 'Rockford Fosgate',
          model: 'R500X1D',
          name: 'Mono amplifier',
          quantity: 1,
          unitPriceCents: 19900,
          category: 'mono_amp',
          discountPercent: 0,
          taxable: true,
          position: 0,
        },
      ],
    },
  ]

  const stockMovements: StockMovement[] = [
    stockMovement({
      id: 'demo-stock-1', catalogItemId: 'demo-cat-1', movementType: 'receiving',
      quantityDelta: 10, counterpartyName: 'Kicker Direct (wholesale)', daysAgoCount: 30,
    }),
    stockMovement({
      id: 'demo-stock-2', catalogItemId: 'demo-cat-1', movementType: 'sale',
      quantityDelta: -4, daysAgoCount: 12,
    }),
    stockMovement({
      id: 'demo-stock-3', catalogItemId: 'demo-cat-5', movementType: 'receiving',
      quantityDelta: 8, counterpartyName: 'Rockford Fosgate distributor', daysAgoCount: 25,
    }),
    stockMovement({
      id: 'demo-stock-4', catalogItemId: 'demo-cat-5', movementType: 'sale',
      quantityDelta: -2, daysAgoCount: 5,
    }),
    stockMovement({
      id: 'demo-stock-5', catalogItemId: 'demo-cat-4', movementType: 'receiving',
      quantityDelta: 6, counterpartyName: 'Rockford Fosgate distributor', daysAgoCount: 20,
    }),
    stockMovement({
      id: 'demo-stock-6', catalogItemId: 'demo-cat-4', movementType: 'sale',
      quantityDelta: -1, sourceInvoiceId: 'demo-invoice-1', daysAgoCount: 3,
    }),
  ]

  const inventoryDevices: InventoryDevice[] = [
    { id: 'demo-device-1', deviceName: 'Front counter iPad', joinedAt: daysAgo(now, 14) },
    { id: 'demo-device-2', deviceName: "Marco's phone", joinedAt: daysAgo(now, 2) },
  ]

  // --- Booking (see docs/MVP_PLAN.md §5) ---------------------------------

  const bays: Bay[] = [
    { id: 'demo-bay-1', shopId: SHOP_ID, name: 'Bay 1', active: true, position: 0 },
    { id: 'demo-bay-2', shopId: SHOP_ID, name: 'Bay 2', active: true, position: 1 },
  ]

  const services: Service[] = [
    {
      id: 'demo-svc-audio',
      shopId: SHOP_ID,
      name: 'Car Audio Install',
      description: 'Full system install — speakers, amp, sub, wiring.',
      durationMinutes: 180,
      priceCents: 15000,
      active: true,
      position: 0,
      durationOverrides: [],
    },
    {
      id: 'demo-svc-tint',
      shopId: SHOP_ID,
      name: 'Window Tint',
      description: 'Ceramic or standard film, full vehicle.',
      durationMinutes: 90,
      priceCents: 25000,
      active: true,
      position: 1,
      // Bigger glass takes longer — same reasoning as the tint config's own
      // per-body-style window layout (src/lib/windowTint.ts).
      durationOverrides: [
        { bodyStyle: 'suv_6_window', durationMinutes: 150 },
        { bodyStyle: 'truck_crew_cab', durationMinutes: 120 },
        { bodyStyle: 'minivan', durationMinutes: 150 },
      ],
    },
  ]

  const businessHours: BusinessHoursDay[] = [0, 1, 2, 3, 4, 5, 6].map((dayOfWeek) => ({
    dayOfWeek,
    isOpen: dayOfWeek !== 0,
    openTime: dayOfWeek !== 0 ? '09:00' : null,
    closeTime: dayOfWeek !== 0 ? '18:00' : null,
  }))

  const scheduleExceptions: ScheduleException[] = []

  const apptStart = (daysFromNow: number, hour: number) => {
    const d = new Date(now)
    d.setDate(d.getDate() + daysFromNow)
    d.setHours(hour, 0, 0, 0)
    return d
  }
  const apptEnd = (start: Date, minutes: number) => new Date(start.getTime() + minutes * 60_000).toISOString()

  // Derived from the customer records rather than hardcoded, so a change to a
  // demo customer's name or phone can never leave the calendar showing stale
  // contact details.
  const apptCustomer = (id: string) => {
    const c = customers.find((x) => x.id === id)
    return {
      customerFirstName: c?.firstName ?? '',
      customerLastName: c?.lastName ?? null,
      customerPhone: c?.phone ?? null,
    }
  }

  const appointments: Appointment[] = (() => {
    // The calendar opens on today, so today has to look like a real working
    // day — a prospect who taps Calendar during a demo and sees nothing has
    // just watched the feature fail. Two jobs in progress now, one already
    // finished this morning, then the days ahead.
    const today0900 = apptStart(0, 9)
    const today1300 = apptStart(0, 13)
    const today1600 = apptStart(0, 16)
    const tomorrow930 = apptStart(1, 9)
    const tomorrow1400 = apptStart(1, 14)
    const nextWeek1100 = apptStart(5, 11)
    return [
      {
        id: 'demo-appt-today-1',
        shopId: SHOP_ID,
        bayId: 'demo-bay-1',
        customerId: 'demo-cust-tahoe-gloria',
        ...apptCustomer('demo-cust-tahoe-gloria'),
        source: 'staff',
        status: 'completed',
        startsAt: today0900.toISOString(),
        endsAt: apptEnd(today0900, 150),
        bodyStyle: 'suv_6_window',
        notes: null,
        publicToken: 'demo-appt-token-today-1',
        sourceQuoteId: null,
        depositAmountCents: 2000,
        depositPaidAt: daysAgo(now, 1),
        reminderSentAt: daysAgo(now, 1),
        cancelledAt: null,
        services: [{ serviceId: 'demo-svc-tint', name: 'Window Tint', durationMinutes: 150, priceCents: 25000 }],
        createdAt: daysAgo(now, 4),
        updatedAt: daysAgo(now, 4),
      },
      {
        id: 'demo-appt-today-2',
        shopId: SHOP_ID,
        bayId: 'demo-bay-2',
        customerId: 'demo-cust-f150-marcus',
        ...apptCustomer('demo-cust-f150-marcus'),
        source: 'from_quote',
        status: 'confirmed',
        startsAt: today1300.toISOString(),
        endsAt: apptEnd(today1300, 180),
        bodyStyle: null,
        notes: 'Keeping the rear seat storage — see quote notes.',
        publicToken: 'demo-appt-token-today-2',
        sourceQuoteId: 'demo-quote-f150-marcus',
        depositAmountCents: 2000,
        depositPaidAt: daysAgo(now, 2),
        reminderSentAt: daysAgo(now, 1),
        cancelledAt: null,
        services: [{ serviceId: 'demo-svc-audio', name: 'Car Audio Install', durationMinutes: 180, priceCents: 15000 }],
        createdAt: daysAgo(now, 6),
        updatedAt: daysAgo(now, 2),
      },
      {
        id: 'demo-appt-today-3',
        shopId: SHOP_ID,
        bayId: 'demo-bay-1',
        customerId: 'demo-cust-silverado-dana',
        ...apptCustomer('demo-cust-silverado-dana'),
        source: 'self_serve',
        status: 'awaiting_deposit',
        startsAt: today1600.toISOString(),
        endsAt: apptEnd(today1600, 90),
        bodyStyle: 'truck_crew_cab',
        notes: null,
        publicToken: 'demo-appt-token-today-3',
        sourceQuoteId: null,
        depositAmountCents: 2000,
        depositPaidAt: null,
        reminderSentAt: null,
        cancelledAt: null,
        services: [{ serviceId: 'demo-svc-tint', name: 'Window Tint', durationMinutes: 90, priceCents: 18000 }],
        createdAt: daysAgo(now, 1),
        updatedAt: daysAgo(now, 1),
      },
      {
        id: 'demo-appt-1',
        shopId: SHOP_ID,
        bayId: 'demo-bay-1',
        customerId: 'demo-cust-f150-marcus',
        ...apptCustomer('demo-cust-f150-marcus'),
        source: 'staff',
        status: 'confirmed',
        startsAt: tomorrow930.toISOString(),
        endsAt: apptEnd(tomorrow930, 180),
        bodyStyle: null,
        notes: null,
        publicToken: 'demo-appt-token-1',
        sourceQuoteId: 'demo-quote-f150-marcus',
        depositAmountCents: null,
        depositPaidAt: null,
        reminderSentAt: null,
        cancelledAt: null,
        services: [{ serviceId: 'demo-svc-audio', name: 'Car Audio Install', durationMinutes: 180, priceCents: 15000 }],
        createdAt: daysAgo(now, 2),
        updatedAt: daysAgo(now, 2),
      },
      {
        id: 'demo-appt-2',
        shopId: SHOP_ID,
        bayId: 'demo-bay-2',
        customerId: 'demo-cust-tahoe-gloria',
        ...apptCustomer('demo-cust-tahoe-gloria'),
        source: 'self_serve',
        status: 'awaiting_deposit',
        startsAt: tomorrow1400.toISOString(),
        endsAt: apptEnd(tomorrow1400, 150),
        bodyStyle: 'suv_6_window',
        notes: null,
        publicToken: 'demo-appt-token-2',
        sourceQuoteId: null,
        depositAmountCents: 2000,
        depositPaidAt: null,
        reminderSentAt: null,
        cancelledAt: null,
        services: [{ serviceId: 'demo-svc-tint', name: 'Window Tint', durationMinutes: 150, priceCents: 25000 }],
        createdAt: daysAgo(now, 1),
        updatedAt: daysAgo(now, 1),
      },
      {
        id: 'demo-appt-3',
        shopId: SHOP_ID,
        bayId: 'demo-bay-1',
        customerId: 'demo-cust-silverado-dana',
        ...apptCustomer('demo-cust-silverado-dana'),
        source: 'staff',
        status: 'confirmed',
        startsAt: nextWeek1100.toISOString(),
        endsAt: apptEnd(nextWeek1100, 90),
        bodyStyle: null,
        notes: 'Customer requested morning slot.',
        publicToken: 'demo-appt-token-3',
        sourceQuoteId: null,
        depositAmountCents: null,
        depositPaidAt: null,
        reminderSentAt: null,
        cancelledAt: null,
        services: [{ serviceId: 'demo-svc-tint', name: 'Window Tint', durationMinutes: 90, priceCents: 25000 }],
        createdAt: daysAgo(now, 3),
        updatedAt: daysAgo(now, 3),
      },
    ]
  })()

  return {
    shop, employees, customers, quotes, options, events, responses, emails, catalogItems, packageTemplates,
    stockMovements,
    invoices: demoInvoices,
    staffAccessCode: 'DEMO-2468',
    inventoryDevices,
    services,
    bays,
    businessHours,
    scheduleExceptions,
    appointments,
    // A live conversation on the quote whose customer asked to be contacted
    // after payday. The demo needs the thread to already have two sides to
    // it — an empty chat box demonstrates nothing.
    quoteMessages: (() => {
      // Pinned to one seed by token, not by status. Two seeds are
      // 'responded', and "whichever comes first" is how a demo ends up with
      // its conversation attached to a different customer than the one the
      // script talks about.
      const target = quotes.find((q) => q.publicToken === 'demo-token-mustang-april')
      if (!target) return []
      return [
        {
          id: 'demo-msg-1',
          quoteId: target.id,
          sender: 'customer' as const,
          body: 'Get paid on the 1st. Can you still do that price then?',
          createdAt: daysAgo(now, 2),
          readAt: daysAgo(now, 2),
        },
        {
          id: 'demo-msg-2',
          quoteId: target.id,
          sender: 'shop' as const,
          body: "Yes — that price is good through the end of the month. Want me to pencil you in for the 2nd?",
          createdAt: daysAgo(now, 2),
          readAt: daysAgo(now, 1),
        },
        {
          id: 'demo-msg-3',
          quoteId: target.id,
          sender: 'customer' as const,
          body: 'Perfect. Morning works better for me if you have it.',
          createdAt: daysAgo(now, 1),
          readAt: null,
        },
      ]
    })(),
    seedVersion: DEMO_SEED_VERSION,
  }
}
