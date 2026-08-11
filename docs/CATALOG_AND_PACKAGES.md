# Catalog & Package Templates

0Gauge is evolving from a quote-recovery tool into a visual, easy car-audio
selling system: any employee should be able to build a correct package
quickly, present it professionally, and still get the quote-recovery
follow-up if the customer doesn't buy on the spot. This document covers the
catalog/package data model that supports that — see `docs/IMPLEMENTATION_STATUS.md`
for what's actually wired up to a UI today versus what's schema-only.

This catalog started as a **selling catalog, not a real-time inventory
system** — stock quantities were never required to quote a product, and
that's still true today. As of migration `0011`, catalog items also carry
a real, ledger-backed `quantity_on_hand` (opt-in, additive — nothing here
changed to require it), feeding the separate "scan-to-invoice" effort that
fuses barcode/photo scanning and real inventory tracking into this app.
See `docs/INVENTORY_AND_SCANNING.md` for that model; this doc still covers
the catalog/package/configuration data quoting itself depends on.

## Universal configurations (`src/lib/audioConfigs.ts`)

A "configuration" is a package **shell**, not a finished package — e.g.
"Truck 2×8" says a truck bass build normally needs two 8" subs, a
compatible enclosure, a mono amp, a wiring kit, labor, and usually signal
integration and a bass control, with several optional upgrades. It never
hard-codes a brand, model, or price — each shop fills the slots with
products it actually carries.

