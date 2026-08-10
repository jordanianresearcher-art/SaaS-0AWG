# Implementation Status — Selling Catalog & Packages

Tracks the "visual, easy car-audio selling system" evolution against the
5-phase plan. Updated as each phase lands — read this before starting new
work in this area so effort isn't duplicated.

## Completed (Phase 1 — Foundation)

- **Universal configuration engine** (`src/lib/audioConfigs.ts`): all 9
  spec'd bass configurations (1×8 through 2×15), each with
  required/recommended/optional component slots. Pure, tested,
  framework-agnostic — no UI depends on it yet. **Generalized (this
  round)**: these were originally split into vehicle-gated `TRUCK_BASS`/
  `CAR_BASS` arrays with duplicate truck/car style entries and a
  truck-only 4×8; per an explicit user request they're now one
  `BASS_CONFIGS` array (`bass_1x8`…`bass_2x15`), identical across every
  vehicle type. `full_system_car`'s own configs are untouched — out of
  scope for that request.
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
- **Settings → Shopify catalog import**: a real "Run import" button
  (production mode only) that loops the paginated call until done, shows
  running totals, and refreshes the Product Catalog list on success —
  no browser console or CLI script needed. `SupabaseRepository.runShopifyImport()`
  unwraps the Edge Function's real JSON error message (e.g. "Only an
  owner or manager can run a Shopify catalog import.") off the
  `FunctionsHttpError`'s attached `Response` instead of surfacing
  supabase-js's generic non-2xx message.
- 193/193 tests passing (16 in `shopifyImport.test.ts`), lint/typecheck/
  build clean. The Edge Function itself was verified to type-check
  cleanly in isolation (no Deno runtime available in this session to
  execute it against a live store — see below).

## Completed (Phase 3 — Fast visual package builder)

- **`src/components/PackageBuilder.tsx`**: the phone/tablet-optimized
  slot-filling UI — vehicle type → configuration (e.g. "Truck 2×8") →
  drag-and-drop (or tap-to-add) products into each required/recommended/
  optional slot → a separate installation-labor price field → an
  installed-price override → a "compatibility not verified, please
  confirm" gate. Built on `@dnd-kit/core` (not native HTML5 drag-and-drop,
  which doesn't work on touch devices — this app's primary target is
  phones/tablets in a shop) with pointer, touch, and keyboard sensors, so
  every drag also has a tap/keyboard equivalent.
- **`src/lib/packageBuilder.ts`**: the pure logic underneath it — which
  catalog products are eligible for a slot (`catalogItemsForSlot`), the
  add/set-quantity/remove slot-assignment reducers, converting filled
  slots into quote line items (`assignmentsToQuoteItems`) or into
  package-template items with images (`assignmentsToPackageItems`), the
  component subtotal, completeness against `validatePackageSlots`, and
  folding the separate labor price field into the same generic
  slot-assignment model as a synthetic catalog item
  (`resolveBuilderCatalog`) so no other calculation needs labor-specific
  branching. 19 tests.
