import type { SupabaseClient } from '@supabase/supabase-js'

// Platform-admin data access. Deliberately separate from DataRepository:
// admin queries span every shop and return aggregate shapes, not the
// per-shop domain objects DemoRepository/SupabaseRepository deal in, and
// there is no demo-mode equivalent.

export interface AdminShopSummary {
  id: string
  name: string
  slug: string
  active: boolean
  createdAt: string
  memberCount: number
  quoteCount: number
}

export interface CreateShopResult {
  shopId: string
  emailSent: boolean
  inviteLink?: string
}

export interface AdminRepository {
  listShops(): Promise<AdminShopSummary[]>
  createShop(input: { shopName: string; ownerEmail: string }): Promise<CreateShopResult>
  setShopActive(shopId: string, active: boolean): Promise<void>
}

/* eslint-disable @typescript-eslint/no-explicit-any -- Supabase RPC rows are untyped without codegen; mapped at this boundary only. */
function mapShopSummary(r: any): AdminShopSummary {
  return {
    id: r.id,
    name: r.name,
    slug: r.slug,
    active: r.active,
    createdAt: r.created_at,
    memberCount: Number(r.member_count),
    quoteCount: Number(r.quote_count),
  }
}

export class SupabaseAdminRepository implements AdminRepository {
  constructor(private supabase: SupabaseClient) {}

  async listShops(): Promise<AdminShopSummary[]> {
    const { data, error } = await this.supabase.rpc('admin_list_shops')
    if (error) throw error
    return ((data as any[]) ?? []).map(mapShopSummary)
  }

  async createShop(input: { shopName: string; ownerEmail: string }): Promise<CreateShopResult> {
    const { data, error } = await this.supabase.functions.invoke('admin-create-shop', {
      body: input,
    })
    if (error) throw error
    const result = data as { ok: boolean; message?: string; shopId?: string; emailSent?: boolean; inviteLink?: string }
    if (!result.ok || !result.shopId) {
      throw new Error(result.message ?? 'Could not create the shop.')
    }
    return { shopId: result.shopId, emailSent: Boolean(result.emailSent), inviteLink: result.inviteLink }
  }

  async setShopActive(shopId: string, active: boolean): Promise<void> {
    const { error } = await this.supabase.rpc('admin_set_shop_active', { p_shop_id: shopId, p_active: active })
    if (error) throw error
  }
}
