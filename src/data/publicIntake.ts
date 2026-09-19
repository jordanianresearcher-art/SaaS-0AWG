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
  /**
   * The shop's own web address, when it has one.
   *
   * Carried so the review link this page texts says the shop's domain even
   * when the shortcut saved on the phone's home screen is the older platform
   * address. Public either way — it is on every quote the shop sends.
   */
  customDomain: string | null
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
          customDomain: shop.customDomain,
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
        if (!data) return null
        const row = data as Record<string, unknown>
        return {
          shopName: String(row.shopName ?? ''),
          shopLogoUrl: (row.shopLogoUrl as string | null) ?? null,
          shopPrimaryColor: String(row.shopPrimaryColor ?? '#1d4ed8'),
          // Absent until migration 0034 is applied, which is a shop with no
          // domain as far as this page is concerned — the old behaviour.
          customDomain: (row.customDomain as string | null) ?? null,
        }
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
