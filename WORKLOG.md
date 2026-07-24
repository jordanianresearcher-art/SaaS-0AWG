# WORKLOG — 0Gauge Recovery

## Repository assessment (start of session)
- Empty repository, no commits, on branch `claude/autonomous-execution-90min-sk40xw`.
- No CLAUDE.md / AGENTS.md / README present. No lockfile → using npm.
- Decision: scaffold new Vite + React + TypeScript (strict) + Tailwind app per spec.

## Ordered implementation backlog
1. [x] Project scaffold (Vite, React, TS strict, Tailwind, ESLint, Vitest)
2. [x] Domain layer: types, status model, currency/vehicle formatting, follow-up logic, email templates, eligibility
3. [x] Data repository abstraction + demo repository (localStorage) + seeded demo data
4. [x] Router + layouts + protected routes + demo-mode indicator
5. [x] Landing page
6. [x] Dashboard
7. [x] Create quote workflow (Zod + react-hook-form)
8. [x] Quote detail (actions, email preview/send, timeline)
9. [x] Public quote page + responses + opt-out
10. [x] Follow-up queue
11. [x] Reports (7/14-day, printable, CSV)
12. [x] Settings (+ demo reset)
13. [x] Supabase migrations, RLS, public RPCs, seed.sql
14. [x] Supabase repository + auth (magic link) + onboarding
15. [x] Resend Edge Function (send-quote-email)
16. [x] Tests (domain logic + demo repo + component)
17. [x] Docs: README, ROADMAP, PILOT_PLAYBOOK, SECURITY, env examples
18. [x] Verification: lint / typecheck / test / build + manual smoke test

## Completed
- Full Phase 1 MVP implemented (see README.md). All backlog items above complete.
- Demo mode fully interactive with localStorage persistence + reset.
- Supabase schema (10 tables), RLS on every table, 4 SECURITY DEFINER public RPCs,
  onboarding RPC, updated_at triggers, indexes, seed.sql.
- Resend Edge Function with auth, membership check, permission/opt-out checks,
  rate limiting, HTML+text emails, 5 templates, safe responses.
- 79 unit/component tests passing across 8 files.
- Cloudflare Pages SPA `_redirects` included; build is fully static.

## Blockers
- No Supabase project/credentials in this environment → production mode cannot be
  end-to-end tested here. Fallback: demo mode is fully functional without any
  credentials; Supabase code paths compile and follow documented API usage.
- No Resend key → Edge Function not live-tested. Fallback: demo email flow +
  mailto: fallback + honest "not configured" notice; no false "sent" states.
- npm registry access worked; no other environment blockers.

## Verification results (Phase 1 MVP)
- `npm run lint` → PASS (0 errors, 0 warnings)
- `npm run typecheck` → PASS
- `npm run test -- --run` → PASS (79 tests, 8 files)
- `npm run build` → PASS (static bundle in dist/, ~179 KB gzip JS)
- Browser smoke test (Playwright + preinstalled Chromium against `vite preview`,
  390×844 phone viewport) — all 14 steps PASS:
  enter demo → dashboard w/ Demo Data banner → create quote → email preview with
  honest demo note → demo send recorded → public quote (first name only, no PII)
  → customer response submitted → quote detail updated → follow-up demo email →
  public opt-out → further sends blocked → follow-up queue groups → pilot report
  with demo label → demo reset from settings.

---

## Round 2 — Platform admin, real-backend prep, landing redesign, gamified reports

Requested: (1) working login/signup + customer email (blocked on the user
creating real Supabase/Resend accounts and handing over credentials — they
chose to do this themselves), (2) a platform-owner dashboard to onboard new
shop tenants, (3) a more icon-forward/low-text landing page, (4) a bold,
gamified reports page ("Recovery Score").

### Backlog (this round)
1. [x] Migration `0002_platform_admin.sql`: `platform_admins` table (no
   in-app grant path), `is_platform_admin()`, `shops.active` suspend flag,
   widened read-only RLS for admins, suspend-aware write checks on
   `quotes`/`customers`, `admin_list_shops()` / `admin_set_shop_active()` RPCs
2. [x] `admin-create-shop` Edge Function: platform-admin-only, creates a shop,
   generates an invite link (`auth.admin.generateLink`, never Supabase's own
   mailer), inserts the owner membership immediately, tries to deliver via
   Resend with a copy-link fallback on failure
3. [x] `send-quote-email` now blocks sends for suspended shops
4. [x] `src/data/adminRepository.ts` — dedicated `AdminRepository`, kept
   separate from the per-shop `DataRepository`
5. [x] `AppDataContext`: `isPlatformAdmin` + `adminRepo`, derived the same
   way `needsOnboarding` already was
6. [x] `/admin` route + `RequirePlatformAdmin` guard in `App.tsx`
7. [x] `src/pages/AdminPage.tsx`: shop list (member/quote counts,
   suspend/reactivate) + create-shop modal
8. [x] Landing page redesign: icon-first hero CTAs, 3-step visual row,
   6 icon tiles replacing paragraph copy, icon trust row
9. [x] `computeRecoveryScore()` (weighted revenue/win/response/view rate,
   Bronze→Platinum tiers, honest `null` state for no data) and
   `computeMilestones()` (4 lifetime badges) in `metrics.ts`, with tests
10. [x] `RecoveryScoreGauge` (hand-rolled SVG ring + count-up) and `Confetti`
    (CSS-only burst, skips under `prefers-reduced-motion`) — no new deps
11. [x] Wired into `ReportsPage`: score/tier/badges above the existing,
    unmodified metrics table; confetti fires only on genuine new-best-tier
    or newly-achieved milestones (tracked in localStorage)
