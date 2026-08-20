// Supabase Edge Function: resolve-product
// The one canonical, shared product-resolution surface — replaces the
// separate `lookup-product-upc` and `lookup-product-suggestions` functions
// (both deleted this round; nothing else referenced their names directly
// outside src/data/supabaseRepository.ts, which now calls this one). See
// docs/PRODUCT_RESOLVER.md.
//
// Three request kinds, one response shape:
//   { kind: 'barcode', shopId, code }                       -- a scanned/typed UPC/EAN
//   { kind: 'text', shopId, query }                         -- a partial brand/model/SKU/name
//   { kind: 'photo', shopId, imageBase64, mediaType }        -- a shop-floor product photo
//
// Resolution order (barcode): shop's resolution cache -> UPCitemdb (a real
// barcode database, decent confidence) -> AI + web_search using the code
// itself as a search hint (lower confidence -- barcode databases don't
// always cover obscure car-audio SKUs) -> cache the result either way.
// Resolution order (text): shop's resolution cache -> AI + web_search.
// Resolution order (photo): AI vision + web_search, always fresh -- see
// "Photo lookup" below for why this one isn't cached like the other two.
//
// "AI + web_search" (all three kinds) tries OpenAI first (Responses API,
// `web_search` tool, strict `text.format` json_schema output) if
// OPENAI_API_KEY is set, else falls back to Claude (Messages API,
// `web_search` tool, `output_config` json_schema output) if
// ANTHROPIC_API_KEY is set instead. Same prompt, same AI_CANDIDATE_SCHEMA,
// same confidence-capping rules either way -- the provider is just which
// API answers the grounding question. Whichever key a shop's operator
// actually funds is the one that runs; no error if only one (or neither)
// is set, see resolveViaAi/resolveViaVision below.
//
// Photo lookup's *method* (image + web_search + structured output in one
// call) is ported from car-audio-inventory's (this app's sister
// inventory-scanning app) production vision route, which is Claude-only.
// This app tries OpenAI first for it too, same as barcode/text -- that
// exact three-way combination (image input, the `web_search` tool, and
// strict json_schema output) isn't explicitly documented as supported by
// OpenAI's Responses API, but each piece is independently documented with
// no stated incompatibility, and OpenAI is the funded provider. A
// rejected combination degrades the same as any other provider failure
// here: logged, empty candidates, automatic fallback to Claude only if
// OPENAI_API_KEY isn't set at all (not a mid-request retry) -- see
// resolveViaVision. Not cached (see product_resolution_cache's migration,
// which only allows kind in ('barcode','text')) -- a photo is effectively
// never re-taken identically, so there's no meaningful cache hit to
// chase, unlike a repeated barcode/text query.
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
// Barcode identity -- mirrors src/lib/barcodeIdentity.ts (Deno cannot import
// from src/; same duplication rule as the email templates and productNaming).
// The full classifier, its GS1 origin table, and its tests live on the client
// side; only the two questions this function needs are mirrored here.
//
// Why it exists: a shop scanned 200001188725 (a valid UPC-A whose GS1 prefix
// is 2 -- "restricted distribution", i.e. assigned by the store itself) and
// 26040308 (eight digits that are not a valid EAN-8), and this function
// dutifully queried a barcode database, missed, then ran a full AI web search
// on a meaningless number before reporting "couldn't identify". Neither code
// can exist in any public database. Recognising that up front is both instant
// and honest.
// ---------------------------------------------------------------------------

function gs1CheckDigit(payload: string): number {
  let sum = 0
  let weight = 3
  for (let i = payload.length - 1; i >= 0; i--) {
    sum += Number(payload[i]) * weight
    weight = weight === 3 ? 1 : 3
  }
  return (10 - (sum % 10)) % 10
}

/** GS1 prefix 2 (the 02x and 04x bands of the EAN-13 form) is store-assigned. */
function isStoreAssignedBarcode(code: string): boolean {
  if (!/^\d+$/.test(code)) return false
  const ean13 = code.length === 12 ? `0${code}` : code
  if (ean13.length !== 13) return false
  const prefix = Number(ean13.slice(0, 3))
  return (prefix >= 20 && prefix <= 29) || (prefix >= 40 && prefix <= 49) || (prefix >= 200 && prefix <= 299)
}

