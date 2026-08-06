import type { PublicQuote, ResponseType } from '../types'
import { DemoRepository } from './demoRepository'
import { getSupabase } from './supabaseClient'
import { env, supabaseConfigured } from '../lib/env'

// The public quote page works anonymously in both modes. Demo tokens resolve
// against the local demo database; anything else goes to the Supabase RPCs.

export interface PublicQuoteApi {
  get(): Promise<PublicQuote | null>
  /** deliveryToken comes from the emailed link's ?d= param — null for a bare/staff link, which never records anything. */
  recordView(deliveryToken: string | null): Promise<void>
  submitResponse(responseType: ResponseType, optionId: string | null, message: string | null): Promise<void>
  optOut(): Promise<void>
  /**
   * Best-effort staff email notification for a high-intent response
   * (currently just 'need_financing'/'ready_to_book') — fire-and-forget,
   * called after submitResponse() already succeeded. Never throws; a
   * failure here must never affect the customer's own confirmation.
   * Demo mode never makes a real call.
   */
  notifyHighIntent(responseType: ResponseType): Promise<void>
}

const DEMO_DB_KEY = '0gauge-demo-db'

function demoAvailableFor(token: string): boolean {
  if (!env.demoModeEnabled) return false
  return token.startsWith('demo-token-') || localStorage.getItem(DEMO_DB_KEY) !== null
}

export async function resolvePublicQuoteApi(token: string): Promise<PublicQuoteApi | null> {
  if (demoAvailableFor(token)) {
    const demo = new DemoRepository()
    const found = await demo.getPublicQuote(token)
    if (found) {
      return {
        get: () => demo.getPublicQuote(token),
        recordView: (deliveryToken) => demo.recordPublicView(token, deliveryToken),
        submitResponse: (r, o, m) => demo.submitPublicResponse(token, r, o, m),
        optOut: () => demo.optOutPublicQuote(token),
        // Demo mode must never make a real external call — the shop staff
        // notification is a real email in production only.
        notifyHighIntent: async () => {},
      }
    }
  }
  if (supabaseConfigured) {
    const supabase = getSupabase()
    return {
      get: async () => {
        const { data, error } = await supabase.rpc('get_public_quote', { p_public_token: token })
        if (error) throw error
        return (data as PublicQuote | null) ?? null
      },
      recordView: async (deliveryToken) => {
        if (!deliveryToken) return
        await supabase.rpc('record_quote_delivery_view', { p_public_token: token, p_delivery_token: deliveryToken })
      },
      submitResponse: async (responseType, optionId, message) => {
        const { error } = await supabase.rpc('submit_public_quote_response', {
          p_public_token: token,
          p_response_type: responseType,
          p_option_id: optionId,
          p_message: message,
        })
        if (error) throw error
      },
      optOut: async () => {
        const { error } = await supabase.rpc('opt_out_public_quote_email', { p_public_token: token })
        if (error) throw error
      },
      notifyHighIntent: async (responseType) => {
        // Best-effort, fire-and-forget — a customer's confirmation must
        // never depend on or wait for this. Any failure (function not
        // deployed yet, no Resend secrets, a network hiccup) is swallowed.
        try {
          await supabase.functions.invoke('notify-shop-response', { body: { publicToken: token, responseType } })
        } catch (err) {
          console.error('notify-shop-response failed', err)
        }
      },
    }
  }
  return null
}
