-- 0Gauge Recovery — reusable package templates. A shop-specific, named
-- package built from real catalog products against a universal
-- configuration (see src/lib/audioConfigs.ts) — the thing staff pick from
-- in the fast package builder (a later phase). Two ways populate this table
-- today's Phase 1 groundwork supports: a staff member saving a quote option
-- as a package, or (later, deferred) AI-drafted onboarding suggestions —
-- both land as 'pending_review' until an owner/manager approves them.
--
-- Snapshot, not a live reference: source_quote_id/source_quote_option_id
-- are provenance only ("what quote did this come from"), set null on
-- delete. Editing or deleting the original quote never changes an already
-- saved package, and vice versa.

create type package_template_source as enum ('staff_saved', 'ai_drafted');

create table public.package_templates (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops (id) on delete cascade,
  name text not null,
  description text not null default '',
  -- References an AUDIO_CONFIGURATIONS id (code-level seed data — see that
  -- file's own comment on why configs are data, not a DB table), not a FK.
  config_id text,
  vehicle_types text[] not null default '{}',
  installed_price_cents bigint check (installed_price_cents is null or installed_price_cents >= 0),
  labor_included boolean not null default true,
  source package_template_source not null default 'staff_saved',
  approval_status product_approval_status not null default 'pending_review',
  source_quote_id uuid references public.quotes (id) on delete set null,
  source_quote_option_id uuid references public.quote_options (id) on delete set null,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index package_templates_shop_idx on public.package_templates (shop_id);
create index package_templates_shop_approval_idx on public.package_templates (shop_id, approval_status);
create index package_templates_shop_config_idx on public.package_templates (shop_id, config_id);

create trigger package_templates_updated_at before update on public.package_templates
  for each row execute function public.set_updated_at();

create table public.package_template_items (
  id uuid primary key default gen_random_uuid(),
  package_template_id uuid not null references public.package_templates (id) on delete cascade,
  brand text,
  model text,
  name text not null,
  quantity integer not null default 1 check (quantity >= 1),
  description text,
  category product_category,
  -- Snapshotted at save time — preserves what the package looked like even
  -- if the source catalog product's image later changes or is removed.
  image_url text,
  position integer not null default 0,
  created_at timestamptz not null default now()
);

create index package_template_items_template_idx on public.package_template_items (package_template_id);

alter table public.package_templates enable row level security;
alter table public.package_template_items enable row level security;

-- Any shop member can propose/view a package (mirrors catalog_items_all) —
-- who may flip approval_status is enforced by the trigger below.
create policy package_templates_all on public.package_templates
  for all to authenticated
  using (public.is_shop_member(shop_id))
  with check (public.is_shop_member(shop_id));

create policy package_template_items_all on public.package_template_items
  for all to authenticated
  using (exists (
    select 1 from public.package_templates p where p.id = package_template_id and public.is_shop_member(p.shop_id)))
  with check (exists (
    select 1 from public.package_templates p where p.id = package_template_id and public.is_shop_member(p.shop_id)));

create or replace function public.guard_package_template_approval()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.approval_status is distinct from old.approval_status and not public.is_shop_admin(old.shop_id) then
    raise exception 'Only an owner or manager can change a package template''s approval status';
  end if;
  return new;
end;
$$;

create trigger package_templates_guard_approval
  before update on public.package_templates
  for each row execute function public.guard_package_template_approval();