/**
 * Every spelling of this code worth querying, or an empty list when no
 * database could ever hold it.
 *
 * A 12-digit UPC-A and the 13-digit EAN carrying a leading zero are the same
 * product, and a database may hold either -- querying only the scanned form is
 * how a real, findable product (a Brazilian EAN-13, in the report that
 * prompted this) comes back empty.
 */
function barcodeLookupForms(raw: string): string[] {
  const code = raw.trim().replace(/[\s-]/g, '')
  if (!/^\d+$/.test(code)) return []
  const retailLength = code.length === 8 || code.length === 12 || code.length === 13
  if (!retailLength) return []
  if (gs1CheckDigit(code.slice(0, -1)) !== Number(code[code.length - 1])) return []
  if (isStoreAssignedBarcode(code)) return []

  const forms = [code]
  if (code.length === 12) forms.push(`0${code}`)
  else if (code.length === 13 && code.startsWith('0')) forms.push(code.slice(1))
  return forms
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

/**
 * Query UPCitemdb for every equivalent spelling of the code, stopping at the
 * first hit. Sequential rather than parallel on purpose: the trial endpoint is
 * rate-limited per IP, and the second form is only ever needed when the first
 * missed.
 */
async function resolveViaUpcItemDbAllForms(raw: string): Promise<Candidate | null> {
  for (const form of barcodeLookupForms(raw)) {
    const hit = await resolveViaUpcItemDb(form)
    if (hit) return hit
  }
  return null
}

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
// Official product photo scraping -- ported near-verbatim from
// car-audio-inventory's src/lib/scrape-photos.ts (this app's sister
// inventory-scanning app). Claude's web_search tool returns extracted
// text, not raw HTML, so it can't see <img> tags or a photo gallery --
// fetching the page ourselves and reading its JSON-LD Product schema /
// Open Graph tags is how most e-commerce sites expose their listing
// photos anyway. Used only by resolveViaVision below.
// ---------------------------------------------------------------------------

function collectLdImages(node: unknown, urls: Set<string>) {
  if (!node || typeof node !== 'object') return
  if (Array.isArray(node)) {
    for (const item of node) collectLdImages(item, urls)
    return
  }
  const obj = node as Record<string, unknown>
  if (obj['@graph']) collectLdImages(obj['@graph'], urls)

  const type = obj['@type']
  const isProduct = type === 'Product' || (Array.isArray(type) && type.includes('Product'))
  if (isProduct && obj.image) {
    const img = obj.image
    if (typeof img === 'string') {
      urls.add(img)
    } else if (Array.isArray(img)) {
      for (const entry of img) {
        if (typeof entry === 'string') urls.add(entry)
        else if (entry && typeof entry === 'object' && typeof (entry as { url?: unknown }).url === 'string') {
          urls.add((entry as { url: string }).url)
        }
      }
    } else if (typeof img === 'object' && typeof (img as { url?: unknown }).url === 'string') {
      urls.add((img as { url: string }).url)
    }
  }
}

async function scrapeProductImages(pageUrl: string, max = 8): Promise<string[]> {
  try {
    const res = await fetch(pageUrl, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
      },
      signal: AbortSignal.timeout(15_000),
    })
    if (!res.ok) return []

    const contentType = res.headers.get('content-type') ?? ''
    if (!contentType.includes('html')) return []

    const html = await res.text()
    const urls = new Set<string>()

    for (const match of html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
      try {
        collectLdImages(JSON.parse(match[1].trim()), urls)
      } catch {
        // Malformed/partial JSON-LD -- skip it.
      }
    }

    for (const match of html.matchAll(/<meta[^>]+property=["']og:image(?::secure_url)?["'][^>]+content=["']([^"']+)["']/gi)) {
      urls.add(match[1])
    }
    for (const match of html.matchAll(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image(?::secure_url)?["']/gi)) {
      urls.add(match[1])
    }

    return Array.from(urls)
      .map((u) => {
        try {
          return new URL(u, pageUrl).toString()
        } catch {
          return null
        }
      })
      .filter((u): u is string => !!u && u.startsWith('https:'))
      .slice(0, max)
  } catch (err) {
    console.error('resolve-product: failed to scrape product images', err)
    return []
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

// A funded key is not the same as a working one. A wrong model name, an
// account with no credit, a revoked key and a rate limit all come back as a
// non-2xx from the provider, and every one of them used to end the same way:
// console.error on a log nobody reads, then an empty candidate list that is
// indistinguishable from "the AI looked and found nothing". The shop concludes
// lookup is broken and has no way to learn why.
//
// So each request carries this scratchpad down to whichever provider call it
// makes, and the handler reports what it collected. Per-request rather than
// module-level on purpose: Deno serves concurrent requests from one isolate,
// and a shared mutable would let one shop's failure surface in another's UI.
interface ProviderDiag {
  error: string | null
}

/**
 * Turn a provider's error body into something safe to show a shop owner.
 *
 * The raw body is NOT forwarded — it can quote the request back, which for the
 * photo path means a base64 image, and for any path means our prompt. Only the
 * provider's own short machine-readable code is extracted, and only when it
 * looks like a code rather than prose. That is enough to tell the three cases
 * that actually happen apart: model_not_found, insufficient_quota,
 * invalid_api_key.
 */
function providerErrorCode(body: string): string | null {
  try {
    const parsed = JSON.parse(body)
    const err = parsed?.error ?? parsed
    const code = err?.code ?? err?.type ?? null
    if (typeof code === 'string' && /^[a-z0-9_.:-]{1,60}$/i.test(code)) return code
  } catch {
    // Not JSON (an HTML error page from a proxy, say) — the status alone tells
    // the story well enough.
  }
  return null
}

function noteProviderError(diag: ProviderDiag, provider: string, status: number, body: string): void {
  const code = providerErrorCode(body)
  diag.error = `${provider} returned ${status}${code ? ` (${code})` : ''}`
  console.error(`resolve-product: ${provider} API error`, status, body.slice(0, 500))
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

async function resolveViaClaude(apiKey: string, prompt: string, upc: string | null, diag: ProviderDiag): Promise<Candidate[]> {
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
    noteProviderError(diag, 'Anthropic', res.status, await res.text().catch(() => ''))
    return []
  }

  const data = await res.json()
  const textBlock = Array.isArray(data?.content) ? data.content.find((b: { type?: string }) => b?.type === 'text') : null
  return parseAiCandidates(textBlock?.text, upc, 'Anthropic')
}

// ---------------------------------------------------------------------------
// Photo lookup -- ported from car-audio-inventory's vision route (this
// app's sister app), which identifies a photographed product with one
// Claude call: an image content block + a web_search-enabled, structured-
// output prompt. This app tries OpenAI first here too now (same
// precedence as barcode/text, see resolveViaVision below) -- the
// image+web_search+structured-output combination isn't explicitly
// documented as supported by OpenAI's Responses API, but each piece
// (image input, the web_search tool, strict json_schema output) is
// independently documented with no stated incompatibility between them,
// and OpenAI is the funded provider being asked for here. If that
// combination is ever rejected outright, it degrades exactly like every
// other provider failure in this file: logged server-side, empty
// candidates to the caller -- never a broken photo-lookup button.
// ---------------------------------------------------------------------------

const PAGE_URL_SCHEMA = {
  type: 'object',
  properties: {
    page_url: {
      ...NULLABLE_STRING,
      description:
        'Direct HTTPS URL to the single best official product page (manufacturer site or a major ' +
        "retailer's product listing) for this exact product. Null if you can't confidently find one.",
    },
  },
  required: ['page_url'],
  additionalProperties: false,
}

const OFFICIAL_PAGE_PROMPT = (query: string) =>
  `Find the single best official product page for: ${query}. Prioritize the manufacturer's own site or a ` +
  "major car-audio retailer. Return null if you can't confidently find one for this exact product."

const VISION_IDENTIFY_PROMPT =
  'This is a photo of a car-audio shop product (amplifier, subwoofer, speaker, head unit, wiring, ' +
  'enclosure, radio, DSP, etc), taken by staff. Identify the exact brand and model if you can read it in ' +
  'the photo or on its packaging/label. Use web search to confirm the model, find its MSRP in USD, and a ' +
  'plain-language category hint. Return up to 3 candidates, most-likely first, ranked by confidence -- or ' +
  "zero if the photo doesn't show an identifiable product clearly enough; never invent a product from a " +
  'blurry or ambiguous photo.'

// A web_search tool's text-extraction result can't see the product
// photo(s) on a page it finds -- find the single best official product
// page, then fetch and scrape that page ourselves. Narrow, cheap
// follow-up call; only made for the top vision candidate when it didn't
// already come back with a photo (see resolveViaVisionClaude/OpenAi).
async function findOfficialPhotoUrlClaude(apiKey: string, name: string, brand: string | null): Promise<string | null> {
  const query = [brand, name].filter(Boolean).join(' ')
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': ANTHROPIC_VERSION,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: ANTHROPIC_MODEL,
        max_tokens: 512,
        tools: [{ type: 'web_search_20260318', name: 'web_search', max_uses: 2 }],
        output_config: { format: { type: 'json_schema', schema: PAGE_URL_SCHEMA } },
        messages: [{ role: 'user', content: OFFICIAL_PAGE_PROMPT(query) }],
      }),
    })
    if (!res.ok) return null

    const data = await res.json()
    const textBlock = Array.isArray(data?.content) ? data.content.find((b: { type?: string }) => b?.type === 'text') : null
    if (typeof textBlock?.text !== 'string') return null

    const parsed = JSON.parse(textBlock.text) as { page_url?: unknown }
    const pageUrl = parsed.page_url
    if (typeof pageUrl !== 'string' || !pageUrl.startsWith('https://')) return null

    const photos = await scrapeProductImages(pageUrl)
    return photos[0] ?? null
  } catch (err) {
    console.error('resolve-product: official photo lookup (Anthropic) failed', err)
    return null
  }
}

async function findOfficialPhotoUrlOpenAi(apiKey: string, name: string, brand: string | null): Promise<string | null> {
  const query = [brand, name].filter(Boolean).join(' ')
  try {
    const res = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${apiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: OPENAI_MODEL,
        tools: [{ type: 'web_search' }],
        input: OFFICIAL_PAGE_PROMPT(query),
        text: { format: { type: 'json_schema', name: 'official_page', schema: PAGE_URL_SCHEMA, strict: true } },
      }),
    })
    if (!res.ok) return null

    const data = await res.json()
    const messageItem = Array.isArray(data?.output) ? data.output.find((o: { type?: string }) => o?.type === 'message') : null
    const textPart = Array.isArray(messageItem?.content)
      ? messageItem.content.find((c: { type?: string }) => c?.type === 'output_text')
      : null
    const rawText = typeof textPart?.text === 'string' ? textPart.text : typeof data?.output_text === 'string' ? data.output_text : null
    if (typeof rawText !== 'string') return null

    const parsed = JSON.parse(rawText) as { page_url?: unknown }
    const pageUrl = parsed.page_url
    if (typeof pageUrl !== 'string' || !pageUrl.startsWith('https://')) return null

    const photos = await scrapeProductImages(pageUrl)
    return photos[0] ?? null
  } catch (err) {
    console.error('resolve-product: official photo lookup (OpenAI) failed', err)
    return null
  }
}

