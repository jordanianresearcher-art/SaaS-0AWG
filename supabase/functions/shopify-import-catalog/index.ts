// Supabase Edge Function: shopify-import-catalog
// Imports a shop's Shopify product catalog into 0Gauge's catalog_items,
// paginated and idempotent — safe to re-run. Owner/manager only.
//
// Deploy:  supabase functions deploy shopify-import-catalog
// Secrets: supabase secrets set SHOPIFY_STORE_DOMAIN=your-shop.myshopify.com \
//            SHOPIFY_ADMIN_ACCESS_TOKEN=shpat_...
//
// This currently supports exactly one Shopify-connected shop per
// deployment (a single global secret pair, same pattern as RESEND_API_KEY)
// — matches the current scope: "for our shop" now, future shops onboard
// via bulk photo upload instead (see docs/CATALOG_AND_PACKAGES.md).
//
// The mapping/sync-decision logic here mirrors src/lib/shopifyImport.ts
// (which is unit-tested against real Super Car Audio product data) —
// duplicated rather than imported cross-directory, the same way
// send-quote-email/index.ts duplicates src/lib/emailTemplates.ts. Update
// both together.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const API_VERSION = '2025-01'
const VARIANTS_PER_PRODUCT = 50
// Each variant costs 2-3 sequential Postgres round trips (existence check, then an
// insert-with-count or an update) on top of the Shopify GraphQL call itself. A real
// run against Super Car Audio's live catalog hit Supabase's Edge Function compute
// quota at the previous, much larger values (50 products/page x 10 pages/invocation)
// — these are deliberately small so one invocation always finishes comfortably
// within budget; the caller (SettingsPage's "Run import" button) already loops on
// `hasMore` until the whole catalog is processed, so a smaller per-call batch just
// means more (automatic) round trips, not a worse import.
const DEFAULT_PRODUCTS_PER_PAGE = 15
const MAX_PAGES_PER_RUN = 1 // caps one invocation's work; caller resumes with the returned cursor

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

