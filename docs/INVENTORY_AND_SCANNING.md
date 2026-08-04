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

## Completed (Phase 2 — Scan workspace + barcode lookup + invoices)

- **`src/components/BarcodeScanner.tsx`**: ported from `car-audio-inventory`'s
  `CameraCapture.tsx` — `@zxing/browser` live camera decode, a "Take photo
  instead" fallback for products with no barcode (the photo capture itself
  is wired to a "not available yet" message this phase; AI identification
  is Phase 4). Code-split via `React.lazy`/`Suspense` in `ScanWorkspacePage`
  — the ~470kb zxing bundle only downloads once someone actually opens the
  scanner, not on every page load.
- **`lookup-product-upc` Edge Function**: ported from that app's
  `/api/lookup/upc` route (UPCitemdb's free trial endpoint, no API key
  needed). Requires just a signed-in user — no shop-membership check, since
  it's a pure external lookup that touches no shop-specific rows.
- **`DataRepository.lookupProductByUpc()`**: local `catalog_items` match by
  UPC/SKU first (`findCatalogItemByCode`), falling back to the Edge
  Function only in production — demo mode never makes the real network
  call, same rule as `runShopifyImport`. A successful external match is
  immediately saved into the shop's catalog (with the UPC set) so the next
  scan of that exact barcode is an instant local hit. **Never throws** —
  any failure reaching the Edge Function (not deployed yet, a network
  hiccup, whatever) degrades to the same `{ source: 'not_found' }` result
  a genuine miss produces, logged to the console for debugging but never
  surfaced as a raw error mid-scan. (Real shops will hit this today: the
  Edge Function isn't deployed to the live project until the shop owner
  runs `supabase functions deploy lookup-product-upc` — until then, every
  barcode not already in the local catalog just falls through to "add it
  manually," which is the correct degraded behavior, not a bug.)
- **Hardware (laser/CCD) barcode scanners are the primary input** — most
  of these (USB on a PC, Bluetooth on a phone/tablet) need no camera, app,
  or driver at all: to the browser they're just a keyboard that types a
  barcode's characters in a couple of milliseconds each, then sends Enter.
  `src/lib/hardwareScan.ts`'s `ScanBuffer` detects this shape (buffers
  keystrokes, resets on any gap slow enough to be human typing, done
  fully pure/timestamp-driven so it's unit-testable with no DOM) and
  `src/lib/useHardwareScanner.ts` wires it to real `keydown` events. Two
  complementary capture paths, both landing in the same
  `handleBarcodeDetected`:
  - A dedicated, always-focused "Scan here" input in `ScanWorkspacePage`
    (auto-focuses on load, refocuses after every lookup and whenever a new
    session starts) — the scanner's keystrokes land directly in it like
    any real typing, so this is the reliable primary path.
  - `useHardwareScanner`'s document-wide listener as a fallback for when
    focus has drifted off that field (a button, the page background) —
    it explicitly ignores any real `<input>`/`<textarea>`/`contentEditable`
    target, so normal typing in the search box, custom-item fields, or the
    payment form is completely unaffected; it only ever fires when nothing
    editable has focus.
  - The camera (`BarcodeScanner.tsx`) is now explicitly secondary — a
    "Use camera instead" button, for shops without a hardware scanner or
    for a one-off item the scanner can't read.
- **Invoices, end to end**: `DataRepository.createInvoice()` (always
  `'draft'`, never touches stock) and `markInvoicePaid()` (idempotent —
  records one `'sale'` `stock_movements` row per line item that has a
  `catalogItemId`, skipping custom/one-off lines, via the same
  `recordStockMovement`/`apply_stock_movement` path Phase 1 built).
  `invoice_number` is assigned by the DB trigger in production; demo mode
  computes the equivalent locally.
- **`src/lib/scanCart.ts`**: the pure cart model backing the workspace —
  scanning/tapping the same catalog item twice bumps quantity instead of
  duplicating the row (custom items never merge, since two one-off entries
  aren't guaranteed to be "the same thing"), plus the edit/remove/subtotal/
  invoice-item-conversion helpers. Fully unit tested before any UI wiring.
- **`ScanWorkspacePage.tsx`** (`/app/scan`, the new primary nav
  destination — see `AppLayout.tsx`, the mobile bottom nav's center button
  now opens Scan instead of "New quote"): center work area holds the
  running cart (image/name/brand/price, quantity stepper, pencil-to-edit,
  remove) while building; the side panel has the four document-type tiles
  (only **Invoice** is active — Quote/Receive inventory/Outgoing order
  show a "Soon" badge, not yet wired) plus the create/pay/print flow. Once
  an invoice is created the center area swaps to a read-only invoice
  summary (this doubles as the printed view — `window.print()` with the
  existing `.no-print` convention hiding the side panel/nav chrome, same
  pattern as `QuoteDetailPage`).

## Not yet built (Phases 3-5)

- **Phase 3 — Remaining document types**: quote-from-scan (hands off into
  the existing `NewQuotePage` flow, pre-filled), vendor receiving, and
  outgoing orders, all using the `outgoing_orders` table already landed in
  Phase 1's migration.
- **Phase 4 — AI photo lookup + generated codes + label printing**: a
  `lookup-product-vision` Edge Function (ported from that app's
  `/api/lookup/vision` route — Claude + `web_search`, Shopify cross-check,
  official product-photo scraping) for products with no findable barcode —
  the scanner's "Take photo instead" button already exists and is wired to
  a placeholder message pending this. For products with no UPC anywhere,
  `src/lib/upc.ts` generates a real, checksum-valid **UPC-A number in
  GS1's reserved in-store/restricted-circulation prefix (`02`)** —
  guaranteed never to collide with an actual retail product's barcode,
  while still being a genuine, scannable GTIN (not a fake/ambiguous
  internal code). `LabelSheetPage` prints these as a grid of labels (name,
  code, barcode) sized for the shop's 4"×6" label printer.
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
| UPCitemdb (barcode lookup) | **Live this phase** — no key needed on the free trial tier (~100 lookups/day/IP), same as `car-audio-inventory` already uses it. Worth watching for rate-limit errors at real shop volume; a paid key is a drop-in swap in `lookup-product-upc/index.ts` if needed later. |
| Supabase deploy/migration access | This session still has no Supabase personal access token/CLI (a standing limitation — see `docs/CATALOG_AND_PACKAGES.md`). Migration `0011` (and the two new Edge Functions) are written and ready; the shop owner applies/deploys them themselves via the CLI/SQL editor, same as prior migrations this project has shipped. |

## Known limitations (through this phase)

- Catalog items created from an external UPC lookup land `importSource:
  'manual'` — there's no dedicated `'upc_lookup'` value in that enum. A
  minor categorization nuance, not worth a migration on its own this round.
- The camera-photo fallback in `BarcodeScanner` captures a frame but
  currently just tells staff photo lookup isn't available yet — the AI
  vision pipeline is Phase 4.
- Only **Invoice** is a working document type. Quote/Receive inventory/
  Outgoing order are visible in the side panel (so the eventual four-way
  choice is discoverable) but disabled — Phase 3.
- No generated codes or label printing yet — items with no findable UPC
  just fail the lookup and staff add them manually; nothing queues a label
  to print. Phase 4.
- `markInvoicePaid` has no compensating "void a paid invoice" path — once
  paid, the stock movements it recorded are permanent (an `'adjustment'`
  movement is the manual undo, same ledger mechanism, just not wired to a
  UI button yet).
