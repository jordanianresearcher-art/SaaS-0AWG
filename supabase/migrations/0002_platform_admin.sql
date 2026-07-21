-- 0Gauge Recovery — platform admin capability.
-- Adds a platform-owner role (distinct from any shop's owner/manager/staff)
-- who can see every shop tenant, create new shops with an invited owner,
-- and suspend/reactivate a shop's access. There is deliberately NO in-app
-- path to grant platform-admin status — membership in platform_admins is
-- managed only via a manual insert run in the Supabase SQL editor.

-- ---------------------------------------------------------------------------
-- Shop suspension flag
-- ---------------------------------------------------------------------------

alter table public.shops add column active boolean not null default true;

-- ---------------------------------------------------------------------------
-- platform_admins
-- ---------------------------------------------------------------------------

create table public.platform_admins (
  user_id uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

alter table public.platform_admins enable row level security;

-- Deliberately no insert/update/delete policy for any role — granting
-- platform-admin status has no in-app path. See README for the manual step:
--   insert into platform_admins (user_id) select id from auth.users where email = '...';

create or replace function public.is_platform_admin()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from platform_admins where user_id = auth.uid()
  );
$$;

create policy platform_admins_select on public.platform_admins
  for select to authenticated using (public.is_platform_admin());

-- ---------------------------------------------------------------------------
-- Widen read access: platform admins can see every shop and membership,
-- as a narrow, explicit, read-only exception. All writes across shops still
-- go through the service-role admin-create-shop Edge Function and the
-- admin_* RPCs below — this stays the single auditable write path rather
-- than a broad RLS hole.
-- ---------------------------------------------------------------------------

drop policy if exists shops_select on public.shops;
create policy shops_select on public.shops
  for select to authenticated
  using (public.is_shop_member(id) or public.is_platform_admin());

drop policy if exists memberships_select on public.shop_memberships;
create policy memberships_select on public.shop_memberships
  for select to authenticated
  using (user_id = auth.uid() or public.is_shop_admin(shop_id) or public.is_platform_admin());

-- ---------------------------------------------------------------------------
-- Suspension enforcement: block new/changed quotes and customers the moment
-- a shop is suspended, while leaving existing data fully readable (so a
-- suspended owner sees their dashboard and a "suspended" notice instead of a
-- blank/broken app). Only the WITH CHECK clause changes — SELECT (using)
-- stays exactly as it was.
-- ---------------------------------------------------------------------------

create or replace function public.is_shop_active(p_shop_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select coalesce((select active from shops where id = p_shop_id), false);
$$;

drop policy if exists customers_all on public.customers;
create policy customers_all on public.customers
  for all to authenticated
  using (public.is_shop_member(shop_id))
  with check (public.is_shop_member(shop_id) and public.is_shop_active(shop_id));

drop policy if exists quotes_all on public.quotes;
create policy quotes_all on public.quotes
  for all to authenticated
  using (public.is_shop_member(shop_id))
  with check (public.is_shop_member(shop_id) and public.is_shop_active(shop_id));

-- ---------------------------------------------------------------------------
-- Admin RPCs — each gates on is_platform_admin() inside the function body
-- (grants alone don't distinguish roles) and returns aggregates only, never
-- quote/customer rows.
-- ---------------------------------------------------------------------------

create or replace function public.admin_list_shops()
returns table (
  id uuid,
  name text,
  slug text,
  active boolean,
  created_at timestamptz,
  member_count bigint,
  quote_count bigint
)
language plpgsql
security definer
set search_path = public
stable
as $$
begin
  if not public.is_platform_admin() then
    raise exception 'Not authorized';
  end if;

  return query
  select
    s.id, s.name, s.slug, s.active, s.created_at,
    (select count(*) from shop_memberships m where m.shop_id = s.id),
    (select count(*) from quotes q where q.shop_id = s.id)
  from shops s
  order by s.created_at desc;
end;
$$;

revoke all on function public.admin_list_shops() from public, anon;
grant execute on function public.admin_list_shops() to authenticated;

create or replace function public.admin_set_shop_active(p_shop_id uuid, p_active boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_platform_admin() then
    raise exception 'Not authorized';
  end if;

  update shops set active = p_active where id = p_shop_id;
end;
$$;

revoke all on function public.admin_set_shop_active(uuid, boolean) from public, anon;
grant execute on function public.admin_set_shop_active(uuid, boolean) to authenticated;
