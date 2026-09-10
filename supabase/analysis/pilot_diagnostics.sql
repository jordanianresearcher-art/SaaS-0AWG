-- Pilot diagnostics — the numbers Home doesn't show.
--
-- Read-only. Every statement here is a SELECT; nothing writes, updates, or
-- deletes. Safe to run against the live database during business hours.
--
-- HOW TO USE: paste into the Supabase SQL editor, run each numbered block,
-- and paste the results back to Claude. Block 1 alone answers most of the
-- open questions.
--
-- WHY THIS EXISTS: the Home screen shows 4 of the 12 metrics the app
-- computes, and two of its rows are scoped to *today* while a third is
-- scoped to 60 days. That mix has already produced one wrong diagnosis.
-- These queries go to the source.
--
-- Quote value is deliberately defined the way the app defines it
-- (src/lib/format.ts quoteValueCents): the MAIN option's price, falling back
-- to the first option. It is NOT the sum of options — add-ons are priced as
-- increments on top of the main package. Any query here that computes money
-- must use main_value_cents below, or its numbers will not reconcile with
-- what the dashboard shows.

-- ---------------------------------------------------------------------------
-- BLOCK 1 — Headline diagnostics. One table, paste the whole thing back.
-- ---------------------------------------------------------------------------
with shop as (
  -- One live shop today. If that changes, put its id here instead.
  select id from public.shops where active order by created_at limit 1
),
q as (
  select
    qt.*,
    coalesce(
      (select o.price_cents from public.quote_options o
        where o.quote_id = qt.id and o.option_kind = 'main'
        order by o.position limit 1),
      (select o.price_cents from public.quote_options o
        where o.quote_id = qt.id
        order by o.position limit 1),
      0
    ) as main_value_cents,
    (select min(em.sent_at) from public.email_messages em
      where em.quote_id = qt.id and em.status in ('sent','demo_sent')) as first_email_at,
    (select count(*) from public.email_messages em
      where em.quote_id = qt.id and em.status in ('sent','demo_sent')) as emails_sent,
    (select min(ev.created_at) from public.quote_events ev
      where ev.quote_id = qt.id and ev.event_type = 'marked_won') as won_at,
    (select count(*) from public.quote_events ev
      where ev.quote_id = qt.id and ev.event_type = 'quote_viewed') as view_events,
    (select count(*) from public.quote_responses r where r.quote_id = qt.id) as response_count
  from public.quotes qt
  where qt.shop_id = (select id from shop)
)
select * from (
  select 1 as ord, 'Quotes created (all time)' as metric, count(*)::text as value from q
  union all select 2, 'Quotes created (last 60 days)', count(*)::text from q where created_at >= now() - interval '60 days'
  union all select 3, '— of those, ever emailed', count(*)::text from q where created_at >= now() - interval '60 days' and emails_sent > 0
  union all select 4, '— of those, ever viewed by customer', count(*)::text from q where created_at >= now() - interval '60 days' and view_events > 0
  union all select 5, '— of those, customer responded', count(*)::text from q where created_at >= now() - interval '60 days' and response_count > 0
  union all select 6, '— of those, won', count(*)::text from q where created_at >= now() - interval '60 days' and status = 'won'

  -- THE MISSING DENOMINATOR. Home shows the dollars with no count beside it.
  union all select 10, 'OPEN quotes (count)', count(*)::text from q where status not in ('won','lost','expired')
  union all select 11, 'OPEN quotes (value)', to_char(sum(main_value_cents)/100.0,'FM999,999,990.00') from q where status not in ('won','lost','expired')
  union all select 12, 'OPEN quotes (average value)', to_char(avg(main_value_cents)/100.0,'FM999,999,990.00') from q where status not in ('won','lost','expired')

  -- Disposition: is anything ever closed out? Expect ~0, which is the finding.
  union all select 20, 'Quotes marked LOST (all time)', count(*)::text from q where status = 'lost'
  union all select 21, 'Quotes EXPIRED (all time)', count(*)::text from q where status = 'expired'
  union all select 22, 'Open quotes older than 30 days', count(*)::text from q where status not in ('won','lost','expired') and created_at < now() - interval '30 days'
  union all select 23, 'Value sitting open past 30 days', to_char(coalesce(sum(main_value_cents),0)/100.0,'FM999,999,990.00') from q where status not in ('won','lost','expired') and created_at < now() - interval '30 days'

  -- Did the app touch the deal before it closed, or is it recording wins?
  -- This is the split that decides whether "recovered revenue" survives the
  -- question "no, I closed those on the phone".
  union all select 30, 'Wins where an email went out BEFORE the win', count(*)::text
    from q where status = 'won' and first_email_at is not null and won_at is not null and first_email_at < won_at
  union all select 31, '— their value', to_char(coalesce(sum(main_value_cents),0)/100.0,'FM999,999,990.00')
    from q where status = 'won' and first_email_at is not null and won_at is not null and first_email_at < won_at
  union all select 32, 'Wins with NO email ever sent', count(*)::text
    from q where status = 'won' and first_email_at is null
  union all select 33, 'Wins where the customer had viewed the quote', count(*)::text
    from q where status = 'won' and view_events > 0
  union all select 34, 'Wins where the customer responded in-app', count(*)::text
    from q where status = 'won' and response_count > 0

  -- Speed. If the median is well past 10 days, the cadence ends too early.
  union all select 40, 'Median days, first email -> won', to_char(
      percentile_cont(0.5) within group (order by extract(epoch from (won_at - first_email_at))/86400.0), 'FM990.0')
    from q where status = 'won' and first_email_at is not null and won_at is not null
  union all select 41, 'Longest days, first email -> won', to_char(
      max(extract(epoch from (won_at - first_email_at))/86400.0), 'FM990.0')
    from q where status = 'won' and first_email_at is not null and won_at is not null

  -- Sends. Is the machine actually running?
  union all select 50, 'Emails sent (60d, all types)', count(*)::text
    from public.email_messages em join q on q.id = em.quote_id
    where em.status in ('sent','demo_sent') and em.created_at >= now() - interval '60 days'
  union all select 51, '— sent automatically by the app', count(*)::text
    from public.quote_events ev join q on q.id = ev.quote_id
    where ev.event_type = 'email_sent' and ev.metadata->>'automatic' = 'true'
      and ev.created_at >= now() - interval '60 days'
) t order by ord;

