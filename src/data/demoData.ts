import type {
  CatalogItem,
  Customer,
  EmailMessage,
  Employee,
  Quote,
  QuoteEvent,
  QuoteOption,
  QuoteResponse,
  Shop,
  WindowTintConfig,
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
  /** Bumped when the seed shape changes so stale localStorage is discarded. */
  seedVersion: number
}

export const DEMO_SEED_VERSION = 7

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
    windowTint?: WindowTintConfig | null
  }
  options: Array<{
    tier: QuoteOption['tier']
    name: string
    description: string
    priceCents: number
    recommended: boolean
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
      windowTint: windowTintFormValuesToConfig({
        ...createDefaultWindowTintFormValues('suv_wagon_van'),
        tintType: 'ceramic',
        price: '450',
        windows: createDefaultWindowTintFormValues('suv_wagon_van').windows.map((w) => ({ ...w, vltPercent: 20 })),
        windshieldIncluded: true,
        windshieldVltPercent: 70,
        windshieldPrice: '120',
      }),
    },
    options: [
      {
        tier: 'good', name: 'Good', description: 'Solid daily-driver upgrade without touching the factory look.',
        priceCents: 189900, recommended: false,
        items: [
          { brand: 'Kicker', model: 'KEY200.4', name: '4-channel smart amp', quantity: 1 },
          { brand: 'Kicker', model: 'DS-Series', name: 'Front + rear speaker set', quantity: 1 },
        ],
      },
      {
        tier: 'better', name: 'Better', description: 'Adds real low end with a hidden 10" sub under the rear seat.',
        priceCents: 289900, recommended: true,
        items: [
          { brand: 'JL Audio', model: 'XD600/6v2', name: '6-channel amplifier', quantity: 1 },
          { brand: 'JL Audio', model: 'Stealthbox', name: 'Under-seat 10" subwoofer', quantity: 1 },
          { brand: 'Focal', model: 'PS 165', name: 'Front component speakers', quantity: 1 },
        ],
      },
      {
        tier: 'insane', name: 'Insane', description: 'Full front-stage rebuild with DSP tune. Show-truck sound.',
        priceCents: 549900, recommended: false,
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
        tier: 'good', name: 'Good', description: 'Head unit + speaker refresh.',
        priceCents: 149900, recommended: false,
        items: [
          { brand: 'Alpine', model: 'iLX-W670', name: 'CarPlay receiver', quantity: 1 },
          { brand: 'Alpine', model: 'S-Series', name: 'Front speakers', quantity: 1 },
        ],
      },
      {
        tier: 'better', name: 'Better', description: 'Adds amp + shallow sub behind the seat.',
        priceCents: 259900, recommended: true,
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
      { type: 'need_financing', daysAgo: 3, message: 'Can I split this over a few months?', optionIndex: 1 },
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
    },
    options: [
      {
        tier: 'good', name: 'Good', description: 'Amp + sub starter package.',
        priceCents: 199900, recommended: false,
        items: [{ brand: 'Rockford Fosgate', model: 'P300-12', name: 'Powered 12" subwoofer', quantity: 1 }],
      },
      {
        tier: 'better', name: 'Better', description: 'Full four-door speaker swap with amp and sub.',
        priceCents: 319900, recommended: true,
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
      { type: 'marked_won', daysAgo: 5, meta: { wonAmountCents: 319900 } },
    ],
    responses: [{ type: 'ready_to_book', daysAgo: 8, message: 'Saturday work for the install?', optionIndex: 1 }],
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
        tier: 'good', name: 'Good', description: 'Fix the flat factory sound.',
        priceCents: 129900, recommended: false,
        items: [{ brand: 'Kicker', model: 'CS-Series', name: 'Front + rear speakers', quantity: 1 }],
      },
      {
        tier: 'better', name: 'Better', description: 'Speakers plus hideaway sub and amp.',
        priceCents: 219900, recommended: true,
        items: [
          { brand: 'Kicker', model: 'Hideaway HS10', name: 'Compact powered sub', quantity: 1 },
          { brand: 'Kicker', model: 'KEY500.1', name: 'Mono amplifier', quantity: 1 },
        ],
      },
      {
        tier: 'insane', name: 'Insane', description: 'Full custom system with DSP.',
        priceCents: 469900, recommended: false,
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
        tier: 'good', name: 'Good', description: 'Powered sub that fits under the seat.',
        priceCents: 99900, recommended: true,
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
        tier: 'good', name: 'Good', description: 'Replace blown factory speakers, add clean power.',
        priceCents: 164900, recommended: true,
        items: [
          { brand: 'Pioneer', model: 'TS-A652F', name: 'Front + rear speakers', quantity: 1 },
          { brand: 'Pioneer', model: 'GM-D8704', name: '4-channel amplifier', quantity: 1 },
        ],
      },
      {
        tier: 'better', name: 'Better', description: 'Adds a 12" sub and sound deadening.',
        priceCents: 264900, recommended: false,
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
        tier: 'good', name: 'Good', description: 'Basic sub + amp package.',
        priceCents: 119900, recommended: true,
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
      windowTint: windowTintFormValuesToConfig({
        ...createDefaultWindowTintFormValues('sedan_coupe'),
        tintType: 'normal',
        price: '250',
        removeOldTint: true,
        removeOldTintPrice: '50',
        windows: createDefaultWindowTintFormValues('sedan_coupe').windows.map((w) => ({
          ...w,
          vltPercent: w.position === 'back_glass' ? 5 : 35,
        })),
        windshieldIncluded: false,
        windshieldVltPercent: null,
        windshieldPrice: '',
      }),
    },
    options: [
      {
        tier: 'better', name: 'Better', description: 'Keep the factory dash, upgrade everything behind it.',
        priceCents: 234900, recommended: true,
        items: [
          { brand: 'Morel', model: 'Maximo Ultra 602', name: 'Component front stage', quantity: 1 },
          { brand: 'Helix', model: 'M FOUR DSP', name: 'DSP amplifier', quantity: 1 },
        ],
      },
      {
        tier: 'insane', name: 'Insane', description: 'Competition-grade front stage and twin 10s.',
        priceCents: 499900, recommended: false,
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
]

export function buildDemoData(now: Date = new Date()): DemoDB {
  const shop: Shop = {
    id: SHOP_ID,
    name: 'Big Tex Audio',
    slug: 'big-tex-audio',
    phone: '214-555-0100',
    email: 'shop@bigtexaudio.example.com',
    replyToEmail: 'quotes@bigtexaudio.example.com',
    address: '4820 Ross Ave, Dallas, TX 75204',
    website: 'https://bigtexaudio.example.com',
    logoUrl: null,
    primaryColor: '#1d4ed8',
    defaultPaymentMethod: 'cashapp',
    defaultPaymentHandle: '$BigTexAudio',
    quoteExpirationDays: 30,
    followUpScheduleDays: [2, 3, 5],
    quoteDisclaimer:
      'Final pricing and compatibility may require vehicle inspection. Products and availability are subject to confirmation by the shop.',
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
      windowTint: seed.quote.windowTint ?? null,
      createdAt: created,
      updatedAt: created,
    })

    seed.options.forEach((opt, i) => {
      const optionId = `demo-opt-${seed.key}-${i}`
      options.push({
        id: optionId,
        quoteId,
        tier: opt.tier,
        name: opt.name,
        description: opt.description,
        priceCents: opt.priceCents,
        laborIncluded: true,
        depositPaymentMethod: shop.defaultPaymentMethod,
        depositPaymentHandle: shop.defaultPaymentHandle,
        depositAmountCents: computeDefaultDepositCents(opt.priceCents),
        recommended: opt.recommended,
        position: i,
        items: opt.items.map((item, j) => ({
          id: `demo-item-${seed.key}-${i}-${j}`,
          quoteOptionId: optionId,
          brand: item.brand,
          model: item.model,
          name: item.name,
          quantity: item.quantity,
          description: null,
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
      })
    })
  }

  const catalogItems: CatalogItem[] = [
    { id: 'demo-cat-1', shopId: SHOP_ID, brand: 'Kicker', model: 'KEY200.4', name: '4-channel smart amp', defaultPriceCents: 24900, position: 0 },
    { id: 'demo-cat-2', shopId: SHOP_ID, brand: 'JL Audio', model: 'Stealthbox', name: 'Under-seat 10" subwoofer', defaultPriceCents: 54900, position: 1 },
    { id: 'demo-cat-3', shopId: SHOP_ID, brand: 'Rockford Fosgate', model: 'T400X4ad', name: '4-channel amplifier', defaultPriceCents: 32900, position: 2 },
    { id: 'demo-cat-4', shopId: SHOP_ID, brand: 'Alpine', model: 'iLX-W670', name: 'CarPlay receiver', defaultPriceCents: 44900, position: 3 },
    { id: 'demo-cat-5', shopId: SHOP_ID, brand: 'Focal', model: 'PS 165', name: 'Front component speakers', defaultPriceCents: 29900, position: 4 },
    { id: 'demo-cat-6', shopId: SHOP_ID, brand: 'Pioneer', model: 'TS-A652F', name: 'Front + rear speakers', defaultPriceCents: 12900, position: 5 },
    { id: 'demo-cat-7', shopId: SHOP_ID, brand: 'MTX', model: 'TNP212D2', name: 'Dual 12" package with amp', defaultPriceCents: 39900, position: 6 },
    { id: 'demo-cat-8', shopId: SHOP_ID, brand: 'JL Audio', model: '12TW3', name: 'Custom sub enclosure build', defaultPriceCents: 64900, position: 7 },
  ]

  return { shop, employees, customers, quotes, options, events, responses, emails, catalogItems, seedVersion: DEMO_SEED_VERSION }
}
