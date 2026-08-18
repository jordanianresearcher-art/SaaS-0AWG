import type { AppointmentStatus, PublicAppointment, PublicBookingPage } from '../types'
import { DemoRepository } from './demoRepository'
import { getSupabase } from './supabaseClient'
import { env, supabaseConfigured } from '../lib/env'

// The public booking pages (/book/:shopSlug and /booking/:publicToken) work
// anonymously in both modes, mirroring src/data/publicQuote.ts exactly —
// demo mode resolves against the local demo database, production calls the
// anonymous RPCs from migration 0021_booking_core.sql directly (not through
// SupabaseRepository, which requires an authenticated shopId this page
// never has).

const DEMO_DB_KEY = '0gauge-demo-db'

function demoDbAvailable(): boolean {
  return env.demoModeEnabled && localStorage.getItem(DEMO_DB_KEY) !== null
}

export interface BookAppointmentInput {
  serviceIds: string[]
  /** ISO timestamp. */
  startsAt: string
  bodyStyle: string | null
  customerFirstName: string
  customerLastName: string | null
  customerEmail: string | null
  customerPhone: string | null
  /** Continuing from an already-quoted customer skips re-entering their info — see the "Book my install" CTA on the public quote page. */
  sourceQuotePublicToken: string | null
  notes: string | null
}

export interface PublicBookingApi {
  getBookingPage(): Promise<PublicBookingPage | null>
  bookAppointment(input: BookAppointmentInput): Promise<{ publicToken: string; status: AppointmentStatus }>
}

export async function resolvePublicBookingApi(shopSlug: string): Promise<PublicBookingApi | null> {
  if (demoDbAvailable()) {
    const demo = new DemoRepository()
    const page = await demo.getPublicBookingPage(shopSlug)
    if (page) {
      return {
        getBookingPage: () => demo.getPublicBookingPage(shopSlug),
        bookAppointment: (input) => demo.bookAppointmentPublic(shopSlug, input),
      }
    }
  }
  if (supabaseConfigured) {
    const supabase = getSupabase()
    return {
      getBookingPage: async () => {
        const { data, error } = await supabase.rpc('get_public_booking_page', { p_shop_slug: shopSlug })
        if (error) throw error
        return (data as PublicBookingPage | null) ?? null
      },
      bookAppointment: async (input) => {
        const { data, error } = await supabase.rpc('book_appointment', {
          p_shop_slug: shopSlug,
          p_service_ids: input.serviceIds,
          p_starts_at: input.startsAt,
          p_body_style: input.bodyStyle,
          p_customer_first_name: input.customerFirstName,
          p_customer_last_name: input.customerLastName,
          p_customer_email: input.customerEmail,
          p_customer_phone: input.customerPhone,
          p_source_quote_public_token: input.sourceQuotePublicToken,
          p_notes: input.notes,
        })
        if (error) throw error
        const result = data as { publicToken: string; status: AppointmentStatus }
        return result
      },
    }
  }
  return null
}

export interface PublicAppointmentApi {
  get(): Promise<PublicAppointment | null>
  cancel(): Promise<void>
  /**
   * Demo mode only — flips a deposit to paid instantly with no real
   * payment, standing in for the Stripe Checkout redirect production uses
   * (see Phase 4). Production implementations of this API omit the
   * capability entirely (undefined), and the manage page falls back to a
   * real "pay deposit" link when it's not present.
   */
  fakePayDeposit?(): Promise<void>
}

export async function resolvePublicAppointmentApi(publicToken: string): Promise<PublicAppointmentApi | null> {
  if (demoDbAvailable()) {
    const demo = new DemoRepository()
    const found = await demo.getPublicAppointment(publicToken)
    if (found) {
      return {
        get: () => demo.getPublicAppointment(publicToken),
        cancel: () => demo.cancelAppointmentPublic(publicToken),
        fakePayDeposit: () => demo.fakeDepositPaidPublic(publicToken),
      }
    }
  }
  if (supabaseConfigured) {
    const supabase = getSupabase()
    return {
      get: async () => {
        const { data, error } = await supabase.rpc('get_public_appointment', { p_public_token: publicToken })
        if (error) throw error
        return (data as PublicAppointment | null) ?? null
      },
      cancel: async () => {
        const { error } = await supabase.rpc('cancel_appointment_public', { p_public_token: publicToken })
        if (error) throw error
      },
    }
  }
  return null
}
