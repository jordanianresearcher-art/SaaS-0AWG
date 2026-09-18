-- 0032: one app, many front doors.
--
-- Super Car Audio wants the software on supercaraudio.com, and the founder
-- wants to keep selling the same product to other shops. The obvious reading
-- of that is "make them a copy", and it is the expensive wrong answer: every
-- fix would have to be applied to every copy, they drift within weeks, and a
-- bug fixed for one shop stays broken for the rest.
--
-- Nothing about it needs a copy. This app has been multi-tenant since 0001 —
-- shops, memberships, RLS — so Super Car Audio is already a row. The only
-- thing missing was the front door: a customer domain has to know which shop
-- it belongs to BEFORE anyone signs in, so the login page can wear that
-- shop's name instead of the platform's.
--
-- So: one repository, one build, N domains pointed at it. A push updates
-- every shop at once, which is exactly what the founder asked for.

alter table public.shops
  add column custom_domain text;

-- Stored lowercase and bare (no scheme, no port, no leading www) — the same
-- shape normalizeHost() in src/lib/tenantDomain.ts produces from
-- window.location.hostname, so the lookup is an equality match and never a
-- fuzzy one.
alter table public.shops
  add constraint shops_custom_domain_shape
  check (
    custom_domain is null
    or (custom_domain = lower(custom_domain)
        and custom_domain !~ '^(https?://|www\.)'
        and custom_domain !~ '[/:\s]'
        and custom_domain ~ '\.')
  );

-- One domain, one shop. This is the only thing standing between two shops
-- claiming the same hostname, and first-come is the right answer because
-- claiming a domain you do not control achieves nothing: DNS has to point
-- here as well, and that needs the real owner.
create unique index shops_custom_domain_idx on public.shops (custom_domain)
  where custom_domain is not null;

comment on column public.shops.custom_domain is
  'Bare lowercase hostname this shop is served on (e.g. supercaraudio.com). Null means the shop lives on the platform domain.';

-- ---------------------------------------------------------------------------
-- get_shop_branding_by_domain: who is this front door for?
--
-- Called by an anonymous visitor before any sign-in, so it returns the same
-- things a customer already sees on a public quote — name, logo, colour — and
-- nothing else. No ids, no contact details, no counts. A hostname is public
-- knowledge; what it maps to must not be a way to enumerate the platform.
-- ---------------------------------------------------------------------------
create or replace function public.get_shop_branding_by_domain(p_host text)
returns jsonb
language sql
security definer
set search_path = public
stable
as $$
  select jsonb_build_object(
    'shopName', s.name,
    'shopSlug', s.slug,
    'shopLogoUrl', s.logo_url,
    'shopPrimaryColor', s.primary_color
  )
  from shops s
  where s.custom_domain = lower(btrim(coalesce(p_host, ''))) and s.active;
$$;

grant execute on function public.get_shop_branding_by_domain to anon, authenticated;

notify pgrst, 'reload schema';
