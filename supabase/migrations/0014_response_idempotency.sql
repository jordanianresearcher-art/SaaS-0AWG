-- 0Gauge Recovery — idempotent public quote responses.
--
-- The public quote page's response buttons (including the new prominent
-- "I need financing" CTA — see docs/FINANCING_INTENT.md) must survive a
-- double-click or a retried network request without creating two
-- quote_responses rows and two customer_responded events for what was
-- really one tap. Client-side guards (disabled-while-submitting,
-- sessionStorage) already help, but the trustworthy guarantee has to live
-- server-side: a retry after a timeout, or a second tab, isn't caught by
-- either of those.
--
-- Fix: before inserting, check for a response of the *same type* on this
-- quote within a short window (2 minutes) and treat a match as the same
-- submission — return successfully without inserting again. This is a
-- narrow window deliberately: a customer genuinely changing their mind
-- and picking a different response type is a new response as always
-- (that's a different type, or the same type long after, both still
-- insert normally); only a rapid repeat of the identical answer is
-- deduplicated.

create or replace function public.submit_public_quote_response(
  p_public_token uuid,
  p_response_type text,
  p_option_id uuid default null,
  p_message text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_quote quotes%rowtype;
  v_recent integer;
  v_type quote_response_type;
  v_duplicate integer;
begin
  select * into v_quote from quotes where public_token = p_public_token and status <> 'draft';
  if not found then
    raise exception 'Quote not found';
  end if;

  -- Only approved response values are accepted.
  begin
    v_type := p_response_type::quote_response_type;
  exception when others then
    raise exception 'Invalid response type';
  end;

  if v_type = 'stop_emails' then
    perform public.opt_out_public_quote_email(p_public_token);
    return;
  end if;

  -- The option, if given, must belong to this quote.
  if p_option_id is not null and not exists (
    select 1 from quote_options where id = p_option_id and quote_id = v_quote.id
  ) then
    raise exception 'Invalid option';
  end if;

  -- Idempotency: a repeat of the exact same response type within the last
  -- 2 minutes is treated as the same submission (double-click, a retried
  -- request after a timeout, a second tab) -- succeed without inserting a
  -- duplicate row or event.
  select count(*) into v_duplicate
  from quote_responses
  where quote_id = v_quote.id
    and response_type = v_type
    and created_at > now() - interval '2 minutes';
  if v_duplicate > 0 then
    return;
  end if;

  -- Basic abuse protection: max 5 responses per quote per hour.
  select count(*) into v_recent
  from quote_responses
  where quote_id = v_quote.id and created_at > now() - interval '1 hour';
  if v_recent >= 5 then
    raise exception 'Too many responses. Please call the shop instead.';
  end if;

  insert into quote_responses (quote_id, quote_option_id, response_type, message)
  values (v_quote.id, p_option_id, v_type, nullif(left(coalesce(p_message, ''), 500), ''));

  insert into quote_events (quote_id, event_type, metadata, created_by)
  values (v_quote.id, 'customer_responded', jsonb_build_object('responseType', v_type), null);

  -- Advance-only: never downgrade booked/deposit_paid/won/lost.
  update quotes
  set status = 'responded'
  where id = v_quote.id and status in ('emailed', 'viewed');
end;
$$;
