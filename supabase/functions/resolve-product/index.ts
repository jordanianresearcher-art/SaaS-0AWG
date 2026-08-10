// Supabase Edge Function: resolve-product
// The one canonical, shared product-resolution surface — replaces the
// separate `lookup-product-upc` and `lookup-product-suggestions` functions
// (both deleted this round; nothing else referenced their names directly
// outside src/data/supabaseRepository.ts, which now calls this one). See
// docs/PRODUCT_RESOLVER.md.
//
// Two request kinds, one response shape:
//   { kind: 'barcode', shopId, code }  -- a scanned/typed UPC/EAN
//   { kind: 'text', shopId, query }    -- a partial brand/model/SKU/name
//
// Resolution order (barcode): shop's resolution cache -> UPCitemdb (a real
// barcode database, decent confidence) -> AI + web_search using the code
// itself as a search hint (lower confidence -- barcode databases don't
// always cover obscure car-audio SKUs) -> cache the result either way.
// Resolution order (text): shop's resolution cache -> AI + web_search.
//
// "AI + web_search" tries OpenAI first (Responses API, `web_search` tool,
// strict `text.format` json_schema output) if OPENAI_API_KEY is set, else
// falls back to Claude (Messages API, `web_search` tool, `output_config`
// json_schema output) if ANTHROPIC_API_KEY is set instead. Same prompt,
// same AI_CANDIDATE_SCHEMA, same confidence-capping rules either way --
// the provider is just which API answers the grounding question. Whichever
// key a shop's operator actually funds is the one that runs; no error if
// only one (or neither) is set, see resolveViaAi below.
//
// This function never invents a product from memory alone -- every AI
// candidate is grounded in a live web_search call, self-reports a
// confidence, and lists its evidence/warnings; the caller (ScanWorkspacePage)
// is responsible for requiring staff confirmation on anything below
// high confidence and for never silently overwriting a shop's own
// confirmed price. The shop's own catalog is checked client-side *before*
// this function is ever called (see resolveProduct in supabaseRepository.ts)
// -- everything this function returns is inherently "not already in this
// shop's catalog."
//
// Deploy:  supabase functions deploy resolve-product
// Needs OPENAI_API_KEY and/or ANTHROPIC_API_KEY for the AI+web-search
// fallback (either one is enough; OpenAI is preferred when both are set —
// see docs/PRODUCT_RESOLVER.md's credentials table). UPCitemdb needs no
// key on the free trial tier.

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
  return json(status, { ok: false, message, candidates: [] })
}

const ANTHROPIC_VERSION = '2023-06-01'
const ANTHROPIC_MODEL = 'claude-sonnet-5'
const OPENAI_MODEL = 'gpt-5.6'
const BARCODE_CACHE_DAYS = 30
const TEXT_CACHE_DAYS = 7

// ---------------------------------------------------------------------------
// Normalization -- mirrors src/lib/productResolver.ts's normalizeBarcode/
// normalizeQuery. Duplicated deliberately: this Edge Function runs in Deno
// with its own module resolution, separate from the Vite/React client build
// (same established convention as this project's email-template duplication
// between src/lib/*.ts and supabase/functions/*/index.ts).
// ---------------------------------------------------------------------------

function normalizeBarcode(raw: string): string {
  // Barcodes are strings, never numbers -- leading zeros are significant
  // and must never be dropped. Only trim whitespace and strip anything
  // that clearly isn't part of a barcode (spaces, dashes some scanners add).
  return raw.trim().replace(/[\s-]/g, '')
}

function normalizeQuery(raw: string): string {
  return raw.trim().toLowerCase().replace(/\s+/g, ' ')
}

// ---------------------------------------------------------------------------
// Candidate shape -- mirrors ProductResolutionCandidate in src/data/repository.ts.
// ---------------------------------------------------------------------------

interface Candidate {
  id: string
  source: 'resolution_cache' | 'verified_web_source' | 'ai_extracted'
  brand: string | null
  model: string | null
  name: string
  categoryHint: string | null
  upc: string | null
  imageUrl: string | null
  referencePriceCents: number | null
  priceKind: 'msrp' | 'retail' | 'unknown'
  priceSourceUrl: string | null
  priceSourceName: string | null
  confidence: number
  confidenceLevel: 'high' | 'probable' | 'low'
  evidence: string[]
  warnings: string[]
}

function confidenceLevel(score: number): 'high' | 'probable' | 'low' {
  if (score >= 0.75) return 'high'
  if (score >= 0.4) return 'probable'
  return 'low'
}

function newCandidateId(): string {
  return crypto.randomUUID()
}

