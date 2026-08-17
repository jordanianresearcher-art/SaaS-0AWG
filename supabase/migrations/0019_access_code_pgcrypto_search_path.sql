-- Repair migration for 0017 — see docs/INVENTORY_MERGE_PLAN.md.
--
-- 0017 shipped join_shop_with_access_code and rotate_staff_access_code with
-- `set search_path = public`. Both call pgcrypto's crypt()/gen_salt(), and
-- Supabase installs pgcrypto into the `extensions` schema, not `public` — so
-- 0017's own `create extension if not exists pgcrypto` silently no-ops
-- ("extension already exists, skipping") and the functions then fail at
-- RUNTIME, not at apply time:
--
--   ERROR: function gen_salt(unknown) does not exist
--
-- Generating a shop access code hit this immediately; joining a device would
-- have hit the same wall on crypt().
--
-- Fix: add `extensions` to each function's search_path. This is a no-op risk
-- on installs where pgcrypto really is in `public` (a missing schema listed
-- in search_path is silently ignored), so the same definition is portable to
-- a plain Postgres / `supabase db reset` as well — both paths verified.
--
-- 0017 itself now carries the corrected definitions, so a fresh install never
-- needs this file. It exists for databases where 0017 was already applied.
-- Safe to re-run: create-or-replace only, no schema changes.

create or replace function public.join_shop_with_access_code(p_code text, p_device_name text default null)
returns uuid
language plpgsql
security definer
-- `extensions` too: Supabase installs pgcrypto there, not in public, so a bare
-- `public` search_path cannot see crypt()/gen_salt(). Harmless on installs
-- where pgcrypto IS in public — a missing schema in search_path is ignored.
set search_path = public, extensions
as $$
declare
  v_shop_id uuid;
  v_recent_attempts integer;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  select count(*) into v_recent_attempts
  from public.join_attempts
  where user_id = auth.uid() and attempted_at > now() - interval '1 hour';

  if v_recent_attempts >= 10 then
    raise exception 'Invalid code';
  end if;

  insert into public.join_attempts (user_id) values (auth.uid());

  select id into v_shop_id
  from public.shops
  where staff_access_code_hash is not null
    and staff_access_code_hash = crypt(p_code, staff_access_code_hash);

  if v_shop_id is null then
    raise exception 'Invalid code';
  end if;

  -- If this identity already holds a real (non-inventory) membership on
  -- this shop, never downgrade it — the where clause skips the update in
  -- that case, so an owner/manager/staff mistakenly using the join code
  -- keeps their real role.
  insert into public.shop_memberships (shop_id, user_id, role, device_name)
  values (v_shop_id, auth.uid(), 'inventory', p_device_name)
  on conflict (shop_id, user_id) do update
    set device_name = coalesce(excluded.device_name, shop_memberships.device_name)
    where shop_memberships.role = 'inventory';

  return v_shop_id;
end;
$$;

grant execute on function public.join_shop_with_access_code to authenticated;

create or replace function public.rotate_staff_access_code(p_shop_id uuid)
returns text
language plpgsql
security definer
-- `extensions` too — same pgcrypto reason as join_shop_with_access_code above.
set search_path = public, extensions
as $$
declare
  v_code text;
begin
  if not public.is_shop_admin(p_shop_id) then
    raise exception 'Not authorized';
  end if;

  select string_agg(substr('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', (random() * 32)::int + 1, 1), '')
  into v_code
  from generate_series(1, 8);

  update public.shops
  set staff_access_code_hash = crypt(v_code, gen_salt('bf')), has_staff_access_code = true
  where id = p_shop_id;

  delete from public.shop_memberships
  where shop_id = p_shop_id and role = 'inventory';

  return v_code;
end;
$$;

grant execute on function public.rotate_staff_access_code to authenticated;
