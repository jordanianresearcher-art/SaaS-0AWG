# Scan-to-Invoice: Inventory Ledger & Document Types

Tracks the "combine the quote estimator with a barcode/photo inventory
scanner" evolution — see `WORKLOG.md`'s "Scan-to-Invoice" round entries for
the day-by-day narrative, and the design plan this was built from (5
phases: ledger foundation → scan workspace + invoice → remaining document
types → AI photo lookup + label printing → voice ordering).

## Why this exists

The shop's real daily workflow is: scan a product, see it show up with
image/name/brand/price already looked up, keep scanning, then decide what
this scan session becomes — a quote to send, an invoice to print/pay/track,
a vendor inventory receipt, or an outgoing order to another shop. Building
that means two things `docs/CATALOG_AND_PACKAGES.md`'s catalog was
explicitly **not** built for yet: real tracked stock quantities (that doc's
own "Known limitations" called this out — "no inventory/stock quantities
are tracked or required anywhere in this model, by design"), and new
document types alongside `Quote` (an itemized, already-decided sale is a
different shape than a multi-tier proposal). This doc covers both.

A second app, `car-audio-inventory` (Next.js + Supabase, cloned at
`/workspace/car-audio-inventory`), already solved the scanning/lookup UX —
`@zxing/browser` barcode scanning, a UPCitemdb lookup, and a Claude +
`web_search` photo-identification flow. Rather than keeping it as a second
deployed app, its logic is being **ported into this app** (rewritten for
this app's shop-scoped/RLS multi-tenant model, which that app doesn't
have) — see each phase below for what's ported vs. built new.

## Completed (Phase 1 — Inventory ledger foundation)

- **`catalog_items` gains real stock tracking** (migration `0011`):
  `quantity_on_hand` (integer, defaults 0 — entirely opt-in, no existing
  quoting flow requires it), `upc_is_generated` (distinguishes a real
  looked-up UPC from one this app generated — see Phase 4),
  `label_printed_at` (the label-print queue, also Phase 4).
- **`stock_movements`**: an append-only ledger — every quantity change
  (`receiving`, `outgoing_order`, `sale`, `adjustment`) is a row here, with
  `quantity_delta` (signed), optional `unit_cost_cents`/`counterparty_name`
  (vendor or destination-shop name), and optional links to the invoice/
  outgoing-order that caused it. Read-only via RLS for shop members —
  every write goes through the RPC below, never a direct insert, so
  `quantity_on_hand` can never drift out of sync with its own history.
- **`apply_stock_movement(...)` RPC**: the only way `quantity_on_hand`
  changes. Inserts the ledger row and updates the item's count atomically
  in one transaction (one function call = one transaction), which matters
  once multiple staff are scanning/receiving/selling at the same register
  at once — a plain client-side read-then-write would race.
- **`invoices`/`invoice_items` and `outgoing_orders`/`outgoing_order_items`
  tables** (schema only this phase — no UI yet, that's Phase 2/3):
  - `invoices` is flat (no tiers, unlike `quotes`/`quote_options`) since by
    the time something is an invoice, staff have already decided what's
    being sold. Sequential, human-friendly `invoice_number` per shop
    (assigned by a trigger using an advisory lock so concurrent inserts
    for the same shop never collide on the same number).
  - `outgoing_orders` is the same shape minus payment fields, plus a
    `destination_name`.
  - Vendor **receiving** deliberately has no header/document table of its
    own — it's just catalog item upserts + `stock_movements` rows with
    `counterparty_name` = the vendor. The ledger itself is the "what did
    we receive and when" record.
- **Repository layer**: `DataRepository.recordStockMovement()` /
  `listStockMovements()`, implemented in both `DemoRepository`
  (localStorage, mirrors the RPC's atomicity — one method updates both the
  ledger array and the item's `quantityOnHand` together) and
  `SupabaseRepository` (calls `apply_stock_movement`). Demo data seeds a
  short realistic history (received 10, sold 4) on two catalog items so
  the ledger isn't empty in a fresh demo. `DEMO_SEED_VERSION` bumped to 11.

## Not yet built (Phases 2-5)

- **Phase 2 — Scan workspace + barcode lookup**: `BarcodeScanner.tsx`
  (ported from `car-audio-inventory`'s `CameraCapture.tsx`, `@zxing/browser`),
  a `lookup-product-upc` Edge Function (ported from that app's
  `/api/lookup/upc` route, UPCitemdb, no API key needed on the free trial
  tier), and the actual `ScanWorkspacePage` — the center work-area cart of
  scanned items (image/name/brand/price, pencil-to-edit) with the side
  panel of document-type actions. Wired first to just **invoices** end to
  end (create, print, mark paid, decrement stock via `recordStockMovement`).
- **Phase 3 — Remaining document types**: quote-from-scan (hands off into
  the existing `NewQuotePage` flow, pre-filled), vendor receiving, and
  outgoing orders, all using the `invoices`/`outgoing_orders` tables
  already landed in Phase 1's migration.
- **Phase 4 — AI photo lookup + generated codes + label printing**: a
  `lookup-product-vision` Edge Function (ported from that app's
  `/api/lookup/vision` route — Claude + `web_search`, Shopify cross-check,
  official product-photo scraping) for products with no findable barcode.
  For products with no UPC anywhere, `src/lib/upc.ts` generates a real,
  checksum-valid **UPC-A number in GS1's reserved in-store/restricted-
  circulation prefix (`02`)** — guaranteed never to collide with an actual
  retail product's barcode, while still being a genuine, scannable GTIN
  (not a fake/ambiguous internal code). `LabelSheetPage` prints these as a
  grid of labels (name, code, barcode) sized for the shop's 4"×6" label
  printer.
- **Phase 5 — Voice ordering**: record → `transcribe-voice-order` Edge
  Function (OpenAI Whisper) → `parse-voice-order` Edge Function (Claude
  structured output against this app's own `ProductCategory` taxonomy and
  `AUDIO_CONFIGURATIONS` shell vocabulary) → fuzzy-match parsed components
  against the catalog, confirm-or-create-new for anything ambiguous.

## Required credentials / access (Phases 4-5, not needed yet)

| For | Status |
| --- | --- |
| `ANTHROPIC_API_KEY` (photo lookup, voice-order parsing) | Not yet set. Not used server-side anywhere in this project today (Shopify import and email use their own separate credentials) — the shop owner will need to set this as a new Supabase Edge Function secret, same self-serve mechanism as `RESEND_API_KEY`/`SHOPIFY_ADMIN_ACCESS_TOKEN`. |
| `OPENAI_API_KEY` (voice transcription) | Not yet set — new secret, same mechanism. |
| UPCitemdb (barcode lookup) | No key needed on the free trial tier (~100 lookups/day/IP) — same as `car-audio-inventory` already uses it. |
| Supabase deploy/migration access | This session still has no Supabase personal access token/CLI (a standing limitation — see `docs/CATALOG_AND_PACKAGES.md`). Migration `0011` is written and ready; the shop owner applies it themselves via the CLI/SQL editor, same as prior migrations this project has shipped. |

## Known limitations (this phase)

- `quantity_on_hand` is real but nothing decrements it yet outside of the
  demo seed and direct `recordStockMovement` calls — no UI writes to it
  until Phase 2's invoice flow lands ("sale" movements) and Phase 3's
  receiving/outgoing-order flows.
- `invoices`/`outgoing_orders` tables exist in the schema but have no
  repository methods or UI yet — deliberately landed early (Phase 1) so
  `stock_movements.source_invoice_id`/`source_outgoing_order_id` could
  reference real tables from the start, rather than being added as
  dangling nullable FKs later.
- No barcode scanning, photo lookup, or voice input exists yet in this
  app — this phase is schema/ledger only. See "Not yet built" above.
