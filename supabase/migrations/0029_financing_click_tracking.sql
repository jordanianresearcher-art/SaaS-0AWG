-- 0029: record it when a customer taps a financing application.
--
-- The shop reported customers "opening quotes and starting on finance" with
-- nothing to show for it, and they were right: nothing in this app has ever
-- recorded a financing click. The buttons are plain links to Snap and Acima,
-- the customer leaves, and the shop finds out only if the provider calls them.
--
-- That gap is worse than it looks. Over the pilot the financing email has the
-- worst click-through of the four templates (6.0% against the first email's
-- 22.5%), and it is simultaneously the only mechanism with a documented win
-- behind it. Judging it on email clicks alone measures the wrong end: the
-- question is how many people reach an application, not how many open an
-- email about one.
--
-- Stored as a quote_event rather than its own table. It is one fact with a
-- timestamp and a name attached, the activity feed already reads events, and
-- a table would need its own RLS, its own index and its own query for no gain.

create or replace function public.record_financing_click(p_public_token uuid, p_offer_name text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_quote quotes%rowtype;
  v_offer text;
  v_recent integer;
begin
  select * into v_quote from quotes where public_token = p_public_token and status <> 'draft';
  if not found then
    -- Silent. This is fired from an anchor the customer is already following;
    -- there is no UI that could show them an error and nothing they could do
    -- about one. Losing the record is strictly better than delaying the tap.
    return;
  end if;

  v_offer := left(btrim(coalesce(p_offer_name, '')), 120);
  if v_offer = '' then
    v_offer := 'Financing';
  end if;

  -- One record per offer per quote per hour. Someone comparing two providers,
  -- or bouncing back to re-read the quote, is one intent — and an activity
  -- feed that says "clicked Snap Finance" nine times buries the other nine
  -- customers who did it once.
  select count(*) into v_recent
    from quote_events
   where quote_id = v_quote.id
     and event_type = 'financing_clicked'
     and metadata->>'offer' = v_offer
     and created_at > now() - interval '1 hour';
  if v_recent > 0 then
    return;
  end if;

  insert into quote_events (quote_id, event_type, metadata)
  values (v_quote.id, 'financing_clicked', jsonb_build_object('offer', v_offer));
end;
$$;

grant execute on function public.record_financing_click to anon, authenticated;

-- The activity feed asks "what happened lately across every quote in this
-- shop", which reads quote_events by time with no quote_id to narrow on.
create index if not exists quote_events_recent_idx on public.quote_events (created_at desc);

notify pgrst, 'reload schema';
