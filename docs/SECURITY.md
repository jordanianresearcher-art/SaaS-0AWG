# Security Notes — 0Gauge Recovery

## Tenant isolation

Every private row belongs to a shop (`shop_id`), and every authenticated query is
gated by membership: `is_shop_member(shop_id)` / `is_shop_admin(shop_id)`
(SECURITY DEFINER helpers that check `shop_memberships` for `auth.uid()`).
Users cannot read or write data for shops they don't belong to, even with a
valid session and hand-crafted queries — RLS enforces it at the database layer.

Roles:

- **owner / manager** — everything staff can do, plus shop settings and
  membership management (enforced by `shops_update` / membership policies)
- **staff** — create and manage customers, quotes, options, items, events;
  read email history
- **platform admin** — a role above any shop, held by the person running the
  0Gauge business (see "Platform admin" below). Not a `shop_memberships` role.

## Platform admin

`platform_admins (user_id)` (added in `0002_platform_admin.sql`) identifies
platform admins — the people who onboard new shop tenants. This role has
**no in-app grant path**: the table has a SELECT policy only
(`using (is_platform_admin())`), no insert/update/delete policy for any
role. Granting admin status is a manual, one-time SQL statement run by
whoever administers the Supabase project:

```sql
insert into platform_admins (user_id) select id from auth.users where email = 'you@yourdomain.com';
```

`is_platform_admin()` widens exactly two RLS policies (`shops_select`,
`memberships_select`) to a **read-only** OR condition — platform admins can
see every shop and membership, nothing more. All writes across shops
(creating a shop, inviting its owner, suspending it) go through the
service-role `admin-create-shop` Edge Function and the `admin_list_shops()` /
`admin_set_shop_active()` RPCs, each of which re-checks `is_platform_admin()`
inside the function body. This keeps the cross-shop exception narrow and
auditable instead of a broad service-role hole reachable from the browser.

Shop suspension (`shops.active`) is enforced in the `with check` clause only
of `quotes_all`/`customers_all` — a suspended shop's existing data stays
fully readable (so the owner sees a "suspended" state, not a blank app) while
new/changed quotes and customers are blocked at the database layer. The
`send-quote-email` function independently checks `shop.active` before
sending, so email sending stops immediately on suspension even if a client
never re-fetches shop state.

## Public tokens

Public quote links use `public_token uuid not null unique default
gen_random_uuid()` — 122 bits of randomness, unguessable and unenumerable.
Tokens grant access only through the sanitized RPCs below; they never unlock
table access. Draft quotes are excluded from all public functions.

## Row Level Security

RLS is enabled on every table, including the catalog/package tables added
for the selling-catalog work (`catalog_items`, `package_templates`,
`package_template_items` — see `docs/CATALOG_AND_PACKAGES.md`). Those three
share one more protection beyond plain shop-membership RLS: a product's or
package's `approval_status` can only be changed by an owner/manager,
enforced by a `before update` trigger (`guard_catalog_item_approval` /
`guard_package_template_approval`) since RLS's `USING`/`WITH CHECK`
clauses can't compare a row's old value to its new one on their own.

There are **no anon policies at all** — an
anonymous request that touches a table directly gets zero rows. The only
anonymous surface is four SECURITY DEFINER functions with explicit
`grant execute ... to anon`:

| Function | Behavior |
| --- | --- |
| `get_public_quote(token)` | Returns shop contact info, customer **first name only**, vehicle, options/items, status, expiration. Never: last name, phone, customer email, internal notes, memberships, events metadata, provider IDs. |
| `record_public_quote_view(token)` | Inserts a `quote_viewed` event (capped at 20/quote/hour) and advances `emailed → viewed` only. Silently ignores bad tokens. |
| `submit_public_quote_response(token, type, option, message)` | Validates the response type against the enum allow-list, verifies the option belongs to the quote, caps at 5 responses/quote/hour, truncates messages to 500 chars, advances `emailed/viewed → responded` only. Anonymous users can never set arbitrary quote fields. |
| `opt_out_public_quote_email(token)` | Sets `email_opt_out_at`, disables follow-up, clears the follow-up date. Idempotent; doesn't leak token validity. |

Status changes from public functions are advance-only: a page view can never
downgrade a booked or won quote.

## Edge Function authorization

`send-quote-email` (the only server-side email path):

1. Requires a valid user JWT (`auth.getUser()`)
2. Verifies the caller has a membership in the quote's shop
3. Verifies the quote/customer/shop relationship server-side
4. Enforces contact permission, opt-out, follow-up-allowed, and non-terminal
   status — the same rules as the UI, re-checked server-side
5. Rate-limits: 3 sends per quote per day, 30 per shop per hour
6. Records every attempt (`sending → sent/failed`) in `email_messages`
7. Returns only safe messages — no provider responses, IDs, or stack traces

## Email-key security

`RESEND_API_KEY` exists only as a Supabase Edge Function secret. It is never in
the frontend bundle, `VITE_` variables, or client-reachable responses. The
browser talks to the Edge Function; the Edge Function talks to Resend.

## Customer data

- Stored: name, email, optional phone (click-to-call only — no messaging),
  vehicle, lead source
- The public page and all emails expose the first name only
- Internal notes are never rendered outside the authenticated app
- No PII is written to logs by the app; error messages stored on email rows are
  provider status strings, not customer content

## Contact permission and opt-outs

- Every quote form requires confirming: *"This customer requested a quote and
  the shop is permitted to email them about it"* — stored with a timestamp
- Every email includes a one-click stop-follow-ups link plus the shop's name
  and physical address
- Opt-out is enforced in three places: UI eligibility check, demo repository,
  and the Edge Function — a send to an opted-out customer fails everywhere
- All follow-ups are manual; there is no scheduler that could email someone
  after they opted out

## Rate protection

- Public view recording: 20/quote/hour
- Public responses: 5/quote/hour
- Email sends: 3/quote/day, 30/shop/hour
- Duplicate response submissions are also blocked client-side per browser session

## Production checklist

- [ ] Migrations applied — including `0009_catalog_product_model.sql` and `0010_package_templates.sql`, not yet applied to any live project as of this writing; confirm RLS is enabled on every table (`select * from pg_tables where rowsecurity = false and schemaname = 'public'` returns nothing)
- [ ] Auth redirect URLs restricted to your real domains
- [ ] Magic-link email template branded and sender configured in Supabase Auth
- [ ] `RESEND_API_KEY`, `EMAIL_FROM`, `APP_URL` set as function secrets; sending domain verified in Resend (SPF/DKIM)
- [ ] `EMAIL_FROM` uses the verified domain; reply-to set per shop
- [ ] Anon key (not service role) in frontend env; service-role key nowhere client-side
- [ ] Test as a second user: confirm you cannot read another shop's data
- [ ] Test anonymous: direct table selects return nothing; RPCs return sanitized data only
- [ ] Test opt-out: public link → stop emails → Edge Function refuses the next send
