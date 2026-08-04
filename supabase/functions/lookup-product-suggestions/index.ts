// Supabase Edge Function: lookup-product-suggestions
// AI+web-search autocomplete for a partially-typed SKU/model/name (e.g.
// "NA-12F") when staff are adding a new catalog product -- see
// src/components/ProductSuggestField.tsx. Ported technique from
// car-audio-inventory's src/app/api/lookup/vision/route.ts (this app's
// sister inventory-scanning app -- see docs/INVENTORY_AND_SCANNING.md):
// Claude + the web_search tool + structured JSON output, but driven by a
// text query instead of a photo. Called directly over HTTPS rather than via
// @anthropic-ai/sdk -- this project's Edge Functions stay dependency-light
// (see send-quote-email's raw Resend fetch), and one call site doesn't
// justify Deno's npm interop overhead.
//
// Deploy:  supabase functions deploy lookup-product-suggestions
// Needs a new secret this project doesn't use anywhere else yet:
//   supabase secrets set ANTHROPIC_API_KEY=sk-ant-...
// (see docs/INVENTORY_AND_SCANNING.md's credentials table)

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
  return json(status, { ok: false, message, suggestions: [] })
}

const ANTHROPIC_VERSION = '2023-06-01'
const MODEL = 'claude-sonnet-5'

// A nullable string field, expressed as anyOf(string, null) -- the shape
// zod's `.nullable()` compiles to (see the ProductSchema this mirrors in
// car-audio-inventory's vision route) and the safest form for a strict
// json_schema structured-output request: every property below is required,
// with null used to express "the model didn't find one" instead of
// omitting the key.
const NULLABLE_STRING = { anyOf: [{ type: 'string' }, { type: 'null' }] }
const NULLABLE_NUMBER = { anyOf: [{ type: 'number' }, { type: 'null' }] }

const SUGGESTION_SCHEMA = {
  type: 'object',
  properties: {
    suggestions: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string', description: "Full product name, e.g. \"NA-12F 12\" Loaded Enclosure\"" },
          brand: NULLABLE_STRING,
          model: NULLABLE_STRING,
          unit_price: { ...NULLABLE_NUMBER, description: 'Typical MSRP or street price in USD, from web search. Null if unknown.' },
          image_url: NULLABLE_STRING,
          source_url: NULLABLE_STRING,
        },
        required: ['name', 'brand', 'model', 'unit_price', 'image_url', 'source_url'],
        additionalProperties: false,
      },
    },
  },
  required: ['suggestions'],
  additionalProperties: false,
}

interface RawSuggestion {
  name: unknown
  brand: unknown
  model: unknown
  unit_price: unknown
  image_url: unknown
  source_url: unknown
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return fail(405, 'Method not allowed')

  // Pure lookup, no shop-specific read/write -- same "any signed-in user"
  // rule as lookup-product-upc.
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
    return fail(401, 'You must be signed in to look up product suggestions.')
  }

  const body = await req.json().catch(() => null)
  const query = typeof body?.query === 'string' ? body.query.trim() : ''
  if (query.length < 2) {
    return fail(400, 'Type at least 2 characters to search.')
  }

  const apiKey = Deno.env.get('ANTHROPIC_API_KEY')
  if (!apiKey) {
    return fail(500, "Product suggestions aren't set up yet (missing ANTHROPIC_API_KEY).")
  }

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': ANTHROPIC_VERSION,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 1536,
        tools: [{ type: 'web_search_20260318', name: 'web_search', max_uses: 3 }],
        output_config: { format: { type: 'json_schema', schema: SUGGESTION_SCHEMA } },
        messages: [
          {
            role: 'user',
            content:
              `A car-audio shop employee is adding a new product to their catalog and has typed: "${query}" ` +
              '(a partial or full SKU, model number, or product name). Use web search to find up to 5 real, ' +
              'specific car-audio products (amplifiers, subwoofers, speakers, head units, wiring, enclosures, ' +
              'radios, DSPs, etc) that this could plausibly be, ranked most-likely-match first. For each, give ' +
              'the exact brand, full model/name, typical MSRP in USD if you can find one, a product photo URL ' +
              "if you can find one, and the source page URL. Only include products you're reasonably confident " +
              "are real -- return fewer than 5 results (even zero) rather than guessing or inventing a product " +
              "that doesn't exist.",
          },
        ],
      }),
    })

    if (!res.ok) {
      const errText = await res.text().catch(() => '')
      console.error('lookup-product-suggestions: Anthropic API error', res.status, errText.slice(0, 500))
      return fail(502, 'Product suggestions failed. You can still enter the product manually.')
    }

    const data = await res.json()
    const textBlock = Array.isArray(data?.content)
      ? data.content.find((block: { type?: string }) => block?.type === 'text')
      : null
    const rawText = textBlock?.text
    if (typeof rawText !== 'string') {
      console.error('lookup-product-suggestions: no text block in response', JSON.stringify(data).slice(0, 500))
      return fail(502, 'Product suggestions failed. You can still enter the product manually.')
    }

    let parsed: { suggestions?: RawSuggestion[] }
    try {
      parsed = JSON.parse(rawText)
    } catch {
      console.error('lookup-product-suggestions: unparseable structured output', rawText.slice(0, 500))
      return fail(502, 'Product suggestions failed. You can still enter the product manually.')
    }

    const rawSuggestions = Array.isArray(parsed.suggestions) ? parsed.suggestions.slice(0, 5) : []
    const suggestions = rawSuggestions
      .map((s) => ({
        name: typeof s.name === 'string' ? s.name.trim() : '',
        brand: typeof s.brand === 'string' ? s.brand : null,
        model: typeof s.model === 'string' ? s.model : null,
        unitPriceCents: typeof s.unit_price === 'number' ? Math.round(s.unit_price * 100) : null,
        imageUrl: typeof s.image_url === 'string' ? s.image_url : null,
        sourceUrl: typeof s.source_url === 'string' ? s.source_url : null,
      }))
      .filter((s) => s.name.length > 0)

    return json(200, { ok: true, suggestions })
  } catch (err) {
    console.error('lookup-product-suggestions failed', err)
    return fail(500, 'Product suggestions failed. You can still enter the product manually.')
  }
})
