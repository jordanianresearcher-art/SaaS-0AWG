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
