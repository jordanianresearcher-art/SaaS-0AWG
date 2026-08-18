-- 0023: automatic quote follow-up emails.
--
-- Until now every follow-up email needed a human to press Send. That was a
-- deliberate trust stance, but in practice the shop owner answers their own
-- phone and a 4-touch cadence never survives a busy week by hand — which is
-- exactly where the recovered revenue lives. Follow-up emails now send
-- themselves; SMS stays manual (tap-to-text from the owner's own phone).
--
-- Two things are added:
--   1. A per-shop off switch (on by default — a pilot shop should get the
--      benefit without configuring anything).
--   2. A "who is due right now" RPC the scheduled Edge Function calls. The
--      eligibility rules live in the function rather than in the query so the
--      logic sits in one readable place next to src/lib/autoFollowUp.ts, which
--      mirrors it for the UI.
--
-- Note on the per-quote pause: quotes.email_follow_up_allowed already exists
-- (0001) and already blocks manual sends. It now doubles as the per-quote
-- pause for automation, so no new column is needed there.

alter table public.shops
  add column auto_follow_up_enabled boolean not null default true;

comment on column public.shops.auto_follow_up_enabled is
  'When true, due follow-up emails send automatically. Per-quote pause is quotes.email_follow_up_allowed.';

-- ---------------------------------------------------------------------------
-- list_due_follow_ups: everything the scheduled sender needs to decide and
-- send, in one round trip.
--
-- SECURITY DEFINER because the scheduled Edge Function runs with the service
-- role and has no shop membership. It is revoked from anon/authenticated —
-- nothing in the browser may call it.
--
-- Deliberately returns *candidates*, not a final verdict: the coarse filters
-- that a query does well (due date, shop switch, opt-out, permission) run here
-- to keep the result set small, and the full rule set — including the sequence
-- position — is applied in the function. p_limit caps a single run so one
-- backlogged shop cannot exhaust the Resend rate limit in one burst.
-- ---------------------------------------------------------------------------

create or replace function public.list_due_follow_ups(p_limit integer default 100)
returns table (
  quote_id uuid,
  shop_id uuid,
  status quote_status,
  next_follow_up_at timestamptz,
  email_follow_up_allowed boolean,
  expiration_date date,
  customer_email text,
  customer_email_permission_confirmed boolean,
  customer_opted_out_at timestamptz,
  has_customer_response boolean,
  sent_templates text[]
)
language sql
security definer
set search_path = public
stable
as $$
  select
    q.id,
    q.shop_id,
    q.status,
    q.next_follow_up_at,
    q.email_follow_up_allowed,
    q.expiration_date,
    c.email,
    c.email_contact_permission_confirmed,
    c.email_opt_out_at,
    exists (select 1 from quote_responses r where r.quote_id = q.id),
    coalesce((
      select array_agg(distinct m.template_type::text)
      from email_messages m
      where m.quote_id = q.id and m.status in ('sent', 'demo_sent')
    ), '{}')
  from quotes q
  join customers c on c.id = q.customer_id
  join shops s on s.id = q.shop_id
  where s.auto_follow_up_enabled
    and s.active
    and q.email_follow_up_allowed
    and q.next_follow_up_at is not null
    and q.next_follow_up_at <= now()
    -- Mirrors AUTO_SENDABLE_STATUSES in src/lib/autoFollowUp.ts: only a quote
    -- that is out and quiet. Booked/deposit_paid/won/lost/expired/draft never
    -- get an automatic nudge.
    and q.status in ('emailed', 'viewed')
    and c.email is not null
    and c.email_contact_permission_confirmed
    and c.email_opt_out_at is null
  order by q.next_follow_up_at asc
  limit greatest(1, least(coalesce(p_limit, 100), 500));
$$;

revoke execute on function public.list_due_follow_ups(integer) from public, anon, authenticated;

-- New column — PostgREST caches the schema and will 400 on
-- auto_follow_up_enabled until it is told to look again.
notify pgrst, 'reload schema';