12. [x] Full verification + browser smoke test + docs updated + commit/push

### Blockers
- Real Supabase/Resend credentials still not available in this environment —
  the user is creating both themselves. `/admin`, real auth, and real email
  sends are implemented and typecheck/build clean but **not live-tested**
  against an actual project. Fallback: everything demo-mode-relevant was
  smoke-tested in the browser; the new SQL/Edge Function follow the exact
  patterns already proven in `0001_init.sql` / `send-quote-email`.
- Platform-admin bootstrap has no in-app UI by design (security requirement
  from the plan) — it's a documented one-time manual SQL insert.

### Verification results (this round)
- `npm run lint` → PASS
- `npm run typecheck` → PASS
- `npm run test -- --run` → PASS (84 tests, 8 files — +5 new metrics tests)
- `npm run build` → PASS
- Browser smoke test: new landing page (hero/steps/icon grid) renders;
  Reports page shows the Recovery Score gauge + milestone badge shelf above
  the untouched metrics table; `/admin` correctly blocks access without a
  platform-admin session. Screenshots reviewed for visual quality.
- Not yet tested (needs real credentials, documented above): actual
  invite-email delivery, actual suspend/reactivate against live RLS, real
  magic-link sign-in as an invited owner.

---

## Round 3 — Live backend cutover

The user provided a real Supabase project (db password, then a personal
access token) and a real Resend API key, and asked to take the project live.

### Done
- Applied `0001_init.sql` and `0002_platform_admin.sql` directly to the real
  Supabase project via the Management API's `/database/query` endpoint
  (the `supabase` CLI's own HTTP client doesn't respect this sandbox's
  outbound proxy — confirmed `curl` does, so drove the Management API
  directly instead). Verified all 11 tables present afterward.
- Deployed both Edge Functions (`send-quote-email`, `admin-create-shop`) via
  the Management API's multipart `/functions/deploy` endpoint — both ACTIVE,
  confirmed returning 401 (not 404/500) for unauthenticated requests.
- Enabled magic-link auth config (`site_url`, `uri_allow_list`) for both
  local dev and the eventual production domain.
- Set `RESEND_API_KEY` / `EMAIL_FROM` / `APP_URL` as Edge Function secrets.
  Sender domain (`supercaraudiodallas.com`) isn't verified in Resend yet
  (DKIM TXT record confirmed absent via DNS-over-HTTPS lookup) — using
  Resend's `onboarding@resend.dev` test sender until the user's DNS
  propagates, at which point `EMAIL_FROM` flips to the branded address.
- Bootstrapped the user's account as the first platform admin via a direct
  SQL insert (`platform_admins` has no in-app grant path by design).
- Live security spot-check against the real project: anonymous `shops`
  select returns empty, `get_public_quote` handles a bad token as `null`
  (not an error), `create_shop_with_owner` correctly rejects unauthenticated
  callers — RLS behaves exactly as designed against the real database.
- Fixed a Cloudflare deploy failure: the classic `_redirects` SPA-fallback
  rule (`/* /index.html 200`) is rejected as an infinite loop by Cloudflare's
  newer unified Workers/Pages deploy pipeline. Replaced with `wrangler.jsonc`
  (`assets.not_found_handling: "single-page-application"`), the modern
  equivalent for that pipeline.
- Deployed to Cloudflare (Workers & Pages, Git-connected) at
  `https://saas-0awg.jordanianresearcher.workers.dev` — confirmed reachable
  and serving the correct HTML from this sandbox (unlike `*.pages.dev`,
  `*.workers.dev` isn't blocked by the sandbox's egress proxy, so this one
  can be checked directly rather than only through user screenshots).

### Blockers / notes
- The Supabase MCP server (`.mcp.json`, added per the user's request) never
  reached "approved" status from this session's perspective — likely
  because the user's approval/OAuth happened in a separate local
  environment that doesn't share config with this cloud sandbox. Not
  needed in practice: the Management API + a personal access token covered
  every task the MCP server would have (migrations, functions, auth config,
  secrets).
- Two magic-link attempts were burned on user error unrelated to the app
  itself: first link expired before the local dev server was confirmed
  running; local `.env` wasn't picked up because the dev server wasn't
  fully restarted after the file was created. Neither is a code issue.
- `supercaraudiodallas.com` still needs its Resend DNS records added at the
  domain's actual DNS provider (not Resend) before `EMAIL_FROM` can switch
  off the test sender.

---

## Round 4 — First real quote, domain mix-up, and full go-live

The user actually used the live product for the first time: signed in as
`supercaraudiodallas@gmail.com`, created their real shop ("Super Car Audio"),
and tried to email a real quote. Two real bugs surfaced and got fixed, plus
a domain identity mix-up got sorted out.

### Done
- **Fixed a genuine Edge Function crash.** Both functions had been deployed
  via the Management API's raw multipart upload (the `supabase` CLI can't
  reach this sandbox's proxy at all), which doesn't resolve `jsr:` import
  specifiers the way the CLI's own bundler does — first invocation crashed
  immediately (502, zero application logs, confirmed via `function_logs`
  query showing only Boot/Shutdown/EarlyDrop with nothing from the code
  itself). Switched both functions' `supabase-js` import from `jsr:...` to
  `https://esm.sh/...`, redeployed, and confirmed via a direct authenticated
  test call (using a real access token minted through the Admin API's
  `generate_link` + manually following the verify redirect) that the
  function now runs its full logic.
- **Diagnosed a Resend account restriction, not a bug**: the test sender
  `onboarding@resend.dev` can only send to the Resend account's own email —
  confirmed verbatim via Resend's own rejection message when sending to the
  quote's actual customer address.
- **Caught a domain identity mix-up.** The Resend domain being verified
  (`supercaraudiodallas.com`) did not match the user's actual connected
  Shopify store domain (`supercaraudio.com`) — confirmed via
  `mcp__Shopify__get-shop-info`. Checked whether Shopify's Admin API could
  manage DNS at all (it can't — zero domain/DNS mutations exist in the
  schema) and whether the domain even lived there — nameserver lookup showed
  `supercaraudio.com`'s DNS is actually hosted at WordPress.com, unrelated to
  both Shopify and Cloudflare.
- User added the correct Resend domain (`supercaraudio.com`) and its three
  DNS records at WordPress.com themselves (no API access available there);
  confirmed propagation via DNS-over-HTTPS, then confirmed Resend's own
  verification via a direct test send.
- Flipped `EMAIL_FROM` to the verified `Super Car Audio <quotes@supercaraudio.com>`
  and re-ran the exact same live quote send — success end to end.
- Additionally pointed Supabase Auth's outgoing mail (magic links) through
  Resend's SMTP relay (`smtp.resend.com`, user `resend`, password = the API
  key), replacing Supabase's shared/rate-limited test mailer now that the
  domain is verified. Confirmed with a live OTP trigger (200 response).

