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

1. **Staff saves a quote option as a package** — the only one implemented
   so far, and only at the data/logic layer (no UI button yet). See
   `src/lib/packageTemplates.ts`'s `quoteOptionToPackageTemplateDraft()` —
   a **pure snapshot conversion**: every product, quantity, price, and the
   configuration are copied. `sourceQuoteId`/`sourceQuoteOptionId` are kept
   for provenance only (`on delete set null` in the schema) — editing or
   deleting the original quote later never changes an already-saved
   package, and vice versa.
2. **Fast visual package builder** (deferred) — staff pick a vehicle type,
   a configuration, and fill slots from the catalog.
3. **AI-drafted onboarding packages** (deferred) — drafted from an imported
   catalog + interview notes; always `pending_review`.

Every template starts `pending_review` unless an owner/manager creates it
directly — the same trigger-enforced approval-status protection as catalog
items (`guard_package_template_approval`).

## What a shop sees where

- **Settings → Product Catalog**: unchanged today — brand/model/name/price
  only. The richer fields exist in the schema and repository layer for a
  future import to populate; no manual-entry UI for them yet (deliberately
  — see IMPLEMENTATION_STATUS).
- **Nowhere yet**: package templates have no screen. The repository/type
  layer is complete and tested; the "fast package builder" and "save as
  package" button are the next phase's UI work.

## Security

Both new tables follow this schema's existing tenant-isolation pattern
exactly (see `docs/SECURITY.md`): RLS enabled, no anon policies, a single
`for all: is_shop_member(shop_id)` policy (mirroring `catalog_items_all`),
with `package_template_items` scoped through its parent template. The one
addition beyond the existing pattern is the two approval-status guard
triggers described above, since "who can approve" is a finer-grained rule
than plain shop membership.

## Environment variables

None yet — this phase (universal configs, extended catalog schema, package
templates) needs no new credentials. Shopify import and AI photo onboarding
(both deferred) will need their own — see IMPLEMENTATION_STATUS.md.

## Running the new migrations

Same process as every prior migration in this project — apply
`supabase/migrations/0009_catalog_product_model.sql` and
`0010_package_templates.sql` to your Supabase project (SQL editor, CLI, or
the Management API), in that order, after `0008`.

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
- `src/data/demoRepository.test.ts` — catalog item defaults and
  partial-update semantics (an edit never clobbers fields it wasn't told
  to touch), package template CRUD, seed data covering approved/pending/
  sourced-from-a-quote states, and a snapshot-immutability test (changing
  the original quote's status after saving a package never changes the
  saved package).
