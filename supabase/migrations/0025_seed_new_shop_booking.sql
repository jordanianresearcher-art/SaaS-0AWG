-- 0025: a brand-new shop can book an appointment on day one.
--
-- The bug this fixes: create_shop_with_owner (migration 0004) inserts a row
-- into `shops` and `shop_memberships` and stops there. Migration 0021 added
-- services / bays / business_hours and backfilled business hours for shops that
-- existed *at that moment* — it never touched the creation RPC. So every shop
-- created since gets zero bays, zero services, and zero business hours.
--
-- The result was a dead end the owner hit in live testing: the calendar's "Add
-- appointment" modal shows a required Services field with nothing in it, the
-- time picker stays hidden (it is gated on a non-zero duration), and Save
-- refuses with "Pick at least one service" — a demand that cannot be satisfied
-- from that screen. Demo mode seeds services, which is exactly why this never
-- surfaced before a real shop tried it.
--
-- Rather than only teaching the UI to explain the emptiness, make the emptiness
-- not happen: a shop should be bookable immediately, with every default plainly
-- editable in Settings → Booking.
--
-- Signature is unchanged, so create-or-replace is safe (no drop needed).

create or replace function public.create_shop_with_owner(
  p_name text,
  p_phone text,
  p_email text,
  p_reply_to_email text,
  p_address text,
  p_website text default null,
  p_logo_url text default null,
  p_primary_color text default '#1d4ed8',
  p_default_payment_method payment_method default null,
  p_default_payment_handle text default null,
  p_quote_expiration_days integer default 30,
  p_follow_up_schedule_days integer[] default '{2,3,5}',
  p_quote_disclaimer text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_shop_id uuid;
  v_slug text;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;
  if coalesce(trim(p_name), '') = '' then
    raise exception 'Shop name is required';
  end if;

  v_slug := lower(regexp_replace(trim(p_name), '[^a-zA-Z0-9]+', '-', 'g'))
            || '-' || substr(gen_random_uuid()::text, 1, 6);

  insert into shops (
    name, slug, phone, email, reply_to_email, address, website, logo_url,
    primary_color, default_payment_method, default_payment_handle, quote_expiration_days,
    follow_up_schedule_days, quote_disclaimer
  ) values (
    trim(p_name), v_slug, coalesce(p_phone, ''), coalesce(p_email, ''),
    coalesce(p_reply_to_email, p_email, ''), coalesce(p_address, ''),
    nullif(trim(coalesce(p_website, '')), ''), nullif(trim(coalesce(p_logo_url, '')), ''),
    coalesce(p_primary_color, '#1d4ed8'), p_default_payment_method,
    nullif(trim(coalesce(p_default_payment_handle, '')), ''),
    coalesce(p_quote_expiration_days, 30), coalesce(p_follow_up_schedule_days, '{2,3,5}'),
    coalesce(nullif(trim(coalesce(p_quote_disclaimer, '')), ''),
      'Final pricing and compatibility may require vehicle inspection. Products and availability are subject to confirmation by the shop.')
  )
  returning id into v_shop_id;

  insert into shop_memberships (shop_id, user_id, role)
  values (v_shop_id, auth.uid(), 'owner');

  -- ---------------------------------------------------------------------
  -- Booking defaults. All of this is ordinary editable data, not config —
  -- the owner renames, re-times, or deletes any of it in Settings → Booking.
  -- The point is only that the calendar works before they ever go there.
  -- ---------------------------------------------------------------------

  -- Two bays: capacity in these shops is bays, not people. Two is the common
  -- small-shop case and makes the calendar's column layout read correctly at
  -- a glance.
  insert into bays (shop_id, name, position) values
    (v_shop_id, 'Bay 1', 0),
    (v_shop_id, 'Bay 2', 1);

  -- Mon-Sat 9-6, closed Sunday. Durations are the realistic middles for this
  -- trade: a system install runs most of a day, a tint job a couple of hours.
  insert into services (shop_id, name, duration_minutes, position) values
    (v_shop_id, 'Car Audio Install', 180, 0),
    (v_shop_id, 'Window Tint', 150, 1);

  insert into business_hours (shop_id, day_of_week, is_open, open_time, close_time)
  select v_shop_id, d, d <> 0, case when d <> 0 then time '09:00' end, case when d <> 0 then time '18:00' end
  from generate_series(0, 6) as d;

  return v_shop_id;
end;
$$;

revoke execute on function public.create_shop_with_owner from public, anon;
grant execute on function public.create_shop_with_owner to authenticated;

-- ---------------------------------------------------------------------------
-- Backfill: shops created between 0021 and now have the same empty calendar.
-- Each insert is guarded, so this is safe to re-run and never disturbs a shop
-- that has already set its own bays/services/hours.
-- ---------------------------------------------------------------------------

insert into bays (shop_id, name, position)
select s.id, v.name, v.position
from shops s
cross join (values ('Bay 1', 0), ('Bay 2', 1)) as v(name, position)
where not exists (select 1 from bays b where b.shop_id = s.id);

insert into services (shop_id, name, duration_minutes, position)
select s.id, v.name, v.minutes, v.position
from shops s
cross join (values ('Car Audio Install', 180, 0), ('Window Tint', 150, 1)) as v(name, minutes, position)
where not exists (select 1 from services x where x.shop_id = s.id);

insert into business_hours (shop_id, day_of_week, is_open, open_time, close_time)
select s.id, d, d <> 0, case when d <> 0 then time '09:00' end, case when d <> 0 then time '18:00' end
from shops s
cross join generate_series(0, 6) as d
where not exists (select 1 from business_hours h where h.shop_id = s.id);
