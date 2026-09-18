-- 0031: a review-ask page that needs no login.
--
-- The shop wants this on a phone's home screen: tap the icon, type the number
-- the customer just read off their card, tap once. A login screen in front of
-- that is the difference between doing it every time and doing it never.
--
-- "Public" here means "no account", not "no credential". The URL carries a
-- per-shop token that is the credential, the same way the quote and review
-- links already work. Anyone holding it can raise a review request for this
-- shop and nothing else — they cannot read the shop's data, see who else was
-- asked, or reach any other table. The blast radius of a leaked token is junk
-- rows in one shop's review list, and the shop can invalidate every copy of it
-- from Settings in one tap.
--
-- Note what this page still cannot do: send a text. The SMS link opens the
-- phone's own messaging app, so a stranger with the token can create records
-- but cannot make this shop's phone message anybody.

alter table public.shops
  add column review_intake_token uuid not null default gen_random_uuid();

comment on column public.shops.review_intake_token is
  'Credential in the no-login review intake URL (/ask/<token>). Rotate from Settings to invalidate every saved shortcut.';

create unique index shops_review_intake_token_idx on public.shops (review_intake_token);

-- ---------------------------------------------------------------------------
-- get_review_intake_shop: just enough to render the page and prove the token
-- points somewhere real.
--
-- Deliberately returns nothing but the shop's public identity. A token that
-- leaks must not become a way to read the shop's phone list.
-- ---------------------------------------------------------------------------
create or replace function public.get_review_intake_shop(p_intake_token uuid)
returns jsonb
language sql
security definer
set search_path = public
stable
as $$
  select jsonb_build_object(
    'shopName', s.name,
    'shopLogoUrl', s.logo_url,
    'shopPrimaryColor', s.primary_color
  )
  from shops s
  where s.review_intake_token = p_intake_token and s.active;
$$;

grant execute on function public.get_review_intake_shop to anon, authenticated;

-- ---------------------------------------------------------------------------
-- create_review_intake_request: raise the ask, hand back the link to text.
--
-- Returns the new request's public_token so the page can build the sms: URL
-- without a second round trip — the staff member is standing at a counter and
-- every wait is a reason not to bother next time.
-- ---------------------------------------------------------------------------
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
  v_token uuid;
begin
  select * into v_shop from shops where review_intake_token = p_intake_token and active;
  if not found then
    raise exception 'This shortcut is no longer valid. Ask the shop for a new link.';
  end if;

  -- Digits only, US country code dropped — mirrors normalizePhoneForSms in
  -- src/lib/sms.ts, which is what builds the link the browser then opens.
  v_digits := regexp_replace(coalesce(p_phone, ''), '\D', '', 'g');
  if length(v_digits) = 11 and left(v_digits, 1) = '1' then
    v_digits := substr(v_digits, 2);
  end if;
  if length(v_digits) < 7 then
    raise exception 'That number cannot be texted. Check the digits and try again.';
  end if;

  -- A busy shop asks a few dozen people a day, not hundreds. This is the only
  -- thing standing between a leaked shortcut and a junk-filled review list.
  select count(*) into v_recent
    from review_requests
   where shop_id = v_shop.id and created_at > now() - interval '1 hour';
  if v_recent >= 60 then
    raise exception 'Too many requests in the last hour. Try again shortly.';
  end if;

  insert into review_requests (shop_id, phone, customer_name, handed_to_phone_at)
  values (v_shop.id, v_digits, nullif(btrim(coalesce(p_customer_name, '')), ''), now())
  returning public_token into v_token;

  return jsonb_build_object('publicToken', v_token, 'phone', v_digits, 'shopName', v_shop.name);
end;
$$;

grant execute on function public.create_review_intake_request to anon, authenticated;

-- ---------------------------------------------------------------------------
-- rotate_review_intake_token: the "someone saw my phone" button.
-- ---------------------------------------------------------------------------
create or replace function public.rotate_review_intake_token(p_shop_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_token uuid;
begin
  if not public.is_shop_admin(p_shop_id) then
    raise exception 'Not allowed';
  end if;
  update shops set review_intake_token = gen_random_uuid()
   where id = p_shop_id
  returning review_intake_token into v_token;
  return v_token;
end;
$$;

revoke execute on function public.rotate_review_intake_token(uuid) from public, anon;
grant execute on function public.rotate_review_intake_token to authenticated;

notify pgrst, 'reload schema';
