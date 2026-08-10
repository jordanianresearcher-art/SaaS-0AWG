# Universal product resolver

The shared, typed contract behind barcode lookup and typed-search
autocomplete — the app's main AI priority, per the product brief: find the
best available identity/name/model/price/image for nearly any car-audio
shop product, never invent certainty, and never dead-end at "not found."

## Why this exists

Before this round, barcode lookup (`lookup-product-upc`) and typed-search
autocomplete (`lookup-product-suggestions`) were two separate Edge
Functions with two separate, narrower response shapes, and a barcode that
missed the local catalog *and* UPCitemdb just reported "not found" — a
genuine dead end for staff mid-scan. This round unifies both into one
resolver contract and makes sure a barcode miss automatically continues
into AI+web resolution instead of stopping.

## The contract

`DataRepository.resolveProduct(request: ProductResolveRequest): Promise<ProductResolveResult>`
(`src/data/repository.ts`) — a discriminated request:

```ts
type ProductResolveRequest =
  | { kind: 'barcode'; code: string }
  | { kind: 'text'; query: string }
  | { kind: 'photo'; imageBase64: string; mediaType: 'image/jpeg' | 'image/png' | 'image/webp' }
```

returning ranked `ProductResolutionCandidate[]`, each with: id, source
(`resolution_cache` | `verified_web_source` | `ai_extracted`),
brand/model/name, a free-text `categoryHint`, upc, image, a
**reference** price + `priceKind` (`msrp`/`retail`/`unknown`) + source
url/name — deliberately never a shop's own selling price/cost, which
lives only on `CatalogItem` and is never overwritten by a candidate —
plus a 0-1 `confidence`, a human `confidenceLevel`, `evidence`, and
`warnings`. `retainedInput` on the result is always the original
code/query, even when candidates come back empty, so a "nothing found"
outcome never loses what was scanned/typed.

**Two existing, already-shipped surfaces now delegate to this contract
rather than making their own calls** — `lookupProductByUpc()` (fast local
match, else a single high-confidence external hit) and
`lookupProductSuggestions()` (the catalog-entry autocomplete built last
round) keep their exact prior return shapes for backward compatibility;
both call `resolveProduct()` underneath.

## Resolution order

1. Shop's own catalog (checked client-side, before `resolveProduct` is
   ever called — see `findCatalogItemByCode`).
2. This shop's `product_resolution_cache` (migration `0012`) — an exact
   `(shop_id, kind, normalized_key)` hit skips the network entirely.
   Barcode results cache 30 days; text results 7 days (prices drift
   faster on a loose text match than a barcode's identity does).
3. **Barcode only:** UPCitemdb (free trial tier, no key) — a real
   barcode-to-product database, classified `verified_web_source`,
   confidence 0.75.
4. AI + web search, structured JSON output — for text queries always, for
   barcodes only once UPCitemdb has already missed. **OpenAI first if
   `OPENAI_API_KEY` is set** (Responses API, the built-in `web_search`
   tool, strict `text.format` json_schema output), **else Claude if
   `ANTHROPIC_API_KEY` is set** (Messages API, the `web_search` tool,
   `output_config`/`json_schema` output) — either key alone is enough,
   OpenAI wins if both are set, and neither set means this step is
   skipped entirely (not an error). Same prompt and the exact same
   `AI_CANDIDATE_SCHEMA` either way; `resolveViaAi` in the Edge Function
   is the one place that picks a provider, and `parseAiCandidates` is the
   one place that turns a provider's raw text into `Candidate[]`, so the
   confidence-capping rule below applies identically regardless of which
   provider answered. The barcode-mode prompt explicitly asks whether a
   source *confirmed* the exact code belongs to the product
   (`barcode_confirmed`); if not, confidence is capped at 0.35
   server-side regardless of what the model claims, and a warning is
   attached — the model is never trusted to assert a barcode match from
   general product knowledge alone.
5. Cache the result (even an empty one, so an obscure code/query doesn't
   re-trigger AI on every retry within the cache window).

**Photo lookup is a separate, simpler path**, not part of the numbered
order above: AI vision + `web_search`, always fresh, never cached (see
"Photo lookup" below).

All of this lives in one Edge Function, `supabase/functions/resolve-product/index.ts`
— it replaces (and both old functions were deleted) `lookup-product-upc`
and `lookup-product-suggestions`.

## Photo lookup

Ported from `car-audio-inventory`'s (this app's sister inventory-scanning
app) production vision route — same *method*, not a from-scratch design:
one AI call with the photo (base64 JPEG/PNG/WebP) as an image content
part alongside a `web_search`-tool-enabled, structured-output prompt
asking it to identify the product and confirm details on the web.
Returns up to 3 ranked candidates through the exact same
`AI_CANDIDATE_SCHEMA`/`Candidate` shape as barcode/text — `parseAiCandidates`
is shared code, so confirmation-modal rendering, confidence badges, and
the "Add to cart" / "Save to catalog & add" actions all work identically
for a photo-derived candidate with zero new UI beyond copy that says
"photo" instead of "barcode."

