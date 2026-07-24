-- 0Gauge Recovery — extend the product catalog into a real selling catalog.
-- Purely additive: every new column is nullable or has a safe default, so
-- existing catalog_items rows and every existing quote flow are unaffected.
-- This lays the schema groundwork for (a) staff picking catalog products by
-- category to fill a configuration's component slots, and (b) a future
-- Shopify import / AI photo import (deferred — see docs/CATALOG_AND_PACKAGES.md)
-- upserting idempotently without duplicating rows.

create type product_category as enum (
  'subwoofer', 'enclosure', 'mono_amp', 'multi_amp', 'wiring_kit', 'integration',
  'bass_control', 'battery', 'big_three', 'epicenter', 'integration_module',
  'sound_treatment', 'ofc_wiring', 'door_speaker', 'tweeter', 'radio', 'dsp',
  'camera', 'fabrication', 'labor', 'accessory', 'other'
);

create type product_price_kind as enum ('msrp', 'retail', 'sale', 'unknown');

create type product_availability as enum ('not_tracked', 'available', 'low_stock', 'out_of_stock', 'special_order');

-- 'manual' covers every catalog_items row created before this migration.
create type product_import_source as enum ('manual', 'shopify', 'ai_photo_import');

-- AI/import proposals stay pending_review until an owner/manager approves
-- them — nothing uncertain is ever silently shown to staff-at-large or
-- customers. Existing rows are all hand-entered, so they default approved.
create type product_approval_status as enum ('approved', 'pending_review', 'rejected');

alter table public.catalog_items
  add column category product_category,
  add column description text,
  add column sku text,
  add column upc text,
  -- default_price_cents (existing column) stays the shop's actual selling
  -- price. These are the new, clearly-distinct price kinds from the spec.
  add column msrp_cents bigint check (msrp_cents is null or msrp_cents >= 0),
  add column promo_price_cents bigint check (promo_price_cents is null or promo_price_cents >= 0),
  add column min_staff_price_cents bigint check (min_staff_price_cents is null or min_staff_price_cents >= 0),
  add column cost_cents bigint check (cost_cents is null or cost_cents >= 0),
  add column price_source_url text,
  add column price_source_name text,
  add column price_kind product_price_kind,
  add column price_checked_at timestamptz,
  add column image_url text,
  add column image_source_url text,
  add column source_url text,
  -- Structured, category-varying specs (subwoofer size, impedance, RMS
  -- power, amp RMS-by-impedance, etc.) — schemaless JSONB, same precedent as
  -- quotes.window_tints and quote_events.metadata elsewhere in this schema.
  add column specs jsonb,
  add column active boolean not null default true,
  add column availability product_availability not null default 'not_tracked',
  add column import_source product_import_source not null default 'manual',
  add column external_source_product_id text,
  -- 0-1; null for manually-entered products (there's nothing to be confident about).
  add column identification_confidence numeric check (identification_confidence is null or (identification_confidence between 0 and 1)),
  add column approval_status product_approval_status not null default 'approved';

-- Lets a future importer look up "have I already imported this exact
-- upstream product for this shop" and upsert instead of duplicating. Only
-- enforced once a product actually has an external id — existing/manual
-- rows (external_source_product_id is null) never collide with each other.
create unique index catalog_items_import_identity_idx
  on public.catalog_items (shop_id, import_source, external_source_product_id)
  where external_source_product_id is not null;

create index catalog_items_shop_category_idx on public.catalog_items (shop_id, category);
create index catalog_items_shop_approval_idx on public.catalog_items (shop_id, approval_status);

-- catalog_items_all (migration 0003) lets any shop member fully manage the
-- catalog — fine for brand/model/price, but approval is an owner/manager
-- decision per the product's permission model ("nothing uncertain should be
-- silently published"). RLS alone can't compare old vs. new column values,
-- so a trigger enforces the one column-level restriction on top of the
-- existing table-level policy.
create or replace function public.guard_catalog_item_approval()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.approval_status is distinct from old.approval_status and not public.is_shop_admin(old.shop_id) then
    raise exception 'Only an owner or manager can change a catalog item''s approval status';
  end if;
  return new;
end;
$$;

create trigger catalog_items_guard_approval
  before update on public.catalog_items
  for each row execute function public.guard_catalog_item_approval();

-- ---------------------------------------------------------------------------
-- quote_items / quote_options: readiness for component-slot validation.
-- Nullable — a quote item copied from a category-less catalog entry (or
-- typed free-hand, as every item is today) simply doesn't fill any slot;
-- see validatePackageSlots() in src/lib/audioConfigs.ts. config_id is a
-- plain string referencing a AUDIO_CONFIGURATIONS entry (seed data, not a
-- DB table — see that file's own comment on why configs are code, not rows).
-- ---------------------------------------------------------------------------

alter table public.quote_items add column category product_category;
alter table public.quote_options add column config_id text;
