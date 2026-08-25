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
3. **Barcode only:** the shared cross-shop catalog (exact barcode match,
   skipped for store-assigned GS1-prefix-2 codes, whose digits mean a
   different product at every retailer), then UPCitemdb (free trial
   tier, no key) — a real barcode-to-product database, classified
   `verified_web_source`, confidence 0.75.
4. **Text only:** the retailers' own storefront search — Moon Car
   Stereo and Sundown (Shopify `search/suggest.json`), Down4Sound and
   Sky High (BigCommerce quick-results HTML) — all queried in parallel
   with a 3.5s per-store budget, ~1s total in practice. Live listings
   carry the name, current price, image and product URL; **two or more
   hits end the resolution with no AI call at all**. The parsers are
   pure, mirrored, and pinned against captured real responses in
   `src/lib/__fixtures__/` (`retailerSearch.test.ts`), so a store
   redesign fails a named test instead of a shop's intake.

   Deliberately NOT used for barcodes: tested live, raw UPC digits get
   zero hits on the Shopify stores and *false* fuzzy matches on the
   BigCommerce ones (D4S matched `677478807501` to alternators "for a
   2004"), which would attach a confident wrong product to a scan.
   `skipRetailers: true` (sent by the Settings self-test) bypasses this
   step so the health check still proves the AI key rather than
   reporting "healthy" over a dead one.
5. AI + web search, structured JSON output — for text queries only when
   the retailers returned fewer than two listings (the prompt then says
   which stores were already checked, steering the model toward Amazon,
   eBay, Crutchfield and manufacturer sites); for barcodes only once
   UPCitemdb has already missed. **OpenAI first if
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

**Two round trips that don't need to be sequential run concurrently
instead:** step 1's `findCatalogItemByCode` issues its UPC lookup and its
SKU lookup as one `Promise.all` (neither depends on the other's result,
both only need the already-known `code`). Inside the Edge Function, the
shop-membership check and step 2's cache read are likewise independent of
each other's *result* — both only need `shopId`/`kind`/`normalizedKey`,
already known before either query runs — so they also fire as one
`Promise.all`; the membership result still gates whether the cache result
is ever used or returned, so authorization isn't weakened, the two
round-trips just overlap instead of waiting on each other.

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
3. Otherwise, the candidates already fetched: `lookupProductByUpc()`
   internally calls `resolveProduct()` to check for step 2's single
   confident match, so it already has the full ranked candidate list in
   hand by the time it decides step 2 doesn't apply. Earlier this list was
   discarded and `ScanWorkspacePage` made its own separate
   `resolveProduct({ kind: 'barcode', code })` call to re-fetch it — a full
   second Edge Function round trip (its own auth + membership + cache
   overhead) just to re-fetch data the first call already had. Fixed:
   `UpcLookupResult` gained a `'candidates'` variant that carries the list
   straight through, so this is one round trip, not two.
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


---

## Brand hint and fast mode (added for unpublished barcodes)

Some manufacturers never publish their barcodes anywhere — Nemesis Audio is
the case that drove this. For those products **no lookup can ever succeed
from the code alone**: the number is in no barcode database, and a web search
for a bare 12-digit number matches nothing. Sending it to the AI anyway cost
15-30 seconds per scan and returned nothing useful.

Two request options address that:

| Option | Applies to | Effect |
| --- | --- | --- |
| `brandHint` | `barcode`, `text` | The brand the shop is currently receiving. Scopes the web search to that manufacturer's own site and its dealers, and is part of the cache key. This is what makes a lookup work at all for these products — "Nemesis Audio NA-12F" finds the manufacturer's page; the barcode never will. |
| `fast` | `barcode` | Answers from the cache + UPCitemdb only and stops there, skipping the AI/web step (~1s instead of 15-30s). |

**An empty `fast` result is never cached.** It isn't an answer, it's a
deliberately half-finished lookup — caching it would make the follow-up full
lookup read the empty entry straight back and never run the search at all.

Callers use these together: the scan flows do a `fast` lookup, hand staff the
keyboard immediately on a miss, and (in the selling workspace) run the full
search in the background, offering candidates only if the same code is still
on screen. See `src/pages/app/NewInventoryItemPage.tsx` (rapid intake) and
`ScanWorkspacePage`'s `handleBarcodeDetected`.

The durable fix is neither of these, though: identifying a product once
**binds its code to that catalog item forever**, so an unpublished barcode is
a one-time cost per product rather than a permanent one. Rapid intake is
built around making that one time as cheap as possible — see
`src/lib/productSearch.ts` for the offline-first matching that backs it.

## What a barcode actually is (added after a live failure)

A shop scanned three codes and got nothing, and reported lookup as broken.
The codes turned out to diagnose two separate faults:

| Code | What it is | Why it failed |
|---|---|---|
| `200001188725` | A **valid** UPC-A whose GS1 prefix is `2` — "restricted distribution", meaning the store assigned it | No public database can ever hold it |
| `26040308` | Eight digits that are not a valid EAN-8 | An internal item number, not a retail barcode |
| `7908706600230` | A valid EAN-13, prefix `790` = Brazil (Taramps) | Real and findable, but only the scanned form was ever queried |

`normalizeBarcode` only stripped whitespace and dashes; there was no
classification, no check-digit validation, and no UPC-A ↔ EAN-13 conversion
anywhere. All three now live in **`src/lib/barcodeIdentity.ts`** (mirrored
into the Edge Function, tested on the client side against these exact codes):

- **Store-assigned and item-number codes short-circuit** with zero network
  calls. The reply is the only thing that can work — type the model, and the
  code is bound to it forever. That binding already existed; it was buried
  behind a ten-second wait and an error.
- **A failed check digit on a 12- or 13-digit code is a misread scan**, not
  an unknown product, and says so. Eight digits failing EAN-8 deliberately do
  *not* get that verdict: those labels scan fine and are simply internal
  numbering, so "try scanning again" would send staff in circles.
- **Both equivalent forms are queried.** A 12-digit UPC-A and the 13-digit
  EAN with a leading zero are one product and a database may hold either.

Ordering is load-bearing and unchanged: `lookupProductByUpc` checks the local
catalog *first*, so a store barcode already bound during rapid intake resolves
instantly and never reaches the short-circuit.

## The provider ladder

The rich AI call depends on three exact things being right at once — the model
id, the web-search tool identifier, and the structured-output request shape.
Any one of them being wrong for a given account fails the whole call, and the
caller used to see an empty list indistinguishable from "no such product".

Each provider is now tried down three rungs, first to return candidates wins:

1. **web search + strict structured output** — best quality
2. **structured output, no tools** — removes the tool-identifier risk
3. **plain chat, "reply with only JSON"** — removes the response-format risk

Rung 3 works on essentially every chat model and API version, so a deployment
where the rich path is unavailable gets slightly worse results rather than
none. Its replies arrive fenced, prefaced, or trailed with prose, which
`src/lib/aiJson.ts` recovers by scanning for a balanced value while tracking
string literals — a brace inside a product name cannot end the object early.
It returns null rather than repairing anything: a guessed parse would invent a
product, which is worse for a shop than no result.

**Model id.** No longer hardcoded. `OPENAI_MODEL` / `ANTHROPIC_MODEL` secrets
override the default without a redeploy, and on a model-not-found the resolver
asks the provider what it actually has (`GET /v1/models`) and retries. That
retry sits *outside* the rung loop on purpose — a wrong model id fails all
three rungs identically, so discovering it first saves three round trips. The
discovered list is cached module-scope, which is safe because it is a property
of the API key, unlike the per-request `ProviderDiag`.

## Diagnosing it from the app

Settings → **Test product lookup** runs a fixed query and reports which
provider answered, which model it used, which rung it had to drop to, and the
product it found as proof — or the exact provider error and the command that
fixes it.

This exists because every failure mode looks identical from the shop floor: no
key, a key without access to the configured model, an unavailable tool, a
function that was never deployed, and a genuine miss all end in an empty list.
That ambiguity is what turned a configuration problem into a week of "lookup
is broken" with nothing to act on.

## Why the health check uses `kind: 'text'`

The first version of the self-test sent a bespoke `kind: 'selftest'`. That was
backwards, and it failed on exactly the deployment it existed to diagnose.

The app and the Edge Function ship through **two separate manual pipelines** —
the app to Cloudflare, the function via `supabase functions deploy` — and
nothing keeps them in step. A browser running new code called a function
running old code, whose `kind` check only knew `barcode`/`text`/`photo`, so it
answered `400 Missing shopId or kind`. supabase-js collapsed that to "Edge
Function returned a non-2xx status code", and the UI reported **"No AI provider
key is set"** to an owner who had just set one, recharged the account, and
redeployed.

Two rules came out of that, and both are load-bearing:

1. **A health check runs on the oldest contract available, never the newest.**
   `kind: 'text'` has been supported since the resolver shipped, and it
   exercises the same path a shop uses when they type a model name — which is
   the thing being asked about anyway. It works against every deployed version.
2. **A diagnostic never guesses.** `aiConfigured` is `boolean | null`, and null
   means "the call never got far enough to ask". Reporting `false` there is
   what produced the wrong instruction.

Supporting details: `noCache: true` asks for a live call, and older
deployments ignore the unknown field rather than failing — a cache hit is
reported rather than counted as a pass, since it proves the pipeline worked
once but says nothing about whether the key works now. `FUNCTION_VERSION` is
reported so a skew is visible instead of inferred; its absence means the
deployed function predates these diagnostics.

## Deploying without skew

Three things deploy separately and drifting between them is the most common
cause of "it's broken":

```bash
npm run deploy          # Edge Functions, then install + build + wrangler (app)
npm run deploy:web      # app only (installs and checks env first)
npm run deploy:functions # Edge Functions only — needs no VITE_* variables
```

**Functions deploy before the app, deliberately.** A newly-deployed app calling
an old function is the skew that produced "No AI provider key is set" on a
project whose key was fine; the reverse — an old app calling a new function —
is safe, because the function is kept backwards compatible. Ordering it this
way also means a web-side failure (missing `VITE_*`) cannot block the half that
had no such precondition.

`deploy:web` runs `npm install` and an env check through npm's `predeploy:web`
hook. The env check is the more important one: Vite bakes `VITE_*` variables
into the bundle at **build time**, so a build run on a laptop without them
uploads a site that tells every visitor "Login isn't set up on this install
yet" — while the build and the upload both report success. Cloudflare Pages
builds with those variables set in the Pages project, which is why pushing to
git has always worked; building locally needs a `.env.local` with the same
values. The check refuses rather than shipping the broken bundle.

The install half matters too. That is not
housekeeping: a pull that adds a dependency leaves `node_modules` stale, and
the build then fails with `Cannot find module '@zxing/browser'` — which reads
like broken code rather than an un-run install. Hanging the install off
`deploy:web` means it happens once in the full chain and also when that script
is run on its own.

Setting a secret does **not** deploy code:
`supabase secrets set OPENAI_API_KEY=…` changes what the function reads at its
next invocation, but a function whose *code* is stale stays stale until it is
deployed. Migrations are a third, separate step run in the SQL editor.

## Pointing the resolver at a cheaper provider

The web-search call, not the tokens, is what makes a lookup expensive:
roughly $0.01–0.025 per grounded search against well under a tenth of a cent
of tokens for a small model. So the cheapest meaningful change is not a
cheaper model — it is not making a search call.

Any OpenAI-compatible endpoint can serve the resolver. It takes three secrets
and no code change:

```bash
supabase secrets set AI_BASE_URL=https://generativelanguage.googleapis.com/v1beta/openai
supabase secrets set AI_API_KEY=<your key>
supabase functions deploy resolve-product
```

**`AI_MODEL` is optional, and leaving it unset is the more reliable choice.**
Unset, the resolver asks the endpoint what it serves (`GET /models`, which
every compatible endpoint implements) and picks a small fast tier from the
answer. A model id written into config is a guess with a shelf life —
`gemini-2.5-flash` was this function's default and had already been retired, so
every lookup 404'd on a project configured perfectly correctly. Discovery does
not go stale.

Set it only to pin a specific model:

```bash
supabase secrets set AI_MODEL=gemini-3.7-flash
```

To see what your key can actually reach:

```bash
curl -s -H "Authorization: Bearer $AI_API_KEY" \
  https://generativelanguage.googleapis.com/v1beta/openai/models \
  | grep -o '"id": *"[^"]*"'
```

The self-test in Settings reports the model that actually answered, which is
the fastest confirmation of what the endpoint settled on.

Known-good base URLs:

| Provider | `AI_BASE_URL` |
|---|---|
| Google Gemini | `https://generativelanguage.googleapis.com/v1beta/openai` |
| Groq | `https://api.groq.com/openai/v1` |
| OpenRouter | `https://openrouter.ai/api/v1` |
| OpenAI (cheap model) | `https://api.openai.com/v1` |

When `AI_BASE_URL` and `AI_API_KEY` are both set they take precedence over
`OPENAI_API_KEY` and `ANTHROPIC_API_KEY` — configuring an endpoint is a
deliberate decision about cost, and a leftover key from an earlier setup
should not quietly override it.

### Web grounding on the compatible path

Gemini exposes Google Search grounding through the OpenAI-compatible layer as a
`google` block on the request body (what the OpenAI SDK calls `extra_body`),
and only on **Gemini 3 and newer**. Rung 1 sends it, and only to Google's own
host — other compatible endpoints reject unknown top-level fields, and there is
no reason to spend a round trip proving that.

This matters more than it sounds. An ungrounded model identifies a Kicker
CompR from memory perfectly well, and cannot identify a JP284 amplifier at all
— and obscure part numbers are most of what a shop actually scans. The first
version of this path sent no search tool, purely for cost, and the result was a
lookup that returned "no matches" for exactly the products it existed to
identify.

So rung 1 is now the *grounded* rung, and it asks for `json_object` rather than
a strict `json_schema` — inverting the usual strictest-first order on purpose.
The schema-plus-grounding combination is the likelier of the two to be
rejected, and losing grounding costs far more than losing schema strictness:
unstructured JSON is recovered by `parseLooseJson`, while a model without web
access simply cannot answer.

The self-test reports which rung answered and whether it reached the web, so a
memory-only answer is never mistaken for a grounded one.

**Cost note:** grounded queries are the expensive part (~$0.01-0.025 each
against well under a tenth of a cent of tokens), which is why the local catalog,
the shared catalog and the resolution cache all sit in front of it. Cost is per
*unique* product, not per scan.

Two things already make repeat lookups free regardless of provider: the local
catalog is checked first, and `product_resolution_cache` holds barcode results
for 30 days and text results for 7. Cost is per *unique* product, not per scan.