`car-audio-inventory`'s own vision route is Claude-only (confirmed by
reading its actual source — `@anthropic-ai/sdk`, `claude-sonnet-5`, no
OpenAI usage anywhere in that repo). This app runs the same request
shape through **OpenAI first** now (`resolveViaVision` — same
OpenAI-preferred, Claude-fallback precedence as `resolveViaAi`), since
that's the funded provider being asked for here: `input_image` + the
`web_search` tool + strict `text.format` json_schema output, all in one
Responses API call. That specific three-way combination isn't explicitly
documented as supported by OpenAI, but each piece is independently
documented with no stated incompatibility between them — if it's ever
rejected outright, it degrades exactly like any other provider failure
(logged, empty candidates), not a broken button.

Two other deliberate differences from barcode/text:

- **Never cached.** `product_resolution_cache`'s `kind` check constraint
  only allows `'barcode'`/`'text'` (migration `0012`) — adding `'photo'`
  would need a migration, and a photo is realistically never re-taken
  identically, so there's no meaningful cache hit to chase anyway (same
  reasoning `car-audio-inventory` itself uses — it doesn't cache vision
  lookups either).
- **A second, narrow follow-up call for a real photo.** The `web_search`
  tool (either provider) returns extracted text, not raw HTML, so it
  can't see a product page's `<img>` tags. If the top candidate comes
  back with no `image_url`, `resolveViaVisionOpenAi`/`resolveViaVisionClaude`
  makes one more call (same provider) asking only for the single best
  official product page URL, then fetches that page itself and reads its
  JSON-LD `Product.image` / Open Graph tags (`scrapeProductImages`,
  ported near-verbatim from `car-audio-inventory`'s
  `src/lib/scrape-photos.ts`). Only the top candidate gets this — at most
  one extra round trip, not one per candidate.

## Client-side ranking and dedup

`src/lib/productResolver.ts` (pure, unit-tested, network-free):

- `normalizeBarcode` / `normalizeQuery` — mirrored (duplicated, not
  imported — different runtime) in the Edge Function; barcodes are always
  treated as strings, leading zeros are never dropped.
- `rankCandidates` — an exact brand/model/name token match against the
  original query ranks a candidate ahead of a higher-confidence but
  looser one; barcode queries naturally produce no token overlap and fall
  back to confidence ordering, which is what's wanted there.
- `dedupeCandidates` — conservative: only merges candidates sharing an
  exact UPC, or an exact normalized brand *and* model (never on name
  similarity alone).

`SupabaseRepository.resolveProduct()` runs both after mapping the Edge
Function's response, so ranking/dedup guarantees hold client-side
regardless of what order the server happened to return things in.

## Never dead-ends in the scan workspace

`ScanWorkspacePage.handleBarcodeDetected`:

1. Local catalog hit → add instantly (unchanged).
2. A single confident (`verified_web_source`, `confidenceLevel: 'high'`)
   external match → auto-saved to the catalog and added, same fast path
   this already had.
