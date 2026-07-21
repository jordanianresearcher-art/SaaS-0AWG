# 0Gauge Recovery

Quote-recovery software for independent car-audio shops. A shop employee creates a
professional Good / Better / Insane quote, emails it to the customer, sees when the
quote link is viewed, collects the customer's response, works a simple manual
follow-up queue, and prints a 7/14-day pilot report showing recovered revenue.

Built to be sold in person to family-owned shops: big buttons, plain language,
phone-first layout, and nothing automated behind the owner's back — every email is
sent by a person pressing **Send**.

## Current scope (Phase 1)

- Create quotes with 1–3 options (Good / Better / Insane or a single option)
- Email quotes and manual follow-ups (5 templates) — **email only, no SMS**
- Public quote page at an unguessable link, with customer response buttons
- Quote-view tracking (first meaningful view per browser session)
- Customer responses: book, financing, cheaper option, after payday, question, not interested
- One-click "stop follow-up emails" opt-out, enforced server-side
- Follow-up queue grouped by urgency with suggested next email
- Dashboard: pipeline value, recovered revenue, views, responses, funnel
- Printable 7-day / 14-day pilot report with CSV export
- Full demo mode with a seeded Dallas shop — runs with zero backend
- Multi-tenant Supabase schema with RLS and sanitized public RPCs
- Resend-backed Supabase Edge Function for real email delivery

See [docs/ROADMAP.md](docs/ROADMAP.md) for later phases (System Builder, package
pages, build passport, marketplace — all intentionally not implemented).

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

79 tests cover currency parsing/formatting, quote totals, vehicle formatting,
status transitions (advance-only, terminal protection), follow-up buckets and
sequencing, email template rendering (including HTML escaping and PII exclusion),
send eligibility (permission, opt-out, closed quotes), demo repository
persistence, public-quote sanitization, and a full jsdom walkthrough of the
public quote page (view tracking, response submission, duplicate blocking,
opt-out).

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

## Email-only, on purpose

All electronic delivery and follow-ups are email. Phone numbers are stored for
normal shop records and click-to-call only. SMS is a postponed future decision
(see roadmap) and is deliberately absent from the product and the codebase.

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