function json(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

function fail(status: number, message: string): Response {
  return json(status, { ok: false, message })
}

// --- Category-guessing (mirrors guessCategoryFromProductType) --------------

const PRODUCT_TYPE_CATEGORY_HINTS: Array<{ pattern: RegExp; category: string }> = [
  { pattern: /subwoofer/i, category: 'subwoofer' },
  { pattern: /enclosure|\bbox\b/i, category: 'enclosure' },
  { pattern: /mono.*amp/i, category: 'mono_amp' },
  { pattern: /amp(lifier)?/i, category: 'multi_amp' },
  { pattern: /wiring|wire kit/i, category: 'wiring_kit' },
  { pattern: /coax|component|midrange|tweeter|door speaker|\bspeaker/i, category: 'door_speaker' },
  { pattern: /head unit|receiver|\bradio\b/i, category: 'radio' },
  { pattern: /\bdsp\b|processor/i, category: 'dsp' },
  { pattern: /camera/i, category: 'camera' },
  { pattern: /battery/i, category: 'battery' },
  { pattern: /bass control|bass knob/i, category: 'bass_control' },
]

function guessCategory(productType: string | null): string | null {
  if (!productType) return null
  for (const { pattern, category } of PRODUCT_TYPE_CATEGORY_HINTS) {
    if (pattern.test(productType)) return category
  }
  return null
}

function parseDecimalToCents(value: string | null): number | null {
  if (!value) return null
  const n = Number(value)
  if (!Number.isFinite(n) || n < 0) return null
  return Math.round(n * 100)
}

function mapAvailability(inventoryQuantity: number | null): string {
  if (inventoryQuantity === null) return 'not_tracked'
  if (inventoryQuantity <= 0) return 'out_of_stock'
  if (inventoryQuantity <= 3) return 'low_stock'
  return 'available'
}

type ShopifyVariantNode = {
  id: string
  title: string
  sku: string | null
  barcode: string | null
  price: string
  compareAtPrice: string | null
  inventoryQuantity: number | null
  image: { url: string } | null
}

type ShopifyProductNode = {
  id: string
  title: string
  handle: string
  vendor: string | null
  productType: string | null
  description: string | null
  status: 'ACTIVE' | 'DRAFT' | 'ARCHIVED'
  featuredMedia: { preview: { image: { url: string } | null } | null } | null
  variants: { nodes: ShopifyVariantNode[] }
}

type MappedRow = Record<string, unknown> & { external_source_product_id: string }

function mapVariant(product: ShopifyProductNode, variant: ShopifyVariantNode, shopDomain: string): MappedRow {
  const isOnlyVariant = product.variants.nodes.length === 1
  const name = isOnlyVariant || variant.title === 'Default Title' ? product.title : `${product.title} — ${variant.title}`
  const priceCents = parseDecimalToCents(variant.price)
  const compareAtCents = parseDecimalToCents(variant.compareAtPrice)
  const featuredImageUrl = product.featuredMedia?.preview?.image?.url ?? null

  return {
    brand: product.vendor,
    model: variant.sku,
    name,
    category: guessCategory(product.productType),
    description: product.description,
    sku: variant.sku,
    upc: variant.barcode,
    default_price_cents: priceCents,
    msrp_cents: compareAtCents !== null && priceCents !== null && compareAtCents > priceCents ? compareAtCents : null,
    price_source_name: 'Shopify',
    price_kind: 'retail',
    price_checked_at: new Date().toISOString(),
    image_url: variant.image?.url ?? featuredImageUrl,
    source_url: `https://${shopDomain}/products/${product.handle}`,
    active: product.status === 'ACTIVE',
    availability: mapAvailability(variant.inventoryQuantity),
    import_source: 'shopify',
    external_source_product_id: variant.id,
    approval_status: 'approved',
  }
}

// deno-lint-ignore no-explicit-any
type Row = Record<string, any>

function priceLikelyEditedSinceSync(existing: Row): boolean {
  if (!existing.price_checked_at) return false
  return new Date(existing.updated_at).getTime() > new Date(existing.price_checked_at).getTime() + 1000
}

type SyncAction = 'create' | 'update' | 'unchanged' | 'skipped'

function planSync(existing: Row | null, mapped: MappedRow, overwriteLocalPrices: boolean): { action: SyncAction; row?: MappedRow } {
  if (!existing) return { action: 'create', row: mapped }

  const nonPriceChanged =
    existing.brand !== mapped.brand ||
    existing.model !== mapped.model ||
    existing.name !== mapped.name ||
    existing.description !== mapped.description ||
    existing.image_url !== mapped.image_url ||
    existing.active !== mapped.active

  const priceChanged = existing.default_price_cents !== mapped.default_price_cents || existing.msrp_cents !== mapped.msrp_cents
  const protectPrice = priceLikelyEditedSinceSync(existing) && !overwriteLocalPrices

  if (protectPrice && priceChanged) {
    if (!nonPriceChanged) return { action: 'skipped' }
    return {
      action: 'update',
      row: { ...mapped, default_price_cents: existing.default_price_cents, msrp_cents: existing.msrp_cents },
    }
  }

  if (!nonPriceChanged && !priceChanged) return { action: 'unchanged' }
  return { action: 'update', row: mapped }
}

async function shopifyGraphQL<T>(domain: string, token: string, query: string, variables: Record<string, unknown>): Promise<T> {
  const res = await fetch(`https://${domain}/admin/api/${API_VERSION}/graphql.json`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': token },
    body: JSON.stringify({ query, variables }),
  })
  if (!res.ok) throw new Error(`Shopify API returned ${res.status}`)
  const payload = await res.json()
  if (payload.errors) throw new Error(payload.errors.map((e: { message: string }) => e.message).join('; '))
  return payload.data as T
}

