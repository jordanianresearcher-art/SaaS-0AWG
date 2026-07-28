# Catalog & Package Templates

0Gauge is evolving from a quote-recovery tool into a visual, easy car-audio
selling system: any employee should be able to build a correct package
quickly, present it professionally, and still get the quote-recovery
follow-up if the customer doesn't buy on the spot. This document covers the
catalog/package data model that supports that — see `docs/IMPLEMENTATION_STATUS.md`
for what's actually wired up to a UI today versus what's schema-only.

This is a **selling catalog, not a real-time inventory system**. Stock
quantities are never required to quote a product.

## Universal configurations (`src/lib/audioConfigs.ts`)

A "configuration" is a package **shell**, not a finished package — e.g.
"Truck 2×8" says a truck bass build normally needs two 8" subs, a
compatible enclosure, a mono amp, a wiring kit, labor, and usually signal
integration and a bass control, with several optional upgrades. It never
hard-codes a brand, model, or price — each shop fills the slots with
products it actually carries.

- `AUDIO_CONFIGURATIONS`: the seeded truck (2×8, 4×8, 2×10, 2×12) and
  car/sedan/hatchback/SUV (1×8 through 2×15) bass shells. This is
  intentionally **code, not a database table** — these are universal,
  platform-level definitions, not something an individual shop edits (a
  platform admin changing them is a code change + deploy, matching the
  spec's "editable platform data or well-structured seed data").
- `ConfigSlot` / `SlotRequirement`: each configuration lists required,
  recommended, and optional slots by `ProductCategory` (subwoofer,
  enclosure, mono_amp, wiring_kit, integration, bass_control, battery,
  epicenter, integration_module, sound_treatment, ofc_wiring, door_speaker,
  labor, and more — see `types.ts`).
- `validatePackageSlots(config, items)`: pure function comparing a
  configuration's slots against a set of `{category, quantity}` items and
  reporting which required/recommended/optional slots are filled. This is
  the one place "is this package complete?" logic lives — not scattered
  across UI components.
- Only the `bass` shell is populated today. `door_speakers`, `full_system`,
  `radio`, `camera`, `marine` are declared in `ConfigShell` / `SHELL_INFO`
  with `active: false` so the architecture supports them without new code
  — adding a shell later means adding data to this file, not restructuring
  it. Window tint intentionally keeps its own dedicated system
  (`src/lib/windowTint.ts`) — it predates this work and has its own,
  more detailed per-window model.

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

1. **Fast visual package builder** — pick a vehicle type and a
   configuration in `src/components/PackageBuilder.tsx`, drag (or tap)
   catalog products into its slots, then tap "Save as package" in
   `NewQuotePage.tsx`'s option editor. Calls `createPackageTemplate`
   directly — this can happen before the quote itself is even saved, so
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

Lives inside `NewQuotePage.tsx`'s per-option editor as a "Build with drag &
drop" / "Switch to manual entry" toggle — it doesn't replace the existing
free-text product list, it's an alternate way to fill it in:

1. Pick a **vehicle type** (truck / car / sedan / hatchback / suv), then a
   **configuration** (e.g. "Truck 2×8") — `configurationsForVehicleType()`
   filters `AUDIO_CONFIGURATIONS` down to the relevant ones.
2. Drag a product card from the tray onto a slot, or tap a slot then tap a
   product (dnd-kit's `PointerSensor`/`KeyboardSensor` cover mouse, touch,
   and keyboard — plain HTML5 drag-and-drop doesn't work on phones/tablets,
   this app's primary target). A slot only ever accepts its own category —
   dropping a mismatched product shows a toast, not a silent no-op.
3. Set an **installation labor price** in its own field — labor isn't a
   catalog product, so `resolveBuilderCatalog()` folds it into the same
   slot-assignment model as a synthetic, non-persisted `CatalogItem`
   (`id: '__labor_charge__'`) purely so every other calculation (subtotal,
   completeness) doesn't need a special case for it.
4. The parts+labor subtotal is computed live; an **installed-price
   override** field lets staff quote package pricing instead of a straight
   parts markup.
5. A **"Compatibility not verified"** checkbox must be checked before
   applying. `requiresCompatibilityConfirmation()` always returns `true`
   today — nothing in this system holds a real, owner-vetted compatibility
   ruleset yet, so the builder never implies a compatibility check it can't
   back up.
6. **"Apply to this option"** copies the filled slots into that option's
   real `items`, sets its `price` to the computed (or overridden) total,
   and stamps its `configId` — then closes the builder so the now-populated
   manual list is there for a final look before saving. Under-filled
   required slots produce a warning, not a block — a shop might genuinely
   be quoting a partial job.
7. **"Save as package"** (shown once a configuration is picked) names the
   current build and calls `createPackageTemplate` directly — independent
   of react-hook-form, so it works even before the quote itself is saved.

Only `active` + `approvalStatus: 'approved'` catalog items are offered in
slots or the search tray (`catalogItemsForSlot`) — a shop's own
not-yet-approved or deactivated products never get dragged into a quote by
accident.

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
  before deciding create vs. update vs. unchanged vs. skipped.
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
- **Settings → Product Catalog**: manual add/edit form is unchanged —
  brand/model/name/price only. The richer fields (category, MSRP, images,
  etc.) exist in the schema and repository layer and do get populated by
  the Shopify import; there's just no *manual*-entry UI for them yet
  (deliberately — see IMPLEMENTATION_STATUS).
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
- A Playwright smoke pass against `vite preview` in demo mode covering the
  builder end to end: pick vehicle type → configuration, drag a subwoofer
  onto its slot, tap-add an enclosure/amp/wiring kit, set a labor price,
  confirm compatibility, apply, and verify the option's product list,
  price, and total all land correctly — then save the quote.