### Verification (this round)
- Direct authenticated Edge Function calls (real access tokens, real quote
  IDs, via the Management API + Auth Admin API — no UI needed): crash fixed,
  membership check passes, Resend rejection reproduced then resolved,
  final send returns `{"ok":true}`.
- Live DNS checks (DNS-over-HTTPS) for all three Resend records on the
  correct domain, confirmed propagated before re-testing verification.
- Live nameserver + Shopify schema checks before touching anything, avoiding
  a wasted DNS change on the wrong domain/platform.
- Real customer email confirmed delivered to `syajsebawe@gmail.com` from
  the shop's own verified domain.

No code changes this round beyond the Edge Function import fix — everything
else was live infrastructure configuration (Resend, Supabase Auth, secrets).

---

## Round 5 — Faster quote creation without losing detail

After sending their first real quote, the user asked to brainstorm making
quote creation and sending faster/easier — with a hard constraint: never at
the cost of losing itemized detail. The fix had to be *reuse of what's
already typed*, not *removal of fields*. Five features came out of that
brainstorm and are now built:

### Done
- **Shop-managed item catalog.** New `catalog_items` table (migration
  `0003_catalog_items.sql`, RLS mirrors `customers_all` — any shop member
  can manage it) plus full `DataRepository` CRUD (demo + Supabase). A new
  "Product catalog" section in Settings lets a shop save common products
  once (brand/model/name/usual price) and a "From catalog" button in the
  quote option editor inserts one as a pre-filled item row instead of
  retyping brand/model every time.
- **Duplicate Quote.** A "Duplicate" button on the quote detail page
  carries vehicle info and every option/item over into a fresh New Quote
  form, but leaves the customer's name/email and permission checkbox blank
  so a new customer's consent is always re-confirmed.
- **Autocomplete from history.** Brand/model/item-name fields on the quote
  form now suggest from every item ever entered for the shop (derived from
  already-loaded quote data, no new query), via plain `<datalist>` — never
  blocks free typing.
- **Save & Send in one step, preview still mandatory.** Saving a quote now
  auto-opens the email preview immediately instead of requiring a separate
  navigate-and-click. The preview modal still requires an explicit tap on
  **Send email** — this only removes a redundant step, it never sends
  automatically.
- **Metra-style vehicle picker.** Year and Make are now `<select>` dropdowns
  (curated list of ~30 real passenger makes, not NHTSA's raw ~12,300-entry
  list, which is mostly trailers/custom shops); Model is a free-text field
  with `<datalist>` suggestions pulled live from NHTSA's public vPIC API
  (`getmodelsformakeyear`). NHTSA does fuzzy substring matching on make name
  (a "Ford" query surfaces "ASHFORD MFG", "BRADFORD BUILT", etc. ahead of
  real Ford models) — fixed with an exact-match filter on `Make_Name`
  before showing suggestions. Trim stays free text (no reliable free data
  source for trim levels). Never blocks quote creation: a network hiccup
  or NHTSA outage just degrades to a plain text field, no error shown.

### Verification (this round)
- `npm run lint`, `npx tsc -b --noEmit`, `npm run test -- --run` (90/90
  across 9 files, including new `vehicleData.test.ts` covering the fuzzy-
  match filter with a real captured NHTSA response, dedup/sort, case
  insensitivity, and graceful `[]` fallback on fetch failure), and
  `npm run build` all clean.
- Playwright smoke test against a `vite preview` build covering the full
  new flow end to end: enter demo mode → Settings shows the seeded catalog
  → add a catalog item → New Quote's Year/Make selects + NHTSA-backed Model
  suggestions → "From catalog" inserts a pre-filled item → Save & Send
  auto-opens the email preview (subject line confirms the vehicle data
  flowed through: "Your 2021 Ford F-150 audio quote from Big Tex Audio") →
  Duplicate carries options over while leaving the customer name blank.
  All 8 checks passed.
- Migration `0003_catalog_items.sql` applied to the live Supabase project
  via the Management API (same direct route used for `0001`/`0002`, since
  the CLI still can't reach this sandbox's proxy) — confirmed the table,
  its columns, and its RLS policy all exist as expected.

---

## Round 6 — Deposit payment methods for shops without Shopify/Stripe

