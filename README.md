# 0Gauge

Shop software for independent car-audio and window-tint shops. Quote a customer,
email it, see when they open it, follow up automatically, book the install, take
a deposit, invoice at the counter, and keep the shelves straight — all from a
phone.

Built to be sold in person to family-owned shops: big buttons, plain language,
phone-first layout, scan-first data entry, and no required fields anywhere.

The product's first real sale came from a customer tapping **"I need
financing"** on a revived quote. That's the shape of the whole thing: make the
next step one tap, and make the shop's own money come back.

## What it does today

**Quotes and recovery**
- One main package plus priced add-ons (the old Good/Better/Insane tiers were
  removed — shops found three full alternatives hard to explain on the phone)
- Drag-and-drop package builder with catalog search that understands plain
  words ("subwoofer 12 inch", "epicenter", "amp")
- Quote emails with product photos, one clear price, and the shop's financing
  links; subject lines written per job type (audio vs tint) and never repeated
  across the follow-up cadence
- Public quote page at an unguessable link, with ranked one-tap responses
- Quote-view tracking that structurally cannot be faked by staff previewing
- **Automatic follow-up emails** that stop the moment a customer replies, books,
  opts out, or the quote expires. The first email is always a human decision;
  everything after it sends itself
- **Tap-to-text**: prefilled `sms:` links so the owner texts from their own
  phone, with the customer's name already written in. No SMS API, no A2P
  registration
- Financing offers per shop, captured by scanning the QR code on the provider's
  counter card

**Booking**
- Staff calendar with one column per bay (capacity here is bays, not people)
- Public self-booking page, and a "Book my install" CTA on any quote
- Double-booking prevented in the database, not just the UI
- Automatic 24-hour reminders — the no-show killer
- Deposits: staff bookings hold the slot immediately, self-serve bookings hold
  it once the deposit is paid

**Inventory and the counter**
- Scan-first item intake: barcode → free UPC database → AI + web search, with a
  photo path for anything unlabeled
- Consistent naming enforced structurally ("Brand Model — Descriptor"), applied
  on write so manual entry, AI resolution, and Shopify import all converge
- Generated codes and 4×6" label printing for products with no barcode
- Shelf-walk stock counting; shared-device access by shop code, no accounts
- Invoices with tax (added or included), discounts, and payment method
  including financed sales

**Reporting**
- Printable pilot report — the instrument that converts a free pilot to paid.
  Recovered revenue, show rate, no-shows, reminders and follow-ups sent
- CSV export

**Throughout**
- Full demo mode with a seeded Dallas shop — runs with zero backend
- Multi-tenant Supabase schema with RLS and sanitized public RPCs
- Resend-backed Edge Functions for all email

## On automation

This app used to promise that every message needed a person to press Send. That
changed for follow-up emails only, because a four-touch cadence never survives a
busy week by hand and that cadence is where the recovered revenue lives.

The current stance, and how to say it to a shop owner:

> **Emails follow up automatically and stop the moment the customer answers or
> opts out. Texts always come from you.**

Sending is deliberately conservative: an allowlist of quote statuses, hard stops
on any customer response, and no automated first contact ever. See
`src/lib/autoFollowUp.ts`.

## Docs

- [docs/PILOT_PLAYBOOK.md](docs/PILOT_PLAYBOOK.md) — how to run and close a pilot
- [docs/MVP_PLAN.md](docs/MVP_PLAN.md) — current build plan
- [docs/CATALOG_AND_PACKAGES.md](docs/CATALOG_AND_PACKAGES.md) — catalog model
- [docs/INVENTORY_AND_SCANNING.md](docs/INVENTORY_AND_SCANNING.md) — scanning
- [docs/QUOTE_TRACKING.md](docs/QUOTE_TRACKING.md) — view tracking and why it's trustworthy
- [docs/FINANCING_INTENT.md](docs/FINANCING_INTENT.md) — why financing is a first-class CTA
- [docs/SECURITY.md](docs/SECURITY.md) — tenant isolation and roles
- [docs/ROADMAP.md](docs/ROADMAP.md) — later phases

## Technology