const PRODUCTS_QUERY = `
  query Products($first: Int!, $after: String) {
    products(first: $first, after: $after, sortKey: ID) {
      edges {
        node {
          id
          title
          handle
          vendor
          productType
          description
          status
          featuredMedia { preview { image { url } } }
          variants(first: ${VARIANTS_PER_PRODUCT}) {
            nodes { id title sku barcode price compareAtPrice inventoryQuantity image { url } }
          }
        }
      }
      pageInfo { hasNextPage endCursor }
    }
  }
`

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return fail(405, 'Method not allowed')

  let body: { shopId?: string; afterCursor?: string | null; overwriteLocalPrices?: boolean; productsPerPage?: number }
  try {
    body = await req.json()
  } catch {
    return fail(400, 'Invalid request')
  }
  const { shopId, afterCursor = null, overwriteLocalPrices = false } = body
  const productsPerPage = Math.min(Math.max(body.productsPerPage ?? DEFAULT_PRODUCTS_PER_PAGE, 1), 100)
  if (!shopId) return fail(400, 'Missing shopId')

  const authHeader = req.headers.get('Authorization') ?? ''
  const userClient = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: authHeader } } },
  )
  const {
    data: { user },
  } = await userClient.auth.getUser()
  if (!user) return fail(401, 'You must be signed in to run a catalog import.')

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

  const { data: membership } = await admin
    .from('shop_memberships')
    .select('role')
    .eq('shop_id', shopId)
    .eq('user_id', user.id)
    .maybeSingle()
  if (!membership || !['owner', 'manager'].includes(membership.role)) {
    return fail(403, 'Only an owner or manager can run a Shopify catalog import.')
  }

  const domain = Deno.env.get('SHOPIFY_STORE_DOMAIN')
  const token = Deno.env.get('SHOPIFY_ADMIN_ACCESS_TOKEN')
  if (!domain || !token) {
    return fail(503, "Shopify isn't configured yet. Ask your administrator to set SHOPIFY_STORE_DOMAIN and SHOPIFY_ADMIN_ACCESS_TOKEN.")
  }

  const results = { created: 0, updated: 0, unchanged: 0, skipped: 0, failed: 0 }
  const errors: Array<{ product: string; message: string }> = []
  let cursor = afterCursor
  let hasMore = true
  let pagesProcessed = 0

  // Counted once up front rather than re-queried for every created row — on a fresh
  // import (every item a 'create') that was tripling round trips per item right when
  // the invocation is most likely to run into its compute budget.
  const { count: startingCount } = await admin
    .from('catalog_items')
    .select('id', { count: 'exact', head: true })
    .eq('shop_id', shopId)
  let nextPosition = startingCount ?? 0

  try {
    while (hasMore && pagesProcessed < MAX_PAGES_PER_RUN) {
      const data = await shopifyGraphQL<{
        products: { edges: { node: ShopifyProductNode }[]; pageInfo: { hasNextPage: boolean; endCursor: string | null } }
      }>(domain, token, PRODUCTS_QUERY, { first: productsPerPage, after: cursor })

      for (const { node: product } of data.products.edges) {
        for (const variant of product.variants.nodes) {
          try {
            const mapped = mapVariant(product, variant, domain)
            const { data: existing } = await admin
              .from('catalog_items')
              .select('*')
              .eq('shop_id', shopId)
              .eq('import_source', 'shopify')
              .eq('external_source_product_id', variant.id)
              .maybeSingle()

            const plan = planSync(existing, mapped, overwriteLocalPrices)
            if (plan.action === 'create') {
              const { error } = await admin.from('catalog_items').insert({ shop_id: shopId, position: nextPosition++, ...plan.row })
              if (error) throw error
              results.created += 1
            } else if (plan.action === 'update') {
              const { error } = await admin.from('catalog_items').update(plan.row!).eq('id', existing!.id)
              if (error) throw error
              results.updated += 1
            } else if (plan.action === 'unchanged') {
              results.unchanged += 1
            } else {
              results.skipped += 1
            }
          } catch (err) {
            results.failed += 1
            errors.push({ product: `${product.title} (${variant.title})`, message: String(err) })
          }
        }
      }

      hasMore = data.products.pageInfo.hasNextPage
      cursor = data.products.pageInfo.endCursor
      pagesProcessed += 1
    }
  } catch (err) {
    return fail(502, `Shopify import failed partway through: ${String(err)}`)
  }

  return json(200, {
    ok: true,
    ...results,
    errors,
    hasMore,
    nextCursor: hasMore ? cursor : null,
  })
})
