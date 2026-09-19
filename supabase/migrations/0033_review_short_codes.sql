-- 0033: a review link a person can read, and one that stops working.
--
-- What the shop received on their own phone, and reacted to:
--
--   https://app.supercaraudio.com/r/55e0dab8-2f53-491b-825f-20f2ca870614
--
-- Thirty-six characters of hex wrapping across four lines of a text message.
-- It reads as a phishing link, and a customer deciding in half a second
-- whether to tap is exactly who that matters to. A short code fits on one
-- line and looks like something a shop sent.
--
-- The second change: a rated link is finished. The shop asked for it and it
-- is right — a review ask is one question to one person at one moment, and a
-- link that keeps answering forever is a link that gets forwarded, screenshot
-- and re-rated.

-- Deliberately not base64 and not hex. No i, l, o, 0 or 1, because this gets
-- read aloud across a counter and typed by hand when a text does not arrive.
-- 31 symbols over 8 places is about 850 billion codes, which against a
-- one-per-hour-per-shop realistic guess rate is not a lane worth attacking —
-- and a correct guess buys nothing but the ability to rate a stranger's
-- receipt.
create or replace function public.gen_review_code()
returns text
language plpgsql
volatile
set search_path = public
as $$
declare
  v_code text;
begin
  loop
    select string_agg(substr('abcdefghjkmnpqrstuvwxyz23456789', floor(random() * 31)::int + 1, 1), '')
      into v_code
      from generate_series(1, 8);
    exit when not exists (select 1 from review_requests where short_code = v_code);
  end loop;
  return v_code;
end;
$$;

alter table public.review_requests
  add column short_code text not null default public.gen_review_code(),
  -- Stamped the moment a star is tapped. The link answers nothing afterwards.
  add column closed_at timestamptz;

create unique index review_requests_short_code_idx on public.review_requests (short_code);

comment on column public.review_requests.short_code is
  'What goes in the texted link (/r/<code>). Short enough to read on one line; see 0033.';
comment on column public.review_requests.closed_at is
  'When a star was tapped. A closed link shows a thank-you and nothing else.';

-- ---------------------------------------------------------------------------
-- The three public functions now take a code as text and accept EITHER form.
--
-- Links already sitting in customers' phones carry the old uuid, and those
-- people have done nothing wrong. Matching both costs one OR and keeps every
-- text already sent working.
-- ---------------------------------------------------------------------------
drop function if exists public.get_public_review_request(uuid);
drop function if exists public.submit_review_rating(uuid, smallint);
drop function if exists public.submit_review_feedback(uuid, text);

create or replace function public.find_review_request(p_code text)
returns review_requests
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_needle text := lower(btrim(coalesce(p_code, '')));
  v_req review_requests%rowtype;
begin
  -- Two lookups rather than one OR, for two reasons. The short code is
  -- indexed and is what almost every link carries, so it is tried first. And
  -- nothing here ever casts the INPUT to uuid: Postgres does not short-circuit
  -- OR, so `p_code::uuid` guarded by a regex still ran against an 8-character
  -- code and threw. Casting the column is safe; casting user input is not.
  select * into v_req from review_requests where short_code = v_needle limit 1;
  if found then
    return v_req;
  end if;
  select * into v_req from review_requests where public_token::text = v_needle limit 1;
  return v_req;
end;
$$;

