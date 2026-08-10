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
type ProductResolveRequest = { kind: 'barcode'; code: string } | { kind: 'text'; query: string }
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

All of this lives in one Edge Function, `supabase/functions/resolve-product/index.ts`
— it replaces (and both old functions were deleted) `lookup-product-upc`
and `lookup-product-suggestions`.

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

## Demo mode

`DemoRepository.resolveProduct()` never makes a real call. Text queries
always resolve to `[]` (matches the pre-existing `lookupProductSuggestions`
demo behavior exactly). A single fixed constant,
`DEMO_UNRESOLVED_BARCODE = '999999999999'`, deterministically returns two
canned candidates (one `probable`, one `low` with a warning) so the
never-dead-end UI is exercisable in demo mode and Playwright without any
network access; every other unrecognized barcode genuinely resolves to
`[]`, exactly like a real miss.

## Known limitations / deferred

- **No cross-shop shared product library yet.** `product_resolution_cache`
  is deliberately shop-scoped — a genuine "master product" table shared
  across shops (separate identity vs. private-catalog schema, dedup
  rules, RLS that never leaks one shop's price/cost/quantity to another)
  is a real, larger architectural decision that would have destabilized
  this round. This cache is the documented first step; a real shared
  library is future work, not silently working today.
- **No photo/vision lookup yet.** The `image` request kind described in
  the product brief (upload to Storage, extract visible brand/model/label
  text, resolve from that) is not built this round — the camera
  scanner's "Take photo instead" path still reports "not available yet."
  A large, separate piece of work; deferred and not built shallowly.
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