The user pointed out that not every shop has Shopify or Stripe to generate
a deposit payment link, and asked for the deposit amount to default to 15%
of the job automatically, with a way to send customers to the shop's
Zelle/Cash App/Venmo/PayPal.me instead of a raw checkout URL.

### Done
- **Five deposit payment methods, shop-level default + per-option override.**
  Replaced the single free-text `default_payment_link` (shop) /
  `deposit_link` (quote option) URL fields with a method + handle pair —
  `link` (the original raw-URL case, kept for shops that do have Stripe/
  Shopify), `zelle`, `cashapp`, `venmo`, `paypal`. New migration
  `0004_deposit_payment_methods.sql` adds a `payment_method` enum, migrates
  existing non-empty links to `method='link'` on both tables, and adds a
  pairing check constraint (`(method is null) = (handle is null)`) on each.
  Settings and Onboarding both get a method dropdown plus a conditional
  handle field (label/placeholder/hint driven by a single
  `PAYMENT_METHOD_INFO` lookup in the new `src/lib/paymentMethods.ts`); New
  Quote's per-option "Deposit link" field is replaced with a "Use a
  different payment method for this deposit" checkbox that reveals the same
  picker, defaulting to the shop's setting when left unchecked.
- **Deposit amount auto-calculated at 15%, editable.** Each option now has a
  "Deposit amount" field that live-recomputes to 15% of that option's price
  as it's typed (via a `useWatch`-driven effect comparing against the last
  value the effect itself wrote, so a manual override is never clobbered by
  a later price edit) — staff can freely type any flat dollar amount
  instead.
- **`create_shop_with_owner` dropped and recreated**, not just
  `create or replace` — changing `p_default_payment_link` to two new
  parameters changes the function's identifying signature, which would have
  left a stale duplicate overload behind. Re-applied the
  revoke-from-anon/grant-to-authenticated pair immediately after, since
  Postgres grants EXECUTE to `PUBLIC` (which `anon` inherits) by default on
  a freshly created function — confirmed live afterward that `anon` is not
  in the grant list.
- **Real-world link formats confirmed and implemented** in
  `buildPaymentUrl()`: Cash App and PayPal.me both support an exact dollar
  amount appended to the URL path (`cash.app/$tag/145.00`,
  `paypal.me/name/145.00`); Venmo's profile link
  (`venmo.com/u/name`) has no reliable amount-in-path format outside its
  native app, so the public quote page's copy says "tap Pay, then enter the
  amount" for Venmo instead of promising it's prefilled. Zelle has no
  clickable link format at all — shown as plain instructional text instead
  of a button. (Caught and fixed a bug before shipping: the first draft ran
  `encodeURIComponent` on Cash App handles, which escapes the required
  literal `$` to `%24` and breaks the link — fixed to only strip
  whitespace/pasted URL prefixes, never encode the `$`.)
- Duplicate Quote reproduces today's exact carryover behavior for the new
  fields: a resolved deposit method on the original always wins over the
  shop's *current* default when duplicating (verbatim carryover, override
  checkbox pre-checked); an option that had none falls back to the shop's
  live current default (checkbox left unchecked) — matching the existing
  `depositLink` semantics precisely rather than a new behavior.
- No changes to email templates or the send-quote-email Edge Function —
  confirmed neither ever referenced deposit fields (emails intentionally
  stay short and only link to the public quote page); that design choice is
  unchanged.

### Verification (this round)
- A dedicated Plan-agent review before writing any code caught several real
  gaps in the first draft of this design: `supabase/seed.sql` still
  inserting into the old columns (would have broken `supabase db reset`),
  the `anon`-grant regression risk above, a `demoRepository.test.ts` literal
  that would fail to typecheck, and the exact duplicate-carryover semantics
  needed to match current behavior. All fixed before implementation began.
- `npm run lint`, `npx tsc -b --noEmit`, `npm run test -- --run` (104/104
  across 10 files, including a new 14-test `paymentMethods.test.ts` covering
  every method's URL format, the Cash App `$`-encoding bug, and the 15%
  rounding), and `npm run build` all clean.
- Playwright smoke test against a `vite preview` build: Settings shows the
  seeded Cash App default and swaps handle fields correctly per method;
  New Quote's deposit amount auto-fills at 15% and recomputes live as price
  changes, a manual override survives a further price edit, and the
  per-option method override reveals its fields; Save & Send still
  auto-opens the email preview; Duplicate carries the manual deposit amount
  and override flag over verbatim. A second pass against the public quote
  page confirmed the Cash App CTA renders with the correct link
  (`cash.app/$BigTexAudio/284.85`) and a `$284.85 deposit` amount line.
- Migration `0004` applied to the live Supabase project via the Management
  API (same direct route used for `0001`-`0003`). Verified against the real
  shop's data (a live Shopify product-page URL used as its payment link):
  the backfill correctly produced `method='link'` rows on both `shops` and
  `quote_options` with no data loss, both pairing check constraints exist,
  and — the one regression risk worth double-checking — `anon` is
  confirmed absent from `create_shop_with_owner`'s grants after the
  drop/recreate. A live anonymous `get_public_quote` RPC call against a
  real quote confirmed the new field names come back correctly.

---

## Round 7 — Create Quote overhaul: responsive layout, optional sections, window tint

The user asked for the Create Quote page to go multi-column on desktop
(still stacked on phone), for every section except email to become
optional so a bare lead can be saved without pricing or vehicle info, and
for a new window-tint configurator — described as "advanced" but wanting
a "really slick, modern" UI.