// ---------------------------------------------------------------------------
// UPCitemdb -- ported from the deleted lookup-product-upc function.
// ---------------------------------------------------------------------------

async function resolveViaUpcItemDb(code: string): Promise<Candidate | null> {
  try {
    const res = await fetch(`https://api.upcitemdb.com/prod/trial/lookup?upc=${encodeURIComponent(code)}`, {
      headers: { Accept: 'application/json' },
    })
    const data = await res.json()
    const item = data?.items?.[0]
    if (!item) return null

    const price = Array.isArray(item.offers) && item.offers.length > 0 ? item.offers[0].price : null
    const photoUrls = Array.isArray(item.images) ? item.images.filter((u: unknown): u is string => typeof u === 'string') : []

    return {
      id: newCandidateId(),
      source: 'verified_web_source',
      brand: typeof item.brand === 'string' ? item.brand : null,
      model: null,
      name: typeof item.title === 'string' ? item.title : 'Unnamed product',
      categoryHint: typeof item.category === 'string' ? item.category : null,
      upc: code,
      imageUrl: photoUrls[0] ?? null,
      referencePriceCents: typeof price === 'number' ? Math.round(price * 100) : null,
      priceKind: 'retail',
      priceSourceUrl: null,
      priceSourceName: 'UPCitemdb',
      confidence: 0.75,
      confidenceLevel: confidenceLevel(0.75),
      evidence: ['Exact barcode match in the UPCitemdb barcode database.'],
      warnings: [],
    }
  } catch (err) {
    console.error('resolve-product: UPCitemdb lookup failed', err)
    return null
  }
}

// ---------------------------------------------------------------------------
// Claude + web_search structured output.
// ---------------------------------------------------------------------------

const NULLABLE_STRING = { anyOf: [{ type: 'string' }, { type: 'null' }] }
const NULLABLE_NUMBER = { anyOf: [{ type: 'number' }, { type: 'null' }] }
const NULLABLE_BOOLEAN = { anyOf: [{ type: 'boolean' }, { type: 'null' }] }

const AI_CANDIDATE_SCHEMA = {
  type: 'object',
  properties: {
    candidates: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          brand: NULLABLE_STRING,
          model: NULLABLE_STRING,
          category_hint: { ...NULLABLE_STRING, description: 'Plain-language category, e.g. "car subwoofer", "4-channel amplifier". Null if unsure.' },
          barcode_confirmed: { ...NULLABLE_BOOLEAN, description: 'True only if a source explicitly ties this exact barcode/UPC to this product. False or null otherwise. Always null for a text-query search.' },
          unit_price: { ...NULLABLE_NUMBER, description: 'Price in USD found from web search. Null if unknown.' },
          price_kind: { ...NULLABLE_STRING, description: '"msrp", "retail", or null if unclear which kind of price this is.' },
          image_url: NULLABLE_STRING,
          source_url: NULLABLE_STRING,
          source_name: { ...NULLABLE_STRING, description: 'Short human-readable source name, e.g. "Manufacturer site", "Crutchfield".' },
          confidence: { type: 'number', description: 'Your own confidence 0-1 that this is a real, correctly identified product.' },
          evidence: { type: 'array', items: { type: 'string' }, description: 'Short reasons supporting this match.' },
        },
        required: [
          'name', 'brand', 'model', 'category_hint', 'barcode_confirmed', 'unit_price',
          'price_kind', 'image_url', 'source_url', 'source_name', 'confidence', 'evidence',
        ],
        additionalProperties: false,
      },
    },
  },
  required: ['candidates'],
  additionalProperties: false,
}

interface RawAiCandidate {
  name: unknown
  brand: unknown
  model: unknown
  category_hint: unknown
  barcode_confirmed: unknown
  unit_price: unknown
  price_kind: unknown
  image_url: unknown
  source_url: unknown
  source_name: unknown
  confidence: unknown
  evidence: unknown
}

