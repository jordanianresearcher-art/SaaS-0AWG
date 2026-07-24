# Implementation Status — Selling Catalog & Packages

Tracks the "visual, easy car-audio selling system" evolution against the
5-phase plan. Updated as each phase lands — read this before starting new
work in this area so effort isn't duplicated.

## Completed (Phase 1 — Foundation)

- **Universal configuration engine** (`src/lib/audioConfigs.ts`): all 12
  spec'd bass configurations (truck 2×8/4×8/2×10/2×12; car/sedan/
  hatchback/SUV 1×8 through 2×15), each with required/recommended/optional
  component slots. Pure, tested, framework-agnostic — no UI depends on it
  yet.
- **`validatePackageSlots()`**: the reusable "is this package complete"
  logic, tested against under-filled, missing, recommended-only, and
  categoryless-item cases.
- **Extended catalog product model** (migration `0009`): category, MSRP
  vs. selling vs. promo vs. cost pricing, price provenance, images,
  schemaless specs, active/availability, import source, approval status —
  all additive/nullable, existing catalog flows unaffected. Owner/manager-
  only approval-status changes enforced by a DB trigger.
- **Package template model** (migration `0010`): `package_templates` +
  `package_template_items`, RLS matching this project's existing tenant-
  isolation pattern, same approval-status trigger protection.
- **Save-quote-option-as-package conversion** (`src/lib/packageTemplates.ts`):
  pure, tested snapshot function. **Not yet wired to a UI button.**
- **Quote snapshot immutability**: verified by test — saving a package
  from a quote option and then changing that quote's status afterward
  never changes the saved package.
- Demo mode: enriched catalog (14 categorized products, including two
  deliberately uncategorized bundled products) and 3 seeded package
  templates (approved, approved-with-real-provenance, pending_review) —
  no real external calls.

## Completed (Phase 2 — Shopify import backend)

- **`shopify-import-catalog` Edge Function**: paginated (Shopify
  `products(first, after)` cursor pagination, up to 10 pages per
  invocation, resumable via the returned `nextCursor`), owner/manager-only
  (checks `shop_memberships.role` directly — same reasoning as
  `admin-create-shop`'s platform-admin check, since `is_shop_admin()`'s RPC
  reads `auth.uid()`, which is null under the function's own service-role
  session), idempotent (upserts on
  `(shop_id, import_source='shopify', external_source_product_id=<variant GID>)`).
- **`src/lib/shopifyImport.ts`**: the pure, unit-tested mapping and
  sync-decision logic — one catalog item per Shopify *variant*, best-effort
  `productType` → `ProductCategory` guessing (never an authoritative
  claim), `compareAtPrice` → `msrpCents` only when genuinely higher,
  non-`ACTIVE` products imported as `active: false` rather than skipped,
  and the "never silently overwrite a staff member's price edit since the
  last sync" heuristic (`priceLikelyEditedSinceSync`). **Tested against
  real Super Car Audio product data** fetched live during this round (a
  Nemesis Audio NA-8SLM V.2 subwoofer, etc.) — not synthetic fixtures.
- **`DataRepository.runShopifyImport()`**: `SupabaseRepository` invokes the
  Edge Function; `DemoRepository` throws immediately (demo mode must never
  call a real external service).
- Imported items land `approvalStatus: 'approved'` directly — they're the
  shop's own already-published, already-priced Shopify listings, not an
  uncertain AI guess, so the `pending_review` gate (reserved for Phase 5's
  AI-identified data) doesn't apply to them.
- **Not yet done**: deploying the function, configuring its two secrets,
  and actually running it against the live shop (see "Required credentials"
  below) — and there's still no UI button, by the same "complete backend,
  no dangling UI" approach as Phase 1.
- 174/174 tests passing (16 new in `shopifyImport.test.ts`), lint/
  typecheck/build clean. The Edge Function itself was verified to
  type-check cleanly in isolation (no Deno runtime available in this
  session to execute it against a live store — see below).

## Partially completed

- **Component-slot readiness on real quotes**: `quote_items.category` and
  `quote_options.config_id` columns exist and are threaded through both
  repositories and covered by an integration test (creating a quote with a
  categorized item + config, reading it back, validating it against
  `validatePackageSlots`). **No UI sets these yet** — `NewQuotePage.tsx`'s
  existing free-text option builder is untouched; a staff member typing a
  quote today never picks a category or configuration. That's the fast
  package builder's job (Phase 3).

## Deferred (by explicit phase ordering)

- **Fast visual package builder** (Phase 3) — the phone/tablet-optimized
  slot-filling UI (vehicle type → configuration → subwoofer/enclosure/amp/
  wiring/labor/upgrades → installed price), including the "Save as
  package" button and owner approval screen for pending packages.
- **Repeated/won-combination intelligence** (Phase 3) — a query layer
  detecting "this combination has appeared in N quotes / M won jobs,
  create a reusable package?" Needs real quote volume with categorized
  items to be meaningful, which the fast builder produces.
- **Customer-facing visual quote redesign** (Phase 4) — product images,
  plain-language outcomes, an expandable technical-details section, a
  compact Subwoofers → Enclosure → Amplifier → Wiring → Installation
  summary. The current public quote page (text-based options + line
  items) is unchanged.
