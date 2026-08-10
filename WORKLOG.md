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

### Round 10 addendum — Shopify import (Phase 2 backend)

Mid-round, the user supplied the two things flagged as Phase 2/5 blockers:
the sibling product-scanner repo
(`jordanianresearcher-art/car-audio-inventory`, cloned into this session)
and confirmation that the Shopify connector already available in this
session is live against **Super Car Audio (supercaraudio.com)**. Read the
scanner repo's `src/lib/shopify.ts` (auth/pagination/GraphQL patterns —
adapted, not copied, since it syncs the opposite direction, pushing
scanned items *into* Shopify rather than pulling a catalog *out of* it)
and its AI photo-identification route (informs Phase 5's design later).
Fetched real Super Car Audio product data live via the Shopify MCP
connector to ground the import's mapping logic in actual data rather than
guesswork.

- **`src/lib/shopifyImport.ts`** (pure, 16 tests, all against a fixture
  shaped from a real fetched product — a Nemesis Audio NA-8SLM V.2
  subwoofer): `guessCategoryFromProductType()` (best-effort, never an
  authoritative claim), `mapShopifyVariantToCatalogItem()` (one catalog
  item per Shopify *variant* — this catalog has no variant concept;
  `compareAtPrice` → `msrpCents` only when genuinely higher than the
  current price; non-`ACTIVE` products land `active: false` rather than
  being skipped), and `planCatalogItemSync()` / `priceLikelyEditedSinceSync()`
  — the "never silently overwrite a price a staff member edited since the
  last sync" protection, driven off comparing `updatedAt` to
  `priceCheckedAt` (a timestamp only a price-carrying sync write sets).
- **`supabase/functions/shopify-import-catalog/index.ts`**: paginated
  (resumable via a returned cursor, capped per invocation), owner/manager-
  only (checks `shop_memberships.role` directly rather than the
  `is_shop_admin()` RPC, which can't see `auth.uid()` under the function's
  own service-role session — same reasoning already used in
  `admin-create-shop`), idempotent upsert keyed on
  `(shop_id, 'shopify', variant GID)`. Mirrors (duplicates, doesn't import
  cross-directory) the tested logic in `shopifyImport.ts`, the same
  precedent `send-quote-email` already set for `emailTemplates.ts`.
  Reports `{created, updated, unchanged, skipped, failed, errors}` per
  the spec's explicit ask. No Deno runtime available in this session to
  execute it live, so it was instead verified to type-check cleanly in
  isolation against a stubbed `Deno` global.
- **`DataRepository.runShopifyImport()`** added to both repositories:
  `SupabaseRepository` invokes the Edge Function; `DemoRepository` throws
  immediately, since demo mode must never make a real external call.
- **Still no UI** — same complete-backend-no-dangling-button approach as
  the rest of this round. `docs/IMPLEMENTATION_STATUS.md` spells out the
  exact remaining steps (deploy, set two Edge Function secrets, run the
  import) and flags the one genuine remaining gap precisely: the Shopify
  MCP *connector* used to research this round is a Claude-side connection
  for the assistant, not something the deployed app can use at runtime —
  the app itself still needs its own `SHOPIFY_STORE_DOMAIN` +
  `SHOPIFY_ADMIN_ACCESS_TOKEN` as real Edge Function secrets (the sibling
  `car-audio-inventory` repo already has a working token for this same
  store, confirmed by its own code referencing the store's admin handle).

### Verification (this addendum)
- `npm run lint`, `npx tsc -b --noEmit`, `npm run test -- --run` (174/174
  across 14 files, 16 new in `shopifyImport.test.ts`), and `npm run build`
  all clean.
- `shopify-import-catalog/index.ts` type-checked in isolation (stubbed
  `Deno` global + stubbed `createClient`) since no Deno runtime was
  available in this session — confirmed no syntax/type errors in the
  duplicated mapping/sync logic.
- Neither migrations `0009`/`0010` nor the new Edge Function were applied/
  deployed to the live Supabase project this round — same access-token gap
  as every prior round; exact deploy commands are in
  `docs/CATALOG_AND_PACKAGES.md`.

## Round 11 — Fast visual package builder (Phase 3)

The user asked to deploy migrations `0009`/`0010`, the `shopify-import-catalog`
function, set its secrets, and run the import against Super Car Audio, then
build the fast visual drag-and-drop package builder against the real
imported catalog. The deploy/secrets/import portion stayed blocked for the
same reason as every prior round — no Supabase personal access token, no
CLI, no Supabase MCP tools, and no real `SHOPIFY_ADMIN_ACCESS_TOKEN`
available in this session (re-confirmed via `ToolSearch`, `which supabase`,
and checking the environment for secrets, all empty). That's communicated
to the user as a real, standing blocker. The builder itself needs no
deploy access and works against demo data today, so that's what got built:

- **`@dnd-kit/core`** added as a dependency, chosen over native HTML5
  drag-and-drop specifically because HTML5 DnD doesn't work on touch
  devices and this app's primary target is phones/tablets in a shop.
  `PointerSensor` (8px activation distance, so a tap isn't misread as a
  drag) + `KeyboardSensor` cover mouse, touch, and keyboard.
- **`src/lib/packageBuilder.ts`** (pure, 19 tests): which catalog products
  are eligible for a slot (`catalogItemsForSlot` — active + approved +
  matching category only), the add/set-quantity/remove assignment
  reducers, converting filled slots into quote items
  (`assignmentsToQuoteItems`) or package-template items with images
  (`assignmentsToPackageItems`), the component subtotal, completeness via
  the existing `validatePackageSlots`, `requiresCompatibilityConfirmation()`
  (always `true` — no owner-vetted compatibility ruleset exists anywhere
  in this system yet, so the builder never implies a check it can't back
  up), and folding a separate labor-price field into the same generic
  slot-assignment model as a synthetic, non-persisted `CatalogItem`
  (`resolveBuilderCatalog`) so no other calculation needs a labor special case.
- **`src/components/PackageBuilder.tsx`**: the actual slot-filling UI —
  vehicle type → configuration → drag (or tap) products into slots → a
  labor price field → an installed-price override → the compatibility
  confirmation gate. Every draggable product card is also a plain tap
  target (`onClick`), so the same interaction works with or without real
  drag support. A cross-category drop is rejected with a toast rather than
  silently accepted.
- **Wired into `NewQuotePage.tsx`**: each option now has a "Build with
  drag & drop" / "Switch to manual entry" toggle. The builder is a
  self-contained draft (`PackageBuilderValue`) that only writes to the
  option's real `items`/`price`/`configId` once staff taps "Apply to this
  option" — the existing free-text product list is fully preserved and
  becomes the post-apply review/edit surface, per the spec's explicit
  "preserve the existing builder" requirement. A "Save as package" button
  next to it calls `createPackageTemplate` directly, independent of the
  quote's own form state, so a good build can become a reusable package
  before the quote itself is even saved.
- **Not built this round**: "Start from a saved package" (pre-filling the
  builder from an existing `package_templates` row) and an owner-approval
  screen for pending packages — both real, scoped-out enhancements
  documented in `docs/IMPLEMENTATION_STATUS.md`'s recommended next steps,
  not half-built UI.
- Demo catalog (seeded in Round 10) already covers every *required* slot
  category for all 12 bass configurations, so no demo-data changes were
  needed to get a good demo of the builder.
- Docs updated: `docs/CATALOG_AND_PACKAGES.md` gained a full "Fast visual
  package builder" section; `docs/IMPLEMENTATION_STATUS.md` moved the
  builder from "Deferred" to "Completed (Phase 3)" and rewrote the
  recommended next step; `README.md` and `docs/ROADMAP.md` updated to stop
  describing the builder as upcoming.

### Verification (this round)
- `npm run lint`, `npx tsc -b --noEmit`, `npm run test -- --run` (193/193
  across 15 files — 19 new in `packageBuilder.test.ts`), and `npm run
  build` all clean.
- A Playwright smoke pass against a `vite preview` build exercised the
  builder end to end in demo mode: picked Truck → Truck 2×8, tap-added a
  subwoofer/enclosure/amp/wiring kit, bumped subwoofer quantity to 2, did
  a **real dnd-kit pointer-sensor drag** (mouse-move/down/move/up, not a
  synthetic drop event) to fill the optional bass-control slot, confirmed
  a cross-category drop never fills the wrong slot, saved the in-progress
  build as a reusable package, confirmed the Apply button is gated
  correctly on the compatibility checkbox, applied it (verified the
  computed installed price — $744.00 — and all six item names landed in
  the manual product list), then saved the quote end-to-end.
- Migrations `0009`/`0010` and the `shopify-import-catalog` function
  remain **not deployed** to the live Supabase project — same access gap
  as every prior round. The Shopify import against Super Car Audio has
  still never been run against real data; the builder was verified
  against demo data only, exactly as flagged to the user up front.

## Round 12 — Shopify import: real deploy + a real UI button

The user deployed the Round 11 backend themselves this round: applied
migrations `0009`/`0010` via the SQL Editor, deployed
`shopify-import-catalog` via the Supabase CLI (working around a stale
local checkout and a not-yet-running Docker Desktop along the way), and
set `SHOPIFY_STORE_DOMAIN` + `SHOPIFY_ADMIN_ACCESS_TOKEN` as Edge Function
secrets. That closes the deploy-access gap flagged in every prior round —
this session still has no Supabase token/CLI of its own, but the user now
has a live, deployed import function.

What was missing to actually use it: the plan up to that point was
"open the browser console and call `repo.runShopifyImport()` yourself,"
which assumed a `window.__repo` debug hook that doesn't actually exist in
this app. Rather than asking a non-technical user to work around that,
built the real thing:

- **`src/data/supabaseRepository.ts`**: `runShopifyImport()` now unwraps
  a `FunctionsHttpError`'s attached `Response` to read the Edge Function's
  real JSON `message` (e.g. "Only an owner or manager can run a Shopify
  catalog import.", "Shopify isn't configured yet…") instead of
  supabase-js's generic "Edge Function returned a non-2xx status code."
- **Settings → Shopify catalog import** (`src/pages/app/SettingsPage.tsx`):
  a new section, production-mode only (demo mode's `runShopifyImport`
  always throws, so it's hidden entirely there — verified with a
  Playwright smoke check). One "Run import" button loops the paginated
  call until `hasMore` is false, showing running totals
  (created/updated/unchanged/skipped/failed) as each page completes, and
  refreshes the Product Catalog list below on success via a lifted
  `catalogReloadSignal` passed into `CatalogSection`. Any signed-in staff
  member can see the button; the Edge Function's own owner/manager check
  is the real gate, and a non-owner/manager now sees that exact message
  instead of a generic failure.
- Docs updated: `docs/CATALOG_AND_PACKAGES.md` and
  `docs/IMPLEMENTATION_STATUS.md` both replaced the old "no UI, run this
  script yourself" guidance with the button's actual behavior, and
  corrected a stale line that said imported products would need separate
  owner approval — they don't; Shopify imports land `approvalStatus:
  'approved'` directly, by design (see Phase 2's original reasoning).

### Verification (this round)
- `npm run lint`, `npx tsc -b --noEmit`, `npm run test -- --run`
  (193/193 across 15 files — no new test files this round, since the
  addition is UI wiring over already-tested repository/Edge-Function
  logic), and `npm run build` all clean.
- A Playwright smoke pass against `vite preview` confirmed the Shopify
  import section is correctly absent in demo mode (Settings still renders
  fine, no dangling button that would just throw if clicked).
- Whether the user's own "Run import" click against the real Super Car
  Audio catalog succeeds is not something this session can observe
  directly — the button, its error-message surfacing, and its
  hidden-in-demo-mode behavior are what got verified here.

## Round 13 — Real import ran; fixed a compute-quota failure partway through

The user got the Shopify auth 401 sorted themselves (with a local Claude
Code instance debugging the actual token/domain directly, since this
remote session has no access to their terminal) and successfully ran the
import against the real Super Car Audio store — real Nemesis Audio
products (NA-6.9HCX, NA-2.75, NA-6.5HCX, etc.) landed in the Product
Catalog with real prices. Partway through, the function failed with
"not having enough compute resources."

Root cause: each variant costs 2-3 sequential Postgres round trips
(existence check, then an insert-with-a-fresh-COUNT-query or an update)
on top of the Shopify GraphQL call itself — and the function was sized to
do up to 500 products (50/page x 10 pages) in one invocation, comfortably
enough sequential I/O to blow past Supabase's per-invocation Edge
Function compute budget on a real catalog.

Fixed in `supabase/functions/shopify-import-catalog/index.ts`:
- `DEFAULT_PRODUCTS_PER_PAGE` 50 → 15, `MAX_PAGES_PER_RUN` 10 → 1 — one
  invocation now does far less work; the "Run import" button already
  loops on `hasMore` automatically, so this just means more (automatic)
  calls, not a worse import.
- Removed the per-created-row COUNT query used only to assign `position`
  — it's now counted once up front and incremented locally, cutting a
  third round trip off exactly the case (a fresh import, everything a
  `create`) that had just failed.
- Re-verified the function type-checks cleanly in isolation (same
  stubbed-`Deno`-global approach as Phase 2, no Deno runtime available in
  this session) since there's still no way to execute it directly here.

### Verification (this round)
- `npm run lint`, `npx tsc -b --noEmit`, `npm run test -- --run`
  (193/193 — unchanged, this round only touches the Edge Function, which
  has no local test runner), and `npm run build` all clean.
- Whether the smaller batch size actually clears Super Car Audio's real
  catalog without hitting the quota again is something only the user's
  next "Run import" click can confirm — not observable from this session.

## Round 14 — Builder UI feedback after using it against a real catalog

The user ran the fast builder against the now-imported real Super Car
Audio catalog and gave three pieces of concrete UI feedback: some real
products (e.g. a "RAM box") weren't findable in their expected slot
category, the working area felt cramped, and they wanted the product tray
positioned on the right to drag from. All three addressed:

- **`src/components/ui.tsx`**: `Modal` gained a `size?: 'default' | 'wide' | 'xl'`
  prop (`xl` → `sm:max-w-6xl`), keeping the existing `wide` boolean prop
  working unchanged for its one other caller (`EmailPreviewModal`).
- **`src/pages/app/NewQuotePage.tsx`**: the builder now opens in that `xl`
  modal instead of inline inside the narrow per-option card — the option
  card's free-text product list is no longer conditionally hidden while
  the builder is open (there's nothing to hide from now that the builder
  floats above everything as a dialog), it's always there underneath.
- **`src/components/PackageBuilder.tsx`**: restructured into a two-column
  `lg:grid` layout — slot grid/labor/price/confirmation on the left, the
  `ProductTray` as a `lg:sticky` right sidebar (stays in view while the
  slot list scrolls). Below `lg`, it stays exactly as before — a single
  stacked column, since phones/tablets (the primary target) don't have
  spare width for a sidebar. `ProductTray`'s own grid also got an
  `lg:grid-cols-2` override, since its previous `sm:`/`md:` column counts
  assumed full-viewport-width placement and would've been far too dense
  squeezed into a 22rem sidebar.
- **`ProductTray`** gained a **"Search all products"** checkbox, shown
  once a slot is selected, that drops the category filter entirely and
  searches the shop's whole active/approved catalog instead. This is the
  honest fix for miscategorized/unrecognized Shopify imports — rather than
  trying to guess-expand `guessCategoryFromProductType`'s pattern table
  for one specific unseen product name (which risks miscategorizing
  something else), give staff a direct way to find and assign anything
  regardless of its stored category. Tap-to-add already didn't enforce
  category (only a *drag* onto a slot does), so this genuinely surfaces
  items that were simply invisible before, not just widens a search box.

### Verification (this round)
- `npm run lint`, `npx tsc -b --noEmit`, `npm run test -- --run`
  (193/193 — unchanged; this round is UI-only, no new pure-logic
  functions), and `npm run build` all clean.
- A Playwright smoke pass against `vite preview` (1440px viewport)
  confirmed: the builder opens in a dialog (not inline), the dialog is
  genuinely wide (~1152px, not the old ~768px cap), the product tray sits
  to the right of the slot grid, the tray defaults to category-scoped,
  and checking "Search all products" reveals a cross-category item (a
  demo enclosure, while a subwoofer slot was selected) that was hidden
  a moment before.

## Round 15 — Sync bug fix, custom items, icon-led UI, Codex prompt

Four more asks after the user kept using the builder against their real
catalog: their Shopify categorization needs improving (asked for a Codex
prompt to do that work), a way to add something with no category at all,
less text/more icons, and self-explanatory buttons.

- **Real bug found and fixed first**: `planCatalogItemSync()`'s change
  detection (in both `src/lib/shopifyImport.ts` and the duplicated
  `supabase/functions/shopify-import-catalog/index.ts`) never compared
  `category`, only brand/model/name/description/image/active. That meant
  fixing a product's categorization in Shopify and re-running the import
  would silently do nothing to an already-imported row — only brand-new
  products would ever pick up a category fix. Without this, the entire
  point of the Codex categorization work below would've had zero effect
  on the ~7+ products already imported. Added `category` to the
  comparison in both places; new test in `shopifyImport.test.ts`.
- **Extra / custom items** (`src/lib/packageBuilder.ts`): a
  `CustomBuilderItem` (name/price/quantity, no catalog product or
  category) kept deliberately outside the slot-assignment model — never
  fills a slot, never affects completeness, only folds into the subtotal
  and the final applied/saved item list. UI in `PackageBuilder.tsx`
  mirrors the existing manual-entry row pattern from `NewQuotePage.tsx`.
  4 new tests.
- **Icon-led UI pass** (`PackageBuilder.tsx`, `NewQuotePage.tsx`): slot
  requirement badges ("Required"/"Recommended"/"Optional") became small
  icons with accessible labels/tooltips instead of spelled-out words; the
  repeated-on-every-empty-slot sentence "Tap to select, then drag or tap
  a product below" became a plus icon + "Add"; a slot's `note` text moved
  from always-visible to an info-icon tooltip; a product tray card's
  "Drag or tap" caption became a corner grip icon with a native tooltip;
  the compatibility confirmation shrank from a bold header + two
  sentences to one line with a warning icon; "Apply to this option" →
  "Apply" (with a check icon) since the modal's own context already says
  which option; the "Save as package" field dropped its explanatory hint
  in favor of a plain "Package name" label.
- **Codex prompt**: delivered directly in chat (not a repo file) — a
  complete, self-contained prompt covering the exact `ProductCategory`
  taxonomy this app's importer recognizes, the current
  `guessCategoryFromProductType` regex hint table so Codex's output
  actually round-trips into a correct category on next import, and SEO
  guidance (Shopify `productType`/tags/meta description/title) per the
  user's explicit ask that categorization serve both purposes.

### Verification (this round)
- `npm run lint`, `npx tsc -b --noEmit`, `npm run test -- --run`
  (198/198 across 15 files — 1 new in `shopifyImport.test.ts`, 4 new in
  `packageBuilder.test.ts`), and `npm run build` all clean.
- A Playwright smoke pass confirmed: the old requirement-badge text and
  the verbose empty-slot sentence are both gone, a custom item with no
  category can be added and its price lands in the subtotal, applying an
  option with *only* a custom item (no slots touched at all) still works
  end to end, and the custom item's name lands correctly in the manual
  product list afterward.

## Round 16 — In-app categorization tools (automatic + manual drag-and-drop)

The Codex categorization pass didn't fully resolve the user's findability
problem, and rather than keep iterating on Shopify-side fixes alone, the
user asked for the app itself to be able to fix this — both automatically
and by hand. Also a small but clear UX fix: the "search all products"
override was staying checked across slot changes, contrary to what the
user wanted.

- **`src/lib/categorize.ts`** (new): `guessCategoryFromName(name,
  description)` — a regex hint table matching against a product's own
  name/description text rather than Shopify's `productType` field, so it
  works for *any* catalog item regardless of source (manually-entered
  products included, which Shopify's importer never touches). Pattern
  order matters here — enclosure checked before subwoofer ("Sub Box"
  would otherwise match `\bsub\b` first), wiring_kit before mono/multi
  amp ("Amp Wiring Kit" would otherwise match `amp(lifier)?` first). 4 tests.
- **`src/pages/app/SettingsPage.tsx`**: the catalog item add/edit modal
  gained a **Category** dropdown (previously category had no manual-entry
  UI at all), and each catalog list row now shows its category or an
  "Uncategorized" badge.
- **`src/components/CatalogOrganizer.tsx`** (new): a bulk categorization
  tool opened from Settings → Product Catalog → "Organize by category" (a
  new `Modal size="xl"`). Drag a product card onto a category, or tap a
  card then tap a category — mirrors the package builder's product-tray
  interaction model, reusing the same `@dnd-kit` setup. Every category
  accepts every product here (unlike a config slot, there's no "wrong"
  category — the whole point is setting one). An **"Auto-categorize"**
  button runs `guessCategoryFromName()` against everything currently
  uncategorized and reports a count of what it placed versus what still
  needs a manual look, rather than forcing a low-confidence guess.
- **`src/components/PackageBuilder.tsx`**: `ProductTray`'s "Search all
  products" checkbox now resets to unchecked whenever `selectedSlot`
  changes (a `useEffect` keyed on `selectedSlot?.key`) — an override on
  one slot no longer silently carries over to the next slot clicked.

### Verification (this round)
- `npm run lint`, `npx tsc -b --noEmit`, `npm run test -- --run`
  (202/202 across 16 files — 4 new in `categorize.test.ts`), and `npm run
  build` all clean.
- A Playwright smoke pass confirmed: the category dropdown is present in
  the edit modal, the organizer opens as a dialog, tap-select-then-tap-
  assign correctly moves an item out of the "uncategorized only" filtered
  view, and "Auto-categorize" runs and reports a summary toast (in the
  demo catalog, it correctly picked up the one remaining uncategorized
  bundle product via its name's "amp" mention — landing it in
  `multi_amp`, a reasonable if imperfect guess for a sub+amp bundle,
  exactly the kind of case staff can still correct by hand afterward).

## Round 17 — Remove the drag category barrier; strengthen auto-categorize

The user hit the "That product doesn't match this slot's category" toast
during real use and asked for it gone entirely, for the search box to
clear on slot switches (a gap left over from last round's searchAll-only
fix), and for the categorization logic itself to be reviewed and
improved. Can't literally browse this shop's live catalog from this
session (no direct Supabase/Shopify access, same standing constraint as
the deploy work) — instead improved the shared guessing logic using the
real product names already visible earlier in this conversation.

- **`src/components/PackageBuilder.tsx`**: `handleDragEnd` no longer
  compares `dragData.category`/`dropData.category` at all — any drag onto
  any slot succeeds, matching how tap-to-add already worked. The main
  component now also clears `search` (not just `searchAll`, fixed last
  round) via a `useEffect` keyed on `selectedSlotKey`. The tray's empty
  state ("No X in your catalog yet") now also points at the extra/custom
  items field below it.
- **`src/lib/categorize.ts`**: substantially broadened
  `NAME_CATEGORY_HINTS` — more wiring-kit phrasing ("installation kit",
  "power kit", gauge-kit patterns), CAN-bus/steering-wheel-control
  wording for `integration_module`, more `sound_treatment` terms (butyl,
  MLV, jute pad), `full-range`/`coaxial` wording for `door_speaker`
  (verified against this shop's actual Nemesis Audio product names shown
  earlier in this conversation — "6x9-Inch ... Coaxial Speakers", "...
  Full Range Speakers", "... Midrange Speaker" all now resolve correctly),
  CarPlay/Android Auto/touchscreen for `radio`, and a new `accessory`
  catch-all tier (capacitors, fuse holders, RCA cables, dash kits,
  antennas) checked last since it's the least specific tier. 3 new test
  cases, including the real Nemesis Audio names directly.

### Verification (this round)
- `npm run lint`, `npx tsc -b --noEmit`, `npm run test -- --run`
  (204/204 across 16 files — 3 new in `categorize.test.ts`), and `npm run
  build` all clean.
- A Playwright smoke pass confirmed: search text now clears on slot
  switch, a deliberately cross-category drag (an enclosure onto a
  subwoofer slot, found via "Search all products") succeeds silently with
  no rejection toast and the item actually lands in the slot, and the
  empty-tray state shows the new pointer toward extra/custom items.

## Round 18 — Voice/speaker and complete-system shells, wiring-kit variants

The user described their real domain model in full (bass system: enclosure,
subs, mono amp, LOC, bass restoration; voice system: door speakers,
tweeters, 4/5-channel amps; factory retention: T-harnesses / integration
modules; optional head unit and DSP; four wiring-kit variants — 0-gauge and
4-gauge, each in CCA and OFC) and asked for a "code building system that can
work on any car or any truck" they can resell to other shops. The
`ConfigShell`/`SHELL_INFO` architecture from Phase 1 already anticipated
this (`door_speakers` and `full_system` were declared but inert, `active:
false`, zero configs) — this round populates them rather than inventing a
new mechanism.

- **`src/lib/audioConfigs.ts`**: `AudioConfiguration.subCount`/
  `subSizeInches` made optional (voice-only builds don't size by sub
  count). Added `speakerSlots()`/`speakerConfig()` and four
  `DOOR_SPEAKER_CONFIGS` (2-way/3-way × front-only/front+rear, offered for
  every vehicle type, unlike bass sizing) — door speaker required (min
  qty doubles for front+rear), tweeter required only on 3-way, multi-amp/
  wiring/integration-module recommended, DSP/head-unit optional. Added
  `fullSystemSlots()`/`fullSystemConfig()` and two `FULL_SYSTEM_CONFIGS`
  (`full_system_truck`: 2×8", `full_system_car`: 1×10") — a
  purpose-built combined slot list (not a naive concatenation of the bass
  and voice slot lists, which would have produced duplicate slot keys),
  required on both the bass side (subwoofer/enclosure/mono_amp) and the
  voice side (door_speaker) before `validatePackageSlots` reports
  complete. `SHELL_INFO.door_speakers`/`full_system` flipped to
  `active: true` with real labels ("Voice / speakers", "Complete
  systems").
- **`src/components/PackageBuilder.tsx`**: inserted a "Build type" shell
  picker between the vehicle-type and configuration pickers (only shown
  once a vehicle type is picked; only lists shells that actually have
  configs for that vehicle type) — otherwise adding two more shells would
  have doubled+ the number of undifferentiated configuration buttons
  shown at once. Choosing a shell resets any in-progress `configId` and
  selected slot.
- **Wiring-kit gauge/material variants**: rather than fragmenting
  `ProductCategory` into one entry per gauge/material combo, added a
  documented convention on the existing schemaless `specs` JSONB —
  `specs.gaugeAwg` (number) / `specs.wireMaterial` ('cca' | 'ofc'). New
  `formatWiringKitSpec()` in `src/lib/format.ts` renders this as a compact
  "0GA · OFC" badge, wired into both `SlotCard`'s assigned-item row and
  `ProductTrayCard` in `PackageBuilder.tsx` so staff can tell the variants
  apart at a glance when several wiring-kit products are on screen
  together.
- **Demo catalog**: added 3 more wiring-kit variants alongside the
  existing 4-gauge CCA kit (4-gauge OFC, 0-gauge CCA, 0-gauge OFC, each
  with `specs` set), plus a tweeter, a factory-integration harness
  (`integration_module`), and an 8-channel DSP — enough catalog depth to
  actually complete a voice or full-system build in the demo.
  `DEMO_SEED_VERSION` bumped 9 → 10.
- **`docs/CATALOG_AND_PACKAGES.md`**: documented the newly active shells,
  the shell-picker UI addition, and the wiring-kit specs convention.
- Tests: `audioConfigs.test.ts` gained a `door_speakers shell` block (4
  tests: config ids present, tweeter requirement 2-way vs 3-way, min-qty
  doubling front+rear, never requires bass-side categories) and a
  `full_system shell` block (3 tests: combined required-slot set with no
  duplicate keys, complete only once both sides filled, one config per
  broad vehicle group); existing tests that assumed every config was
  bass-shaped were scoped to `.shell === 'bass'`. `format.test.ts` gained
  4 tests for `formatWiringKitSpec`.

### Verification (this round)
- `npx tsc -b --noEmit`, `npm run lint`, `npm run test -- --run`
  (215/215 across 16 files), and `npm run build` all clean.
- A Playwright smoke pass against `vite preview` confirmed: the shell
  picker appears after choosing a vehicle type and offers all three
  active shells; picking "Voice / speakers" → "2-Way Front Speakers"
  shows door-speaker + tweeter slots and no subwoofer slot; switching to
  "Complete systems" → "Complete System — Truck" shows bass slots
  (subwoofer) and voice slots (door speaker) together; the wiring-kit
  badges ("4GA · CCA", "0GA · OFC") render both in the product tray and
  next to an item once it's assigned to a slot.

## Round 19 — Scan-to-Invoice, Phase 1: inventory ledger foundation

The user asked to combine this quote estimator with a second app they have
(`car-audio-inventory`, a Next.js barcode/photo inventory scanner) so
scanning becomes the main daily workflow: scan a product → it shows up
centered with image/name/brand/price looked up automatically, all fields
editable → choose from a side panel whether this scan session becomes a
quote, a printed/paid/tracked invoice, a vendor inventory receipt, or an
outgoing order to another shop — plus AI photo lookup and generated codes
with printable labels for products with no barcode, and voice input that
parses a spoken order into matched-or-new catalog items. This is a large,
multi-phase build (design plan: 5 phases, see `docs/INVENTORY_AND_SCANNING.md`).
Confirmed with the user via AskUserQuestion before starting: this app
(SaaS-0AWG) becomes the one app going forward (`car-audio-inventory`'s
logic gets ported in, not kept as a second deployed app); voice input uses
server-side transcription (not the browser's built-in speech API, so it
works on iPhones too); no-UPC products get a real, checksum-valid UPC-A in
GS1's reserved in-store prefix range (not a fake/ambiguous internal code);
labels print as a grid on the shop's existing 4"×6" label printer.

This round is Phase 1 only — the inventory ledger foundation. No scanning,
no UI for any of the four document-type actions yet; see
`docs/INVENTORY_AND_SCANNING.md` for the full phase breakdown.

- **Migration `0011_inventory_and_documents.sql`**: `catalog_items` gains
  `quantity_on_hand` (opt-in, default 0), `upc_is_generated`,
  `label_printed_at`. New `stock_movements` append-only ledger
  (`receiving`/`outgoing_order`/`sale`/`adjustment`, signed
  `quantity_delta`, optional vendor/destination name and cost) — read-only
  via RLS for shop members, every write goes through the new
  `apply_stock_movement()` SECURITY DEFINER RPC so the ledger and the
  derived `quantity_on_hand` can never drift apart (one function call = one
  atomic transaction, which matters once multiple staff scan/sell
  concurrently). New `invoices`/`invoice_items` (flat, unlike tiered
  `quotes`/`quote_options` — by the time something's an invoice, staff
  have already decided what's selling) and `outgoing_orders`/
  `outgoing_order_items` tables, both with a trigger-assigned sequential
  per-shop human-friendly number (`invoice_number`/`order_number`, an
  advisory-lock-guarded `select max()+1` so concurrent inserts never
  collide). Vendor receiving deliberately gets no header table of its own
  — it's just catalog upserts + ledger rows with the vendor's name; the
  ledger itself is the "what did we receive and when" record. Schema only
  this round — `invoices`/`outgoing_orders` have no repository methods or
  UI yet (Phase 2/3), landed early so the ledger's `source_invoice_id`/
  `source_outgoing_order_id` FKs could reference real tables from day one.
- **`src/types.ts`**: `StockMovement`, `Invoice`/`InvoiceItem`,
  `OutgoingOrder`/`OutgoingOrderItem` types; `CatalogItem` gained
  `quantityOnHand`/`upcIsGenerated`/`labelPrintedAt`.
- **`src/data/repository.ts`**: `NewStockMovementInput`,
  `recordStockMovement()`/`listStockMovements()` on `DataRepository`.
  Implemented in `DemoRepository` (localStorage, mirrors the RPC's
  atomicity in one method) and `SupabaseRepository` (calls
  `apply_stock_movement`, then re-reads the item). `listStockMovements`
  sorts newest-first with an insertion-order tiebreak for movements
  recorded in the same millisecond (a real risk with rapid scan-to-invoice
  usage, not just a test artifact — caught by a flaky test during this
  round).
- **Demo data**: seeded a short realistic ledger history (received 10,
  sold 4, net 6 on hand) on the Kicker CompR 12 subwoofer and the RFK4X
  wiring kit. `DEMO_SEED_VERSION` bumped 10 → 11.
- **Docs**: new `docs/INVENTORY_AND_SCANNING.md` (the home for this whole
  effort going forward — phase tracker, schema reference, required
  credentials for later phases, known limitations). Updated
  `docs/CATALOG_AND_PACKAGES.md` and `docs/IMPLEMENTATION_STATUS.md` to
  retract their "no inventory quantities are tracked" framing and point
  here.

### Verification (this round)
- `npx tsc -b --noEmit`, `npm run lint`, `npm run test -- --run`, `npm run
  build` all clean.
- New tests: 4 in `demoRepository.test.ts` covering the seeded ledger
  history, atomic record-and-update, the unknown-item error path, and
  shop-wide ledger ordering.
- No new UI this round (schema/repository only) — nothing new for a
  Playwright smoke pass to exercise yet; the existing full suite still
  passes unchanged, confirming nothing else broke.
- Migration `0011` is written and ready but **not applied to the live
  Supabase project** — this session still has no Supabase CLI/personal
  access token (a standing limitation, see `docs/CATALOG_AND_PACKAGES.md`).
  The shop owner applies it themselves, same as every prior migration.

## Round 20 — Scan-to-Invoice, Phase 2: scan workspace, barcode lookup, invoices

Continuing straight from Round 19's ledger foundation into the actual
scanning screen and the first working document type (invoice) end to end.

- **`@zxing/browser`** added (same dependency `car-audio-inventory` uses).
- **`src/components/BarcodeScanner.tsx`**: ported from that app's
  `CameraCapture.tsx` — live camera barcode decode plus a "Take photo
  instead" fallback for products with no barcode (photo capture wired to a
  placeholder message this round; AI identification is Phase 4). Adapted
  to this app's UI kit and no-dark-mode styling (the source app supports
  dark mode; this one doesn't).
- **`lookup-product-upc` Edge Function**: ported from that app's
  `/api/lookup/upc` route — UPCitemdb's free trial endpoint, no API key
  needed. Requires only a signed-in user (no shop-membership check — it's
  a pure external lookup, touches no shop-specific rows). Typechecked
  standalone via the project's established Deno-shim workflow.
- **`src/lib/scanCart.ts`**: the pure cart model — scanning/tapping the
  same catalog item twice bumps quantity instead of duplicating the row;
  custom items never merge (two one-off entries aren't guaranteed to be
  "the same thing"). 11 tests, written and passing before any UI wiring.
- **`DataRepository.lookupProductByUpc()`**: local catalog match by UPC/SKU
  first, external Edge Function fallback in production only (demo mode
  never makes the real call, same rule as `runShopifyImport`). A
  successful external match is auto-saved into the catalog with its UPC
  set, so the next scan of that exact barcode is an instant local hit next
  time.
- **Invoices, end to end**: `createInvoice()` (always `'draft'`, never
  touches stock — a draft can be freely abandoned) and `markInvoicePaid()`
  (idempotent; records one `'sale'` stock movement per line item that has
  a real `catalogItemId`, custom lines skipped, reusing Round 19's
  `recordStockMovement`/`apply_stock_movement` path rather than
  duplicating the atomicity logic). Implemented in both `DemoRepository`
  and `SupabaseRepository`.
- **`ScanWorkspacePage.tsx`** (`/app/scan`): the actual scan-to-invoice
  screen — center work area holds the running cart (image/name/brand/
  price, quantity stepper, pencil-to-edit with a draft-string pattern so
  the price input doesn't snap mid-keystroke, remove) while building; side
  panel has the four document-type tiles (only **Invoice** active —
  Quote/Receive inventory/Outgoing order show a "Soon" badge so the
  eventual four-way choice is discoverable without being functional yet).
  Once an invoice is created, the center area swaps to a read-only invoice
  summary that doubles as the print view (`window.print()`, same
  `.no-print` chrome-hiding convention as `QuoteDetailPage`).
- **Navigation**: Scan added to `AppLayout.tsx`'s top nav (positioned right
  after Home) and became the mobile bottom nav's prominent center button
  (previously "New quote," which stays reachable from the Quotes and
  Dashboard pages' own buttons) — matches the user's framing of scanning
  as the app's primary daily workflow. The bottom nav's flanking Home/
  Quotes/Follow-ups/Reports slots were made explicit
  (`bottomFlankItems`, filtered out of `NAV`) rather than relying on
  `slice()` indices that would've silently dropped Reports off mobile
  once Scan was inserted into the main nav array.
- **Bundle size**: `@zxing/browser` alone added ~470kb to the production
  bundle. Fixed by code-splitting `BarcodeScanner` via `React.lazy`/
  `Suspense` inside the Scan page (only loads once the scanner modal
  actually opens) — confirmed via a real build that it lands in its own
  chunk rather than bloating the bundle every page load pays for.

### Verification (this round)
- `npx tsc -b --noEmit`, `npm run lint`, `npm run test -- --run`
  (235/235 across 17 files — 11 new in `scanCart.test.ts`, several more
  invoice/lookup tests in `demoRepository.test.ts`), and `npm run build`
  all clean.
- A Playwright smoke pass against `vite preview` confirmed: Scan is
  reachable from the top nav; manual catalog search adds an item to the
  cart; the quantity stepper works; pencil-editing renames a row; a custom
  one-off item can be added; the document-type panel shows exactly Invoice
  active and the other three "Soon"; creating an invoice locks the cart
  into a read-only Unpaid summary with the payment amount prefilled from
  the total; marking paid flips it to "Paid — Cash"; the print button
  appears once paid; "Start a new scan" resets everything. A separate
  mobile-viewport screenshot confirmed the bottom nav's Scan FAB and that
  Reports/Follow-ups are still reachable (the exact regression risk the
  `bottomFlankItems` refactor above was written to avoid).
- Migration `0011` and the new `lookup-product-upc` function are written
  and ready but **not yet applied/deployed to the live Supabase project**
  — same standing limitation as every prior round (no Supabase CLI/token
  in this session). The shop owner applies/deploys them when ready.

## Round 21 — Hardware scanner as primary input; fix a real scan failure

The user hit a real bug on their live deployment: scanning an item threw
a raw "failed to do edge function"-style error instead of degrading
gracefully. Root cause — `lookup-product-upc` isn't deployed to their live
Supabase project yet (a known, documented gap from last round), and
`lookupProductByUpc()`'s error handling only gracefully handled a
well-formed 404 from the function; any other failure to reach it (which is
exactly what "not deployed yet" produces) fell through to a bare `throw`.
Separately, the user clarified their actual hardware: a laser/CCD barcode
scanner (PC or phone), not the phone camera — camera should be a fallback,
not the primary input.

- **`src/data/supabaseRepository.ts`**: `lookupProductByUpc()` now never
  throws — any failure reaching the Edge Function (not deployed, network
  error, malformed response) degrades to the same `{ source: 'not_found'
  }` a genuine miss produces, logged to the console rather than surfaced
  as an error mid-scan. This is the actual fix for the reported bug; it
  also means the whole scan flow already works end-to-end in production
  today even before the shop owner deploys the Edge Function — barcodes
  just fall through to manual entry until then, which is the correct
  degraded behavior.
- **`src/lib/hardwareScan.ts`** (new): `ScanBuffer` — detects a hardware
  scanner's keyboard-wedge output (a barcode's characters typed a few
  milliseconds apart, then Enter) by buffering keystrokes and timing the
  gaps between them, resetting on any gap slow enough to be a human
  typing. Pure, timestamp-driven, no DOM — 8 tests covering fast/slow
  bursts, too-short buffers, stray modifier keys, and back-to-back scans.
- **`src/lib/useHardwareScanner.ts`** (new): wires `ScanBuffer` to real
  `document`-level `keydown` events, explicitly ignoring any event whose
  target is a real `<input>`/`<textarea>`/`contentEditable` element — so
  it only ever fires when focus isn't already in a field the user is
  legitimately typing into.
- **`ScanWorkspacePage.tsx`**: added a dedicated, always-focused "Scanner
  ready — scan here" input as the primary capture path (a scanner's
  keystrokes land directly in it like any real typing; auto-focuses on
  load, refocuses after every lookup and whenever a new session starts).
  `useHardwareScanner` is wired as a fallback for when focus has drifted
  off that field. The old large "Scan barcode" camera button is now a
  smaller, secondary "Use camera instead."

### Verification (this round)
- `npx tsc -b --noEmit`, `npm run lint`, `npm run test -- --run`
  (243/243 across 18 files — 8 new in `hardwareScan.test.ts`), and `npm
  run build` all clean.
- A Playwright smoke pass simulated real hardware-scanner input (fast
  per-character `keyboard.press` calls + Enter, the same shape a real
  scanner produces) and confirmed: the scan input auto-focuses on load; a
  fast burst there triggers a lookup with no thrown error (exercises the
  exact not-found path the reported bug hit); focus returns to the scan
  input afterward; the same fast-burst pattern is also caught by the
  document-wide fallback when focus is on a heading instead of the input;
  slow (120ms/keystroke) typing into the manual search field is never
  mistaken for a scan; manual search still works normally; "Use camera
  instead" still opens the secondary camera modal.

## Round 22 — Quote-from-scan

The user asked to "complete the quote functionality from the scan page" —
the Quote tile in the side panel's document-type grid had been disabled
("Soon") since Phase 2. Rather than trying to build a full quote (customer
info, tiers, deposit config) on the scan screen itself, this hands the
cart off to the existing, already-good `NewQuotePage` flow — the same
choice already made for "why doesn't invoice creation collect a full
customer record either" (it doesn't need to).

- **`src/lib/scanCart.ts`**: `cartToQuoteItemInputs()` — flattens the cart
  into a quote option's item shape, dropping `catalogItemId`/
  `unitPriceCents`/the local row id (a quote option prices as one lump sum
  at the option level, not per line item — confirmed against `NewQuotePage`'s
  existing item schema before writing this). 2 new tests.
- **`ScanWorkspacePage.tsx`**: the "Quote" tile (previously a static
  disabled div) is now a real button — enabled once the cart has an item,
  calling `navigate('/app/quotes/new', { state: { fromScan: {...} } })`.
  The whole "Turn this into…" tile row now only renders while still
  building (hidden once an invoice exists — the cart's already spoken for).
- **`NewQuotePage.tsx`**: reads `location.state.fromScan`, mirroring the
  existing `duplicateFrom` pre-fill pattern exactly (a second, parallel
  state key rather than overloading that one) — defaults `options` to one
  "Scanned items" option with the cart's items and its subtotal as the
  starting price, customer/vehicle fields left blank for staff to fill in
  normally. A blue banner mirrors the existing "Duplicated from…" one so
  staff know why an option showed up already filled in.

### Verification (this round)
- `npx tsc -b --noEmit`, `npm run lint`, `npm run test -- --run`
  (245/245 across 18 files), and `npm run build` all clean.
- A Playwright smoke pass confirmed: the Quote tile is disabled with an
  empty cart and enables once an item is added; clicking it navigates to
  New Quote with the pre-fill banner showing the right item count; the
  pre-filled option is named "Scanned items," carries the scanned item's
  name, and its price is pre-filled from the cart subtotal; filling in
  customer info and saving completes a real quote end to end.

## Round 23 — Invoice as a real document: polished layout, PDF, email

The user asked to "make a good html/PDF so we can print it out or email
it" for the invoice. The previous invoice view was a plain card — this
round rebuilds it as an actual letterhead-style invoice document and adds
sending a copy by email.

- **`ScanWorkspacePage.tsx`**: `InvoiceSummary` rebuilt into
  `InvoiceDocument` — shop logo-or-name + address/phone with a
  `primaryColor` accent bar (matching `PublicQuotePage`'s branding
  convention), "INVOICE #N" + date + a PAID/UNPAID status badge, an
  optional "Bill to" block, a proper itemized table (item/brand-model,
  qty, unit price, line total), subtotal/total, a paid-amount line once
  paid, and a shop footer. This is both the on-screen view and — via the
  existing `.no-print` convention already used by `QuoteDetailPage` — the
  print/Save-as-PDF output; confirmed with a print-media-emulated
  screenshot that only the invoice remains once the nav/side panel are
  hidden. Added optional "Customer name"/"Customer email" fields once an
  invoice exists, typed at send time rather than a persisted `Customer`
  record (this flow is walk-in/fast by design — a real customer record is
  what `NewQuotePage`'s fuller intake is for) — they populate the Bill To
  block and are the email recipient.
- **`src/lib/invoiceEmailTemplate.ts`** (new): renders the emailed copy.
  Unlike quote emails, which stay short and link out to a public quote
  page, there's no public invoice page — the itemized invoice rides
  directly in the email body, like a real receipt. 7 tests, including an
  HTML-injection check on a customer-typed item name.
- **`send-invoice-email` Edge Function** (new): mirrors `send-quote-email`'s
  auth pattern (verify signed-in user, verify shop membership) but is
  simpler — no template types, no eligibility/follow-up scheduling
  (invoices aren't part of the quote-recovery follow-up sequence), and no
  `email_messages` logging (that table exists specifically to drive/rate-
  limit the quote follow-up sequence, not a general send log). **Reuses
  the already-configured `RESEND_API_KEY`/`EMAIL_FROM` secrets** — unlike
  the AI/voice phases still ahead, this needs no new secret, only
  deploying. Typechecked standalone via the project's Deno-shim workflow.
- **`DataRepository.sendInvoiceEmail()`**: demo mode fakes it
  (`demo_sent`, matching `sendEmail`'s existing demo rule — never a real
  network call); production invokes the Edge Function and unwraps its
  real error message the same way `lookupProductByUpc` and
  `runShopifyImport` already do.

### Verification (this round)
- `npx tsc -b --noEmit`, `npm run lint`, `npm run test -- --run`
  (252/252 across 19 files — 7 new in `invoiceEmailTemplate.test.ts`, 2
  more in `demoRepository.test.ts`), and `npm run build` all clean.
- A Playwright smoke pass confirmed: the polished document renders with
  the INVOICE heading and UNPAID badge, the itemized table shows the
  scanned item, the Email button is disabled until a customer email is
  typed, sending in demo mode reports the fake recipient correctly,
  marking paid flips the badge to "PAID — Cash," and the Bill To section
  reflects the typed customer info. A second pass with print media
  emulated confirmed the nav/side panel disappear entirely and only the
  invoice document remains — what Save-as-PDF would actually produce.
- `send-invoice-email` is written and typechecked but **not yet deployed**
  to the live Supabase project — same standing limitation as every prior
  round's new Edge Functions. No new secret is needed for it, though —
  only `supabase functions deploy send-invoice-email`.

## Round 24 — Product-suggestion autocomplete for manual entry

The user's earlier ask — "I need to be able to type in like 'NA-12F' and
have the software lookup options from the web and show me auto-complete
suggestions" — was the one piece of that message not yet built. This
round closes it out.

- **`lookup-product-suggestions` Edge Function** (new): given a
  partially-typed SKU/model/name, calls Claude with the `web_search` tool
  and a structured (`output_config`/`json_schema`) response — up to 5
  candidate real products, ranked most-likely-match first, each with
  brand/model/name, MSRP if found, a photo URL if found, and a source
  URL. Same underlying technique as `car-audio-inventory`'s
  `/api/lookup/vision` route (Claude + `web_search` + structured output),
  ported for a text query instead of a photo, and called directly over
  HTTPS rather than pulling in `@anthropic-ai/sdk` — this project's Edge
  Functions stay dependency-light (raw `fetch`, same as `send-quote-
  email`'s Resend call), and one call site doesn't justify Deno's npm
  interop. Same "any signed-in user" auth rule as `lookup-product-upc`.
  Typechecked standalone via the project's Deno-shim workflow — clean.
- **`DataRepository.lookupProductSuggestions()`**: demo mode always
  resolves `[]` — no real AI/web-search call, ever, same rule as
  `runShopifyImport`/`lookupProductByUpc`. Production never throws either:
  any failure (function not deployed, missing `ANTHROPIC_API_KEY`, a rate
  limit, a network hiccup) degrades to `[]`, since this powers an
  autocomplete dropdown, not a blocking step in a form.
- **`src/components/ProductSuggestField.tsx`** (new): a reusable text
  input that debounce-searches (600ms, 3-char minimum) and lists results
  in a dropdown (photo, brand/model, name, price) — picking one hands the
  full `ProductSuggestion` back to the caller to fill in. Caught a real
  layout bug writing this round's own smoke test: an absolutely-
  positioned dropdown doesn't push page content down, so it was silently
  overlaying (and swallowing clicks on) the price field sitting directly
  below the name field in the scan workspace's "Add a one-off item" row.
  Fixed by rendering the dropdown in normal document flow instead — it
  now pushes sibling fields down rather than covering them, which is
  correct everywhere this component gets used, not just that one row.
  Wired into two places: the Settings catalog add/edit modal's "Model"
  field (a selection also fills brand/name/price) and the scan
  workspace's one-off-item name field (a selection also carries
  brand/model/image into the cart row via a `customSuggestion` state that
  clears the instant the name is hand-edited again, so a stale match
  never rides along silently).

### Verification (this round)
- `npx tsc -b --noEmit`, `npm run lint`, `npm run test -- --run`
  (255/255 across 19 files — 1 new in `demoRepository.test.ts`), and
  `npm run build` all clean.
- A Playwright smoke pass confirmed: the Settings "Add product" modal's
  Model field is a working `ProductSuggestField` that preserves typed
  text and shows "No matches found." after the debounce settles in demo
  mode (never a real web call, never crashes); a product saved through it
  lists normally; the scan workspace's one-off-item field behaves the
  same way and a one-off item added through it lands in the cart
  correctly — including after the dropdown-overlap layout fix, confirmed
  by the Price field and Add button being reachable and clickable
  immediately below it.
- `lookup-product-suggestions` is written and typechecked but **not yet
  deployed** to the live Supabase project, and needs a secret this
  session cannot set — `ANTHROPIC_API_KEY` is not yet configured anywhere
  in this project. Until both are done, the autocomplete quietly shows
  "No matches found." rather than erroring — the same graceful-
  degradation shape as the barcode lookup before `lookup-product-upc` was
  deployed.

## Round 25 — Universal product resolver, a real quote-tracking bug fix, financing as a CRM signal

A large, explicit "inspect the real repo, then implement" instruction
covering three areas from the product brief: a universal product
resolver (the app's stated main AI priority), correct customer-vs-staff
quote-open tracking (a strict requirement), and financing as a tracked
high-intent signal (the thing that produced this product's first real
$3,245 sale). Landed as three independently verified, committed slices.
Two real, previously-unnoticed bugs were found and fixed along the way —
not hypothesized, confirmed by reading the actual code and reproducing
them.

### Slice 1 — Never-dead-end universal product resolver

- **`resolve-product` Edge Function** (new) replaces the separate
  `lookup-product-upc` and `lookup-product-suggestions` functions (both
  deleted) with one shared, typed resolver: `{kind:'barcode', code}` or
  `{kind:'text', query}` in, ranked `ProductResolutionCandidate[]` out.
  Barcode resolution order: shop's `product_resolution_cache` (migration
  `0012`, new table, shop-scoped) → UPCitemdb → Claude + `web_search`
  using the code as a search hint, with confidence explicitly capped
  unless a source confirms the exact barcode → cache the result either
  way (30-day TTL for barcodes, 7-day for text). Text queries: cache →
  Claude + `web_search`, same technique as before, now shared.
- **`src/lib/productResolver.ts`** (new, pure, unit-tested): barcode/query
  normalization (leading zeros never dropped), `rankCandidates` (exact
  model-token match outranks a higher-confidence generic result),
  `dedupeCandidates` (conservative — exact UPC or exact brand+model only,
  never on name similarity). 11 tests.
- `lookupProductByUpc()`/`lookupProductSuggestions()` keep their exact
  prior return shapes (zero breakage to what shipped in earlier rounds —
  `ProductSuggestField`, `ScanWorkspacePage`'s confident-match path) but
  now delegate to `resolveProduct()` underneath.
- **`ScanWorkspacePage`**: a barcode that misses the local catalog and
  isn't a single confident external match now automatically continues
  into the resolver instead of dead-ending on a toast. Candidates (up to
  what the resolver returns) show in a confirmation modal — image,
  confidence badge, reference price + source, warnings — with separate
  "Add to cart" (fast default) and "Save to catalog & add" (explicit)
  actions. A genuine miss retains the scanned code as a visible hint next
  to "Add a one-off item" instead of discarding it.
- **Real bug found and fixed along the way**: `Input`'s hardcoded base
  `w-full` Tailwind class silently wins over a narrower width passed via
  `className` (a stylesheet-order specificity tie, not a markup-order
  one), which had already made the "Add a one-off item" row's three
  fields stack instead of sitting side by side. This round's own
  Playwright smoke test caught the real consequence: closing the
  suggestion dropdown on an outside click shifted the layout mid-click
  and ate a real click on the "Add" button. Fixed the same way the name
  field was already fixed last round — wrap in a width-constrained div
  instead of trusting the class override.
- Demo mode: a fixed constant (`DEMO_UNRESOLVED_BARCODE`) deterministically
  returns two canned candidates; every other unknown barcode genuinely
  resolves to none — zero network calls either way.
- Docs: `docs/PRODUCT_RESOLVER.md` (new).

### Slice 2 — Fixed a real bug: staff previews were faking customer opens

Confirmed by reading the code, not assumed: `quotes.public_token` was the
*only* token in the system, used both for the actual emailed link and for
`QuoteDetailPage`'s own "Open quote"/"Copy link" staff buttons — same
route, same token. `PublicQuotePage` called `record_public_quote_view()`
unconditionally on first load. A staff member glancing at a quote before
sending it silently flipped it from `emailed` to `viewed` and logged a
fake "customer opened the quote" event, with no way to tell the two
apart.

- `email_messages` (already one row per sent email — no new parallel
  table) gains `delivery_token`, `first_viewed_at`, `view_count`
  (migration `0013`).
- New RPC `record_quote_delivery_view(public_token, delivery_token)` is
  the only thing that can ever record a real view or advance status: must
  match both tokens against one specific *sent* email, skips authenticated
  members of the quote's own shop, idempotent (first view fires one event
  + advances status, repeats just bump the count).
- `send-quote-email` now inserts its `email_messages` row before building
  the link (the subject line never depended on the URL, so this reorder
  was free), reads back the row's real `delivery_token`, and embeds it in
  the actual emailed link. The opt-out link deliberately does not carry
  one.
- `QuoteDetailPage`'s staff links are unchanged — still the bare,
  untokened `publicQuoteUrl()` — structurally incapable of recording a
  view now, not just conventionally discouraged from it.
- The old `record_public_quote_view` RPC is neutered (still callable,
  now a true no-op) rather than deleted; historical `quote_events` rows
  it already wrote are untouched — no retroactive reclassification.
- `QuoteDetailPage`'s email history now shows "Opened {time}" once a real
  view lands.
- Docs: `docs/QUOTE_TRACKING.md` (new).

### Slice 3 — Financing as a real, prominent, tracked CRM signal

`need_financing` already existed as a response type flowing into
`quote_responses`/`quote_events`/`ReportsPage` metrics — the gap was that
it was buried in a 6-choice generic grid, not idempotent server-side, and
invisible to staff until they opened the quote.

- `PublicQuotePage`: `need_financing` pulled out of the generic response
  grid into its own large, one-tap, shop-colored CTA right under the
  priced options. A real "Choose this option" action per option card
  (didn't exist before) feeds the option ID into whichever response gets
  submitted. Confirmation renders right where the customer tapped.
- `submit_public_quote_response` is now idempotent (migration `0014`) —
  a response of the same type within a 2-minute window is treated as the
  same submission, no duplicate row/event, covering a retried request or
  a second tab, not just a client-side disabled button.
- `QuotesPage` list + `QuoteDetailPage` now show a "Needs financing"
  badge/banner whenever the latest response is `need_financing` and the
  quote isn't closed out.
- New `notify-shop-response` Edge Function (reuses the already-configured
  Resend secrets, no new one needed) emails the shop on a high-intent
  response, called fire-and-forget after the customer's own submission
  already succeeded — never blocks or affects their confirmation. A
  30-second replay guard keeps a stale/retried call from re-notifying.
- Deliberately not built this round: quote-to-invoice conversion
  attribution. Real, separate follow-up work — see docs/FINANCING_INTENT.md.

### Verification (this round)

- Baseline before any changes: `tsc -b --noEmit` clean, lint clean,
  255/255 vitest passing — recorded so any later failure could be
  correctly attributed.
- After all three slices: `tsc -b --noEmit` clean, `npm run lint` clean,
  `npx vitest run` **271/271 passing** across 20 files (16 new: 11 in
  `productResolver.test.ts`, 5 net-new/rewritten in
  `PublicQuotePage.test.tsx` covering the exact staff-preview-vs-real-view
  distinction), `npm run build` clean. All three new/modified Edge
  Functions (`resolve-product`, `send-quote-email`, `notify-shop-response`)
  typechecked standalone via the project's Deno-shim workflow.
- Four Playwright smoke passes, each catching real issues before they
  shipped: unknown-barcode → resolver candidates → add-to-cart (7 checks,
  caught and fixed the click-eating layout bug above); staff "Open quote"
  vs. a real emailed delivery link (6 checks, confirmed the exact bug
  from the brief is fixed — bare link changes nothing, the real delivery
  link advances status and records exactly one view even on repeat
  opens); the financing CTA end to end including a real 3-option quote's
  "Choose this option" affordance (6 checks). All four prior rounds'
  smoke scripts (product-suggestions, invoice document) re-run clean
  after each slice — no regressions.
- Not deployed: `resolve-product` and `notify-shop-response` are written,
  typechecked, and ready, but this session has no Supabase deploy access
  (a standing, repeatedly-documented limitation). `ANTHROPIC_API_KEY` is
  still not set anywhere in the live project — until it is, the resolver
  falls back to UPCitemdb-only for barcodes and returns no text
  candidates, gracefully, exactly like every prior AI-dependent feature
  in this codebase.

## Round 26 — Live-deployment fixes, then OpenAI as an alternate AI provider

This round was two parts: closing out live-deployment issues the shop
owner hit after Round 25 shipped, then adding OpenAI as a second AI
provider for the product resolver's web-search fallback.

### Live-deployment fixes

- **Invoice creation was failing in production** ("Could not create the
  invoice. Please try again.") — root-caused to migration
  `0011_inventory_and_documents.sql` (which creates `invoices`,
  `invoice_items`, `stock_movements`, and their triggers/RLS) never
  having been applied to the live database, even though migrations
  `0009`/`0010` had been. Diagnosed via a sequence of targeted
  `information_schema` queries run by the shop owner rather than
  guessing; confirmed fixed once `0011` was applied directly via the
  Supabase SQL Editor (this project's proven deploy path — the CLI's own
  migration ledger has never matched what's actually been applied, a
  standing gap documented in prior rounds).
- **`ScanWorkspacePage.handleCreateInvoice()`** now `console.error`s the
  real thrown error before showing the generic toast — the silent
  `catch { toast(...) }` had made this exact production failure
  undiagnosable from the browser. (Commit `881752f`, landed mid-diagnosis
  before this round's other changes.)

### OpenAI as an alternate AI provider (`resolve-product`)

The shop owner's Anthropic org had a $0 credit balance — every Claude API
call was failing with "credit balance is too low," which `resolveViaClaude`
correctly treats as "found nothing" (never invents a product from a
provider failure) rather than surfacing a scary error mid-scan. That's
correct behavior for a genuine miss, but it also means a billing failure
and a real "nothing found" are indistinguishable from the UI — worth
knowing if this happens again. Rather than requiring the shop to fund
Anthropic specifically, `resolve-product` now supports OpenAI as well:

- **`resolveViaOpenAi(apiKey, prompt, upc)`** (new): calls OpenAI's
  Responses API (`POST /v1/responses`) with the built-in `web_search`
  tool and a strict `text.format` json_schema constraining the final
  message to the exact same `AI_CANDIDATE_SCHEMA` Claude already used —
  the candidate shape is provider-agnostic, so one schema serves both.
  Parses the `message`-type item's `output_text` content part (falling
  back to the API's root-level `output_text` convenience field).
- **`parseAiCandidates(rawText, upc, providerLabel)`** (new, extracted):
  the JSON.parse + confidence-capping + field-mapping logic that used to
  live inside `resolveViaClaude` alone, now shared by both providers so
  the barcode-confirmation confidence cap and warning text apply
  identically regardless of which one answered.
- **`resolveViaAi(prompt, upc)`** (new): the one call site the handler
  uses now — tries `OPENAI_API_KEY` first (the shop owner's ask this
  round), falls back to `ANTHROPIC_API_KEY` if only that's set, returns
  `[]` if neither is set. Replaces two near-duplicated
  `Deno.env.get('ANTHROPIC_API_KEY')` + `resolveViaClaude(...)` blocks
  (barcode branch, text branch) with one call each.
- Verified the exact current OpenAI Responses API request/response shape
  (`tools: [{type:'web_search'}]`, `text.format.type: 'json_schema'` with
  `strict: true`, response `output[].content[].text` for `type:
  'output_text'` items) via web search before writing the integration,
  rather than guessing field names — a wrong tool-type or param name
  would have failed the exact same silent way the Anthropic billing issue
  did (logged server-side, empty candidates to the caller), which is
  exactly the failure mode just spent effort diagnosing.
- `docs/PRODUCT_RESOLVER.md` and `docs/INVENTORY_AND_SCANNING.md`
  (credentials table + three prose mentions) updated: either
  `OPENAI_API_KEY` or `ANTHROPIC_API_KEY` now works, OpenAI preferred if
  both are set, and the docs now call out explicitly that a *funded* key
  is required — a $0 balance degrades exactly like a missing key, so
  check `supabase functions logs resolve-product` before assuming a
  genuine "nothing found."

### Verification

- `tsc -b --noEmit` clean, `npm run lint` clean, `npx vitest run`
  271/271 passing (unchanged — this round touched no client-side logic,
  only the Edge Function and its comments/docs), `npm run build` clean.
  `resolve-product/index.ts` typechecked standalone via the project's
  Deno-shim workflow after the OpenAI addition.
- Not yet deployed by this session (no Supabase CLI access, standing
  limitation): the shop owner needs to `supabase functions deploy
  resolve-product` and set `OPENAI_API_KEY` (or keep/fund
  `ANTHROPIC_API_KEY`) for the new provider path to actually run live.

## Round 27 — Photo/vision lookup, ported from car-audio-inventory

The user pointed at their sister app, `car-audio-inventory` (a working
production Next.js app with a proven photo-lookup flow), and asked for
"same method" applied here. This round ports it — not a from-scratch
design — plus starts diagnosing a separate live report that manual text
search returns nothing even with a funded key.

### Photo lookup (`resolve-product`, `kind: 'photo'`)

- `resolveViaVision(apiKey, imageBase64, mediaType)`: one Claude call —
  the photo as an `image` content block alongside a `web_search`-enabled,
  structured-output prompt — asking for up to 3 ranked candidates through
  the exact same `AI_CANDIDATE_SCHEMA`/`parseAiCandidates` pipeline
  barcode/text already use. Deliberately Claude-only, not OpenAI-preferred
  like barcode/text: this specific image + `web_search` + strict-schema
  combination is what's proven working in `car-audio-inventory`'s
  production vision route; OpenAI Responses API support for the same
  three-way combination isn't confirmed, so it wasn't risked here.
  Documented as a known asymmetry, not silently inconsistent.
- `findOfficialPhotoUrl` + `scrapeProductImages` (ported near-verbatim
  from `car-audio-inventory`'s `src/lib/scrape-photos.ts`): Claude's
  `web_search` tool returns extracted text, not raw HTML, so it can't see
  a product page's photos — a second, narrow Claude call finds the single
  best official product page, then this app fetches that page itself and
  reads its JSON-LD `Product.image` / Open Graph tags. Only runs for the
  top candidate when it didn't already come back with an image — at most
  one extra round trip.
- **Not cached** — `product_resolution_cache`'s `kind` check constraint
  only allows `'barcode'`/`'text'` (adding `'photo'` would need a live
  migration), and a photo is realistically never retaken identically
  anyway. `car-audio-inventory` doesn't cache its vision lookups either.
- `ProductResolveRequest` gained `{ kind: 'photo'; imageBase64; mediaType }`
  in `src/data/repository.ts`; `SupabaseRepository`/`DemoRepository`
  updated (`retainedInput` is the fixed string `'photo'` — there's no
  natural short code/query to echo back). Demo mode deterministically
  "succeeds" with the same canned candidates the fixed unresolved-barcode
  case uses, so the confirmation UI is exercisable without a camera.

### UI (`ScanWorkspacePage.tsx`)

- `handlePhotoCaptured` replaced the "Photo lookup isn't available yet"
  stub with a real call into `resolveProduct({kind:'photo', ...})`,
  reusing the exact same confirmation modal, candidate cards, and
  "Add to cart" / "Save to catalog & add" actions the barcode path
  already had — zero new UI beyond a `resolveKind` state (`'barcode' |
  'photo'`) that swaps the modal's copy ("this barcode isn't in your
  catalog yet" vs. "here's what we identified from the photo").

### Verification

- `tsc -b --noEmit` clean, `npm run lint` clean, `npx vitest run`
  272/272 passing (1 new: demo mode's deterministic photo-candidate
  test), `npm run build` clean. `resolve-product/index.ts` typechecked
  standalone via the Deno-shim workflow.
- New Playwright smoke, `smoke28-photo-lookup.mjs` (7 checks) — the first
  one this project has driven through a **real** simulated camera rather
  than stubbing around it: Chromium launched with
  `--use-fake-device-for-media-stream`/`--use-fake-ui-for-media-stream`
  plus `context.grantPermissions(['camera'])`, so the actual
  `BrowserMultiFormatReader` video element gets a synthetic feed,
  `captureFrameAsJpeg` draws a real frame, and the whole pipeline (photo
  capture → `resolveProduct` → confirmation modal → "Add to cart" → cart)
  runs for real, not mocked. All prior smoke scripts re-run clean
  (`smoke20`, `smoke25`, `smoke26`, `smoke27`) — no regressions.
- Not yet deployed by this session (no Supabase CLI access, standing
  limitation): the shop owner needs to redeploy `resolve-product` for
  this to go live, and confirm `ANTHROPIC_API_KEY` specifically is set
  and funded — photo lookup doesn't fall back to OpenAI.

### Still open: live text-search report

The user separately reported that manual text search ("word search") in
`ProductSuggestField` returns nothing in production even after setting
`OPENAI_API_KEY`. Code review of `ProductSuggestField.tsx` and the
`resolveViaAi`/`resolveViaOpenAi` path found no client-side bug — the
likely causes are the deployed function predating the OpenAI-support
commit (`2c23243`) or the cache still holding empty results from before
the key was set (30-day barcode / 7-day text TTL, same gotcha already
documented). This session has no live Supabase access to confirm
directly; next step is a direct `curl` test against the deployed function
bypassing the UI, still owed to the user as of this entry.

## Round 28 — Photo lookup now tries OpenAI first, matching barcode/text

The user insisted on OpenAI for photo lookup, citing "that's what worked
flawlessly in the car inventory app." Checked the actual source before
building anything: `car-audio-inventory` has zero OpenAI usage anywhere
(`grep -rli openai` across the whole repo — nothing; `package.json` lists
only `@anthropic-ai/sdk`). Its vision route, and everything else AI-
related in that app, runs on Claude. That correction is worth recording,
but it doesn't change what the user actually needs: they've funded
OpenAI, not Anthropic, so photo lookup should run on OpenAI too, same as
barcode/text already does.

- **`resolveViaVisionOpenAi`** (new): the same photo-identification method
  as the Claude version (now `resolveViaVisionClaude`), through OpenAI's
  Responses API instead — `input_image` (base64 data URL, no separate
  mime-type field) + `input_text` + the `web_search` tool + strict
  `text.format` json_schema output, all in one call. Same
  `AI_CANDIDATE_SCHEMA`/`parseAiCandidates` pipeline as every other path
  in this function.
- **`findOfficialPhotoUrlOpenAi`** (new): OpenAI equivalent of the
  official-product-page lookup used to backfill a missing photo, reusing
  the same `scrapeProductImages`/`PAGE_URL_SCHEMA`.
- **`resolveViaVision(imageBase64, mediaType)`** (new dispatcher): same
  OpenAI-preferred, Claude-fallback precedence as `resolveViaAi` — tries
  `OPENAI_API_KEY` first, `ANTHROPIC_API_KEY` if that's unset, `[]` if
  neither is. The handler's `kind === 'photo'` branch now calls this
  instead of hardcoding `ANTHROPIC_API_KEY`.
- **Honestly flagged, not hidden**: this specific three-way combination
  (image input + `web_search` tool + strict json_schema output in one
  Responses API request) isn't explicitly documented as supported by
  OpenAI — each piece is independently documented with no stated
  incompatibility, which is why it was built this way, but it hasn't been
  verified against a real funded key by this session (no API keys here).
  If OpenAI rejects the combination outright, it degrades exactly like
  any other provider failure already in this file: logged via
  `console.error`, empty candidates to the caller, never a broken button.
  Documented in `docs/PRODUCT_RESOLVER.md`'s "Photo lookup" section and
  flagged as a known limitation worth a first-use log check.

### Verification

- `tsc -b --noEmit` clean, `npm run lint` clean, `npx vitest run`
  272/272 passing (unchanged — demo mode, which the tests exercise,
  doesn't touch either provider), `npm run build` clean.
  `resolve-product/index.ts` typechecked standalone via the Deno-shim
  workflow after the rewrite.
- `smoke28-photo-lookup.mjs` re-run clean (7/7) — demo mode's behavior is
  identical either way, so this doesn't newly exercise the OpenAI path,
  but confirms the handler restructuring didn't regress the UI flow.
- Not deployable/testable against a real OpenAI key by this session (no
  Supabase or provider credentials here) — the shop owner needs to
  redeploy `resolve-product` and try a real photo; if it comes back
  empty, `supabase functions logs resolve-product` will show whether
  OpenAI rejected the request shape outright or something else failed.