Vite · React 18 · TypeScript (strict) · React Router · Tailwind CSS v4 ·
React Hook Form + Zod · date-fns · Lucide icons · Supabase (Postgres, Auth,
Edge Functions) · Resend · Vitest + React Testing Library.

The frontend builds to a fully static bundle (deployable on Cloudflare Pages).
No custom Node server. No service-role or Resend keys ever reach the browser.

## Quick start (demo mode — no accounts needed)

```bash
npm install
npm run dev
```

Open http://localhost:5173 and press **Try the Demo**. The demo seeds a fictional
Dallas shop ("Big Tex Audio") with quotes in every state, persists your changes in
localStorage, labels everything "Demo Data", and simulates email sending honestly
(a "Demo email sent" record — never a fake "delivered" claim). Reset the demo from
**Settings → Reset demo data**.

## Environment variables

Copy `.env.example` to `.env`:

| Variable | Purpose |
| --- | --- |
| `VITE_SUPABASE_URL` | Supabase project URL (public) |
| `VITE_SUPABASE_ANON_KEY` | Supabase anon key (public, RLS-protected) |
| `VITE_APP_URL` | Public URL of this app (used in emails/links) |
| `VITE_ENABLE_DEMO_MODE` | `true`/`false` — show demo entry points |

Edge Function secrets live in `supabase/functions/.env.example`:
`RESEND_API_KEY`, `EMAIL_FROM`, `APP_URL`. **`EMAIL_FROM` must use a sender
address/domain verified in Resend** — unverified senders are rejected by the
provider.

## Supabase setup

1. Create a project at https://supabase.com.
2. Apply migrations in order: `supabase db push` (or paste
   `supabase/migrations/0001_init.sql` then `0002_platform_admin.sql` into the
   SQL editor). This creates all tables, enums, indexes, `updated_at`
   triggers, RLS policies, the `create_shop_with_owner` onboarding RPC, the
   platform-admin capability (see below), and the four public
   SECURITY DEFINER RPCs (`get_public_quote`, `record_public_quote_view`,
   `submit_public_quote_response`, `opt_out_public_quote_email`).
3. Optional local dev seed: `supabase db reset` picks up `supabase/seed.sql`.
4. Enable the **Email (magic link)** auth provider. Add your app URL to the
   auth redirect allow-list.
5. Put the project URL + anon key in `.env`.
6. **Required — edit the "Magic Link" email template** (Authentication →
   Email Templates → Magic Link, in the Supabase dashboard). Replace the
   default body's link (`{{ .ConfirmationURL }}`) with:

   ```
   <a href="{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=magiclink">Sign in</a>
   ```

   Both `/login` and `/signup` call `signInWithOtp`, so this one template
   covers both — the app's own `/auth/confirm` page verifies the token only
   after a real tap and then routes a new owner to `/onboarding` or an
   existing one to `/app` on its own. Skipping this step is why a magic link
   can work when clicked from a desktop email client but silently fail from a
   phone: many mail apps and security scanners execute a linked page's JS (or
   fetch the link outright) before a human taps it, which burns Supabase's
   default single-use confirmation URL before the real click happens. See
   `src/pages/AuthConfirmPage.tsx` for the full explanation.

First sign-in walks the owner through `/onboarding`, which calls
`create_shop_with_owner` to create the shop and owner membership atomically.

### Platform admin (multi-shop management)

To manage multiple shop tenants from `/admin` (create new shops, invite their
owners, suspend/reactivate access), grant yourself platform-admin status —
there is deliberately no in-app way to do this. In the Supabase SQL editor:

```sql
insert into platform_admins (user_id) select id from auth.users where email = 'you@yourdomain.com';
```

Sign in with that email, then visit `/admin`. Creating a shop tries to email
the new owner a sign-in link via Resend (reusing the same secrets as
`send-quote-email`); if that fails, the dashboard shows a copyable link
instead. Also deploy the new function:

```bash
supabase functions deploy admin-create-shop
```

## Resend + Edge Function setup

1. Create a Resend account and **verify your sending domain** (or use Resend's
   test sender during evaluation).
2. Set secrets and deploy:

   ```bash
   supabase secrets set RESEND_API_KEY=re_xxx EMAIL_FROM="Your Shop <quotes@yourdomain.com>" APP_URL=https://app.yourdomain.com
   supabase functions deploy send-quote-email
   ```