// Shared by both providers: parse a provider's raw structured-output text
// into candidates, applying the same barcode-confirmation confidence cap
// either way. `providerLabel` is only for the console.error breadcrumb.
function parseAiCandidates(rawText: string | null | undefined, upc: string | null, providerLabel: string): Candidate[] {
  if (typeof rawText !== 'string') {
    console.error(`resolve-product: no text output in ${providerLabel} response`)
    return []
  }

  let parsed: { candidates?: RawAiCandidate[] }
  try {
    parsed = JSON.parse(rawText)
  } catch {
    console.error(`resolve-product: unparseable ${providerLabel} structured output`, rawText.slice(0, 500))
    return []
  }

  const rawCandidates = Array.isArray(parsed.candidates) ? parsed.candidates.slice(0, 5) : []
  return rawCandidates
    .map((c): Candidate | null => {
      const name = typeof c.name === 'string' ? c.name.trim() : ''
      if (!name) return null
      const barcodeConfirmed = c.barcode_confirmed === true
      const selfReported = typeof c.confidence === 'number' && Number.isFinite(c.confidence) ? Math.max(0, Math.min(1, c.confidence)) : 0.3
      // A barcode search where the source didn't explicitly confirm the
      // code belongs to this product is inherently a guess, not a match --
      // cap confidence regardless of how sure the model claims to be.
      const confidence = upc !== null && !barcodeConfirmed ? Math.min(selfReported, 0.35) : selfReported
      const warnings: string[] =
        upc !== null && !barcodeConfirmed
          ? ["This barcode wasn't directly confirmed by a source — verify it matches before relying on this match."]
          : []
      return {
        id: newCandidateId(),
        source: 'ai_extracted',
        brand: typeof c.brand === 'string' ? c.brand : null,
        model: typeof c.model === 'string' ? c.model : null,
        name,
        categoryHint: typeof c.category_hint === 'string' ? c.category_hint : null,
        upc,
        imageUrl: typeof c.image_url === 'string' ? c.image_url : null,
        referencePriceCents: typeof c.unit_price === 'number' ? Math.round(c.unit_price * 100) : null,
        priceKind: c.price_kind === 'msrp' ? 'msrp' : c.price_kind === 'retail' ? 'retail' : 'unknown',
        priceSourceUrl: typeof c.source_url === 'string' ? c.source_url : null,
        priceSourceName: typeof c.source_name === 'string' ? c.source_name : null,
        confidence,
        confidenceLevel: confidenceLevel(confidence),
        evidence: Array.isArray(c.evidence) ? c.evidence.filter((e): e is string => typeof e === 'string').slice(0, 5) : [],
        warnings,
      }
    })
    .filter((c): c is Candidate => c !== null)
}

async function resolveViaClaude(apiKey: string, prompt: string, upc: string | null): Promise<Candidate[]> {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': ANTHROPIC_VERSION,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: ANTHROPIC_MODEL,
      max_tokens: 1536,
      tools: [{ type: 'web_search_20260318', name: 'web_search', max_uses: 3 }],
      output_config: { format: { type: 'json_schema', schema: AI_CANDIDATE_SCHEMA } },
      messages: [{ role: 'user', content: prompt }],
    }),
  })

  if (!res.ok) {
    const errText = await res.text().catch(() => '')
    console.error('resolve-product: Anthropic API error', res.status, errText.slice(0, 500))
    return []
  }

  const data = await res.json()
  const textBlock = Array.isArray(data?.content) ? data.content.find((b: { type?: string }) => b?.type === 'text') : null
  return parseAiCandidates(textBlock?.text, upc, 'Anthropic')
}

// OpenAI Responses API: the `web_search` built-in tool grounds the answer,
// `text.format` with a strict json_schema constrains the final assistant
// message to AI_CANDIDATE_SCHEMA -- same schema Claude uses, since the
// candidate shape is provider-agnostic. The tool call itself shows up as a
// separate `web_search_call` item in `output`; the actual structured JSON
// is the `message` item's `output_text` content part.
async function resolveViaOpenAi(apiKey: string, prompt: string, upc: string | null): Promise<Candidate[]> {
  const res = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${apiKey}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      tools: [{ type: 'web_search' }],
      input: prompt,
      text: { format: { type: 'json_schema', name: 'product_candidates', schema: AI_CANDIDATE_SCHEMA, strict: true } },
    }),
  })

  if (!res.ok) {
    const errText = await res.text().catch(() => '')
    console.error('resolve-product: OpenAI API error', res.status, errText.slice(0, 500))
    return []
  }

  const data = await res.json()
  const messageItem = Array.isArray(data?.output) ? data.output.find((o: { type?: string }) => o?.type === 'message') : null
  const textPart = Array.isArray(messageItem?.content)
    ? messageItem.content.find((c: { type?: string }) => c?.type === 'output_text')
    : null
  // `output_text` is also offered as a root-level convenience field by the
  // API -- fall back to it if the shape above ever changes underneath us.
  const rawText = typeof textPart?.text === 'string' ? textPart.text : typeof data?.output_text === 'string' ? data.output_text : null
  return parseAiCandidates(rawText, upc, 'OpenAI')
}