- **Bulk photo onboarding / AI product identification** (Phase 5) — multi-
  product-per-photo detection, UPC/model-number-first identification with
  confidence tiers, web MSRP research with source provenance, product
  image research, the exception-focused owner review queue, and the
  interview/advertisement intake. None of this is implemented; see
  "Required credentials" below for what unlocks it.
- **Drag-and-drop package building** (raised alongside this spec) — a UI
  affordance for the fast builder (Phase 3), not a separate system. It
  will consume the same slot/category model built in this phase.

## Required credentials / access

| For | Status |
| --- | --- |
| Shopify Admin API — **used during this session** | This session's Claude-side Shopify MCP connector is live, connected to Super Car Audio (supercaraudio.com), and was used to fetch real product data to design and test the mapping logic above. **This connector is not something the deployed app can use at runtime** — it's a connection for the assistant, not a server-side credential. |
| Shopify Admin API — **needed for the app itself** | The deployed `shopify-import-catalog` function needs its own `SHOPIFY_STORE_DOMAIN` + `SHOPIFY_ADMIN_ACCESS_TOKEN` (a custom-app Admin API token, `shpat_...`) set as Supabase Edge Function secrets — same mechanism as `RESEND_API_KEY`. **Not yet configured.** The sibling `car-audio-inventory` repo already has its own working token for this exact store (confirmed by its code referencing `ADMIN_STORE_HANDLE = "super-car-audio"`); reusing that token (copy it into 0Gauge's secrets) or minting a fresh one via Shopify admin → Settings → Apps and sales channels → Develop apps both work — your call. |
| Supabase deploy/migration access | Same gap as every prior round this session — no personal access token available, so migrations `0009`/`0010` aren't applied live and `shopify-import-catalog` isn't deployed. All code is committed and ready. |
| `car-audio-inventory` scanner repo | **Cloned** (`/workspace/car-audio-inventory`) and read — its `src/lib/shopify.ts` (auth/pagination/GraphQL patterns), `supabase/migrations/000{2,3}_shopify_*.sql`, and `src/app/api/lookup/vision/route.ts` (structured AI responses, confidence, official-photo search) directly informed this round's design and will inform Phase 5. |
| AI vision/product-ID provider (bulk photo onboarding, Phase 5) | Not yet selected/configured. The scanner repo's own pattern (Claude + `web_search` tool + Zod structured output) is a strong candidate to adapt. |
| Web search/MSRP-research provider (Phase 5) | Same as above — the scanner repo already solves this; adapt, don't rebuild. |

## Known limitations

- No inventory/stock quantities are tracked or required anywhere in this
  model, by design — this is a selling catalog. The Shopify importer maps
  inventory quantity into a coarse `availability` bucket
  (`available`/`low_stock`/`out_of_stock`/`not_tracked`) but never a real count.
- `specs` is schemaless JSONB; there's no validation today that, say, a
  `subwoofer`-category item actually has a `subwooferSizeInches` field.
  Fine for now (nothing reads `specs` yet); worth a light shape check once
  the builder starts surfacing specs to staff. The Shopify import doesn't
  populate `specs` at all — Shopify has no structured spec fields to map from.
- Quote items don't currently record which catalog item (if any) they
  were copied from, so saving a quote option as a package can't carry an
  image forward automatically (`imageUrl` lands `null` on every converted
  package item). Fixable later by adding a `source_catalog_item_id` to
  `quote_items`, but out of scope for this round.
- The Shopify import currently supports **exactly one Shopify-connected
  shop per deployment** (a single global secret pair, mirroring how
  `RESEND_API_KEY` already works for all shops today) — matches the
  spec's own framing ("for our shop... future shops will not assume
  Shopify"). Real multi-shop Shopify support would need per-shop
  credential storage, not built.
- `productType` → `ProductCategory` guessing is a small pattern-matching
  table (`guessCategoryFromProductType`), not exhaustive — an unrecognized
  `productType` simply leaves `category: null` rather than guessing wrong.
- The two catalog/package migrations (`0009`, `0010`) and the new Edge
  Function have **not been applied/deployed to any live Supabase project**
  in this session — no personal access token was available (see prior
  rounds' same limitation). Everything is committed and ready to run.

## Recommended next step

Two independent things can happen next, in either order:

1. **Get the Shopify import actually running against Super Car Audio.**
   Needs: (a) apply migrations `0009`/`0010`, (b) deploy
   `shopify-import-catalog` (`supabase functions deploy shopify-import-catalog`),
   (c) set `SHOPIFY_STORE_DOMAIN` + `SHOPIFY_ADMIN_ACCESS_TOKEN` as Edge
   Function secrets (reusing `car-audio-inventory`'s existing token for
   this same store is the fastest path), (d) call
   `repo.runShopifyImport()` in a loop until `hasMore` is false. All of
   this needs either a Supabase personal access token handed to this
   session, or for you to run these steps yourself with the exact
   commands in `docs/CATALOG_AND_PACKAGES.md`.
2. **Build the fast visual package builder (Phase 3)** against whatever
   catalog exists at the time (demo data today, or the real imported
   catalog once step 1 runs) — the vehicle-type → configuration → slot-
   filling UI, the "save as package" button, and the owner approval
   screen for pending packages. This doesn't strictly need step 1 to be
   done first, but testing it against real products (per the original
   request) does.