create or replace function public.get_public_review_request(p_code text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_req review_requests%rowtype;
  v_shop shops%rowtype;
begin
  v_req := public.find_review_request(p_code);
  if v_req.id is null then
    return null;
  end if;
  select * into v_shop from shops where id = v_req.shop_id;
  if not found or not v_shop.active then
    return null;
  end if;

  -- A closed link is still worth opening: it says thank you. But it records
  -- nothing more, so the open count stops telling the shop a story that is
  -- over.
  if v_req.closed_at is null then
    update review_requests
       set first_opened_at = coalesce(first_opened_at, now()),
           open_count = open_count + 1
     where id = v_req.id
    returning * into v_req;
  end if;

  return jsonb_build_object(
    'shopName', v_shop.name,
    'shopLogoUrl', v_shop.logo_url,
    'shopPrimaryColor', v_shop.primary_color,
    'shopPhone', v_shop.phone,
    'customerName', v_req.customer_name,
    'rating', v_req.rating,
    'lastRating', v_req.last_rating,
    'feedback', v_req.feedback,
    'redirectBlocked', v_req.redirect_blocked,
    'closed', (v_req.closed_at is not null),
    'gateEnabled', v_shop.review_gate_enabled,
    'reviewLink', case when v_req.redirect_blocked then null else v_shop.review_link end
  );
end;
$$;

create or replace function public.submit_review_rating(p_code text, p_rating smallint)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_req review_requests%rowtype;
  v_shop shops%rowtype;
  v_link text;
  v_redirect text;
begin
  v_req := public.find_review_request(p_code);
  if v_req.id is null then
    raise exception 'Review request not found';
  end if;
  if p_rating is null or p_rating < 1 or p_rating > 5 then
    raise exception 'Rating must be 1 to 5';
  end if;

  -- One question, one answer. A tapped link is done, and re-tapping cannot
  -- reopen the public review path for someone who already rated low.
  if v_req.closed_at is not null then
    return jsonb_build_object('redirectTo', null, 'showFeedback', false, 'redirectBlocked', v_req.redirect_blocked, 'closed', true);
  end if;

  select * into v_shop from shops where id = v_req.shop_id;
  v_link := nullif(btrim(coalesce(v_shop.review_link, '')), '');

  update review_requests
     set rating = coalesce(rating, p_rating),
         rated_at = coalesce(rated_at, now()),
         last_rating = p_rating,
         rating_attempts = rating_attempts + 1,
         closed_at = now(),
         redirect_blocked = redirect_blocked or (v_shop.review_gate_enabled and p_rating < 5)
   where id = v_req.id
  returning * into v_req;

  if v_req.redirect_blocked then
    v_redirect := null;
  elsif not v_shop.review_gate_enabled then
    v_redirect := v_link;
  elsif p_rating >= 5 then
    v_redirect := v_link;
  else
    v_redirect := null;
  end if;

  if v_redirect is not null then
    update review_requests set redirected_at = coalesce(redirected_at, now()) where id = v_req.id;
  end if;

  return jsonb_build_object(
    'redirectTo', v_redirect,
    'showFeedback', (v_redirect is null or not v_shop.review_gate_enabled),
    'redirectBlocked', v_req.redirect_blocked,
    'closed', true
  );
end;
$$;

create or replace function public.submit_review_feedback(p_code text, p_feedback text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_req review_requests%rowtype;
  v_body text;
begin
  v_req := public.find_review_request(p_code);
  if v_req.id is null then
    return;
  end if;
  v_body := btrim(coalesce(p_feedback, ''));
  if v_body = '' then
    return;
  end if;
  -- Accepted for an hour after the star tap, which is the session the person
  -- is still in. Closing the link the instant they rate would throw away the
  -- sentence the shop most wants — they tapped two, then started typing.
  if v_req.closed_at is not null and v_req.closed_at < now() - interval '1 hour' then
    return;
  end if;
  update review_requests
     set feedback = left(v_body, 4000),
         feedback_at = now()
   where id = v_req.id;
end;
$$;

grant execute on function public.find_review_request to anon, authenticated;
grant execute on function public.get_public_review_request(text) to anon, authenticated;
grant execute on function public.submit_review_rating(text, smallint) to anon, authenticated;
grant execute on function public.submit_review_feedback(text, text) to anon, authenticated;

-- The intake RPC hands the page a link to text; it must hand back the short
-- one now.
create or replace function public.create_review_intake_request(
  p_intake_token uuid,
  p_phone text,
  p_customer_name text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_shop shops%rowtype;
  v_digits text;
  v_recent integer;
  v_code text;
begin
  select * into v_shop from shops where review_intake_token = p_intake_token and active;
  if not found then
    raise exception 'This shortcut is no longer valid. Ask the shop for a new link.';
  end if;

  v_digits := regexp_replace(coalesce(p_phone, ''), '\D', '', 'g');
  if length(v_digits) = 11 and left(v_digits, 1) = '1' then
    v_digits := substr(v_digits, 2);
  end if;
  if length(v_digits) < 7 then
    raise exception 'That number cannot be texted. Check the digits and try again.';
  end if;

  select count(*) into v_recent
    from review_requests
   where shop_id = v_shop.id and created_at > now() - interval '1 hour';
  if v_recent >= 60 then
    raise exception 'Too many requests in the last hour. Try again shortly.';
  end if;

  insert into review_requests (shop_id, phone, customer_name, handed_to_phone_at)
  values (v_shop.id, v_digits, nullif(btrim(coalesce(p_customer_name, '')), ''), now())
  returning short_code into v_code;

  return jsonb_build_object('shortCode', v_code, 'phone', v_digits, 'shopName', v_shop.name);
end;
$$;

grant execute on function public.create_review_intake_request to anon, authenticated;

notify pgrst, 'reload schema';
