-- 0Gauge Recovery — universal product resolution cache.
-- Backs the new `resolve-product` Edge Function (replaces the separate
-- `lookup-product-upc` and `lookup-product-suggestions` functions with one
-- shared, typed resolver contract — see docs/PRODUCT_RESOLVER.md and
-- src/data/repository.ts's ProductResolutionCandidate/resolveProduct).
--
-- Purpose: once a barcode or text query has been resolved (via UPCitemdb
-- and/or Claude + web_search), remember the ranked candidates so the next
-- staff member who scans/types the same thing gets an instant answer with
-- no repeat AI/web call — "Cache confirmed results so later scans are fast
-- and inexpensive" per the resolver's required pipeline order.
--
-- Deliberately shop-scoped (not a cross-shop shared table): a genuine
-- cross-tenant "master product library" is a real, larger architectural
-- decision (separate shared-identity vs. private-catalog schema, dedup
-- rules, RLS that still never leaks one shop's price/cost/quantity to
-- another) that would destabilize this milestone — this cache table is the
-- documented first step toward that, not the final shape. See "Known
-- limitations" in docs/PRODUCT_RESOLVER.md for the migration path.

create table public.product_resolution_cache (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops (id) on delete cascade,
  -- 'barcode' | 'text' — mirrors ProductResolveRequest's discriminated kind.
  kind text not null check (kind in ('barcode', 'text')),
  -- Normalized cache key: the raw barcode as-is (leading zeros preserved —
  -- never treated as a number), or the lowercased/trimmed/whitespace-
  -- collapsed text query. See src/lib/productResolver.ts's normalize*
  -- functions, mirrored server-side in the Edge Function.
  normalized_key text not null check (char_length(normalized_key) > 0),
  -- The full ranked ProductResolutionCandidate[] as returned to the client,
  -- stored verbatim so a cache hit is a straight passthrough.
  candidates jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  -- Nullable: barcode resolutions (a real product's identity) are treated
  -- as effectively permanent; text-query resolutions (looser, price-
  -- sensitive) get a shorter shelf life so stale pricing doesn't linger
  -- indefinitely. The Edge Function decides the actual interval; this
  -- column is just where it's enforced on read.
  expires_at timestamptz
);

-- One row per (shop, kind, key) — an upsert target for the Edge Function.
create unique index product_resolution_cache_key_idx
  on public.product_resolution_cache (shop_id, kind, normalized_key);

alter table public.product_resolution_cache enable row level security;

-- Same shop-scoped pattern as catalog_items. No anon policy: the resolver
-- is only ever called by an authenticated, signed-in user (see
-- resolve-product/index.ts's auth check) via the service-role client, which
-- bypasses RLS entirely for the cache read/write — this policy exists so
-- authenticated shop members could inspect their own shop's cache directly
-- if ever needed (debugging, admin tooling), not because the client reads
-- this table today.
create policy product_resolution_cache_all on public.product_resolution_cache
  for all to authenticated
  using (public.is_shop_member(shop_id))
  with check (public.is_shop_member(shop_id));
