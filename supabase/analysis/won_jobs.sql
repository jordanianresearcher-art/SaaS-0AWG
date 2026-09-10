-- The eight won jobs, one row each. Read-only.
--
-- Paste ONLY this file into the Supabase SQL editor. It is a single statement
-- on purpose: pilot_diagnostics.sql holds five blocks and a dozen statements,
-- and running all of them at once is a good way to make the editor time out
-- ("Failed to fetch" is the browser giving up on api.supabase.com, not a SQL
-- error — the query never ran).
--
-- Columns worth knowing:
--   quote_val / won_for  the main option's price vs what it actually sold for.
--                        A gap is a discount; read it before trusting any
--                        "recovered revenue" total.
--   clicked              emails whose quote link was actually opened. This is
--                        click-through, NOT an email open — there is no
--                        tracking pixel in this app.
--   last_email           the last template sent before the win. Correlation
--                        only: a customer who phoned the shop that morning
--                        looks identical here to one who clicked the link.
--
-- The question this answers: how many of these eight had zero clicks and zero
-- replies? Those are jobs the shop closed on its own and recorded afterwards,
-- and they are the ones that will be challenged at day 30.
--
-- This query still infers that from behaviour, because the eight wins already
-- recorded predate the app ever asking. Migration 0027 adds quotes.win_source
-- so every win from now on carries the answer staff gave at the moment of the
-- sale. Once 0027 is applied, add `q.win_source` to the select list below —
-- inference stops being necessary, and the two can be compared against each
-- other on the same rows.

select
  c.first_name                                   as who,
  to_char(q.created_at,'Mon DD')                 as quoted,
  (o.price_cents/100)                            as quote_val,
  (q.won_amount_cents/100)                       as won_for,
  (select count(*) from email_messages e
     where e.quote_id=q.id and e.status in ('sent','demo_sent'))            as emails,
  (select count(*) from email_messages e
     where e.quote_id=q.id and e.first_viewed_at is not null)               as clicked,
  (select count(*) from quote_responses r where r.quote_id=q.id)            as replied,
  (select e.template_type::text from email_messages e
     where e.quote_id=q.id and e.status in ('sent','demo_sent')
       and e.sent_at < ev.won_at order by e.sent_at desc limit 1)           as last_email
from quotes q
join customers c on c.id = q.customer_id
left join lateral (
  select min(created_at) as won_at from quote_events
   where quote_id=q.id and event_type='marked_won') ev on true
left join lateral (
  select price_cents from quote_options
   where quote_id=q.id order by (option_kind='main') desc, position limit 1) o on true
where q.status='won'
order by ev.won_at desc nulls last;