3. Otherwise → automatically calls `resolveProduct({ kind: 'barcode', code })`
   (a cache hit in the common case — step 2 above already triggered the
   real lookup and populated the cache).
   - Candidates found → a confirmation modal shows up to what the
     resolver returned (image, brand/model, confidence badge, reference
     price + source, warnings) with **"Add to cart"** (fast default,
     doesn't touch the catalog) and a separate, explicit **"Save to
     catalog & add"** action — selecting quantity/inventory is never
     implied by a resolved candidate; it's just usable as a cart line.
   - Nothing found anywhere → the code is retained and shown as a visible
     hint right above "Add a one-off item," never silently discarded; the
     scan is still completable as a custom/temporary line.

`ScanWorkspacePage.handlePhotoCaptured` (the "Take photo instead" button
inside the camera modal) follows the same confirmation-modal shape as
step 3 above, just without a code to retain on a miss — nothing found
just toasts and staff add the item manually, same as always. A
`resolveKind` state (`'barcode' | 'photo'`) is all that changes: it picks
which copy the shared confirmation modal shows ("this barcode isn't in
your catalog yet" vs. "here's what we identified from the photo") — the
modal, candidate cards, and both actions are the exact same JSX either
way.

## Demo mode

`DemoRepository.resolveProduct()` never makes a real call. Text queries
always resolve to `[]` (matches the pre-existing `lookupProductSuggestions`
demo behavior exactly). A single fixed constant,
`DEMO_UNRESOLVED_BARCODE = '999999999999'`, deterministically returns two
canned candidates (one `probable`, one `low` with a warning) so the
never-dead-end UI is exercisable in demo mode and Playwright without any
network access; every other unrecognized barcode genuinely resolves to
`[]`, exactly like a real miss. Photo lookup always deterministically
"succeeds" with those same two canned candidates — there's no equivalent
of an unresolved-barcode constant to compare an image against, and always
succeeding is what actually exercises the confirmation UI in Playwright
(see `smoke28-photo-lookup.mjs`, which drives a real camera capture via
Chromium's fake-device flags and a synthetic video feed, then asserts on
the photo-specific modal copy and candidate cards).

## Known limitations / deferred

- **No cross-shop shared product library yet.** `product_resolution_cache`
  is deliberately shop-scoped — a genuine "master product" table shared
  across shops (separate identity vs. private-catalog schema, dedup
  rules, RLS that never leaks one shop's price/cost/quantity to another)
  is a real, larger architectural decision that would have destabilized
  this round. This cache is the documented first step; a real shared
  library is future work, not silently working today.
- **Photo lookup's OpenAI path is unconfirmed by OpenAI's own docs** —
  see "Photo lookup" above. It's expected to work (each piece is
  independently documented, no stated incompatibility), and degrades
  safely if it doesn't (logged, empty candidates, same as any other
  provider failure), but hasn't been verified against a real funded
  OpenAI key by this session — this repo has no API keys. Worth an extra
  look at `supabase functions logs resolve-product` the first time a shop
  actually tries it, same as any new integration.
- **Neither `OPENAI_API_KEY` nor `ANTHROPIC_API_KEY` is required** for the
  rest of the resolver to work — UPCitemdb barcode lookups and the local
  catalog/cache paths run regardless. Set whichever one the shop's
  operator has actually funded (`supabase secrets set OPENAI_API_KEY=...`
  or `ANTHROPIC_API_KEY=...`) to light up the AI+web-search step; without
  either, barcode misses fall through to UPCitemdb only and text search
  returns no candidates — gracefully, not an error, same degradation
  shape as before. A request that fails at the provider (bad key, no
  credit balance, rate limit) degrades the exact same way: logged
  server-side via `console.error` (`supabase functions logs
  resolve-product`), empty candidates to the caller — a billing problem
  and a genuine "nothing found" look identical from the UI, so check the
  logs before assuming the latter.
