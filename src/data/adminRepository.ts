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

/** A row of the shared product catalog, as an operator sees it. */
export interface AdminGlobalProduct {
  id: string
  barcode: string | null
  brand: string | null
  model: string | null
  name: string
  category: string | null
  referencePriceCents: number | null
  imageUrl: string | null
  sourceUrl: string | null
  /** How many shops independently arrived at this record. */
  contributionCount: number
  verified: boolean
}

/** What one shop holds of a shared product. Platform-admin only. */
export interface AdminProductStock {
  shopId: string
  shopName: string
  quantityOnHand: number
  defaultPriceCents: number | null
  updatedAt: string
}

/** The operator-editable fields. Deliberately excludes contribution_count and the verified stamp, which are earned rather than set. */
export interface GlobalProductPatch {
  brand?: string | null
  model?: string | null
  name?: string
  barcode?: string | null
  referencePriceCents?: number | null
  imageUrl?: string | null
}

export interface AdminRepository {
  listShops(): Promise<AdminShopSummary[]>
  createShop(input: { shopName: string; ownerEmail: string }): Promise<CreateShopResult>
  setShopActive(shopId: string, active: boolean): Promise<void>
  /** Browse the shared catalog. An empty query returns the most-contributed records first. */
  listGlobalProducts(query: string): Promise<AdminGlobalProduct[]>
  updateGlobalProduct(id: string, patch: GlobalProductPatch): Promise<void>
  /**
   * Mark a record as curated. A verified record is frozen against automatic
   * contributions (see migration 0026) — this is how an operator says "this
   * one is right, stop letting shops edit it".
   */
  setGlobalProductVerified(id: string, verified: boolean): Promise<void>
  deleteGlobalProduct(id: string): Promise<void>
  /** Which shops hold this product, and how many. */
  globalProductStock(id: string): Promise<AdminProductStock[]>
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

  async listGlobalProducts(query: string): Promise<AdminGlobalProduct[]> {
    const trimmed = query.trim()

    // An empty query is "show me the catalog", which the search RPC can't
    // express — it matches against a term. Reading the table directly is fine
    // here: RLS already allows any signed-in user to select, and this page is
    // behind the platform-admin gate anyway.
    const base = this.supabase
      .from('global_products')
      .select('id, barcode, brand, model, name, category, reference_price_cents, image_url, source_url, contribution_count, verified_at')

    const { data, error } = trimmed
      ? await base
          .or(`barcode.eq.${trimmed},brand.ilike.%${trimmed}%,model.ilike.%${trimmed}%,name.ilike.%${trimmed}%`)
          .order('contribution_count', { ascending: false })
          .limit(100)
      : await base.order('contribution_count', { ascending: false }).limit(100)

    if (error) throw error
    return ((data as any[]) ?? []).map((r) => ({
      id: r.id,
      barcode: r.barcode ?? null,
      brand: r.brand ?? null,
      model: r.model ?? null,
      name: r.name ?? '',
      category: r.category ?? null,
      referencePriceCents: r.reference_price_cents ?? null,
      imageUrl: r.image_url ?? null,
      sourceUrl: r.source_url ?? null,
      contributionCount: Number(r.contribution_count ?? 1),
      verified: r.verified_at !== null,
    }))
  }

  async updateGlobalProduct(id: string, patch: GlobalProductPatch): Promise<void> {
    const row: Record<string, unknown> = {}
    if (patch.brand !== undefined) row.brand = patch.brand
    if (patch.model !== undefined) row.model = patch.model
    if (patch.name !== undefined) row.name = patch.name
    if (patch.barcode !== undefined) row.barcode = patch.barcode
    if (patch.referencePriceCents !== undefined) row.reference_price_cents = patch.referencePriceCents
    if (patch.imageUrl !== undefined) row.image_url = patch.imageUrl
    if (Object.keys(row).length === 0) return

    const { error } = await this.supabase.from('global_products').update(row).eq('id', id)
    if (error) throw error
  }

  async setGlobalProductVerified(id: string, verified: boolean): Promise<void> {
    const { data: user } = await this.supabase.auth.getUser()
    const { error } = await this.supabase
      .from('global_products')
      .update({
        verified_at: verified ? new Date().toISOString() : null,
        verified_by: verified ? (user.user?.id ?? null) : null,
      })
      .eq('id', id)
    if (error) throw error
  }

  async deleteGlobalProduct(id: string): Promise<void> {
    const { error } = await this.supabase.from('global_products').delete().eq('id', id)
    if (error) throw error
  }

  async globalProductStock(id: string): Promise<AdminProductStock[]> {
    const { data, error } = await this.supabase.rpc('admin_global_product_stock', { p_global_product_id: id })
    if (error) throw error
    return ((data as any[]) ?? []).map((r) => ({
      shopId: r.shop_id,
      shopName: r.shop_name,
      quantityOnHand: Number(r.quantity_on_hand ?? 0),
      defaultPriceCents: r.default_price_cents ?? null,
      updatedAt: r.updated_at,
    }))
  }
}
