import { DemoRepository } from './demoRepository'
import { getSupabase } from './supabaseClient'
import { env, supabaseConfigured } from '../lib/env'

// The no-login review intake (/ask/:token), in both modes.
//
// "Public" means no account, not no credential: the token in the URL is the
// credential, and it buys exactly one capability — raise a review request for
// one shop. It reads nothing, and it cannot send a text; the sms: link opens
// the staff member's own phone.

export interface IntakeShop {
  shopName: string
  shopLogoUrl: string | null
  shopPrimaryColor: string
}

export interface IntakeApi {
  shop(): Promise<IntakeShop | null>
  /** Returns the new request's public token, so the page can build the sms: link without a second round trip. */
  create(phone: string, customerName: string): Promise<{ shortCode: string; phone: string; shopName: string }>
}

const DEMO_DB_KEY = '0gauge-demo-db'

function demoAvailableFor(token: string): boolean {
  if (!env.demoModeEnabled) return false
  return token === 'demo-intake-token' || localStorage.getItem(DEMO_DB_KEY) !== null
}

export async function resolveIntakeApi(token: string): Promise<IntakeApi | null> {
  if (demoAvailableFor(token)) {
    const demo = new DemoRepository()
    const shop = await demo.getShop()
    if (shop && shop.reviewIntakeToken === token) {
      return {
        shop: async () => ({
          shopName: shop.name,
          shopLogoUrl: shop.logoUrl,
          shopPrimaryColor: shop.primaryColor,
        }),
        create: async (phone, customerName) => {
          const created = await demo.createReviewRequest({ phone, customerName })
          await demo.markReviewRequestHandedToPhone(created.id)
          return { shortCode: created.shortCode, phone: created.phone, shopName: shop.name }
        },
      }
    }
  }
  if (supabaseConfigured) {
    const supabase = getSupabase()
    return {
      shop: async () => {
        const { data, error } = await supabase.rpc('get_review_intake_shop', { p_intake_token: token })
        if (error) throw error
        return (data as IntakeShop | null) ?? null
      },
      create: async (phone, customerName) => {
        const { data, error } = await supabase.rpc('create_review_intake_request', {
          p_intake_token: token,
          p_phone: phone,
          p_customer_name: customerName || null,
        })
        if (error) throw error
        const row = (data ?? {}) as Record<string, unknown>
        return {
          shortCode: String(row.shortCode ?? ''),
          phone: String(row.phone ?? ''),
          shopName: String(row.shopName ?? ''),
        }
      },
    }
  }
  return null
}
