-- 0026: the shared product catalog.
--
-- Every shop that scans a Kicker CompR 12 currently pays for its own AI
-- lookup, because product_resolution_cache is keyed (shop_id, kind, key). Five
-- pilot shops means five paid resolutions of one product, and the sixth shop
-- to open still starts from nothing. This is the shared layer: resolve a
-- product once, and every shop after that gets it instantly and for free.
--
-- It doubles as the master list an operator can curate from /admin.
--
-- ---------------------------------------------------------------------------
-- The boundary
-- ---------------------------------------------------------------------------
-- Only public facts about a PRODUCT cross into this table. Nothing about a
-- BUSINESS ever does:
--
--   shared      brand, model, descriptor, category, specs, image, source,
--               manufacturer list price, real manufacturer barcode
--   never       what a shop charges, what it paid, its discount floor, its
--               stock level, its generated SKUs, its customers
--
-- The allowlist is enforced twice on purpose. src/lib/globalCatalog.ts builds
-- the payload field by field (with a test that fills every private column with
-- a sentinel and asserts none survive), and contribute_global_product below
-- accepts only the named arguments — it cannot be handed a catalog_items row
-- wholesale even by a caller that wants to.
--
-- Contribution is per-shop and switchable: shops.contributes_to_global_catalog.
-- Reading is always allowed; a shop that opts out of giving still benefits from
-- what is there, which is the honest trade for a pilot.

-- ---------------------------------------------------------------------------
-- Prerequisite
-- ---------------------------------------------------------------------------
-- Trigram matching backs the suggestion search below. Supabase ships pg_trgm
-- but does not enable it by default, and it lives in `extensions` there.

create extension if not exists pg_trgm with schema extensions;

-- ---------------------------------------------------------------------------
-- The toggle
-- ---------------------------------------------------------------------------

alter table public.shops
  add column contributes_to_global_catalog boolean not null default true;

comment on column public.shops.contributes_to_global_catalog is
  'When true, products this shop resolves are contributed to global_products (public product facts only — never pricing, cost, or stock). Settings → Product lookup.';

-- ---------------------------------------------------------------------------
-- The catalog
-- ---------------------------------------------------------------------------