-- ---------------------------------------------------------------------------
-- BLOCK 2 — Open value by age. Tells you whether a longer cadence has
-- anything left to reach, or whether the pile is already cold.
-- ---------------------------------------------------------------------------
with shop as (select id from public.shops where active order by created_at limit 1),
q as (
  select qt.id, qt.status, qt.created_at,
    coalesce((select o.price_cents from public.quote_options o
      where o.quote_id = qt.id and o.option_kind = 'main' order by o.position limit 1),
      (select o.price_cents from public.quote_options o where o.quote_id = qt.id order by o.position limit 1), 0) as main_value_cents
  from public.quotes qt where qt.shop_id = (select id from shop)
)
select
  case
    when created_at >= now() - interval '10 days' then '0-10 days (cadence still running)'
    when created_at >= now() - interval '30 days' then '11-30 days (past cadence)'
    when created_at >= now() - interval '60 days' then '31-60 days (cold)'
    else '60+ days (very cold)'
  end as age_bucket,
  count(*) as open_quotes,
  to_char(sum(main_value_cents)/100.0, 'FM999,999,990.00') as open_value
from q where status not in ('won','lost','expired')
group by 1 order by min(created_at) desc;

-- ---------------------------------------------------------------------------
-- BLOCK 3 — Booking, actually measured over 60 days. Home's appointment row
-- is scoped to TODAY only, so it cannot answer "has anyone ever booked".
-- ---------------------------------------------------------------------------
select
  status,
  source,
  count(*) as appointments,
  count(*) filter (where deposit_paid_at is not null) as deposits_paid,
  count(*) filter (where reminder_sent_at is not null) as reminders_sent
from public.appointments
where shop_id = (select id from public.shops where active order by created_at limit 1)
  and starts_at >= now() - interval '60 days'
group by status, source order by appointments desc;

-- ---------------------------------------------------------------------------
-- BLOCK 4 — What customers actually said, and per-email open behaviour.
-- Migration 0013 gives every sent email its own first_viewed_at / view_count,
-- so opens are attributable to the individual send, not just the quote.
-- CAVEAT: rows written before 0013 shipped include staff previews and were
-- deliberately never reclassified. Treat pre-0013 view counts as inflated.
-- ---------------------------------------------------------------------------
select r.response_type, count(*) as responses
from public.quote_responses r
join public.quotes q on q.id = r.quote_id
where q.shop_id = (select id from public.shops where active order by created_at limit 1)
  and r.created_at >= now() - interval '60 days'
group by 1 order by 2 desc;

select
  em.template_type,
  count(*) as sent,
  count(*) filter (where em.first_viewed_at is not null) as opened,
  round(100.0 * count(*) filter (where em.first_viewed_at is not null) / nullif(count(*),0), 1) as open_pct
from public.email_messages em
join public.quotes q on q.id = em.quote_id
where q.shop_id = (select id from public.shops where active order by created_at limit 1)
  and em.status in ('sent','demo_sent')
  and em.created_at >= now() - interval '60 days'
group by 1 order by sent desc;