async function resolveViaVisionClaude(
  apiKey: string,
  imageBase64: string,
  mediaType: 'image/jpeg' | 'image/png' | 'image/webp',
  diag: ProviderDiag,
): Promise<Candidate[]> {
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
      messages: [
        {
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: mediaType, data: imageBase64 } },
            { type: 'text', text: VISION_IDENTIFY_PROMPT },
          ],
        },
      ],
    }),
  })

  if (!res.ok) {
    noteProviderError(diag, 'Anthropic vision', res.status, await res.text().catch(() => ''))
    return []
  }

  const data = await res.json()
  const textBlock = Array.isArray(data?.content) ? data.content.find((b: { type?: string }) => b?.type === 'text') : null
  const candidates = parseAiCandidates(textBlock?.text, null, 'Anthropic vision')

  // The identify call above can't see <img> tags (see the note on
  // scrapeProductImages), so a strong top match with no photo yet gets one
  // more narrow lookup for a real one. Only the top candidate, to keep
  // this to at most one extra round trip.
  const top = candidates[0]
  if (top && !top.imageUrl) {
    top.imageUrl = await findOfficialPhotoUrlClaude(apiKey, top.name, top.brand)
  }

  return candidates
}

// OpenAI Responses API vision: an `input_image` content part (data URL,
// not a separate mime-type field -- the encoding is embedded in the URL
// itself) alongside `input_text`, the `web_search` tool, and the same
// strict json_schema output as the barcode/text path. See the "Photo
// lookup" note above this section for why this exact combination isn't
// explicitly confirmed by OpenAI's own docs, and why it's used anyway.
async function resolveViaVisionOpenAi(
  apiKey: string,
  imageBase64: string,
  mediaType: 'image/jpeg' | 'image/png' | 'image/webp',
  diag: ProviderDiag,
): Promise<Candidate[]> {
  const res = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${apiKey}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      tools: [{ type: 'web_search' }],
      input: [
        {
          role: 'user',
          content: [
            { type: 'input_image', image_url: `data:${mediaType};base64,${imageBase64}` },
            { type: 'input_text', text: VISION_IDENTIFY_PROMPT },
          ],
        },
      ],
      text: { format: { type: 'json_schema', name: 'product_candidates', schema: AI_CANDIDATE_SCHEMA, strict: true } },
    }),
  })

  if (!res.ok) {
    noteProviderError(diag, 'OpenAI vision', res.status, await res.text().catch(() => ''))
    return []
  }

  const data = await res.json()
  const messageItem = Array.isArray(data?.output) ? data.output.find((o: { type?: string }) => o?.type === 'message') : null
  const textPart = Array.isArray(messageItem?.content)
    ? messageItem.content.find((c: { type?: string }) => c?.type === 'output_text')
    : null
  const rawText = typeof textPart?.text === 'string' ? textPart.text : typeof data?.output_text === 'string' ? data.output_text : null
  const candidates = parseAiCandidates(rawText, null, 'OpenAI vision')

  const top = candidates[0]
  if (top && !top.imageUrl) {
    top.imageUrl = await findOfficialPhotoUrlOpenAi(apiKey, top.name, top.brand)
  }

  return candidates
}

