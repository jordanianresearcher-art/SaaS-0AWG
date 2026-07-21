-- 0Gauge Recovery — shop-managed product catalog.
-- Lets staff save commonly-sold products once and reuse them in quotes
-- instead of retyping brand/model/name every time. Any shop member can
-- manage it (a working tool, not a sensitive setting), mirroring the
-- customers_all policy shape exactly.

create table public.catalog_items (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops (id) on delete cascade,
  brand text,
  model text,
  name text not null,
  default_price_cents bigint check (default_price_cents is null or default_price_cents >= 0),
  position integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index catalog_items_shop_idx on public.catalog_items (shop_id);

create trigger catalog_items_updated_at before update on public.catalog_items
  for each row execute function public.set_updated_at();

alter table public.catalog_items enable row level security;

create policy catalog_items_all on public.catalog_items
  for all to authenticated
  using (public.is_shop_member(shop_id))
  with check (public.is_shop_member(shop_id));
