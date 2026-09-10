-- Is the follow-up engine actually running? Read-only. Two statements.
--
-- Why this exists: all eight won jobs closed while only the initial email had
-- been sent. Not one win followed a check-in, a financing offer, or a final
-- check-in — and 145 of those went out. Either the cadence does not convert,
-- or the cadence is not reaching people. Those need completely different
-- fixes, and only the data separates them.
--
-- Both statements are scoped to whatever shops exist in this database. There
-- is one live shop; if a second is ever added, add `and q.shop_id = '<id>'`.

-- ---------------------------------------------------------------------------
-- 1. The eight wins, with the timing the first query could not show.
--
--    days_to_win        how long the customer took. Under the cadence's first
--                       step (3 days) means no follow-up could have fired —
--                       the win says nothing about the engine either way.
--    emails_before_win  how many emails had actually gone out when it closed.
--    emails_after_win   anything here is the app emailing a customer whose
--                       job is already sold. Automatic sends exclude won
--                       quotes, so a non-zero number is a manual send — or a
--                       bug worth chasing.
-- ---------------------------------------------------------------------------
select
  c.first_name                                                          as who,
  to_char(q.created_at, 'Mon DD')                                       as quoted,
  to_char(ev.won_at, 'Mon DD')                                          as won,
  round(extract(epoch from (ev.won_at - q.created_at)) / 86400)::int     as days_to_win,
  (select count(*) from email_messages e
     where e.quote_id = q.id and e.status in ('sent','demo_sent')
       and coalesce(e.sent_at, e.created_at) < ev.won_at)               as emails_before_win,
  (select count(*) from email_messages e
     where e.quote_id = q.id and e.status in ('sent','demo_sent')
       and coalesce(e.sent_at, e.created_at) >= ev.won_at)              as emails_after_win
from quotes q
join customers c on c.id = q.customer_id
left join lateral (
  select min(created_at) as won_at from quote_events
   where quote_id = q.id and event_type = 'marked_won') ev on true
where q.status = 'won'
order by ev.won_at desc nulls last;

-- ---------------------------------------------------------------------------
-- 2. The quotes still open, by age: are they being followed up at all?
--
--    only_got_the_quote  open quotes that have received exactly one email
--                        ever. An old quote sitting here means the cadence
--                        never ran for it. That is the number that decides
--                        whether the follow-up engine is ineffective or idle.
--    overdue             next_follow_up_at is in the past and nothing sent.
--    no_next_step        next_follow_up_at is null — the quote has fallen out
--                        of the cadence entirely, whether by design (it
--                        finished the sequence) or not.
-- ---------------------------------------------------------------------------
select
  case
    when q.created_at > now() - interval '7 days'  then '1 · this week'
    when q.created_at > now() - interval '14 days' then '2 · 1-2 weeks old'
    when q.created_at > now() - interval '30 days' then '3 · 2-4 weeks old'
    else '4 · over a month old'
  end                                                                   as age,
  count(*)                                                              as open_quotes,
  round(avg(e.sent_count), 1)                                           as avg_emails,
  count(*) filter (where e.sent_count <= 1)                             as only_got_the_quote,
  count(*) filter (where q.next_follow_up_at is not null
                     and q.next_follow_up_at < now())                   as overdue,
  count(*) filter (where q.next_follow_up_at is null)                   as no_next_step
from quotes q
left join lateral (
  select count(*) as sent_count from email_messages m
   where m.quote_id = q.id and m.status in ('sent','demo_sent')) e on true
where q.status in ('emailed', 'viewed', 'responded')
group by 1
order by 1;
