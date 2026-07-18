-- 0Gauge Recovery — initial schema, RLS, and public RPCs.
-- Multi-tenant: every private row hangs off a shop, and users only reach
-- shops they have a membership in. Anonymous access goes through
-- SECURITY DEFINER functions that return sanitized data only.

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------

create type membership_role as enum ('owner', 'manager', 'staff');
create type quote_status as enum (
  'draft', 'emailed', 'viewed', 'responded', 'booked', 'deposit_paid', 'won', 'lost', 'expired'
);
create type quote_option_tier as enum ('good', 'better', 'insane', 'custom');
create type quote_response_type as enum (
  'ready_to_book', 'need_financing', 'want_cheaper', 'after_payday', 'question', 'not_interested', 'stop_emails'
);
create type email_template_type as enum (
  'initial', 'check_in', 'financing_option', 'payday_reminder', 'final_check_in'
);
create type email_message_status as enum ('previewed', 'sending', 'sent', 'failed', 'demo_sent');

-- ---------------------------------------------------------------------------
-- updated_at trigger helper
-- ---------------------------------------------------------------------------

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger profiles_updated_at before update on public.profiles
  for each row execute function public.set_updated_at();

-- Auto-create a profile row for each new auth user.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, full_name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'full_name', ''))
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

create table public.shops (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  phone text not null default '',
  email text not null default '',
  reply_to_email text not null default '',
  address text not null default '',
  website text,
  logo_url text,
  primary_color text not null default '#1d4ed8',
  default_payment_link text,
  quote_expiration_days integer not null default 30 check (quote_expiration_days between 1 and 365),
  follow_up_schedule_days integer[] not null default '{2,3,5}',
  quote_disclaimer text not null default 'Final pricing and compatibility may require vehicle inspection. Products and availability are subject to confirmation by the shop.',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger shops_updated_at before update on public.shops
  for each row execute function public.set_updated_at();

create table public.shop_memberships (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role membership_role not null default 'staff',
  created_at timestamptz not null default now(),
  unique (shop_id, user_id)
);

create index shop_memberships_user_idx on public.shop_memberships (user_id);

create table public.customers (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops (id) on delete cascade,
  first_name text not null,
  last_name text,
  phone text,
  email text not null,
  vehicle_year integer not null check (vehicle_year between 1900 and 2100),
  vehicle_make text not null,
  vehicle_model text not null,
  vehicle_trim text,
  source text,
  email_contact_permission_confirmed boolean not null default false,
  email_contact_permission_confirmed_at timestamptz,
  email_opt_out_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index customers_shop_idx on public.customers (shop_id);
create index customers_shop_email_idx on public.customers (shop_id, email);

create trigger customers_updated_at before update on public.customers
  for each row execute function public.set_updated_at();

create table public.quotes (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops (id) on delete cascade,
  customer_id uuid not null references public.customers (id) on delete cascade,
  created_by uuid references auth.users (id) on delete set null,
  public_token uuid not null unique default gen_random_uuid(),
  status quote_status not null default 'draft',
  internal_notes text,
  expiration_date timestamptz,
  last_emailed_at timestamptz,
  next_follow_up_at timestamptz,
  email_follow_up_allowed boolean not null default true,
  won_amount_cents bigint check (won_amount_cents is null or won_amount_cents >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index quotes_shop_idx on public.quotes (shop_id);
create index quotes_shop_status_idx on public.quotes (shop_id, status);
create index quotes_next_follow_up_idx on public.quotes (shop_id, next_follow_up_at);
create index quotes_customer_idx on public.quotes (customer_id);

create trigger quotes_updated_at before update on public.quotes
  for each row execute function public.set_updated_at();

create table public.quote_options (
  id uuid primary key default gen_random_uuid(),
  quote_id uuid not null references public.quotes (id) on delete cascade,
  tier quote_option_tier not null default 'custom',
  name text not null,
  description text not null default '',
  price_cents bigint not null check (price_cents >= 0),
  labor_included boolean not null default true,
  deposit_link text,
  recommended boolean not null default false,
  position integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index quote_options_quote_idx on public.quote_options (quote_id);

create trigger quote_options_updated_at before update on public.quote_options
  for each row execute function public.set_updated_at();

create table public.quote_items (
  id uuid primary key default gen_random_uuid(),
  quote_option_id uuid not null references public.quote_options (id) on delete cascade,
  brand text,
  model text,
  name text not null,
  quantity integer not null default 1 check (quantity >= 1),
  description text,
  position integer not null default 0,
  created_at timestamptz not null default now()
);

create index quote_items_option_idx on public.quote_items (quote_option_id);

create table public.quote_events (
  id uuid primary key default gen_random_uuid(),
  quote_id uuid not null references public.quotes (id) on delete cascade,
  event_type text not null,
  metadata jsonb not null default '{}',
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);

create index quote_events_quote_idx on public.quote_events (quote_id, created_at desc);

create table public.quote_responses (
  id uuid primary key default gen_random_uuid(),
  quote_id uuid not null references public.quotes (id) on delete cascade,
  quote_option_id uuid references public.quote_options (id) on delete set null,
  response_type quote_response_type not null,
  message text check (message is null or char_length(message) <= 500),
  created_at timestamptz not null default now()
);

create index quote_responses_quote_idx on public.quote_responses (quote_id, created_at desc);

create table public.email_messages (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops (id) on delete cascade,
  quote_id uuid not null references public.quotes (id) on delete cascade,
  recipient_email text not null,
  template_type email_template_type not null,
  subject text not null,
  status email_message_status not null default 'previewed',
  provider_message_id text,
  error_message text,
  sent_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  sent_at timestamptz
);

create index email_messages_quote_idx on public.email_messages (quote_id, created_at desc);
create index email_messages_shop_created_idx on public.email_messages (shop_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Membership helper functions (used by RLS policies)
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
    where shop_id = p_shop_id and user_id = auth.uid()
  );
$$;

create or replace function public.is_shop_admin(p_shop_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from shop_memberships
    where shop_id = p_shop_id and user_id = auth.uid() and role in ('owner', 'manager')
  );
$$;

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------

alter table public.profiles enable row level security;
alter table public.shops enable row level security;
alter table public.shop_memberships enable row level security;
alter table public.customers enable row level security;
alter table public.quotes enable row level security;
alter table public.quote_options enable row level security;
alter table public.quote_items enable row level security;
alter table public.quote_events enable row level security;
alter table public.quote_responses enable row level security;
alter table public.email_messages enable row level security;

-- profiles: a user manages only their own profile.
create policy profiles_select on public.profiles
  for select to authenticated using (id = auth.uid());
create policy profiles_update on public.profiles
  for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

-- shops: members read; owners/managers update. Creation goes through the
-- create_shop_with_owner RPC (no direct inserts).
create policy shops_select on public.shops
  for select to authenticated using (public.is_shop_member(id));
create policy shops_update on public.shops
  for update to authenticated using (public.is_shop_admin(id)) with check (public.is_shop_admin(id));

-- memberships: users see their own memberships and those of shops they
-- administer; owners/managers manage them.
create policy memberships_select on public.shop_memberships
  for select to authenticated using (user_id = auth.uid() or public.is_shop_admin(shop_id));
create policy memberships_insert on public.shop_memberships
  for insert to authenticated with check (public.is_shop_admin(shop_id));
create policy memberships_update on public.shop_memberships
  for update to authenticated using (public.is_shop_admin(shop_id)) with check (public.is_shop_admin(shop_id));
create policy memberships_delete on public.shop_memberships
  for delete to authenticated using (public.is_shop_admin(shop_id));

-- customers: any member of the shop (staff included) works with customers.
create policy customers_all on public.customers
  for all to authenticated
  using (public.is_shop_member(shop_id))
  with check (public.is_shop_member(shop_id));

-- quotes: any member of the shop.
create policy quotes_all on public.quotes
  for all to authenticated
  using (public.is_shop_member(shop_id))
  with check (public.is_shop_member(shop_id));

-- quote_options / quote_items / quote_events / quote_responses /
-- email_messages: scoped through the owning quote's shop.
create policy quote_options_all on public.quote_options
  for all to authenticated
  using (exists (select 1 from public.quotes q where q.id = quote_id and public.is_shop_member(q.shop_id)))
  with check (exists (select 1 from public.quotes q where q.id = quote_id and public.is_shop_member(q.shop_id)));

create policy quote_items_all on public.quote_items
  for all to authenticated
  using (exists (
    select 1 from public.quote_options o join public.quotes q on q.id = o.quote_id
    where o.id = quote_option_id and public.is_shop_member(q.shop_id)))
  with check (exists (
    select 1 from public.quote_options o join public.quotes q on q.id = o.quote_id
    where o.id = quote_option_id and public.is_shop_member(q.shop_id)));

create policy quote_events_select on public.quote_events
  for select to authenticated
  using (exists (select 1 from public.quotes q where q.id = quote_id and public.is_shop_member(q.shop_id)));
create policy quote_events_insert on public.quote_events
  for insert to authenticated
  with check (exists (select 1 from public.quotes q where q.id = quote_id and public.is_shop_member(q.shop_id)));

create policy quote_responses_select on public.quote_responses
  for select to authenticated
  using (exists (select 1 from public.quotes q where q.id = quote_id and public.is_shop_member(q.shop_id)));

create policy email_messages_select on public.email_messages
  for select to authenticated using (public.is_shop_member(shop_id));

-- Note: no anon policies anywhere. Anonymous users can only call the
-- SECURITY DEFINER RPCs below; direct table access is denied by RLS.

-- ---------------------------------------------------------------------------
-- Onboarding RPC: create a shop and its owner membership atomically.
-- ---------------------------------------------------------------------------

create or replace function public.create_shop_with_owner(
  p_name text,
  p_phone text,
  p_email text,
  p_reply_to_email text,
  p_address text,
  p_website text default null,
  p_logo_url text default null,
  p_primary_color text default '#1d4ed8',
  p_default_payment_link text default null,
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
    primary_color, default_payment_link, quote_expiration_days,
    follow_up_schedule_days, quote_disclaimer
  ) values (
    trim(p_name), v_slug, coalesce(p_phone, ''), coalesce(p_email, ''),
    coalesce(p_reply_to_email, p_email, ''), coalesce(p_address, ''),
    nullif(trim(coalesce(p_website, '')), ''), nullif(trim(coalesce(p_logo_url, '')), ''),
    coalesce(p_primary_color, '#1d4ed8'), nullif(trim(coalesce(p_default_payment_link, '')), ''),
    coalesce(p_quote_expiration_days, 30), coalesce(p_follow_up_schedule_days, '{2,3,5}'),
    coalesce(nullif(trim(coalesce(p_quote_disclaimer, '')), ''),
      'Final pricing and compatibility may require vehicle inspection. Products and availability are subject to confirmation by the shop.')
  )
  returning id into v_shop_id;

  insert into shop_memberships (shop_id, user_id, role)
  values (v_shop_id, auth.uid(), 'owner');

  return v_shop_id;
end;
$$;

revoke execute on function public.create_shop_with_owner from public, anon;
grant execute on function public.create_shop_with_owner to authenticated;

-- ---------------------------------------------------------------------------
-- Public (anonymous) RPCs. These are the ONLY anonymous surface.
-- Everything returned is sanitized: no last name, phone, customer email,
-- internal notes, employee info, or provider details.
-- ---------------------------------------------------------------------------

create or replace function public.get_public_quote(p_public_token uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_result jsonb;
begin
  select jsonb_build_object(
    'shopName', s.name,
    'shopLogoUrl', s.logo_url,
    'shopPhone', s.phone,
    'shopEmail', s.email,
    'shopAddress', s.address,
    'shopPrimaryColor', s.primary_color,
    'quoteDisclaimer', s.quote_disclaimer,
    'customerFirstName', c.first_name,
    'vehicle', jsonb_build_object(
      'year', c.vehicle_year,
      'make', c.vehicle_make,
      'model', c.vehicle_model,
      'trim', c.vehicle_trim
    ),
    'status', q.status,
    'expirationDate', q.expiration_date,
    'optedOut', (c.email_opt_out_at is not null),
    'options', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', o.id,
          'tier', o.tier,
          'name', o.name,
          'description', o.description,
          'priceCents', o.price_cents,
          'laborIncluded', o.labor_included,
          'depositLink', o.deposit_link,
          'recommended', o.recommended,
          'items', coalesce((
            select jsonb_agg(
              jsonb_build_object(
                'brand', i.brand,
                'model', i.model,
                'name', i.name,
                'quantity', i.quantity,
                'description', i.description
              ) order by i.position
            )
            from quote_items i where i.quote_option_id = o.id
          ), '[]'::jsonb)
        ) order by o.position
      )
      from quote_options o where o.quote_id = q.id
    ), '[]'::jsonb)
  )
  into v_result
  from quotes q
  join customers c on c.id = q.customer_id
  join shops s on s.id = q.shop_id
  where q.public_token = p_public_token
    and q.status <> 'draft';

  return v_result; -- null when not found; caller sees "quote not found"
end;
$$;

grant execute on function public.get_public_quote to anon, authenticated;

create or replace function public.record_public_quote_view(p_public_token uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_quote quotes%rowtype;
  v_recent_views integer;
begin
  select * into v_quote from quotes where public_token = p_public_token and status <> 'draft';
  if not found then
    return; -- silently ignore bad tokens; do not leak existence
  end if;

  -- Basic abuse protection: cap recorded views per quote per hour.
  select count(*) into v_recent_views
  from quote_events
  where quote_id = v_quote.id
    and event_type = 'quote_viewed'
    and created_at > now() - interval '1 hour';
  if v_recent_views >= 20 then
    return;
  end if;

  insert into quote_events (quote_id, event_type, metadata, created_by)
  values (v_quote.id, 'quote_viewed', '{}'::jsonb, null);

  -- Advance-only status change: viewed only upgrades draft/emailed.
  update quotes
  set status = 'viewed'
  where id = v_quote.id and status in ('emailed');
end;
$$;

grant execute on function public.record_public_quote_view to anon, authenticated;

create or replace function public.submit_public_quote_response(
  p_public_token uuid,
  p_response_type text,
  p_option_id uuid default null,
  p_message text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_quote quotes%rowtype;
  v_recent integer;
  v_type quote_response_type;
begin
  select * into v_quote from quotes where public_token = p_public_token and status <> 'draft';
  if not found then
    raise exception 'Quote not found';
  end if;

  -- Only approved response values are accepted.
  begin
    v_type := p_response_type::quote_response_type;
  exception when others then
    raise exception 'Invalid response type';
  end;

  if v_type = 'stop_emails' then
    perform public.opt_out_public_quote_email(p_public_token);
    return;
  end if;

  -- The option, if given, must belong to this quote.
  if p_option_id is not null and not exists (
    select 1 from quote_options where id = p_option_id and quote_id = v_quote.id
  ) then
    raise exception 'Invalid option';
  end if;

  -- Basic abuse protection: max 5 responses per quote per hour.
  select count(*) into v_recent
  from quote_responses
  where quote_id = v_quote.id and created_at > now() - interval '1 hour';
  if v_recent >= 5 then
    raise exception 'Too many responses. Please call the shop instead.';
  end if;

  insert into quote_responses (quote_id, quote_option_id, response_type, message)
  values (v_quote.id, p_option_id, v_type, nullif(left(coalesce(p_message, ''), 500), ''));

  insert into quote_events (quote_id, event_type, metadata, created_by)
  values (v_quote.id, 'customer_responded', jsonb_build_object('responseType', v_type), null);

  -- Advance-only: never downgrade booked/deposit_paid/won/lost.
  update quotes
  set status = 'responded'
  where id = v_quote.id and status in ('emailed', 'viewed');
end;
$$;

grant execute on function public.submit_public_quote_response to anon, authenticated;

create or replace function public.opt_out_public_quote_email(p_public_token uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_quote quotes%rowtype;
begin
  select * into v_quote from quotes where public_token = p_public_token;
  if not found then
    return; -- do not leak token validity
  end if;

  update customers
  set email_opt_out_at = coalesce(email_opt_out_at, now())
  where id = v_quote.customer_id;

  update quotes
  set email_follow_up_allowed = false, next_follow_up_at = null
  where id = v_quote.id;

  insert into quote_events (quote_id, event_type, metadata, created_by)
  values (v_quote.id, 'email_opt_out', '{}'::jsonb, null);
end;
$$;

grant execute on function public.opt_out_public_quote_email to anon, authenticated;