- **Wired into `NewQuotePage.tsx`'s option editor**: each pricing option
  now has a "Build with drag & drop" / "Switch to manual entry" toggle.
  The builder is a self-contained draft — it only writes to the option's
  real `items`/`price`/`configId` fields when staff taps "Apply to this
  option," at which point the existing free-text product list (still
  fully present and editable, per the spec's "preserve the existing
  builder" requirement) is populated from it for final review. A "Save as
  package" action alongside it calls `createPackageTemplate` directly
  (independent of the quote's own form state) so a good build can become
  a reusable package before the quote is even saved — the "fast builder"
  path of the three package-creation methods described in
  `docs/CATALOG_AND_PACKAGES.md`.
- **Not built this round**: "Start from a saved package" (pre-filling the
  builder from an existing `package_templates` row). `package_template_items`
  are a price/spec snapshot with no live `catalog_item_id` back-reference
  (by the same "quotes are immutable" philosophy as everything else in
  this app), so re-linking a saved package to live catalog rows to make it
  editable again isn't a small addition — see "Known limitations."
- 212/212 tests passing (19 new in `packageBuilder.test.ts`), lint/
  typecheck/build clean.

## Partially completed

- **Repeated/won-combination intelligence** (Phase 3, not built) — a
  query layer detecting "this combination has appeared in N quotes / M
  won jobs, create a reusable package?" Needs real quote volume with
  categorized items to be meaningful. The fast builder now produces that
  categorized data (`quote_items.category`, `quote_options.config_id` are
  set whenever a staff member applies a builder session), but nothing
  queries it yet.

## Deferred (by explicit phase ordering)

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
- **"Start from a saved package"** — see above; a real but scoped-out
  enhancement to the Phase 3 builder.

## Required credentials / access

| For | Status |
| --- | --- |
| Shopify Admin API — **used during this session** | This session's Claude-side Shopify MCP connector is live, connected to Super Car Audio (supercaraudio.com), and was used to fetch real product data to design and test the mapping logic above. **This connector is not something the deployed app can use at runtime** — it's a connection for the assistant, not a server-side credential. |
| Shopify Admin API — **needed for the app itself** | The deployed `shopify-import-catalog` function needs its own `SHOPIFY_STORE_DOMAIN` + `SHOPIFY_ADMIN_ACCESS_TOKEN` (a custom-app Admin API token, `shpat_...`) set as Supabase Edge Function secrets — same mechanism as `RESEND_API_KEY`. **Configured directly by the shop owner** via `supabase secrets set` during this round (this session still has no way to hold or verify the real token itself). |
| Supabase deploy/migration access | This session still has no Supabase personal access token/CLI, so it can't deploy or migrate directly — but the shop owner applied migrations `0009`/`0010` via the SQL Editor and deployed `shopify-import-catalog` via the CLI themselves during this round, following the exact commands in this doc. |
| `car-audio-inventory` scanner repo | **Cloned** (`/workspace/car-audio-inventory`) and read — its `src/lib/shopify.ts` (auth/pagination/GraphQL patterns), `supabase/migrations/000{2,3}_shopify_*.sql`, and `src/app/api/lookup/vision/route.ts` (structured AI responses, confidence, official-photo search) directly informed this round's design and will inform Phase 5. |
| AI vision/product-ID provider (bulk photo onboarding, Phase 5) | Not yet selected/configured. The scanner repo's own pattern (Claude + `web_search` tool + Zod structured output) is a strong candidate to adapt. |
| Web search/MSRP-research provider (Phase 5) | Same as above — the scanner repo already solves this; adapt, don't rebuild. |

## Known limitations

- ~~No inventory/stock quantities are tracked or required anywhere in this
  model, by design — this is a selling catalog.~~ **No longer true** — a
  real, ledger-backed `quantity_on_hand` landed in migration `0011`, opt-in
  and additive (nothing about quoting requires it). See
  `docs/INVENTORY_AND_SCANNING.md` for the full "scan-to-invoice" effort
  this is the foundation of. The Shopify importer still only maps
  inventory quantity into the coarse `availability` bucket
  (`available`/`low_stock`/`out_of_stock`/`not_tracked`), not the new
  `quantity_on_hand` count — nothing reconciles the two yet.
- `specs` is schemaless JSONB; there's no validation today that, say, a
  `subwoofer`-category item actually has a `subwooferSizeInches` field.
  Fine for now (nothing reads `specs` yet); worth a light shape check once
  the builder starts surfacing specs to staff. The Shopify import doesn't
  populate `specs` at all — Shopify has no structured spec fields to map from.
- Quote items don't currently record which catalog item (if any) they
  were copied from. Saving a package **directly from the fast builder**
  does carry product images forward (it still has the live catalog items
  in hand). But **saving an already-existing quote option** as a package
  (`quoteOptionToPackageTemplateDraft` in `src/lib/packageTemplates.ts`)
  can't — `imageUrl` lands `null` on every item converted that way.
  Fixable later by adding a `source_catalog_item_id` to `quote_items`, but
  out of scope for this round.
- The builder's "Apply to this option" button doesn't block on
  `isBuilderComplete()` — it warns when required slots are under-filled
  but still lets staff apply and finish the option manually below. This
  is deliberate (a shop might genuinely sell a sub-only job with no
  enclosure yet in stock), not an oversight.
- The Shopify import currently supports **exactly one Shopify-connected
  shop per deployment** (a single global secret pair, mirroring how
  `RESEND_API_KEY` already works for all shops today) — matches the
  spec's own framing ("for our shop... future shops will not assume
  Shopify"). Real multi-shop Shopify support would need per-shop
  credential storage, not built.
- `productType` → `ProductCategory` guessing is a small pattern-matching
  table (`guessCategoryFromProductType`), not exhaustive — an unrecognized
  `productType` simply leaves `category: null` rather than guessing wrong.
- This session still can't deploy or migrate a live Supabase project
  directly (no personal access token/CLI available to it) — but the shop
  owner has now applied migrations `0009`/`0010` and deployed
  `shopify-import-catalog` themselves this round, using the commands in
  this doc. The actual Shopify import against Super Car Audio's real
  catalog still hasn't been confirmed as run from this session's side —
  that happens via the new Settings → Shopify catalog import button.

## Recommended next step

1. **Click "Run import" in Settings → Shopify catalog import**, as an
   owner or manager, now that migrations/deploy/secrets are done. It
   loops until `hasMore` is false and shows running totals; check the
   final numbers and any per-product errors. Imported rows land
   `approvalStatus: 'approved'` automatically (they're the shop's own
   already-published Shopify listings, not an uncertain AI guess), so
   they're immediately usable in the fast builder — no separate approval
   step needed for this path.
2. Open **New Quote → an option → Build with drag & drop** and confirm
   the vehicle-type/configuration slots now offer the real imported
   products instead of (or alongside) the demo catalog.
3. **Owner approval screen for pending package templates** — `package_templates`
   already has the `approvalStatus`/`setPackageTemplateApproval` plumbing
   from Phase 1, and both the fast builder's "Save as package" and the
   older save-from-quote path default new packages to `pending_review`,
   but there's still no settings-page UI listing them for an owner/manager
   to approve or reject. Small, contained addition on top of what exists.