// The one entry point the handler calls -- picks whichever provider this
// shop's operator has actually funded. OpenAI wins if both are set (that's
// the current ask; either key alone is enough to light up AI resolution,
// and neither being set degrades gracefully to no AI candidates, same as
// always).
async function resolveViaAi(prompt: string, upc: string | null): Promise<Candidate[]> {
  const openAiKey = Deno.env.get('OPENAI_API_KEY')
  if (openAiKey) return resolveViaOpenAi(openAiKey, prompt, upc)

  const anthropicKey = Deno.env.get('ANTHROPIC_API_KEY')
  if (anthropicKey) return resolveViaClaude(anthropicKey, prompt, upc)

  return []
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return fail(405, 'Method not allowed')

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
    return fail(401, 'You must be signed in to resolve a product.')
  }

  const body = await req.json().catch(() => null)
  const shopId = typeof body?.shopId === 'string' ? body.shopId : ''
  const kind = body?.kind === 'barcode' || body?.kind === 'text' ? body.kind : null
  if (!shopId || !kind) {
    return fail(400, 'Missing shopId or kind')
  }

  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )

  // The cache is shop-scoped, so this needs to know which shop -- verify
  // membership rather than trusting the client-supplied shopId outright.
  const { data: membership } = await admin
    .from('shop_memberships')
    .select('id')
    .eq('shop_id', shopId)
    .eq('user_id', user.id)
    .maybeSingle()
  if (!membership) {
    return fail(403, 'You are not a member of this shop.')
  }

  let normalizedKey: string
  let code: string | null = null
  let query: string | null = null

  if (kind === 'barcode') {
    code = typeof body?.code === 'string' ? body.code.trim() : ''
    if (!code) return fail(400, 'Missing barcode')
    normalizedKey = normalizeBarcode(code)
  } else {
    query = typeof body?.query === 'string' ? body.query.trim() : ''
    if (!query || query.length < 2) return fail(400, 'Type at least 2 characters to search.')
    normalizedKey = normalizeQuery(query)
  }

  // 1. Cache check.
  const { data: cached } = await admin
    .from('product_resolution_cache')
    .select('candidates, expires_at')
    .eq('shop_id', shopId)
    .eq('kind', kind)
    .eq('normalized_key', normalizedKey)
    .maybeSingle()

  if (cached && (!cached.expires_at || new Date(cached.expires_at) > new Date())) {
    const candidates = (Array.isArray(cached.candidates) ? cached.candidates : []).map((c: Candidate) => ({
      ...c,
      source: 'resolution_cache' as const,
    }))
    return json(200, { ok: true, candidates, cached: true })
  }

  // 2. Resolve fresh.
  let candidates: Candidate[] = []

  if (kind === 'barcode') {
    const upcHit = await resolveViaUpcItemDb(normalizedKey)
    if (upcHit) {
      candidates = [upcHit]
    } else {
      candidates = await resolveViaAi(
        `A car-audio shop employee scanned a barcode/UPC that isn't in a standard barcode database: "${normalizedKey}". ` +
          'Search the web (barcode lookup sites, manufacturer sites, retailer listings) to try to identify what car-audio or ' +
          'related shop product this barcode belongs to. Only set barcode_confirmed to true if a source explicitly ties this exact ' +
          "code to the product -- otherwise leave it false/null and lower your confidence, since you're inferring from a general " +
          'product search rather than a direct barcode match. Return up to 3 candidates, most-likely first, or zero if nothing ' +
          'plausible turns up -- never invent a product.',
        normalizedKey,
      )
    }
  } else {
    // kind === 'text' guarantees query was validated non-empty above, but
    // that narrowing doesn't survive across the separate if/else on `kind`
    // a few lines up -- the fallback is unreachable in practice.
    const textQuery = query ?? ''
    candidates = await resolveViaAi(
      `A car-audio shop employee is adding a new product to their catalog and has typed: "${textQuery}" ` +
        '(a partial or full SKU, model number, or product name). Use web search to find up to 5 real, ' +
        'specific car-audio products (amplifiers, subwoofers, speakers, head units, wiring, enclosures, ' +
        'radios, DSPs, etc) that this could plausibly be, ranked most-likely-match first. Only include ' +
        "products you're reasonably confident are real -- return fewer than 5 results (even zero) rather " +
        "than guessing or inventing a product that doesn't exist.",
      null,
    )
  }

  // 3. Cache the result (even an empty one, so an obscure/unresolvable
  // code or query doesn't re-trigger an AI/web call on every retry within
  // the cache window).
  const days = kind === 'barcode' ? BARCODE_CACHE_DAYS : TEXT_CACHE_DAYS
  const expiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString()
  await admin
    .from('product_resolution_cache')
    .upsert(
      { shop_id: shopId, kind, normalized_key: normalizedKey, candidates, expires_at: expiresAt },
      { onConflict: 'shop_id,kind,normalized_key' },
    )

  return json(200, { ok: true, candidates, cached: false })
})
