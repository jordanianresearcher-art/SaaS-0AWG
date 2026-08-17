# Inventory Merge Plan — fold `car-audio-inventory` into 0Gauge

**Status:** Slices 0–5 shipped (schema, legacy-data-import script, types/
repository/demo mode, the four inventory screens, and shared-device
access). Slices 6–9 (receiving/outgoing orders, label printing, low-stock
email digest + Shopify push, retiring the old app) are not started — see
§6 for what's still open in each. Migrations `0017`/`0018` are written and
verified against a local `supabase db reset`, but **not yet applied to
production** — this session has no Supabase CLI/token (standing
limitation), so the shop owner applies them the same way every prior
migration in this repo has been applied.

**Goal (the user's words):** *"We need to connect the caraudio inventory app
with the 0gauge app. All of it should show up in the 0gauge app. Anyone
should be able to input, check and track inventory from PC or phone, with
UPC scan or photo AI lookup."*

---

## 1. What we found

Two apps, and they are **already sharing one Supabase project**:

| | `SaaS-0AWG` (0Gauge Recovery) | `car-audio-inventory` |
| --- | --- | --- |
| Stack | Vite + React 18 + TS, static SPA | Next.js 16 App Router, server routes |
| Auth | Supabase magic link → `shop_memberships` | one shared PIN (bcrypt hash in `settings`) |
| DB access | anon key + RLS, shop-scoped | **service role**, RLS off, single-tenant |
| Deploy | Cloudflare Pages | Vercel |
| Inventory | ledger schema built (`0011`), UI mostly unbuilt | full working UI, live data |

The proof they share a database is in that repo's own migration
`0005_pos_invoices.sql`:

> *"this database already has an unrelated `invoices` table with a different
> schema (`shop_id`/`customer_id`/`payment_method`/`cents` columns) from
> something else entirely."*

That is 0Gauge's `invoices` table, exactly. So `items` and `catalog_items`
are sitting in the same Postgres right now, in different shapes, not talking
to each other. **This is a merge inside one database, not an integration
between two systems** — which makes it much cheaper than it looks, and makes
"keep both running" much more dangerous than it looks.

### What each side already has

0Gauge has the *schema* for inventory and almost none of the *screens*:
`catalog_items.quantity_on_hand`, an append-only `stock_movements` ledger,
the `apply_stock_movement` RPC (atomic, race-safe), `invoices`,
`outgoing_orders`, a hardware-scanner input, a camera barcode scanner, and
the universal `resolve-product` resolver (barcode + text + photo AI, OpenAI
first / Claude fallback). What it lacks: an inventory list, an item detail
screen, an add-item flow, a stock-count flow, low-stock thresholds, label
printing, and any way for a non-account holder to touch any of it.

`car-audio-inventory` has all of those screens working against a flat
single-tenant `items` table, plus things 0Gauge has never had: **push** to
Shopify (0Gauge only imports *from* it), a `last_counted_at` spot-check
flow, low-stock thresholds + email alerts, generated Code-128 SKUs, and
printed label PDFs.

So the merge is: **0Gauge's schema wins, `car-audio-inventory`'s screens and
extra features get ported onto it, and its live data moves across.**

---

## 2. Decisions locked in

**Access — two tiers, both live.** A shop code gets any phone, tablet, or PC
into the inventory surface with no account; a magic-link account is still
required for quotes, follow-ups, reports, and settings. Nobody is ever
locked out of counting stock, and no one counting stock can see revenue.

**The old app — migrate, then retire.** Every `items` row moves into
`catalog_items` under a real `shop_id`, keeping its UUID. The old tables are
left untouched as a safety net. The Next.js app stays live-but-frozen until
the numbers are confirmed to match, then it redirects to 0Gauge.

---

## 3. Target architecture

Everything lands in this repo. No second deployment survives.

```
0Gauge (static SPA, Cloudflare Pages)
├── /app/inventory            list · search · filters · value
├── /app/inventory/new        scan-first add (UPC · photo AI · quick-add)
├── /app/inventory/:id        detail · edit · adjust · ledger · label
├── /app/inventory/check      spot-count flashcards
├── /app/inventory/labels     label print sheet
├── /app/scan                 (existing) + Receive / Outgoing tiles turned on
└── /join                     shop-code sign-in for phones

Supabase (one project)
├── catalog_items             ← items merges in here
├── stock_movements           the ledger (already built)
├── invoices / invoice_items  ← pos_invoices merges in here
├── shops                     ← settings merges in here
└── Edge Functions            resolve-product (exists), + shopify-push-product,
                              send-low-stock-alert
```

Two structural notes that drive everything below:

- **The SPA has no server.** Every `/api/*` route in the Next.js app is
  either replaced by a direct RLS-protected Supabase call, moved into an
  Edge Function, or done client-side. Nothing that needs the service-role
  key may survive in a form the browser can reach.
- **Demo mode is not optional.** Every repository method must be implemented
  in `DemoRepository` (localStorage) as well as `SupabaseRepository`, and
  demo mode never makes a real AI/network call. This is a standing rule of
  this codebase and the plan honors it everywhere.

---

## 4. Access model in detail

The problem: `is_shop_member(shop_id)` returns true for any membership row,
and nearly every RLS policy in the app is written against it. Adding a
low-privilege role naively would hand anonymous phones the entire quote
pipeline and revenue reports.

The fix is a one-line inversion that needs **no edits to existing policies**:

1. Add `'inventory'` to the `membership_role` enum.
2. **Redefine `is_shop_member` to exclude `'inventory'`** — so every
   already-written policy (quotes, customers, quote_events, email_messages,
   reports) automatically keeps anonymous devices out, with zero policy
   churn and no chance of missing one.
3. Add `has_inventory_access(shop_id)` — true for *any* role including
   `'inventory'`.
4. Repoint exactly the inventory-surface policies to it: `catalog_items`,
   `stock_movements`, `invoices`, `invoice_items`, `outgoing_orders`,
   `outgoing_order_items`, and `shops` SELECT (a phone needs the shop's name,
   logo, and colour to render).

Sign-in flow for a phone:

```
/join  →  type shop code  →  supabase.auth.signInAnonymously()
       →  join_shop_with_access_code(code)   [SECURITY DEFINER]
       →  inserts shop_memberships row, role 'inventory'
       →  name this device ("Front counter iPad")  →  in, for 30 days
```

Device naming is what buys back accountability: `stock_movements.created_by`
already exists, so every count, receipt, and sale reads back as *"Marco's
phone, 3:42pm"* without anyone having an email account.

**Hardening required, not optional:**

- Store `staff_access_code_hash`, never the code itself.
- Rate-limit `join_shop_with_access_code` — a `join_attempts` table keyed by
  `auth.uid()`, 10 failures per hour, and it returns the same generic
  failure whether the code is wrong or the limiter tripped.
- Owner can rotate the code from Settings; rotating **revokes every
  `'inventory'` membership** (one delete), which is the "an employee left"
  button.
- Owner sees a list of joined devices with last-seen time and can revoke one.
- Supabase anonymous sign-ins must be enabled in project Auth settings —
  this is a dashboard toggle the shop owner has to flip; the app must detect
  it being off and say so plainly rather than failing cryptically.

**Known cost, stated up front:** anonymous users accumulate one `auth.users`
row per device per join. Rotation cleans them up; a slice-8 cron can sweep
`'inventory'` memberships idle over 90 days.

---

## 5. Data mapping

### `items` → `catalog_items`

Keep the same UUID for every row — it makes the migration re-runnable and
keeps `pos_invoice_items.item_id` re-pointable.

| `items` | `catalog_items` | Handling |
| --- | --- | --- |
| `id` | `id` | preserved verbatim |
| `name`, `brand`, `description` | same | direct |
| `category` (free text) | `category` (enum) | map via `src/lib/categorize.ts`'s heuristic + an explicit lookup table; **no match → `null`**, never a guess |
| `upc` | `upc` | direct |
| `unit_price` (numeric) | `default_price_cents` | `round(× 100)` |
| `quantity` | `quantity_on_hand` | plus one opening-balance `adjustment` movement per item, so the ledger is not retroactively fictional |
| `photo_url` | `image_url` | direct |
| `source` (`barcode`/`vision`/`manual`) | `import_source` | needs new enum values `upc_lookup`, `ai_photo`; existing `manual` maps straight |
| `barcode_generated` | `upc_is_generated` | direct — column already exists |
| `low_stock_threshold` | **new column** | |
| `last_counted_at` | **new column** | |
| `low_stock_alerted`, `low_stock_alerted_at` | **new columns** | |
| `shopify_product_id`, `shopify_variant_id`, `shopify_synced_at`, `shopify_sync_error`, `shopify_matched_existing`, `shopify_status` | **new columns** | needed for push-back |
| — | `shop_id` | **the crux**: single-tenant → multi-tenant. Every row goes to one chosen shop, passed as a parameter |
| — | `active`, `availability`, `approval_status`, `position` | defaults |

### `settings` (singleton) → `shops` columns

`default_low_stock_threshold`, `low_stock_alert_email`,
`staff_access_code_hash`. The old `pin_hash` is **not** carried over — the
new code is generated fresh and shown to the owner once.

### `pos_invoices` / `pos_invoice_items` → `invoices` / `invoice_items`

The POS side carries fields 0Gauge's invoices don't have: tax rate/amount,
discount, customer address, and vehicle year/make/model. Add them as
nullable columns rather than forcing a `customers` record — this also fixes
a limitation already logged in `docs/INVENTORY_AND_SCANNING.md` ("the
customer name/email typed for an invoice isn't persisted anywhere").
`invoice_items` gains `discount_percent` and `taxable`.

---

## 6. Slices

Each slice is independently committable and independently verifiable. Run
`npm run typecheck && npm run lint && npx vitest run && npm run build` clean
before every commit — no exceptions.

### Slice 0 — Preflight ✅ done

`docs/MVP_PLAN.md` Stream A had recorded migration `0016` as unapplied in
production. The owner ran `supabase/check_migrations.sql` against the live
database and confirmed `0001`–`0016` are all applied (`0007` isn't tracked
by that script — superseded by `0008`, not a gap) — that MVP_PLAN.md note
was stale and has been corrected. `0017`/`0018` are safe to stack on top.

Still open before Slice 2 can run for real:

1. Confirm both apps point at the same project ref (compare
   `VITE_SUPABASE_URL` here against `NEXT_PUBLIC_SUPABASE_URL` in
   `car-audio-inventory`). **If they don't, stop** — Slice 2 becomes a
   cross-project export/import and needs replanning.
2. `select count(*) from items;`, `select count(*) from pos_invoices;` —
   record the numbers; they're the acceptance test for Slice 2.
3. Identify the target `shop_id` (the real shop, not a demo row).

### Slice 1 — Schema (migration `0017_inventory_merge.sql`) ✅ written

- `catalog_items`: add the eleven new columns from §5.
- `product_import_source`: add `'upc_lookup'`, `'ai_photo'`.
- `shops`: add `default_low_stock_threshold`, `low_stock_alert_email`,
  `staff_access_code_hash`.
- `invoices`: add `tax_rate`, `tax_cents`, `discount_cents`,
  `customer_name`, `customer_phone`, `customer_email`, `customer_address`,
  `vehicle_year`, `vehicle_make`, `vehicle_model`.
- `invoice_items`: add `discount_percent`, `taxable`.
- `membership_role`: add `'inventory'`.
- Redefine `is_shop_member` (exclude `'inventory'`); add
  `has_inventory_access`; repoint the seven inventory-surface policies.
- `join_attempts` table + `join_shop_with_access_code(p_code text)` RPC +
  `rotate_staff_access_code()` RPC (owner/manager only).
- Storage bucket `shop-product-photos`, path convention `<shop_id>/<uuid>.jpg`,
  with RLS: insert/update allowed when `has_inventory_access` on the path's
  shop; public read.

**Done when:** applies cleanly to a fresh `supabase db reset`, and an
anonymous `'inventory'` member can read `catalog_items` but gets zero rows
from `quotes`. Write that second assertion as a real SQL test, not an
assumption.

### Slice 2 — Data migration (`0018_import_legacy_inventory.sql`) ✅ written, not yet run

Written as an **idempotent, parameterised, non-destructive** script:

- Takes the target `shop_id`; `on conflict (id) do update` so re-running is
  safe.
- Ships with a dry-run query printing what *would* move, per table.
- Emits one opening-balance `adjustment` stock movement per item, noted
  `"Opening balance imported from car-audio-inventory"`.
- Maps `pos_invoices` → `invoices` and re-points `pos_invoice_items.item_id`
  to the preserved catalog UUIDs.
- **Drops nothing.** `items`, `settings`, `pos_invoices`, and
  `pos_invoice_items` stay exactly where they are.

**Done when:** post-migration counts match the Slice 0 numbers, and
`sum(quantity)` on `items` equals `sum(quantity_on_hand)` on the migrated
`catalog_items`. Any item whose free-text category didn't map lands `null`
and is listed in the run output for manual triage.

### Slice 3 — Types + repository ✅ done

- `src/types.ts`: extend `CatalogItem` with the new fields; add
  `InventorySummary`, `ShopAccessCode`, `InventoryDevice`.
- `src/data/repository.ts`: add `listInventory(filters)`,
  `getInventorySummary()`, `adjustStock(itemId, newQty, reason)`,
  `markCounted(itemId, qty)`, `uploadProductPhoto(base64)`,
  `generateSku(brand, model)`, `joinWithAccessCode(code, deviceName)`,
  `rotateAccessCode()`, `listInventoryDevices()`, `revokeDevice(id)`.
- Implement all of them in **both** `SupabaseRepository` and
  `DemoRepository`. Demo mode seeds ~15 realistic items with mixed stock
  levels, a couple below threshold, one with no UPC.
- Pure helpers get unit tests before any UI is wired: threshold/low-stock
  logic, the free-text→enum category mapper, SKU generation and collision
  handling, inventory-value maths.

**Done when:** tests green, and the demo seed shows a populated inventory
with zero backend.

### Slice 4 — Inventory UI ✅ done

Phone-first, built from the existing `src/components/ui.tsx` primitives so
it looks like the rest of the app, not like a port.

- `/app/inventory` — search (name/brand/UPC), sort, filters for low-stock,
  needs-UPC, and category; each row shows price and stock with a low badge.
- `/app/inventory/:id` — photo, fields, quantity stepper that writes a
  *movement* (never a raw quantity edit), the item's ledger history, and a
  print-label button.
- `/app/inventory/new` — scan-first: hardware scanner input focused on load
  (reusing `useHardwareScanner`), camera fallback, photo-AI lookup, and
  quick-add with a generated SKU. Reuses `resolve-product` for all three
  paths — this is already built and must not be duplicated.
- `/app/inventory/check` — the spot-count flashcard flow, ordered by most
  overdue, writing `last_counted_at` and a movement when the count differs.
- Duplicate check before save (local catalog first, then Shopify).
- `AppLayout` nav gains Inventory; `DashboardPage` gains a tile: SKUs, units,
  inventory value, low-stock count, needs-UPC count.

**Done when:** a Playwright smoke script drives add → list → adjust → count
→ ledger end to end in demo mode.

### Slice 5 — Shared-device access ✅ done

`/join` screen, anonymous sign-in with a clear message if the Supabase
toggle is off, device naming, and a Settings section showing the code, a
rotate button (with an explicit "this signs out every phone" confirmation),
and the joined-device list with revoke. `AppDataContext` learns the
`'inventory'` role and hides every non-inventory nav item for it — belt and
braces on top of the RLS, so a wrong URL shows "not available" rather than
an empty screen.

**Done when:** an anonymous device can complete the whole Slice 4 flow, and
cannot reach quotes, reports, or settings by typing the URL.

### Slice 6 — Receiving + outgoing orders

Turns on the two tiles currently marked "Soon" in the scan workspace.
Receiving: vendor name, per-item cost and quantity → `receiving` movements.
Outgoing: destination, quantities → `outgoing_order` movements + the order
record. Both use the existing `apply_stock_movement` RPC.

### Slice 7 — Labels + generated SKUs

`bwip-js` renders Code 128 **in the browser** (`bwip-js/browser`), so no
Edge Function and no PDF service is needed — the label sheet is an HTML
print page using the `.no-print` convention already used by invoices and
quotes. Port `buildSkuBase`/`generateUniqueSku` (brand+model, 8/12-char
caps for scannability, `-2`/`-3` collision suffixes) into `src/lib/sku.ts`
with tests. Batch action on the list: "generate barcodes for N items without
one".

Note: `docs/INVENTORY_AND_SCANNING.md` proposed GS1 `02`-prefix UPC-A here.
**Code 128 is the better call and is what actually ships in production
today** — it needs no GS1 prefix, is alphanumeric, and keeps the SKU human
readable (`DEAFBONCE-770DSP`). That doc gets corrected in Slice 9.

### Slice 8 — Parity extras

- `send-low-stock-alert` Edge Function + a daily `pg_cron` digest, reusing
  the configured `RESEND_API_KEY`.
- `shopify-push-product` Edge Function — port `syncItemToShopify` and
  `updateExistingPriceAndQuantity`. This is the one genuinely new capability
  for 0Gauge (it has only ever imported).
- Invoice tax/discount in the scan workspace, now that the columns exist.
- Fold the `enrich` lookup (specs, official photos, vehicle fitment) into
  `resolve-product` as a fourth request kind rather than a new function.

### Slice 9 — Retire the old app

Only after the owner confirms the numbers match: point
`car-audio-inventory` at a redirect, update its README, archive the repo.
Update `docs/INVENTORY_AND_SCANNING.md`, `docs/ROADMAP.md`, and
`docs/MVP_PLAN.md` to reflect what actually shipped, and correct the
GS1-prefix note per Slice 7.

---

## 7. Risks

| Risk | Mitigation |
| --- | --- |
| `0016` unapplied → migration chain diverges | Slice 0 is blocking and explicitly gates `0017` |
| Redefining `is_shop_member` silently locks out a real user | Only `'inventory'` is excluded; owner/manager/staff behaviour is bit-identical. Assert it with SQL tests in Slice 1 |
| Anonymous devices reaching revenue data | Two independent layers: RLS (authoritative) + nav/route gating (usability) |
| Shop code brute-forced | Hashed, rate-limited, generic failure message, one-click rotate-and-revoke |
| Category free-text → enum mismapping | Never guesses; unmapped → `null` and reported for triage |
| Double-counting stock during cutover | Old app frozen before Slice 2 runs; both write paths never live at once |
| Anonymous `auth.users` accumulation | Rotation revokes; slice-8 sweep for 90-day-idle devices |

## 8. Credentials and access needed

| Item | Status |
| --- | --- |
| Supabase CLI / access token | **Missing — standing blocker.** Every migration this project has shipped was applied by the owner by hand. Slices 0–2 cannot be verified against the live DB without it |
| Supabase anonymous sign-ins enabled | Dashboard toggle the owner must flip before Slice 5 works |
| `OPENAI_API_KEY` or `ANTHROPIC_API_KEY` | Either one; already the resolver's requirement |
| `RESEND_API_KEY` / `EMAIL_FROM` | Already configured; low-stock alerts reuse them |
| `SHOPIFY_ADMIN_ACCESS_TOKEN` | Already configured for import; the same token covers push |
| UPCitemdb | Free tier, no key (~100/day/IP) |

---

## 9. Sequencing

Slice 0 gates everything. Slices 1→2→3 are strictly serial. Slice 4 is the
bulk of the work and can start as soon as 3 lands. Slice 5 can run parallel
to 4. Slices 6–8 are independent of each other. Slice 9 is last and needs
the owner's confirmation, not just green tests.

The shortest path to the user's actual sentence — *anyone can input, check
and track inventory from a phone, with UPC scan or photo AI* — is
**0 → 1 → 2 → 3 → 4 → 5**, and that path is now built (see the Status line
at the top). What's left before this is genuinely finished, in order:

1. **Apply `0017`/`0018` to production** (this session cannot — no
   Supabase CLI/token) and enable anonymous sign-ins in the Supabase
   dashboard's Auth settings.
2. **Run the Slice 2 import** (`select public.import_legacy_inventory(p_shop_id, true)`
   for a dry-run preview, then `false` to commit) against the real
   `shop_id`, and reconcile any items whose category came back
   `null` (listed in the function's own JSON result).
3. **Smoke-test the live app**: join a phone via `/join`, scan a real
   barcode, confirm a photo lookup, spot-check a count, and confirm an
   owner account still sees quotes/reports while the joined phone
   doesn't.
4. Slices 6–9 (receiving/outgoing orders, label printing, low-stock email
   digest + Shopify push, retiring the old app) remain future depth on top
   of a working product — none of them block using the app day to day.
