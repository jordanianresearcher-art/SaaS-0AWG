-- Inventory merge, Slice 1 (schema) — see docs/INVENTORY_MERGE_PLAN.md.
--
-- Folds car-audio-inventory's feature set onto this app's existing
-- catalog_items/stock_movements/invoices tables (0003/0009/0011) rather
-- than creating parallel tables, and adds a low-privilege 'inventory'
-- membership role so a shop code can get any phone/tablet/PC into the
-- scan/inventory surface with no account — while staying completely walled
-- off from quotes, customers, and revenue reporting.
--
-- Ordering note — read before touching the enum values below.
--
-- This file ADDs enum values (membership_role.'inventory',
-- product_import_source.'upc_lookup') and then defines functions whose
-- bodies reference them. Postgres refuses to *use* a new enum value in the
-- same transaction that added it ("unsafe use of new value ... of enum
-- type", SQLSTATE 55P04), and this whole file runs as one transaction
-- (`supabase db push`, or a paste into the SQL editor). The two languages
-- differ in when that counts as "use":
--
--   * `language plpgsql` bodies are NOT resolved at CREATE FUNCTION time,
--     only when the function first executes — a later transaction, by
--     which point the ADD VALUE has committed. So a plpgsql body may
--     reference 'inventory' freely (join_shop_with_access_code,
--     rotate_staff_access_code, revoke_inventory_device all do).
--   * `language sql` bodies ARE parsed and validated at CREATE FUNCTION
--     time (check_function_bodies is on by default), so an enum literal
--     there fails immediately. That is exactly what happened on the first
--     real run of this migration.
--
-- Hence is_shop_member below compares `role::text <> 'inventory'` rather
-- than `role <> 'inventory'`: a text comparison needs no enum lookup, so
-- it validates cleanly in the same transaction. Do NOT "tidy" that cast
-- away, and do not add a plain DML statement to this file that names
-- 'inventory'/'upc_lookup' directly — both reintroduce the same failure.

-- ---------------------------------------------------------------------------
-- Enum growth
-- ---------------------------------------------------------------------------

alter type membership_role add value if not exists 'inventory';

-- Distinguishes how a catalog item was first identified — mirrors
-- car-audio-inventory's items.source ('barcode'/'vision'/'manual'), folded
-- into the existing import_source vocabulary instead of a parallel column.
-- 'vision' maps to the *already-declared* 'ai_photo_import' value (unused
-- until now, reserved for exactly this); only 'upc_lookup' is genuinely new.
alter type product_import_source add value if not exists 'upc_lookup';

-- ---------------------------------------------------------------------------
-- catalog_items — low-stock tracking, spot-count tracking, Shopify push
-- ---------------------------------------------------------------------------

alter table public.catalog_items
  -- Per-item override; falls back to shops.default_low_stock_threshold
  -- when null (see src/lib/inventory.ts's effectiveThreshold, ported from
  -- car-audio-inventory's src/lib/items.ts).
  add column low_stock_threshold integer check (low_stock_threshold is null or low_stock_threshold >= 0),
  -- When stock was last physically confirmed via the spot-check flow
  -- (/app/inventory/check) — null sorts first, so a never-counted item is
  -- always the most overdue.
  add column last_counted_at timestamptz,
  -- Whether a low-stock alert has already fired for the item's *current*
  -- dip below threshold, so a digest doesn't re-alert on every check —
  -- cleared back to false once quantity_on_hand rises back above it.
  add column low_stock_alerted boolean not null default false,
  add column low_stock_alerted_at timestamptz,
  -- Shopify *push* bookkeeping — new to this app (it has only ever
  -- imported *from* Shopify; car-audio-inventory pushes catalog changes
  -- back out). Mirrors that app's items.shopify_* columns exactly.
  add column shopify_product_id text,
  add column shopify_variant_id text,
  add column shopify_synced_at timestamptz,
  add column shopify_sync_error text,
  -- True when this item's Shopify listing is one we matched to a
  -- pre-existing product (price/quantity only) rather than one we created
  -- and fully control.
  add column shopify_matched_existing boolean not null default false,
  -- Mirrors the listing's push status so a later edit doesn't silently
  -- flip a deliberately-drafted (no real photos yet) listing back live.
  add column shopify_status text not null default 'active' check (shopify_status in ('active', 'draft'));

-- ---------------------------------------------------------------------------
-- shops — low-stock default, alert recipient, shared-device access code
-- ---------------------------------------------------------------------------

alter table public.shops
  add column default_low_stock_threshold integer not null default 3 check (default_low_stock_threshold >= 0),
  add column low_stock_alert_email text,
  -- bcrypt hash only — the plaintext code is shown to the owner exactly
  -- once, at generation/rotation time (see rotate_staff_access_code
  -- below), never stored or re-displayable after that.
  add column staff_access_code_hash text,
  -- Mirrors "staff_access_code_hash is not null" as a plain readable
  -- column, since the hash itself is select-revoked below (clients need
  -- to know *whether* a code exists — e.g. to show "Generate a code" vs
  -- "Rotate code" in Settings — without being able to read the hash).
  add column has_staff_access_code boolean not null default false;

-- Never let a plain client select expose the hash, even though it's a
-- bcrypt hash and not directly usable — belt and braces alongside RLS.
-- (Table owner / service role are unaffected by column privileges.)
revoke select (staff_access_code_hash) on public.shops from authenticated, anon;

-- ---------------------------------------------------------------------------
-- shop_memberships — device naming for the shared-access 'inventory' role
-- ---------------------------------------------------------------------------

-- Free text ("Front counter iPad") a device names itself on join, so
-- stock_movements.created_by reads back as a real person/station rather
-- than an anonymous uuid. Meaningful only for role = 'inventory'.
alter table public.shop_memberships add column device_name text;

-- ---------------------------------------------------------------------------
-- invoices / invoice_items — tax, discount, walk-in customer + vehicle
-- (ported from car-audio-inventory's pos_invoices; see Slice 2 for the
-- data migration that maps pos_invoices -> these columns)
-- ---------------------------------------------------------------------------

alter table public.invoices
  add column tax_rate numeric(5, 4) not null default 0 check (tax_rate >= 0),
  add column tax_cents bigint not null default 0 check (tax_cents >= 0),
  add column discount_cents bigint not null default 0 check (discount_cents >= 0),
  -- Typed at send/create time, same non-persisted-Customer-record shape
  -- send-invoice-email already uses — now actually saved with the invoice
  -- instead of being lost on reload (see docs/INVENTORY_AND_SCANNING.md's
  -- "Known limitations").
  add column customer_name text,
  add column customer_phone text,
  add column customer_email text,
  add column customer_address text,
  add column vehicle_year integer check (vehicle_year is null or vehicle_year between 1900 and 2100),
  add column vehicle_make text,
  add column vehicle_model text;

alter table public.invoice_items
  add column discount_percent numeric(5, 2) not null default 0 check (discount_percent between 0 and 100),
  add column taxable boolean not null default true;

-- ---------------------------------------------------------------------------
-- Access model — redefine is_shop_member to exclude 'inventory', add
-- has_inventory_access for the inventory-surface tables. Every existing
-- policy written against is_shop_member (quotes, customers, quote_events,
-- email_messages, reports, ...) needs ZERO edits: an 'inventory' member
-- now transparently reads as "not a member" everywhere except the specific
-- tables repointed to has_inventory_access below.
-- ---------------------------------------------------------------------------

create or replace function public.is_shop_member(p_shop_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from shop_memberships
    -- role::text, not role — see the "Ordering note" at the top of this file.
    where shop_id = p_shop_id and user_id = auth.uid() and role::text <> 'inventory'
  );
$$;

create or replace function public.has_inventory_access(p_shop_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from shop_memberships
    where shop_id = p_shop_id and user_id = auth.uid()
  );
$$;

-- shops_select: has_inventory_access is a strict superset of the old
-- is_shop_member check (every real member also has inventory access), so
-- this one replacement covers both "a real staff member reads their shop"
-- and "an inventory-only device reads shop name/logo/colors to render the
-- scan UI" — no second policy needed.
drop policy shops_select on public.shops;
create policy shops_select on public.shops
  for select to authenticated using (public.has_inventory_access(id));

-- catalog_items
drop policy catalog_items_all on public.catalog_items;
create policy catalog_items_all on public.catalog_items
  for all to authenticated
  using (public.has_inventory_access(shop_id))
  with check (public.has_inventory_access(shop_id));

-- stock_movements (still select-only via RLS — every write still goes
-- through apply_stock_movement, updated below)
drop policy stock_movements_select on public.stock_movements;
create policy stock_movements_select on public.stock_movements
  for select to authenticated using (public.has_inventory_access(shop_id));

-- invoices / invoice_items — ringing up a sale from the scan workspace is
-- squarely inventory work (it's also how a 'sale' stock movement gets
-- created), so these move to has_inventory_access too.
drop policy invoices_all on public.invoices;
create policy invoices_all on public.invoices
  for all to authenticated
  using (public.has_inventory_access(shop_id))
  with check (public.has_inventory_access(shop_id));

drop policy invoice_items_all on public.invoice_items;
create policy invoice_items_all on public.invoice_items
  for all to authenticated
  using (exists (select 1 from public.invoices i where i.id = invoice_id and public.has_inventory_access(i.shop_id)))
  with check (exists (select 1 from public.invoices i where i.id = invoice_id and public.has_inventory_access(i.shop_id)));

-- outgoing_orders / outgoing_order_items
drop policy outgoing_orders_all on public.outgoing_orders;
create policy outgoing_orders_all on public.outgoing_orders
  for all to authenticated
  using (public.has_inventory_access(shop_id))
  with check (public.has_inventory_access(shop_id));

drop policy outgoing_order_items_all on public.outgoing_order_items;
create policy outgoing_order_items_all on public.outgoing_order_items
  for all to authenticated
  using (exists (select 1 from public.outgoing_orders o where o.id = outgoing_order_id and public.has_inventory_access(o.shop_id)))
  with check (exists (select 1 from public.outgoing_orders o where o.id = outgoing_order_id and public.has_inventory_access(o.shop_id)));

-- apply_stock_movement (0011) gated on is_shop_member — an inventory-role
-- device recording a receiving/sale/adjustment movement must pass. Same
-- body as 0011, only the membership check changes.
create or replace function public.apply_stock_movement(
  p_catalog_item_id uuid,
  p_movement_type stock_movement_type,
  p_quantity_delta integer,
  p_unit_cost_cents bigint default null,
  p_counterparty_name text default null,
  p_source_invoice_id uuid default null,
  p_source_outgoing_order_id uuid default null,
  p_note text default null
)
returns public.stock_movements
language plpgsql
security definer
set search_path = public
as $$
declare
  v_shop_id uuid;
  v_movement public.stock_movements;
begin
  select shop_id into v_shop_id from public.catalog_items where id = p_catalog_item_id;
  if v_shop_id is null then
    raise exception 'Unknown catalog item';
  end if;
  if not public.has_inventory_access(v_shop_id) then
    raise exception 'Not a member of this shop';
  end if;

  insert into public.stock_movements (
    shop_id, catalog_item_id, movement_type, quantity_delta, unit_cost_cents,
    counterparty_name, source_invoice_id, source_outgoing_order_id, note, created_by
  ) values (
    v_shop_id, p_catalog_item_id, p_movement_type, p_quantity_delta, p_unit_cost_cents,
    p_counterparty_name, p_source_invoice_id, p_source_outgoing_order_id, p_note, auth.uid()
  )
  returning * into v_movement;

  update public.catalog_items
  set quantity_on_hand = quantity_on_hand + p_quantity_delta
  where id = p_catalog_item_id;

  return v_movement;
end;
$$;

-- ---------------------------------------------------------------------------
-- Shared-device join: shop code -> anonymous 'inventory' membership
-- ---------------------------------------------------------------------------

create extension if not exists pgcrypto;

-- Rate limiter for join_shop_with_access_code — no client-facing policies
-- on purpose; only the SECURITY DEFINER RPC below ever touches this table.
create table public.join_attempts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  attempted_at timestamptz not null default now()
);

create index join_attempts_user_idx on public.join_attempts (user_id, attempted_at desc);

alter table public.join_attempts enable row level security;

-- Called by an anonymously-signed-in session (supabase.auth.signInAnonymously())
-- right after typing a shop's access code into /join. Always returns the
-- same generic failure for "wrong code" and "rate limited" so neither is
-- distinguishable to a client guessing codes.
create or replace function public.join_shop_with_access_code(p_code text, p_device_name text default null)
returns uuid
language plpgsql
security definer
set search_path = public
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

-- Owner/manager only. Generates a fresh 8-character code from an
-- unambiguous alphabet (no 0/O/1/I), shows it to the caller exactly once
-- (the return value — nothing stores the plaintext), and revokes every
-- existing 'inventory' membership on the shop, since a rotated code means
-- "every device that joined with the old one is off until they rejoin."
create or replace function public.rotate_staff_access_code(p_shop_id uuid)
returns text
language plpgsql
security definer
set search_path = public
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

-- Owner/manager only. Revokes one joined device without rotating the
-- shared code (leaving every other device signed in) — the "this one
-- phone got lost/left with an employee" button, distinct from rotate's
-- "every device is off."
create or replace function public.revoke_inventory_device(p_membership_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_shop_id uuid;
begin
  select shop_id into v_shop_id
  from public.shop_memberships
  where id = p_membership_id and role = 'inventory';

  if v_shop_id is null or not public.is_shop_admin(v_shop_id) then
    raise exception 'Not authorized';
  end if;

  delete from public.shop_memberships where id = p_membership_id;
end;
$$;

grant execute on function public.revoke_inventory_device to authenticated;

-- ---------------------------------------------------------------------------
-- Storage — product photos captured from a phone camera (new: every image
-- in this app so far has been an external URL from the AI resolver or
-- Shopify; a spot-taken photo needs somewhere of our own to live).
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public)
values ('shop-product-photos', 'shop-product-photos', true)
on conflict (id) do nothing;

-- Path convention: <shop_id>/<uuid>.jpg — the first path segment is the
-- shop id, checked against has_inventory_access on every write. Public
-- bucket (true above) covers reads; Storage still requires an explicit
-- select policy for the API to serve objects through the client.
create policy shop_product_photos_select on storage.objects
  for select to public
  using (bucket_id = 'shop-product-photos');

create policy shop_product_photos_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'shop-product-photos'
    and public.has_inventory_access(((storage.foldername(name))[1])::uuid)
  );

create policy shop_product_photos_update on storage.objects
  for update to authenticated
  using (
    bucket_id = 'shop-product-photos'
    and public.has_inventory_access(((storage.foldername(name))[1])::uuid)
  );

create policy shop_product_photos_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'shop-product-photos'
    and public.has_inventory_access(((storage.foldername(name))[1])::uuid)
  );
