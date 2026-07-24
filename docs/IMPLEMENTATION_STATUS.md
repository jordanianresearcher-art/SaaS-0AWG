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
- 158/158 tests passing, lint/typecheck/build clean.

## Partially completed

- **Component-slot readiness on real quotes**: `quote_items.category` and
  `quote_options.config_id` columns exist and are threaded through both
  repositories and covered by an integration test (creating a quote with a
  categorized item + config, reading it back, validating it against
  `validatePackageSlots`). **No UI sets these yet** — `NewQuotePage.tsx`'s
  existing free-text option builder is untouched; a staff member typing a
  quote today never picks a category or configuration. That's the fast
  package builder's job (Phase 3).
- **Shopify catalog import**: `car-audio-inventory` (the requested sibling
  repo, `jordanianresearcher-art/car-audio-inventory`) is now cloned into
  this session, and the Shopify connector confirmed live against **Super
  Car Audio (supercaraudio.com)**. Neither the import pipeline nor its
  Edge Function exist yet — this is the very next piece of work, not
  blocked on anything further.

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
| Shopify Admin API (Super Car Audio import) | **Connected** via this session's Shopify MCP connector — confirmed reachable, no further setup needed to start Phase 2. |
| `car-audio-inventory` scanner repo | **Cloned** (`/workspace/car-audio-inventory`) — patterns from it will inform the import/AI-onboarding design, adapted (not forced) into 0Gauge's architecture. |
| AI vision/product-ID provider (for bulk photo onboarding, Phase 5) | Not yet selected/configured. Needed before Phase 5 can start. |
| Web search/MSRP-research provider (Phase 5) | Not yet selected/configured. |

## Known limitations

- No inventory/stock quantities are tracked or required anywhere in this
  model, by design — this is a selling catalog.
- `specs` is schemaless JSONB; there's no validation today that, say, a
  `subwoofer`-category item actually has a `subwooferSizeInches` field.
  Fine for Phase 1 (nothing reads `specs` yet); worth a light shape check
  once the builder starts surfacing specs to staff.
- Quote items don't currently record which catalog item (if any) they
  were copied from, so saving a quote option as a package can't carry an
  image forward automatically (`imageUrl` lands `null` on every converted
  package item). Fixable later by adding a `source_catalog_item_id` to
  `quote_items`, but out of scope for this round.
- The two new migrations (`0009`, `0010`) have **not been applied to any
  live Supabase project** in this session — no personal access token was
  available (see the prior round's same limitation). They're committed
  and ready to run.

## Recommended next step

Start Phase 2 exactly as requested: build the Shopify import for Super Car
Audio using the now-connected Shopify connector, informed by
`car-audio-inventory`'s existing patterns (duplicate detection, image
handling, structured responses) adapted to 0Gauge's repository/RLS
architecture — paginated product fetch, idempotent upsert into
`catalog_items` keyed on `(shop_id, 'shopify', shopify_product_id)`,
preview/results reporting, and local-edit protection (already built into
`catalogItemRow`'s partial-update semantics). Then populate the fast
package builder (Phase 3) against the real, imported catalog so package
creation can be tested with real products, per the original request.