The function requires a signed-in user, verifies shop membership, checks contact
permission and opt-out, rate-limits sends (3/quote/day, 30/shop/hour), renders the
branded HTML + plain-text email, records the result in `email_messages`, logs a
quote event, and updates `last_emailed_at` / `next_follow_up_at`. If Resend is not
configured the app shows an honest "not configured" notice plus a `mailto:`
fallback — it never fakes a sent state.

## Development commands

```bash
npm run dev        # local dev server
npm run build      # typecheck + production build (static, dist/)
npm run lint       # ESLint, zero warnings allowed
npm run typecheck  # tsc --noEmit
npm run test       # vitest (add -- --run for CI mode)
```

## Testing

`npm test` runs the unit suite (500+ tests). Coverage focuses on the logic
where a bug would be expensive or invisible:

- **Money and scheduling** — currency parsing, quote totals, invoice tax and
  discounts, availability slots (closed days, exceptions, buffers, multi-bay).
- **Anything that emails a customer** — send eligibility (permission, opt-out,
  closed quotes), the automatic follow-up decision rules and every hard stop,
  template rendering including HTML escaping and PII exclusion.
- **Data consistency** — brand/model canonicalization, catalog search
  tokenization, Code 128 encoding and check digits.
- **Both repositories** — demo persistence and public-quote sanitization, plus a
  full jsdom walkthrough of the public quote page (view tracking, response
  submission, duplicate blocking, opt-out).

Playwright smoke scripts run against `vite preview` for the flows that only
break in a real browser.

## Deploying the frontend (Cloudflare Pages)

- Build command: `npm run build`, output directory: `dist`
- `wrangler.jsonc` at the repo root configures SPA routing (`assets.not_found_handling: "single-page-application"`) — Cloudflare's newer unified Workers/Pages deploy pipeline rejects the classic `_redirects` catch-all (`/* /index.html 200`) as an infinite-loop rule, so this is the modern equivalent
- Set the `VITE_*` environment variables in the Pages project
- Deploy the Edge Function separately via the Supabase CLI (see above)

## Security model (summary — details in [docs/SECURITY.md](docs/SECURITY.md))

- RLS on every table; users only reach shops they belong to
- Staff manage quotes/customers; only owners/managers change shop settings
- Anonymous customers touch **only** sanitized SECURITY DEFINER RPCs — never a
  last name, phone, email, internal note, membership, or provider message ID
- Public tokens are random UUIDs; draft quotes are never publicly visible
- Response values are validated against an allow-list server-side
- The Resend key exists only in Edge Function secrets

## No SMS API, on purpose

All automated delivery is email. There is no SMS provider integration and no
server ever sends a text.

Texting still happens — it's just done by a person. Quote rows and appointments
render `sms:` links with the message and the customer's name already written, so
the owner taps once and sends from their own phone (`src/lib/sms.ts`).

Two reasons, in order of weight. First, A2P 10DLC campaign registration is a
weeks-long per-shop compliance process at *every* US provider, not a Twilio
quirk — it would sit between a pilot shop and their first message. Second, a
text from the number the customer already has in their contacts lands better
than one from a shortcode.

The tradeoff is honest: the app can never confirm a text was actually sent, so
nothing is recorded when one of those links is tapped. Revisit only when a shop
asks for genuinely *automated* texting and the revenue justifies the paperwork.

## Known limitations

- Production mode requires a configured Supabase project; this repo ships the
  SQL and code but no hosted backend
- Quote-view tracking is link-based (no email open tracking — that's a feature:
  we don't claim provider acceptance means "read")
- One shop per staff/owner user in the UI (a platform admin can now manage
  many shops from `/admin`, but a shop owner still belongs to just one)
- New shop owners invited via `/admin` skip onboarding and land with blank
  phone/address/logo — they fill it in from Settings
- No pagination yet (fine for pilot-scale data)
- Bundle is a single chunk (~180 KB gzipped); code-splitting is future polish
- `expired` status exists but nothing auto-expires quotes yet
- Recovery Score/milestones are presentation-layer gamification over the same
  numbers already in the pilot report — they never alter the underlying figures
