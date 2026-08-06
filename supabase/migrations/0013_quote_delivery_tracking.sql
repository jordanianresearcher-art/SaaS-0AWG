-- 0Gauge Recovery — trustworthy quote-open tracking.
--
-- Fixes a real bug: staff previewing a quote from the dashboard ("Open
-- quote" / "Copy link" in QuoteDetailPage) used the exact same
-- quotes.public_token and exact same /q/:publicToken route as the emailed
-- link, and PublicQuotePage called record_public_quote_view() unconditionally
-- on first load — so a staff preview silently flipped the quote's status
-- from 'emailed' to 'viewed' and logged a fake "customer opened the quote"
-- event. There was no way to tell a staff open from a real customer open.
--
-- Fix: email_messages already *is* one delivery record per quote email
-- (see migration 0001) — this adds a distinct, opaque delivery_token to
-- each row (separate from quotes.public_token) and a new, trusted RPC that
-- only advances status/records a real view when a caller presents BOTH a
-- valid public_token AND the matching delivery_token from that specific
-- sent email. The emailed link is the only place that token appears
-- (embedded server-side, in send-quote-email) — the bare public_token link
-- staff use for "Open quote"/"Copy link" never carries one, so those opens
-- record nothing, by construction, not by trusting client-side intent.

alter table public.email_messages
  add column delivery_token uuid not null default gen_random_uuid(),
  -- Idempotency marker: null until the first genuine customer view via
  -- this specific delivery's token. Once set, a repeat open only bumps
  -- view_count, never re-fires the quote_viewed event or re-advances status.
  add column first_viewed_at timestamptz,
  add column view_count integer not null default 0;

-- Each shop member can already read their own shop's email_messages rows
-- (existing email_messages_select policy) -- delivery_token/first_viewed_at/
-- view_count ride along under that same policy, no RLS change needed.
-- (Recipient email is already visible to shop members there too; nothing
-- new is exposed publicly -- the anon RPC below never returns this table's
-- contents, only accepts a token to validate against it.)

create index email_messages_delivery_token_idx on public.email_messages (delivery_token);

-- ---------------------------------------------------------------------------
-- The trustworthy view-recording RPC. Anonymous, but only ever does
-- anything when the caller presents a real (public_token, delivery_token)
-- pair that matches one specific *sent* email for one specific quote.
-- ---------------------------------------------------------------------------

create or replace function public.record_quote_delivery_view(
  p_public_token uuid,
  p_delivery_token uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_quote quotes%rowtype;
  v_email email_messages%rowtype;
begin
  select * into v_quote from quotes where public_token = p_public_token and status <> 'draft';
  if not found then
    return; -- silently ignore bad tokens; do not leak existence
  end if;

  -- An authenticated member of this quote's own shop opening the emailed
  -- link (e.g. testing it, or genuinely logged in on their phone) is not a
  -- customer view. Anonymous visitors (auth.uid() is null) fall through
  -- normally -- this is the common, expected case for a real customer.
  if auth.uid() is not null and public.is_shop_member(v_quote.shop_id) then
    return;
  end if;

  select * into v_email
  from email_messages
  where quote_id = v_quote.id
    and delivery_token = p_delivery_token
    and status in ('sent', 'demo_sent');
  if not found then
    return; -- token doesn't match a real sent email for this quote
  end if;

  if v_email.first_viewed_at is null then
    update email_messages
    set first_viewed_at = now(), view_count = view_count + 1
    where id = v_email.id;

    insert into quote_events (quote_id, event_type, metadata, created_by)
    values (v_quote.id, 'quote_viewed', jsonb_build_object('source', 'email_delivery'), null);

    -- Advance-only status change: viewed only upgrades draft/emailed, same
    -- rule the old (now-neutered) record_public_quote_view used.
    update quotes
    set status = 'viewed'
    where id = v_quote.id and status = 'emailed';
  else
    -- Repeat open of the same delivered link: dedup at the "first view"
    -- level (no duplicate event, no duplicate status transition), but the
    -- count is still honest for anyone who wants it.
    update email_messages
    set view_count = view_count + 1
    where id = v_email.id;
  end if;
end;
$$;

grant execute on function public.record_quote_delivery_view to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Neuter the old, bare-token RPC. It's no longer called anywhere in the
-- app (PublicQuotePage only calls record_quote_delivery_view now, and only
-- when a delivery token is present in the URL) -- this is defense in depth
-- for any stale cached client build or direct API call during a deploy
-- transition. It becomes a true no-op: still callable (doesn't error), but
-- never records an event or changes a quote's status again. Historical
-- quote_events rows it already wrote (including ones from staff previews,
-- before this fix) are NOT deleted or reclassified -- see
-- docs/QUOTE_TRACKING.md for why guessing at retroactive reclassification
-- is worse than leaving them be.
create or replace function public.record_public_quote_view(p_public_token uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Intentionally does nothing. Kept only so any code path still calling
  -- this (there shouldn't be any after this round) fails safe instead of
  -- erroring, and so it's obvious from the source why it's inert.
  perform p_public_token;
end;
$$;
