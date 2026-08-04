// Supabase Edge Function: lookup-product-upc
// Looks up a scanned barcode against UPCitemdb on behalf of an authenticated
// user, when the code isn't already in the shop's own catalog (that check
// happens client-side first — see src/lib/productLookup.ts). Ported from
// car-audio-inventory's src/app/api/lookup/upc/route.ts (this app's sister
// inventory-scanning app — see docs/INVENTORY_AND_SCANNING.md).
//
// Deploy:  supabase functions deploy lookup-product-upc
// No secret needed — uses UPCitemdb's free trial endpoint (no API key,
// ~100 lookups/day per IP: https://www.upcitemdb.com/api/explorer#!/lookup/get_trial_lookup).
// If UPC_LOOKUP_API_KEY is set later for higher volume, swap in their paid
// endpoint/header here.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

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

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return fail(405, 'Method not allowed')

  // This is a pure lookup with no shop-specific read/write — just require
  // any signed-in user, no shop-membership check needed (unlike
  // shopify-import-catalog, which touches this shop's own catalog rows).
  const authHeader = req.headers.get('Authorization') ?? ''
  const userClient = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: authHeader } } },
  )
  const {
    data: { user },
  } = await userClient.auth.getUser()
  if (!user) {
    return fail(401, 'You must be signed in to look up a barcode.')
  }

  const body = await req.json().catch(() => null)
  const code = typeof body?.code === 'string' ? body.code.trim() : ''
  if (!code) {
    return fail(400, 'Missing barcode')
  }

  try {
    const res = await fetch(`https://api.upcitemdb.com/prod/trial/lookup?upc=${encodeURIComponent(code)}`, {
      headers: { Accept: 'application/json' },
    })
    const data = await res.json()

    const item = data?.items?.[0]
    if (!item) {
      return fail(404, 'No product found for that barcode. Search the catalog or add it manually.')
    }

    const price = Array.isArray(item.offers) && item.offers.length > 0 ? item.offers[0].price : null
    const photoUrls = Array.isArray(item.images) ? item.images.filter((u: unknown): u is string => typeof u === 'string') : []

    return json(200, {
      ok: true,
      name: item.title ?? null,
      brand: item.brand ?? null,
      unitPriceCents: typeof price === 'number' ? Math.round(price * 100) : null,
      upc: code,
      imageUrl: photoUrls[0] ?? null,
    })
  } catch (err) {
    console.error(err)
    return fail(500, 'Barcode lookup failed. Search the catalog or add the item manually.')
  }
})