create table public.global_products (
  id uuid primary key default gen_random_uuid(),

  -- Match key. 'upc:<code>' for a real manufacturer barcode, else
  -- 'bm:<brand>:<model>' case- and punctuation-folded. Mirrors
  -- globalMatchKey() in src/lib/globalCatalog.ts.
  match_key text not null unique check (char_length(match_key) > 0),

  -- Only ever a genuine, check-digit-valid retail barcode. A generated SKU or
  -- a store-assigned GS1 prefix (2) is locally meaningful and globally noise,
  -- and two shops would generate colliding codes for different products, so
  -- those are stripped before they reach here (see shareableBarcode).
  barcode text,

  brand text,
  model text,
  -- Descriptor half only; brand and model live in their own columns, same
  -- naming contract the local catalog uses (src/lib/productNaming.ts).
  name text not null default '',
  category public.product_category,
  specs jsonb,

  -- Manufacturer/web list price. NOT what any shop charges or paid — that
  -- distinction is the whole reason shops are willing to contribute.
  reference_price_cents bigint check (reference_price_cents is null or reference_price_cents >= 0),
  price_kind text check (price_kind is null or price_kind in ('msrp', 'retail', 'unknown')),

  image_url text,
  source_url text,

  -- How many distinct shops have contributed this record. A product three
  -- shops independently arrived at is more trustworthy than one shop's guess,
  -- and this is the ranking signal — deliberately a count, not a list, so the
  -- table cannot answer "which shops carry this".
  contribution_count integer not null default 1 check (contribution_count >= 0),

  -- Set by a platform admin from /admin. A verified record outranks and is
  -- never overwritten by an automatic contribution.
  verified_at timestamptz,
  verified_by uuid references auth.users (id) on delete set null,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index global_products_barcode_idx on public.global_products (barcode) where barcode is not null;
create index global_products_brand_model_idx on public.global_products (brand, model);
-- Suggestion search is "type a few characters of a model" — trigram beats
-- prefix matching for that, since staff type the model without the brand as
-- often as with it.
create index global_products_name_trgm_idx on public.global_products
  using gin ((coalesce(brand, '') || ' ' || coalesce(model, '') || ' ' || name) extensions.gin_trgm_ops);

create trigger global_products_set_updated_at
  before update on public.global_products
  for each row execute function public.set_updated_at();

alter table public.global_products enable row level security;

-- Readable by any signed-in user: that is the point of a shared catalog, and
-- the table holds no shop-identifying data by construction.
create policy global_products_select on public.global_products
  for select to authenticated using (true);

-- Writes go through the RPCs below or a platform admin. No direct insert or
-- update by a shop, so the column allowlist cannot be bypassed.
create policy global_products_admin_write on public.global_products
  for all to authenticated
  using (public.is_platform_admin())
  with check (public.is_platform_admin());

-- ---------------------------------------------------------------------------
-- Contributing
-- ---------------------------------------------------------------------------
--
-- Named arguments only. There is deliberately no "pass the row and we'll pick
-- the safe columns" variant: the safe set has to be written out by the caller,
-- so adding a private column to catalog_items can never silently start
-- sharing it.

create or replace function public.contribute_global_product(
  p_shop_id uuid,
  p_match_key text,
  p_barcode text,
  p_brand text,
  p_model text,
  p_name text,
  p_category public.product_category,
  p_specs jsonb,
  p_reference_price_cents bigint,
  p_price_kind text,
  p_image_url text,
  p_source_url text
)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_contributes boolean;
begin
  -- Membership, then the shop's own choice. Both, in that order: a caller
  -- must belong to the shop it claims to contribute on behalf of.
  if not public.is_shop_member(p_shop_id) then
    raise exception 'Not a member of that shop';
  end if;

  select contributes_to_global_catalog into v_contributes
  from public.shops where id = p_shop_id;

  if not coalesce(v_contributes, false) then
    return; -- Opted out. Silent, not an error: this is a background write.
  end if;

  if p_match_key is null or char_length(trim(p_match_key)) = 0 then
    return;
  end if;

  insert into public.global_products as g (
    match_key, barcode, brand, model, name, category, specs,
    reference_price_cents, price_kind, image_url, source_url
  )
  values (
    p_match_key, nullif(trim(coalesce(p_barcode, '')), ''), p_brand, p_model,
    coalesce(p_name, ''), p_category, p_specs,
    p_reference_price_cents, p_price_kind, p_image_url, p_source_url
  )
  on conflict (match_key) do update set
    -- Fill gaps, never overwrite something already known. An established
    -- record is the accumulated agreement of several shops; one later
    -- contribution with thinner data must not degrade it.
    barcode               = coalesce(g.barcode, excluded.barcode),
    brand                 = coalesce(g.brand, excluded.brand),
    model                 = coalesce(g.model, excluded.model),
    name                  = case when g.name = '' then excluded.name else g.name end,
    category              = coalesce(g.category, excluded.category),
    specs                 = coalesce(g.specs, excluded.specs),
    reference_price_cents = coalesce(g.reference_price_cents, excluded.reference_price_cents),
    price_kind            = coalesce(g.price_kind, excluded.price_kind),
    image_url             = coalesce(g.image_url, excluded.image_url),
    source_url            = coalesce(g.source_url, excluded.source_url),
    contribution_count    = g.contribution_count + 1
  -- A record an operator has verified is frozen against automatic edits.
  where g.verified_at is null;
end;
$$;

grant execute on function public.contribute_global_product to authenticated;

-- ---------------------------------------------------------------------------
-- Searching
-- ---------------------------------------------------------------------------

create or replace function public.search_global_products(p_query text, p_limit integer default 8)
returns table (
  id uuid,
  barcode text,
  brand text,
  model text,
  name text,
  category public.product_category,
  specs jsonb,
  reference_price_cents bigint,
  price_kind text,
  image_url text,
  source_url text,
  contribution_count integer,
  verified boolean
)
language sql
stable
security definer
set search_path = public, extensions
as $$
  select
    g.id, g.barcode, g.brand, g.model, g.name, g.category, g.specs,
    g.reference_price_cents, g.price_kind, g.image_url, g.source_url,
    g.contribution_count, (g.verified_at is not null) as verified
  from public.global_products g
  where
    -- An exact barcode is an exact answer.
    g.barcode = trim(p_query)
    or (coalesce(g.brand, '') || ' ' || coalesce(g.model, '') || ' ' || g.name) ilike '%' || trim(p_query) || '%'
  order by
    (g.barcode = trim(p_query)) desc,
    (g.verified_at is not null) desc,
    g.contribution_count desc,
    g.brand nulls last,
    g.model nulls last
  limit greatest(1, least(coalesce(p_limit, 8), 25));
$$;

grant execute on function public.search_global_products to authenticated;

-- ---------------------------------------------------------------------------
-- Operator view: stock across shops
-- ---------------------------------------------------------------------------
--
-- Platform admin only, and gated inside the function rather than by relying on
-- the caller to filter — a SECURITY DEFINER function that reads every shop's
-- inventory must check its own caller.

create or replace function public.admin_global_product_stock(p_global_product_id uuid)
returns table (
  shop_id uuid,
  shop_name text,
  quantity_on_hand integer,
  default_price_cents bigint,
  updated_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
begin
  if not public.is_platform_admin() then
    raise exception 'Platform admin only';
  end if;

  return query
  select s.id, s.name, c.quantity_on_hand, c.default_price_cents, c.updated_at
  from public.global_products g
  join public.catalog_items c
    on (g.barcode is not null and c.upc = g.barcode)
    or (
      g.barcode is null
      and lower(regexp_replace(coalesce(c.brand, ''), '[^a-zA-Z0-9]', '', 'g'))
          = lower(regexp_replace(coalesce(g.brand, ''), '[^a-zA-Z0-9]', '', 'g'))
      and lower(regexp_replace(coalesce(c.model, ''), '[^a-zA-Z0-9]', '', 'g'))
          = lower(regexp_replace(coalesce(g.model, ''), '[^a-zA-Z0-9]', '', 'g'))
    )
  join public.shops s on s.id = c.shop_id
  where g.id = p_global_product_id and c.active
  order by s.name;
end;
$$;

grant execute on function public.admin_global_product_stock to authenticated;