### Done
- **Desktop layout.** The page's own `max-w-2xl` cap now relaxes to fill
  `AppLayout.tsx`'s existing `max-w-6xl` shell at `lg:`, and the form
  itself becomes a 2-column grid at that breakpoint (`QuoteDetailPage.tsx`
  already had `lg:grid-cols-2` — direct precedent, not a novel pattern for
  this codebase). Customer and Vehicle sit side by side; Options, Window
  Tint, and Quote details span both columns since they need more room.
  Inside Options, the pricing-tier cards (Good/Better/Insane) reflow from
  a vertical stack into a horizontal row via a `flex lg:flex-row` wrapper
  around the existing `OptionEditor` — `OptionEditor` itself needed zero
  internal changes. Verified at 1024/1280px via screenshots — no cramping,
  so the simple wrapper-only approach was enough; no container-query
  fallback was needed.
- **Only email is required.** First name dropped its `required` mark.
  Vehicle and Options both became fully optional, progressive-disclosure
  sections — Vehicle moved out of the Customer card into its own, starting
  collapsed behind an "+ Add vehicle" button (matching the "+ Add
  option"/"+ Add product" language already used elsewhere on this page);
  Options now starts with zero pre-filled rows instead of two, and a quote
  can genuinely save and send with no pricing at all — confirmed there's
  no edit-quote feature (only duplicate-as-new), so this is a deliberate
  "bare lead" capability the user explicitly wanted, not an oversight.
  Vehicle validation is all-or-nothing (blank is fine, a partial entry
  isn't) via a top-level zod `superRefine`.
- **Nullable vehicle, everywhere it mattered.** `Customer.vehicleYear/Make/Model`
  widened to nullable end to end: migration `0005` drops the `not null`
  constraints (existing `vehicle_year` range check already passed on NULL,
  no change needed there); `formatVehicle()` now returns `null` instead of
  a string with blank parts; both email renderers (`src/lib/emailTemplates.ts`
  and the hand-ported `supabase/functions/send-quote-email/index.ts` mirror)
  got a null-branch for every one of the 5 templates' subject and intro
  copy — two of them (`check_in`, `final_check_in`) had been bypassing
  `formatVehicle` with raw field access, fixed as part of this pass. Every
  list/detail display (`QuoteDetailPage`, `QuotesPage`, `DashboardPage`,
  `FollowUpsPage`, `PublicQuotePage`) got a visible "No vehicle on file"
  fallback instead of silently rendering nothing. `customerDisplayName()`
  also picked up a "New lead" fallback for a blank first name, since that's
  now possible too.
- **NEW: Window Tint configurator**, purely descriptive (no price/line-item
  integration, per explicit choice) — a new `src/lib/windowTint.ts` (typed
  lookup module, same shape as the existing `paymentMethods.ts`) drives a
  manual body-style picker (Sedan/Coupe = 5 windows, SUV/Wagon/Van/Ext. cab
  = 7 windows — matches the user's own "5 windows"/"7 windows" phrasing).
  Confirmed via direct NHTSA vPIC API testing that year+make+model alone
  can't reliably determine body class — only a VIN can, via `DecodeVin`'s
  `BodyClass` field — and this app doesn't collect VINs, so a manual picker
  was the right, deliberate call rather than an unreliable "lookup."
  New `src/components/WindowTintEditor.tsx`: a percent-pill picker
  (5/20/35/50/70%, matching `PublicQuotePage.tsx`'s existing toggle-button
  pattern) per window plus an "apply to all" shortcut, a windshield toggle
  kept visually separate (tinting it is treated differently by law in most
  states), and — on top of the always-present functional list — a small
  hand-authored SVG car diagram on desktop with one real, focusable,
  `aria-pressed` button per window whose opacity darkens with the chosen
  percentage. Stored as a single `window_tint` JSONB column on `quotes`
  (migration `0006`) rather than a normalized table — a fixed-shape
  descriptive blob, same precedent as `quote_events.metadata` and
  `shops.follow_up_schedule_days`. Shown on the internal quote detail page,
  the public quote page (customers should see exactly what was quoted
  without a phone call), and as one short teaser line in the *initial*
  email only ("Includes window tint — see your quote for the full
  breakdown") — never a full window-by-window breakdown in any email,
  consistent with `emailTemplates.ts`'s own stated intent that the full
  quote never rides inside the email.

### Verification (this round)
- A Plan-agent review before writing code caught several real gaps in the
  first draft of this design: there was no existing "Vehicle" card at all
  (Year/Make/Model/Trim lived inside the Customer card, so making it
  collapsible meant extracting it, not just adding a toggle); the plan's
  outer-grid idea needed to reuse `AppLayout.tsx`'s existing `max-w-6xl`
  shell rather than inventing a new width; `QuoteDetailPage.tsx` and
  `PublicQuotePage.tsx` both render nothing (no crash, but no message
  either) for a zero-option quote, which needed an explicit empty state;
  and 2-door coupes/regular-cab trucks physically have fewer windows than
  the 5-window Sedan/Coupe default, needing a copy caveat rather than a
  new enum value. All fixed before or during implementation.
- `npm run lint`, `npx tsc -b --noEmit`, `npm run test -- --run` (121/121
  across 11 files, including a new 7-test `windowTint.test.ts`, plus
  additions to `format.test.ts` (`formatVehicle`/`customerDisplayName` null
  cases), `emailTemplates.test.ts` (no template ever renders a literal
  "null"/"undefined" with no vehicle on file; the tint teaser appears only
  on the initial template and only when a tint config exists), and
  `demoRepository.test.ts` (a fully bare quote — no vehicle, no options —
  creates, round-trips, and serves publicly without error)), and
  `npm run build` all clean.
- Playwright smoke pass against a `vite preview` build, each browser
  context re-entering demo mode fresh (a real bug caught mid-pass: reusing
  a bare `browser.newContext()` without re-authenticating via `/demo`
  silently loaded a shop-less app shell): a bare quote (email only) saves
  successfully; Customer/Vehicle cards confirmed side-by-side at 1280px;
  the full flow (vehicle + options + window tint, including the body-style
  picker, apply-to-all, and windshield toggle) saves and opens the email
  preview, which showed the correct vehicle-aware subject and the tint
  teaser line; Duplicate carried both the vehicle and window tint
  configuration over, matching the existing duplicate-quote philosophy;
  screenshotted the Options row at the 1024px `lg:` breakpoint floor to
  confirm no cramping.
- Migrations `0005` and `0006` applied to the live Supabase project via the
  Management API (same route as `0001`-`0004`). Verified against the real
  shop's live data: both vehicle columns confirmed nullable with existing
  rows untouched, `window_tint` column exists as `jsonb`, and a live
  anonymous `get_public_quote` RPC call against a real quote returned the
  new `windowTint` field correctly (`null`, since that quote predates the
  feature) alongside its unaffected existing vehicle data.

---

## Round 8 — Window tint pricing: film type, old-tint removal, windshield price

The tint configurator shipped last round was deliberately priced at zero —
purely descriptive. The user asked for real pricing: Normal vs Ceramic
film, a price for the base job, a "remove old tint first" add-on with its
own price, and a price specifically for the windshield.

### Done
- **`WindowTintConfig` gained a `tintType: 'normal' | 'ceramic'` and three
  new price fields**: `priceCents` (base job), `removeOldTintPriceCents`
  (gated on a new `removeOldTint` boolean), and `windshieldPriceCents`
  (alongside the existing windshield include-toggle and percentage). Kept
  as its own separate total — not folded into `quoteValueCents` or the
  "quoted from $X" figure used in emails/reports, per the user's
  confirmed choice — so `metrics.ts` and email value-line logic needed no
  changes.
- **A form-values/persisted-config split**, matching this app's existing
  pattern for money fields (option price/deposit amount are dollar strings
  in form state, parsed to cents only at submit): new
  `WindowTintFormValues` type in `src/lib/windowTint.ts` plus
  `windowTintFormValuesToConfig()`/`windowTintConfigToFormValues()`
  converters. `WindowTintEditor.tsx` now edits the form shape directly
  (plain controlled dollar-string inputs); `NewQuotePage.tsx` converts at
  the submit and duplicate-prefill boundaries, the same two places
  `optionsFromBundle`/`onSubmit` already do this for option prices.
- **`WindowTintEditor.tsx`** gained: a Normal/Ceramic film-type picker
  (same tile styling as the body-style picker), a base "Tint job price"
  field, a "Remove old tint first?" block (checkbox + price, styled like
  the existing windshield block), a price field added to the windshield
  block, and a live-computed total shown only once something's actually
  priced.
- **Display sites updated**: `QuoteDetailPage.tsx` now shows film type,
  base price, removal price, windshield price, and a bold total;
  `PublicQuotePage.tsx` shows the same breakdown to the customer (they're
  deciding whether to book — same "no phone tag" principle from last
  round, now extended to cover the price). Email copy was deliberately
  left unchanged — the existing generic teaser line already covers it, and
  the full quote (now including tint's price) still never rides inside
  the email, consistent with `emailTemplates.ts`'s own stated intent.
- **`window_tint` needed no schema migration** — it's a schemaless `jsonb`
  column, so the new keys just appear on future writes. Still shipped
  migration `0007` as a defensive backfill (`tintType`/`removeOldTint`
  onto any pre-existing blob), and it turned out **not** to be a no-op:
  the real shop already had two real quotes with tint data from last
  round, now correctly backfilled to `tintType: 'normal'`,
  `removeOldTint: false`, with prices staying `null` (nothing was ever
  priced under the old version) — verified live via the Management API
  before and after, and via a live anonymous `get_public_quote` call.

### Verification (this round)
- `npm run lint`, `npx tsc -b --noEmit`, `npm run test -- --run` (129/129
  across 11 files, including 9 new `windowTint.test.ts` cases covering the
  form↔config round-trip, total computation respecting each add-on's
  toggle, and defaults for a pre-pricing config missing the new keys), and
  `npm run build` all clean.
- Fixed a genuinely flaky test caught during this round's verification:
  `PublicQuotePage.test.tsx`'s not-found-state test was resolving in
  ~970ms against testing-library's default 1000ms timeout — consistently
  tipping over under the heavier demo dataset now in the module graph.
  Confirmed via an isolated run with an extended timeout that it wasn't a
  regression (the app behaves correctly, just slower than the default
  margin allows), then gave that one test explicit headroom
  (`{ timeout: 5000 }`) rather than loosening the global default.
- Playwright smoke pass against a `vite preview` build: the body-style,
  film-type, and remove-old-tint pickers all work; the live total computed
  correctly ($620 across a $450 base + $50 removal + $120 windshield); a
  real bug in the *smoke test itself* was caught and fixed mid-pass — it
  tried to view a fresh quote's public page without first sending the
  email, and correctly got "not found" back, since a draft quote is
  supposed to be invisible on the public page (fixed by clicking "Send
  demo email" first, which is also what actually exercises the real path).
  Confirmed `QuoteDetailPage` and the public quote page both show the full
  price breakdown and total, and that duplicating a quote carries every
  tint price over verbatim through the new conversion functions.
- Migration `0007` applied to the live Supabase project via the Management
  API (same route as `0001`-`0006`) after first confirming live non-null
  `window_tint` rows existed (they did — two real quotes) — re-verified
  the backfill applied correctly via both a direct SQL query and a live
  anonymous `get_public_quote` RPC call.

## Round 9 — Multiple named window tint options per quote

The user asked for two things: explicit permission to stop worrying about
migrating/preserving old (test-era) quotes' tint data going forward, and
the ability to add several named window tint scenarios to one quote — the
same "+ Add" / named-entry / individually-removable pattern already used
for pricing Options.

### Done
- **`WindowTintConfig` gained a `name: string`.** `Quote.windowTint:
  WindowTintConfig | null` and `PublicQuote.windowTint` both became
  `windowTints: WindowTintConfig[]`.
- **`src/lib/windowTint.ts`**: extracted `windowsForBodyStyle(bodyStyle)`
  so switching body style on an *existing* entry resets only its window
  list — not the name/price/tintType a shop may have already typed in,
  which matters more now that each entry carries more state worth keeping.
  `createDefaultWindowTintFormValues(bodyStyle, name?)` and both
  config↔form-values converters and `summarizeWindowTint` all carry `name`
  through.
- **`WindowTintEditor.tsx`**: `value` is no longer nullable (an appended
  entry is always fully populated via `createDefaultWindowTintFormValues`);
  fixed the three previously-hardcoded DOM ids (`tint-price`,
  `tint-removal-price`, `tint-windshield-price`) to be index-scoped
  (`tint-${index}-price`, etc.) — with a single tint config these never
  collided, but they would have the instant a quote carried two entries.
- **`NewQuotePage.tsx`**: replaced the old `tintOpen` boolean with
  `useFieldArray({ control, name: 'windowTints' })`, the exact same
  mechanism already driving `options` (`optionFields`/`append`/`remove`).
  Added a `TintOptionEditor` wrapper (mirrors `OptionEditor`) with a
  "Tint option name" field at the top and a "Remove tint option" button at
  the bottom; capped at three entries, same as Options.
- **`QuoteDetailPage.tsx`** now loops over `quote.windowTints`, one card per
  named entry. **`PublicQuotePage.tsx`** redesigned the tint summary from a
  single inline line into small bordered per-entry cards (visually closer
  to how the Option cards read), each showing its name, body style, film
  type, percentages, and total.
- **Email teaser condition** (`emailTemplates.ts` and the
  `send-quote-email` Edge Function) changed from tint-object truthiness to
  `windowTints.length > 0`; the teaser copy itself is unchanged.
- **Migration `0008_window_tint_multiple.sql`**: renames `window_tint` →
  `window_tints` and updates the `get_public_quote` RPC to key
  `windowTints` off the new column, guarded with
  `jsonb_typeof(...) = 'array'` so any legacy single-object or null row
  reads back as `[]` instead of crashing the public quote page.
  **Deliberately no backfill** — per the user's explicit "don't worry
  about migrating old quotes, we're still testing them" — a real change
  from the backfill-everything approach used in migration `0007`.
  `supabaseRepository.ts`'s `mapQuote` mirrors the same guard at the
  application layer (`Array.isArray(r.window_tints) ? r.window_tints :
  []`).
- **Demo data**: April's Mustang quote now carries **two** named tint
  entries ("Full vehicle, ceramic" and "Front two only, normal film") to
  showcase the new capability in demo mode; Marcus's F-150 quote carries
  one ("Full vehicle"). `DEMO_SEED_VERSION` bumped 7 → 8.

### Verification (this round)
- `npm run lint`, `npx tsc -b --noEmit`, `npm run test -- --run` (131/131
  across 11 files, including new `windowTint.test.ts` coverage for
  `windowsForBodyStyle` and the `name` field through both converters and
  `summarizeWindowTint`), and `npm run build` all clean.
- Playwright smoke pass against a `vite preview` build: empty state →
  add two tint entries → each gets a sensible default name ("Tint option
  1"/"Tint option 2") → index-scoped price ids stay independent between
  entries → switching body style on one entry preserves its name and
  price → a third entry hits the three-entry cap and the Add button
  disappears → removing an entry brings the Add button back → the quote
  saves and its detail page shows both named entries → duplicating the
  quote carries both entries' names and data over intact → the seeded
  multi-entry demo quote (April) renders correctly on the public quote
  page as two separate named, bordered cards with per-entry totals.
- Migration `0008` was **not** applied to the live Supabase project this
  round — the personal access token used for the Management API in prior
  rounds was not available in this session, and the user asked to hold off
  rather than provide a new one. The code (including the migration file)
  is committed and pushed; the migration still needs to be run against the
  live project before production quotes can use more than one tint entry.

### Round 9 addendum — tint percentages weren't actually optional

The user hit "Could not save the quote" testing in production (root cause:
migration `0008` genuinely hadn't been applied to the live DB yet — flagged
directly, SQL handed over for them to run themselves) and separately asked
that tint percentages, in particular, not be required. Fixed: a window can
now be marked "included" without a % chosen yet, the windshield % is no
longer required when windshield tint is checked, and the tint option name
is no longer required (falls back to a generic "Tint option" label when
blank). Display sites now show a friendly "No tint percentages chosen yet"
message instead of an empty list. Verified with 131/131 tests plus two
targeted Playwright smoke checks (a blank-named, percent-less tint entry
saves successfully; the quote detail page shows the graceful fallback).
Committed as `b5b31b9`.

## Round 10 — Selling catalog & packages: Phase 1 foundation

The product direction expanded significantly: 0Gauge is evolving from
quote recovery into a visual, easy car-audio selling system — universal
configuration shells (Truck 2×8, Car 1×12, etc.), a real product catalog
(MSRP vs. selling price, images, specs, import provenance), reusable
package templates, a fast visual builder, Shopify import, and AI bulk-
photo onboarding, per a detailed 5-phase spec. Given the scope, this round
built **Phase 1 (Foundation) completely** — schema, types, repository
layer, pure business logic, demo data, and tests — and left Phase 2+
(Shopify import, the visual builder, AI onboarding) for the next round(s),
rather than half-connect any of it. Two things the spec flagged as
potential blockers (a sibling product-scanner repo and the target Shopify
store) were provided mid-round and are now cloned/confirmed — see
`docs/IMPLEMENTATION_STATUS.md`.

### Done
- **`src/lib/audioConfigs.ts`** — the universal configuration engine.
  All 12 spec'd bass shells (truck 2×8/4×8/2×10/2×12; car/sedan/hatchback/
  SUV 1×8 through 2×15), each a package *shell* (never a hard-coded brand/
  model/price) with required/recommended/optional component slots by
  category. `validatePackageSlots(config, items)` is the one place
  "is this package complete" logic lives — pure, tested, no UI dependency.
  Only the `bass` shell is populated; `door_speakers`/`full_system`/
  `radio`/`camera`/`marine` are declared `active: false` so new shells are
  a data addition, not a restructure. Window tint keeps its own existing
  system untouched.
- **Extended catalog product model** (`supabase/migrations/0009_catalog_product_model.sql`):
  `catalog_items` gained category, MSRP/selling/promo/min-staff/cost
  pricing (clearly distinct, never conflated), price provenance
  (source URL/name/kind/checked-at), image + specs (schemaless JSONB,
  same precedent as `window_tints`), active/availability, import source,
  and approval status — all additive/nullable, zero impact on existing
  catalog flows. A partial unique index on
  `(shop_id, import_source, external_source_product_id)` sets up
  idempotent upserting for a future importer. `quote_items.category` and
  `quote_options.config_id` were added too (both nullable) so real quotes
  can eventually be validated against `validatePackageSlots`.
  Owner/manager-only approval-status changes are enforced by a genuine
  Postgres trigger (`guard_catalog_item_approval`), not just app-layer
  trust — RLS alone can't compare a row's old value to its new one.
- **Package template model** (`supabase/migrations/0010_package_templates.sql`):
  `package_templates` + `package_template_items`, RLS matching this
  schema's existing tenant-isolation pattern exactly, the same
  approval-status trigger protection. `src/lib/packageTemplates.ts`'s
  `quoteOptionToPackageTemplateDraft()` is a pure, tested snapshot
  conversion — `sourceQuoteId`/`sourceQuoteOptionId` are provenance-only
  (`on delete set null`), never a live reference, so editing or deleting
  the original quote later can never change an already-saved package
  (verified by a test that mutates the source after conversion).
- **Repository layer**: both `DemoRepository` and `SupabaseRepository`
  gained `listPackageTemplates`/`createPackageTemplate`/
  `setPackageTemplateApproval`/`deletePackageTemplate`, and
  `catalogItemRow`/`updateCatalogItem` (both modes) now only touch columns
  the caller actually passed — a plain price edit from the Settings form
  can never silently clobber an imported image or MSRP once an importer
  exists.
- **Demo data**: catalog enriched to 14 categorized products (two
  deliberately left uncategorized — a loaded enclosure and a bundled sub+
  amp kit — rather than force a fake single-slot classification onto a
  bundled product), plus 3 seeded package templates (approved, approved-
  with-real-quote-provenance, pending_review) to exercise the review-queue
  states in demo mode. `DEMO_SEED_VERSION` bumped 8 → 9.
- **No UI wired yet, by design** — the fast package builder, "save as
  package" button, and owner approval screen are Phase 3. Nothing points
  at the new capability from the app today, so there's no dangling/
  nonfunctional button — it's a complete, tested backend layer ready for
  that UI.
- **Docs**: new `docs/CATALOG_AND_PACKAGES.md` (concepts, security model,
  how to run the migrations, test coverage) and
  `docs/IMPLEMENTATION_STATUS.md` (done/partial/deferred/credentials/
  limitations/next step, per the spec's explicit request). `README.md` and
  `docs/ROADMAP.md`'s "Phase 2 — System Builder" updated to point at them;
  `docs/SECURITY.md` documents the two new tables and the approval-trigger
  pattern.
- **Repo/Shopify unblocked mid-round**: the requested sibling scanner repo
  (`jordanianresearcher-art/car-audio-inventory`) was cloned into this
  session, and the Shopify connector confirmed live and connected to
  **Super Car Audio (supercaraudio.com)** — both were flagged as
  blocking Phase 2/5 and are now resolved; recorded in
  `docs/IMPLEMENTATION_STATUS.md` as the immediate next step.

### Verification (this round)
- `npm run lint`, `npx tsc -b --noEmit`, `npm run test -- --run` (158/158
  across 13 files — 15 new `audioConfigs.test.ts` cases, 5 new
  `packageTemplates.test.ts` cases, and 6 new `demoRepository.test.ts`
  cases covering catalog defaults/partial-update protection, package
  template CRUD, seed-state coverage, and snapshot immutability), and
  `npm run build` all clean.
- Playwright smoke pass against a `vite preview` build confirmed no
  regression to existing screens from the type/schema extension: demo mode
  boots on the bumped seed version, Settings → Product Catalog still
  renders with the richer demo catalog, and creating a quote through the
  existing free-text option builder still works end-to-end untouched.
- Migrations `0009` and `0010` were **not** applied to the live Supabase
  project this round (no personal access token available — same
  limitation as Round 9); both are committed and ready to run.