// The one entry point the handler calls for photo lookup -- same OpenAI-
// preferred precedence as resolveViaAi below, now that both providers
// have a working image+web_search+structured-output implementation.
async function resolveViaVision(
  imageBase64: string,
  mediaType: 'image/jpeg' | 'image/png' | 'image/webp',
  diag: ProviderDiag,
): Promise<Candidate[]> {
  const openAiKey = Deno.env.get('OPENAI_API_KEY')
  const anthropicKey = Deno.env.get('ANTHROPIC_API_KEY')
  try {
    if (openAiKey) return await resolveViaVisionOpenAi(openAiKey, imageBase64, mediaType, diag)
    if (anthropicKey) return await resolveViaVisionClaude(anthropicKey, imageBase64, mediaType, diag)
  } catch (err) {
    // A throw here is the network layer, not the provider: DNS, TLS, or the
    // Edge Function's own wall-clock limit. Worth reporting for the same
    // reason a 4xx is — silence looks like "found nothing".
    diag.error = 'Could not reach the AI provider'
    console.error('resolve-product: vision request threw', err)
  }
  return []
}

// OpenAI Responses API: the `web_search` built-in tool grounds the answer,
// `text.format` with a strict json_schema constrains the final assistant
// message to AI_CANDIDATE_SCHEMA -- same schema Claude uses, since the
// candidate shape is provider-agnostic. The tool call itself shows up as a
// separate `web_search_call` item in `output`; the actual structured JSON
// is the `message` item's `output_text` content part.
async function resolveViaOpenAi(apiKey: string, prompt: string, upc: string | null, diag: ProviderDiag): Promise<Candidate[]> {
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
    noteProviderError(diag, 'OpenAI', res.status, await res.text().catch(() => ''))
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
async function resolveViaAi(prompt: string, upc: string | null, diag: ProviderDiag): Promise<Candidate[]> {
  const openAiKey = Deno.env.get('OPENAI_API_KEY')
  const anthropicKey = Deno.env.get('ANTHROPIC_API_KEY')
  try {
    if (openAiKey) return await resolveViaOpenAi(openAiKey, prompt, upc, diag)
    if (anthropicKey) return await resolveViaClaude(anthropicKey, prompt, upc, diag)
  } catch (err) {
    diag.error = 'Could not reach the AI provider'
    console.error('resolve-product: AI request threw', err)
  }
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

  // Whether ANY AI provider is funded. Reported on every response so the app
  // can tell "the AI looked and found nothing" apart from "no AI key is set,
  // so nothing ever looked". Those are identical from the client's side
  // otherwise — both return zero candidates — and the shop is left thinking
  // lookup is broken when it was simply never switched on.
  const aiConfigured = Boolean(Deno.env.get('OPENAI_API_KEY') || Deno.env.get('ANTHROPIC_API_KEY'))
  // Collects the first provider failure of this request, so a key that is set
  // but not working says so instead of looking like an empty result.
  const diag: ProviderDiag = { error: null }

  const body = await req.json().catch(() => null)
  const shopId = typeof body?.shopId === 'string' ? body.shopId : ''
  const kind = body?.kind === 'barcode' || body?.kind === 'text' || body?.kind === 'photo' ? body.kind : null
  if (!shopId || !kind) {
    return fail(400, 'Missing shopId or kind')
  }

  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )

  // Photo lookup branches off entirely here -- no normalized cache key, no
  // cache read/write (see the "Photo lookup" note at the top of this
  // file), so it only needs the membership check below, not the parsing
  // that barcode/text do first. Provider precedence matches resolveViaAi
  // (OpenAI first).
  if (kind === 'photo') {
    const imageBase64 = typeof body?.imageBase64 === 'string' ? body.imageBase64 : ''
    if (!imageBase64) return fail(400, 'Missing photo')
    const mediaTypeRaw = body?.mediaType
    const mediaType: 'image/jpeg' | 'image/png' | 'image/webp' =
      mediaTypeRaw === 'image/png' || mediaTypeRaw === 'image/webp' ? mediaTypeRaw : 'image/jpeg'

    // The cache/candidates fetch below doesn't apply to photo, but the
    // membership check still must happen before doing anything real --
    // done inline here rather than sharing the barcode/text block below
    // since photo has no normalizedKey to run alongside it.
    const { data: membership } = await admin
      .from('shop_memberships')
      .select('id')
      .eq('shop_id', shopId)
      .eq('user_id', user.id)
      .maybeSingle()
    if (!membership) {
      return fail(403, 'You are not a member of this shop.')
    }

    const candidates = await resolveViaVision(imageBase64, mediaType, diag)
    return json(200, { ok: true, candidates, cached: false, aiConfigured, aiError: diag.error })
  }

  // Optional brand context — the shop's "brand lock" while receiving a
  // shipment (see src/lib/productSearch.ts). This is the single biggest
  // lever on result quality for a brand whose barcodes were never
  // published: searching a bare unpublished number can never match
  // anything, but "Nemesis Audio NA-12F" usually finds the manufacturer's
  // own page. Part of the cache key, since the same query under a
  // different brand is a genuinely different question.
  const brandHint = typeof body?.brandHint === 'string' ? body.brandHint.trim().slice(0, 60) : ''

  // Fast mode: cache + UPCitemdb only, no AI/web round-trip. The scan UI
  // uses this so an unknown barcode comes back in ~a second and staff can
  // start typing what it is, instead of waiting out a web search that, for
  // an unpublished code, was never going to find anything.
  const fast = body?.fast === true

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
  if (brandHint) normalizedKey = `${normalizeQuery(brandHint)}|${normalizedKey}`

  // Membership check and the cache read are independent queries (the
  // cache read doesn't depend on the membership result, only on
  // shopId/kind/normalizedKey, all already known) -- run them concurrently
  // rather than waiting on membership before even starting the cache
  // lookup. The membership check still gates whether the cache result
  // below is ever used or returned, so this doesn't weaken the
  // authorization check, just overlaps two round-trips that don't need to
  // be sequential.
  const [membershipResult, cacheResult] = await Promise.all([
    admin.from('shop_memberships').select('id').eq('shop_id', shopId).eq('user_id', user.id).maybeSingle(),
    admin.from('product_resolution_cache').select('candidates, expires_at').eq('shop_id', shopId).eq('kind', kind).eq('normalized_key', normalizedKey).maybeSingle(),
  ])
  if (!membershipResult.data) {
    return fail(403, 'You are not a member of this shop.')
  }
  const cached = cacheResult.data

  if (cached && (!cached.expires_at || new Date(cached.expires_at) > new Date())) {
    const candidates = (Array.isArray(cached.candidates) ? cached.candidates : []).map((c: Candidate) => ({
      ...c,
      source: 'resolution_cache' as const,
    }))
    return json(200, { ok: true, candidates, cached: true, aiConfigured })
  }

  // 2. Resolve fresh.
  let candidates: Candidate[] = []

  if (kind === 'barcode') {
    // The bare code, without any brand prefix the cache key may carry.
    const rawCode = normalizeBarcode(code ?? '')

    // A code no database can hold gets no requests made on its behalf. This
    // is not a shortcut for speed -- it is the difference between "we looked
    // everywhere and found nothing", which is what the shop used to be told,
    // and "nothing to look in", which is the truth and points at the one
    // action that works: type the model, and the code gets bound to it.
    if (barcodeLookupForms(rawCode).length === 0) {
      return json(200, {
        ok: true,
        candidates: [],
        cached: false,
        aiConfigured,
        aiError: null,
        unresolvableBarcode: true,
      })
    }

    const upcHit = await resolveViaUpcItemDbAllForms(rawCode)
    if (upcHit) {
      candidates = [upcHit]
    } else if (fast) {
      // Deliberately stop here. A code absent from UPCitemdb is usually a
      // manufacturer that never published its barcodes, and no web search
      // can tie that number to a product -- so the honest fast answer is
      // "not found", handed back in about a second so staff can identify
      // it by model instead. The caller may follow up with a non-fast call
      // in the background.
      candidates = []
    } else {
      candidates = await resolveViaAi(
        `A car-audio shop employee scanned a barcode/UPC that isn't in a standard barcode database: "${rawCode}". ` +
          (brandHint
            ? `The shop says this is a "${brandHint}" product, so search that manufacturer's own catalog and its retailers first. `
            : '') +
          'Search the web (barcode lookup sites, manufacturer sites, retailer listings) to try to identify what car-audio or ' +
          'related shop product this barcode belongs to. Only set barcode_confirmed to true if a source explicitly ties this exact ' +
          "code to the product -- otherwise leave it false/null and lower your confidence, since you're inferring from a general " +
          'product search rather than a direct barcode match. Return up to 3 candidates, most-likely first, or zero if nothing ' +
          'plausible turns up -- never invent a product.',
        rawCode,
        diag,
      )
    }
  } else {
    // kind === 'text' guarantees query was validated non-empty above, but
    // that narrowing doesn't survive across the separate if/else on `kind`
    // a few lines up -- the fallback is unreachable in practice.
    const textQuery = query ?? ''
    candidates = await resolveViaAi(
      `A car-audio shop employee is adding a new product to their catalog and has typed: "${textQuery}" ` +
        '(a partial or full SKU, model number, or product name). ' +
        (brandHint
          ? `They are currently receiving a shipment from "${brandHint}", so treat what they typed as a ${brandHint} ` +
            `model number or SKU. Search ${brandHint}'s own website and its authorized dealers/retailers first, and ` +
            `strongly prefer real ${brandHint} products over similarly-named products from other manufacturers. ` +
            'Smaller car-audio manufacturers often publish full specs on their own site even when their barcodes ' +
            'appear in no barcode database, so the manufacturer page is usually the best source here. '
          : '') +
        'Use web search to find up to 5 real, ' +
        'specific car-audio products (amplifiers, subwoofers, speakers, head units, wiring, enclosures, ' +
        'radios, DSPs, etc) that this could plausibly be, ranked most-likely-match first. Only include ' +
        "products you're reasonably confident are real -- return fewer than 5 results (even zero) rather " +
        "than guessing or inventing a product that doesn't exist.",
      null,
      diag,
    )
  }

  // 3. Cache the result (even an empty one, so an obscure/unresolvable
  // code or query doesn't re-trigger an AI/web call on every retry within
  // the cache window).
  //
  // Exception: an empty *fast* result is not an answer, it's a deliberately
  // half-finished lookup (UPCitemdb missed and we skipped the AI step).
  // Caching it would mean the follow-up non-fast call reads the empty entry
  // straight back and never runs the search at all — so leave the cache
  // untouched and let the real lookup decide what gets stored.
  if (fast && candidates.length === 0) {
    return json(200, { ok: true, candidates, cached: false, fast: true, aiConfigured, aiError: diag.error })
  }

  const days = kind === 'barcode' ? BARCODE_CACHE_DAYS : TEXT_CACHE_DAYS
  const expiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString()
  await admin
    .from('product_resolution_cache')
    .upsert(
      { shop_id: shopId, kind, normalized_key: normalizedKey, candidates, expires_at: expiresAt },
      { onConflict: 'shop_id,kind,normalized_key' },
    )

  return json(200, { ok: true, candidates, cached: false, aiConfigured, aiError: diag.error })
})