- `AUDIO_CONFIGURATIONS`: the seeded truck (2×8, 4×8, 2×10, 2×12) and
  car/sedan/hatchback/SUV (1×8 through 2×15) **bass** shells, the
  **door_speakers** shells (2-way/3-way × front-only/front+rear, offered
  for every vehicle type — voice builds don't size by vehicle body the way
  bass builds do), and the **full_system** shells (one per broad vehicle
  group: truck, car/sedan/hatchback/SUV) that combine a bass build and a
  voice build into a single package. This is intentionally **code, not a
  database table** — these are universal, platform-level definitions, not
  something an individual shop edits (a platform admin changing them is a
  code change + deploy, matching the spec's "editable platform data or
  well-structured seed data").
- `ConfigSlot` / `SlotRequirement`: each configuration lists required,
  recommended, and optional slots by `ProductCategory` (subwoofer,
  enclosure, mono_amp, wiring_kit, integration, bass_control, battery,
  epicenter, integration_module, sound_treatment, ofc_wiring, door_speaker,
  tweeter, dsp, radio, labor, and more — see `types.ts`).
- `validatePackageSlots(config, items)`: pure function comparing a
  configuration's slots against a set of `{category, quantity}` items and
  reporting which required/recommended/optional slots are filled. This is
  the one place "is this package complete?" logic lives — not scattered
  across UI components. For `full_system`, "complete" requires **both**
  the bass side (subwoofer, enclosure, mono_amp) and the voice side
  (door_speaker) filled — the slot list is purpose-built per shell rather
  than concatenating the bass and voice slot lists, so slot keys never
  collide.
- `bass`, `door_speakers`, and `full_system` are populated today. `radio`,
  `camera`, `marine`, `tint` are declared in `ConfigShell` / `SHELL_INFO`
  with `active: false` so the architecture supports them without new code
  — adding a shell later means adding data to this file, not restructuring
  it. Window tint intentionally keeps its own dedicated system
  (`src/lib/windowTint.ts`) — it predates this work and has its own,
  more detailed per-window model.
- The package builder UI (see below) inserts a **shell picker** ("Build
  type": Bass / Voice-speakers / Complete systems) between the vehicle-type
  and configuration pickers, so adding shells doesn't clutter the
  configuration list with too many undifferentiated buttons per vehicle
  type.
- **Wiring-kit gauge/material variants**: a shop typically stocks 0-gauge
  and 4-gauge kits in both CCA and OFC wire, but this doesn't get its own
  `ProductCategory` — it's encoded as a convention on the schemaless
  `specs` JSONB: `specs.gaugeAwg` (a number, e.g. `0` or `4`) and
  `specs.wireMaterial` (`'cca' | 'ofc'`). `formatWiringKitSpec()` in
  `src/lib/format.ts` renders this as a compact "0GA · OFC" badge next to
  the product name/price wherever a `wiring_kit` item is shown in the
  builder, so staff can tell the variants apart at a glance.

## Catalog products (`catalog_items` table, `CatalogItem` type)

Extends the existing shop-managed catalog (unchanged: any shop member can
manage it) with everything a real selling catalog needs, all **additive
and nullable** — no existing catalog item or quote flow changed:

- `category` — lets a product fill a configuration slot.
- Distinct prices: `defaultPriceCents` (the shop's actual selling price,
  unchanged field), `msrpCents`, `promoPriceCents`, `minStaffPriceCents`,
  `costCents` — never conflated. **Owners/managers can edit
  `defaultPriceCents` directly** (no formal "discount" required);
  `promoPriceCents` is the explicit, visible-discount path.
- Price provenance: `priceSourceUrl`, `priceSourceName`, `priceKind`
  (msrp/retail/sale/unknown), `priceCheckedAt` — for when a price comes
  from web research (a later phase) rather than a shop employee typing it in.
- `specs` — a schemaless JSONB blob (subwoofer size, impedance, RMS power,
  etc.) since meaningful specs vary wildly by category; same precedent as
  `quotes.window_tints` and `quote_events.metadata` elsewhere in this schema.
- `importSource` (`manual` / `shopify` / `ai_photo_import`) and
  `approvalStatus` (`approved` / `pending_review` / `rejected`) — nothing
  imported ever silently becomes an active, customer-visible product.
  **Only an owner/manager can change `approvalStatus`** — enforced by a
  Postgres trigger (`guard_catalog_item_approval`), not just app-layer
  trust, since RLS alone can't compare a row's old vs. new value.
- `active` / `availability` (`not_tracked` by default — this is a selling
  catalog, not inventory).
- `catalog_items_import_identity_idx`: a partial unique index on
  `(shop_id, import_source, external_source_product_id)` so a future
  importer can upsert idempotently instead of duplicating rows on re-run.

`updateCatalogItem` (both `DemoRepository` and `SupabaseRepository`) only
sets the columns a caller actually passed — a plain price edit from the
Settings form (which only ever sends brand/model/name/price) can never
silently wipe an imported image or MSRP.

## Package templates (`package_templates` / `package_template_items`)

A shop-specific, named, reusable package built from real catalog products
against a configuration — e.g. "Truck 2×8 Starter" at $799 installed. Three
ways one comes to exist (per the product spec; see IMPLEMENTATION_STATUS
for which are wired to a UI today):

1. **Fast visual package builder** — drag (or tap) catalog products
   straight into a flat list in `src/components/PackageBuilder.tsx`, then
   tap "Save as package" in `NewQuotePage.tsx`'s option editor (see that
   section below for the current, flat-list design — no vehicle-type/
   configuration picker anymore). Calls `createPackageTemplate` directly —
   this can happen before the quote itself is even saved, so
   `sourceQuoteId`/`sourceQuoteOptionId` are left `null` (there's no quote
   yet to point at).
2. **Staff saves an existing quote option as a package** — data/logic
   layer only, no UI button yet. See `src/lib/packageTemplates.ts`'s
   `quoteOptionToPackageTemplateDraft()` — a **pure snapshot conversion**:
   every product, quantity, price, and the configuration are copied.
   `sourceQuoteId`/`sourceQuoteOptionId` are kept for provenance only
   (`on delete set null` in the schema) — editing or deleting the original
   quote later never changes an already-saved package, and vice versa.
3. **AI-drafted onboarding packages** (deferred) — drafted from an imported
   catalog + interview notes; always `pending_review`.

Every template starts `pending_review` unless an owner/manager creates it
directly — the same trigger-enforced approval-status protection as catalog
items (`guard_package_template_approval`). There's still no settings-page
screen listing pending packages for an owner/manager to approve — see
IMPLEMENTATION_STATUS.md's recommended next step.

## Fast visual package builder (`src/components/PackageBuilder.tsx`)

**Rewritten** — the original version (vehicle type → shell → configuration
→ slot grid, described in older commit history) was removed after direct
shop feedback: *"I don't want categories, or build types anymore... I want
the drag and drop to be the default."* Staff had to click through three
picker menus before a single product appeared; the flat version below
replaces that entirely. `AUDIO_CONFIGURATIONS`/`ConfigSlot`/the
vehicle-type-shell-configuration system in `src/lib/audioConfigs.ts` still
exists (existing `configId` values on old quotes/packages stay valid,
`PRODUCT_CATEGORY_INFO` is still the catalog's category taxonomy), it's
just no longer wired into this UI.

Lives inside `NewQuotePage.tsx`'s per-option editor behind a "Build with
drag & drop" button that opens it in a wide (`Modal size="xl"`) dialog — it
doesn't replace the existing free-text product list (still there
underneath, untouched, once the dialog closes), it's an alternate way to
fill it in:

1. **No picker gate.** The dialog opens straight into a dashed-border drop
   zone (empty state: "Drag products here from the right, or tap one to
   add it") on the left and a catalog tray on the right — nothing to
   select first.
2. **Catalog tray, image-first, ranked by real usage.** Cards default-sort
   by `sortCatalogByUsage()` — most-used-first, computed by
   `computeCatalogUsageCounts()` matching this shop's own past quote items
   back to a catalog product by brand/model/name (there's no
   `catalogItemId` stored on a quote item — it's a snapshot — so a text
   match is the only link back). A sort `<select>` (Most used / Name A–Z /
   Price low-to-high), category filter chips, and a search box
   (`ProductSuggestField`, reused as-is) round it out — the same box
   filters the local grid live *and* debounce-searches the web
   (`resolve-product` Edge Function) as a fallback, so a miss on the local
   catalog isn't a dead end.
3. **Drag or tap — one target, not per-slot.** dnd-kit's
   `PointerSensor`/`KeyboardSensor` cover mouse, touch, and keyboard;
   there's a single droppable zone (`DROP_ZONE_ID`), so tapping a card adds
   it immediately — no "select a slot first" step. Re-adding the same
   catalog product bumps its quantity instead of adding a duplicate row
   (`addCatalogItemToBuilder`). On `lg`+ screens the item list sits on the
   left and the tray is a sticky scrollable sidebar on the right; on
   phones/tablets it stacks.
4. Set an **installation labor price** in its own field — priced
   separately from the parts, added straight into the subtotal.
5. The parts+labor+extras subtotal is computed live
   (`computeBuilderItemsSubtotalCents` + `customItemsSubtotalCents`); an
   **installed-price override** field lets staff quote package pricing
   instead of a straight parts markup.
6. **"Apply"** copies the item list into that option's real `items`
   (including each item's `imageUrl`, snapshotted from the catalog product
   it was added from — a real fix over the old version, which always wrote
   `imageUrl: null` regardless) and sets its `price` to the computed (or
   overridden) total, then closes the builder.
7. **"Save as package"** names the current build and calls
   `createPackageTemplate` directly (`configId: null`, `vehicleTypes: []` —
   no configuration concept to attach anymore) — independent of
   react-hook-form, so it works even before the quote itself is saved.
8. **Extra / custom items** — unchanged: a plain name + price + quantity
   list (`packageBuilder.ts`'s `CustomBuilderItem`) for a one-off item that
   isn't worth adding to the permanent catalog — a misc hardware charge, a
   shop-supplies fee.

Only `active` + `approvalStatus: 'approved'` catalog items are offered in
the tray — a shop's own not-yet-approved or deactivated products never get
dragged into a quote by accident. There's no "compatibility not verified"
confirmation checkbox anymore — that was tied to the old slot/configuration
completeness concept, which no longer exists; staff pick real products
directly, same trust level as the manual item list has always had.

## Shopify catalog import (`shopify-import-catalog` Edge Function)

For the one Shopify-connected pilot shop (Super Car Audio), pulls the
shop's real Shopify catalog into `catalog_items` — the opposite direction
from the sibling `car-audio-inventory` repo, which pushes scanned
inventory *into* Shopify. Owner/manager only.

- **Mapping** (`src/lib/shopifyImport.ts`, unit-tested against real
  Super Car Audio product data fetched during this round): one catalog
  item per Shopify **variant** (0Gauge's catalog has no variant concept;
  a variant's GID is already globally unique, so no composite key is
  needed). Title/vendor/description/SKU/barcode/images come across
  directly. `compareAtPrice` maps to `msrpCents` only when it's genuinely
  higher than the current price (a real "was" price, not a lower/equal
  value someone left in the field). `productType` is best-effort mapped to
  a `ProductCategory` via a small pattern table
  (`guessCategoryFromProductType`) — never treated as a verified
  compatibility claim, just a labeling convenience staff can always
  correct. Non-`ACTIVE` Shopify products are imported but land `active:
  false` rather than skipped, so archived/draft listings don't just vanish.
  Because these are the shop's own already-published, already-priced
  listings (not an AI guess), imported items are `approvalStatus:
  'approved'` directly — the `pending_review` gate is for uncertain
  AI-identified data (Phase 5), not a shop's own live catalog.
- **Idempotent re-runs**: each variant is looked up by
  `(shop_id, import_source='shopify', external_source_product_id=<variant GID>)`
  before deciding create vs. update vs. unchanged vs. skipped. `category`
  is part of that change comparison (fixed after a live run surfaced the
  gap) — fixing a product's `productType`/tags in Shopify and re-running
  the import re-categorizes the already-imported row, not just new ones
  going forward.
- **Local-edit protection**: `priceLikelyEditedSinceSync()` compares a
  catalog item's `updatedAt` against `priceCheckedAt` (stamped only when a
  price-carrying write happens, e.g. this importer's own sync) — if a row
  was touched *after* its last sync stamp, a plain re-import leaves that
  item's price/MSRP alone (still refreshing title/image/description/active
  if Shopify changed those) and reports it `skipped`, unless the caller
  explicitly passes `overwriteLocalPrices: true`.
- **Pagination**: one invocation processes one page of 15 products (Shopify
  `products(first, after)` cursor pagination) and returns `hasMore` +
  `nextCursor` so a caller resumes rather than risking one giant call
  timing out on a large catalog. Kept deliberately small — each variant
  costs 2-3 sequential Postgres round trips on top of the Shopify call
  itself, and a real run against Super Car Audio's live catalog hit
  Supabase's Edge Function compute quota at the original, much larger
  values (50 products/page x 10 pages/invocation). The Settings → Shopify
  catalog import button already loops on `hasMore` automatically, so a
  smaller batch just means more (automatic) calls, not a worse import.
- **Auth**: verifies a real signed-in user, then checks
  `shop_memberships.role` directly (`owner`/`manager`) rather than calling
  the `is_shop_admin()` RPC — that RPC reads `auth.uid()`, which is null
  under the function's own service-role session, same reasoning as
  `admin-create-shop`'s platform-admin check.
- **Repository**: `DataRepository.runShopifyImport()` — `SupabaseRepository`
  invokes the Edge Function; `DemoRepository` throws immediately (demo mode
  must never make a real external call). On a non-2xx response,
  `SupabaseRepository` unwraps the function's real JSON `message` (e.g.
  "Only an owner or manager can run a Shopify catalog import.") off the
  `FunctionsHttpError`'s attached `Response`, rather than surfacing
  supabase-js's generic "non-2xx status code" text.
- **UI**: Settings → **Shopify catalog import** (production mode only —
  hidden entirely in demo mode, since demo's `runShopifyImport` always
  throws). One "Run import" button loops the paginated call until
  `hasMore` is false, shows running totals as it goes, and refreshes the
  Product Catalog list below on success. Any staff member can see the
  button; the Edge Function's own owner/manager check is what actually
  gates it, and a non-owner/manager gets that real error message surfaced
  inline.

## What a shop sees where

- **Settings → Shopify catalog import**: the "Run import" button described
  above (production mode only).
- **Settings → Product Catalog**: the add/edit form now includes a
  **Category** dropdown (the 21-value `ProductCategory` taxonomy — same
  list the builder's slots use), and each row shows its current category
  (or an "Uncategorized" badge) at a glance. The richer fields beyond
  category (MSRP, images, specs, etc.) still have no manual-entry UI
  (deliberately — see IMPLEMENTATION_STATUS); category was worth breaking
  that pattern for since it's the one field that directly gates whether a
  product is even findable in the drag-and-drop builder.
- **Settings → Product Catalog → "Organize by category"**
  (`src/components/CatalogOrganizer.tsx`): a bulk categorization tool for
  when Shopify's own `productType`/tags don't map cleanly (or a product
  was added manually and never had a source to guess from). Two ways to
  work: drag a product card onto a category, or tap a card then tap a
  category — the same dual interaction model as the package builder's
  product tray, via the same `@dnd-kit` setup. A category accepts any
  product (there's no "wrong category" here — the whole point is setting
  it), unlike a config slot's strict category match. An **"Auto-categorize"**
  button runs `guessCategoryFromName()` (`src/lib/categorize.ts` — a
  broader regex hint table than the Shopify importer's, since it matches
  against a product's own name/description text rather than a structured
  `productType` field, so it also works for manually-entered products)
  against everything currently uncategorized and reports how many it
  could confidently place versus how many still need a manual look —
  never forces a guess it isn't reasonably sure of.
- **New Quote → each pricing option**: the "Build with drag & drop" toggle
  and "Save as package" button described above.
- **Nowhere yet**: package templates have no *listing/approval* screen —
  they can be created (via the builder or, at the data layer, from a saved
  quote option) but an owner/manager has no page to review, approve, or
  reject a `pending_review` one. See IMPLEMENTATION_STATUS.md.

## Security

Both new tables follow this schema's existing tenant-isolation pattern
exactly (see `docs/SECURITY.md`): RLS enabled, no anon policies, a single
`for all: is_shop_member(shop_id)` policy (mirroring `catalog_items_all`),
with `package_template_items` scoped through its parent template. The one
addition beyond the existing pattern is the two approval-status guard
triggers described above, since "who can approve" is a finer-grained rule
than plain shop membership.

## Environment variables

Universal configs, the extended catalog schema, and package templates
need no new credentials. The Shopify import needs two Edge Function
secrets (not client-reachable `VITE_` variables):

| Variable | Purpose |
| --- | --- |
| `SHOPIFY_STORE_DOMAIN` | e.g. `supercaraudio.com` or `your-store.myshopify.com` |
| `SHOPIFY_ADMIN_ACCESS_TOKEN` | Admin API access token (`shpat_...`) from a custom app — Shopify admin → Settings → Apps and sales channels → Develop apps |

Set with `supabase secrets set SHOPIFY_STORE_DOMAIN=... SHOPIFY_ADMIN_ACCESS_TOKEN=...`,
same mechanism as `RESEND_API_KEY`. Supports exactly one Shopify-connected
shop per deployment today (see IMPLEMENTATION_STATUS.md). AI photo
onboarding (deferred) will need its own separate credentials.

## Running the new migrations

Same process as every prior migration in this project — apply
`supabase/migrations/0009_catalog_product_model.sql` and
`0010_package_templates.sql` to your Supabase project (SQL editor, CLI, or
the Management API), in that order, after `0008`. Neither migration adds a
table specifically for the Shopify import — it writes directly into the
`catalog_items` columns `0009` already added.

## Deploying and running the Shopify import

```
supabase functions deploy shopify-import-catalog
supabase secrets set SHOPIFY_STORE_DOMAIN=... SHOPIFY_ADMIN_ACCESS_TOKEN=...
```

Then, as an owner/manager, go to **Settings → Shopify catalog import** in
the app and click **Run import**. It loops the paginated call until
`hasMore` is false and shows running totals as it goes.

Each page reports `{ created, updated, unchanged, skipped, failed, errors }`.
Safe to re-run any time — re-running never duplicates rows and never
overwrites a price a staff member edited locally (`overwriteLocalPrices`
isn't exposed in the UI yet — only the repository method supports it).

## Testing

- `src/lib/audioConfigs.test.ts` — configuration catalog shape, lookups,
  and `validatePackageSlots` (complete/under-filled/missing required slots,
  recommended slots never blocking completion, quantity summing across
  multiple items of the same category, items with no category filling
  nothing).
- `src/lib/packageTemplates.test.ts` — the quote-option-to-package
  conversion is a true snapshot (mutating the source afterwards doesn't
  touch the draft already produced), and a converted draft's items satisfy
  `validatePackageSlots` for its configuration.
- `src/lib/shopifyImport.test.ts` — category guessing against real
  productType strings this shop actually uses; variant→catalog-item
  mapping (pricing, MSRP-vs-compareAtPrice, availability thresholds,
  multi-variant naming, non-ACTIVE→inactive) against a fixture shaped from
  a real Super Car Audio product; the local-edit-protection heuristic; and
  the full create/update/unchanged/skipped sync-planning decision,
  including "a Shopify title change still flows through while a
  staff-edited price stays protected."
- `src/data/demoRepository.test.ts` — catalog item defaults and
  partial-update semantics (an edit never clobbers fields it wasn't told
  to touch), package template CRUD, seed data covering approved/pending/
  sourced-from-a-quote states, and a snapshot-immutability test (changing
  the original quote's status after saving a package never changes the
  saved package).
- The Edge Function itself (`supabase/functions/shopify-import-catalog/`)
  has no Deno runtime available in this session to execute against a live
  store, but was verified to type-check cleanly in isolation (its
  duplicated mapping/sync logic mirrors the tested `shopifyImport.ts`
  functions exactly).
- `src/lib/packageBuilder.test.ts` — slot eligibility (active + approved +
  matching category only), the add/set-quantity/remove assignment
  reducers, completeness against `validatePackageSlots` (including a
  dangling assignment pointing at a deleted catalog item never fills
  anything), the quote-item and package-item conversions, the component
  subtotal, and `resolveBuilderCatalog`'s synthetic labor item (created
  when a price is set, absent at zero/blank, cleared when the price is
  removed, a no-op with no configuration picked yet).

  **Update — flat-list rewrite**: `packageBuilder.ts` was rewritten around
  a flat `BuilderLineItem[]` list instead of slot assignments (see the
  "Fast visual package builder" section above); `packageBuilder.test.ts`
  now covers `addCatalogItemToBuilder`/`setBuilderItemQuantity`/
  `removeBuilderItem`, `computeBuilderItemsSubtotalCents`,
  `computeCatalogUsageCounts`/`sortCatalogByUsage`, and the
  quote-item/package-item conversions — the slot/configuration-specific
  tests above describe the builder's *original* design, kept here as
  history rather than rewritten line-by-line.
- A Playwright smoke pass against `vite preview` in demo mode covers the
  current builder end to end: open it (no picker gate), type into the
  labor price field to confirm the modal doesn't steal focus back on every
  keystroke (a real bug this rewrite also fixed — see WORKLOG.md), tap a
  catalog card to add it straight to the list, cancel, and confirm the
  tint editor / quote save still work around it.
