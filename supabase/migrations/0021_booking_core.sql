-- 0021: booking core — services, bays, hours, appointments.
--
-- See docs/MVP_PLAN.md §5 for the full spec. This is Slice 0 (schema + the
-- two write paths) plus enough of Slice 1's read surface to make the public
-- booking page and staff calendar both buildable against it.
--
-- Two write paths, mirroring how quotes already work in this schema:
--   - Staff booking = direct table inserts through RLS (is_shop_member),
--     same as createQuote's direct .from('customers')/.from('quotes')
--     inserts — no RPC needed, the exclusion constraint below protects
--     this path exactly the same as the anonymous one.
--   - Self-serve public booking = the book_appointment() SECURITY DEFINER
--     RPC, mirroring submit_public_quote_response's shape: anonymous,
--     validates everything server-side, never trusts client-computed
--     availability.
--
-- Double-booking is prevented at the database level by a gist exclusion
-- constraint on (bay_id, time range) — not an advisory lock. An exclusion
-- constraint is Postgres's purpose-built tool for exactly this problem: it
-- is checked atomically as part of the INSERT itself, so there is no
-- check-then-insert race window to protect with a lock in the first place,
-- and unlike a lock keyed on shop_id it doesn't serialize unrelated
-- bookings against each other (two customers booking different bays at the
-- same shop never contend).

create extension if not exists btree_gist;

-- Deposit amount lives on shops (a shop-wide default, not per-service) even
-- though *collecting* it is Stripe Connect, landing in a later migration —
-- book_appointment below needs to know whether a deposit is required at all
-- to decide 'confirmed' vs 'awaiting_deposit' (see the owner's explicit
-- deposit-hold policy in docs/MVP_PLAN.md), which is a Slice 0/1 concern
-- independent of how the deposit eventually gets paid. Null/0 = no deposit
-- required, self-serve bookings confirm immediately.
alter table public.shops
  add column booking_deposit_cents bigint check (booking_deposit_cents is null or booking_deposit_cents >= 0);

-- ---------------------------------------------------------------------------
-- Services — what a shop can be booked for. installed_duration_minutes is
-- the default; service_duration_overrides adjusts it for a specific vehicle
-- body style (a tint job on an suv_6_window takes longer than a coupe).
-- ---------------------------------------------------------------------------

create table public.services (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops (id) on delete cascade,
  name text not null,
  description text,
  duration_minutes integer not null check (duration_minutes > 0),
  price_cents bigint check (price_cents is null or price_cents >= 0),
  active boolean not null default true,
  position integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index services_shop_idx on public.services (shop_id, position);

-- Body style values mirror TintBodyStyle (src/types.ts) as plain text with a
-- CHECK rather than a Postgres enum — that list has already grown once
-- ("expanded to 7 real body shapes per explicit request"), and a CHECK can be
-- widened in the same transaction that needs it while an enum value cannot.
create table public.service_duration_overrides (
  id uuid primary key default gen_random_uuid(),
  service_id uuid not null references public.services (id) on delete cascade,
  body_style text not null check (body_style in (
    'coupe', 'sedan', 'truck_single_cab', 'truck_crew_cab',
    'suv_4_window', 'suv_6_window', 'minivan'
  )),
  duration_minutes integer not null check (duration_minutes > 0),
  unique (service_id, body_style)
);

-- ---------------------------------------------------------------------------
-- Bays — capacity is bays, not staff (see MVP_PLAN §5's "jobs regardless of
-- headcount" note). One appointment occupies one bay for its full duration.
-- ---------------------------------------------------------------------------

create table public.bays (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops (id) on delete cascade,
  name text not null,
  active boolean not null default true,
  position integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index bays_shop_idx on public.bays (shop_id, position);

-- ---------------------------------------------------------------------------
-- Business hours (one row per day-of-week per shop) and one-off exceptions
-- (holidays, early closes). See src/lib/scheduling.ts for how these feed
-- slot generation — this is the relational source, that file is pure math
-- over plain minute integers resolved from these rows.
-- ---------------------------------------------------------------------------

create table public.business_hours (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops (id) on delete cascade,
  -- 0 = Sunday .. 6 = Saturday, matching JS Date#getDay().
  day_of_week smallint not null check (day_of_week between 0 and 6),
  is_open boolean not null default true,
  open_time time,
  close_time time,
  unique (shop_id, day_of_week),
  check (
    (is_open and open_time is not null and close_time is not null and close_time > open_time)
    or (not is_open and open_time is null and close_time is null)
  )
);

create table public.schedule_exceptions (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops (id) on delete cascade,
  exception_date date not null,
  is_closed boolean not null default true,
  open_time time,
  close_time time,
  note text,
  unique (shop_id, exception_date),
  check (
    (is_closed and open_time is null and close_time is null)
    or (not is_closed and open_time is not null and close_time is not null and close_time > open_time)
  )
);

create index schedule_exceptions_shop_date_idx on public.schedule_exceptions (shop_id, exception_date);

-- Sane defaults for every existing shop (Mon-Sat 9-6, Sun closed) so
-- booking is immediately demoable/testable right after this migration runs,
-- rather than every shop starting with zero bookable hours until someone
-- visits Settings.
insert into public.business_hours (shop_id, day_of_week, is_open, open_time, close_time)
select s.id, d.day_of_week,
       d.day_of_week <> 0,
       case when d.day_of_week <> 0 then time '09:00' end,
       case when d.day_of_week <> 0 then time '18:00' end
from public.shops s
cross join (select generate_series(0, 6) as day_of_week) d;

-- ---------------------------------------------------------------------------
-- Appointments. status: 'confirmed' (staff-booked, or self-serve with no
-- deposit required) / 'awaiting_deposit' (self-serve, deposit due — still
-- holds the bay, per the owner's explicit deposit-hold decision) /
-- 'cancelled' / 'completed' / 'no_show'. public_token is how a customer
-- reaches their own booking (email link, manage/cancel/reschedule,
-- eventual deposit-pay page) with no account, same shape as quotes.
-- ---------------------------------------------------------------------------

create table public.appointments (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops (id) on delete cascade,
  bay_id uuid not null references public.bays (id) on delete restrict,
  customer_id uuid not null references public.customers (id) on delete cascade,
  source text not null check (source in ('staff', 'self_serve', 'from_quote')),
  status text not null default 'confirmed'
    check (status in ('confirmed', 'awaiting_deposit', 'cancelled', 'completed', 'no_show')),
  starts_at timestamptz not null,
  ends_at timestamptz not null check (ends_at > starts_at),
  body_style text check (body_style in (
    'coupe', 'sedan', 'truck_single_cab', 'truck_crew_cab',
    'suv_4_window', 'suv_6_window', 'minivan'
  )),
  notes text,
  public_token uuid not null default gen_random_uuid() unique,
  source_quote_id uuid references public.quotes (id) on delete set null,
  deposit_amount_cents bigint check (deposit_amount_cents is null or deposit_amount_cents >= 0),
  deposit_paid_at timestamptz,
  reminder_sent_at timestamptz,
  cancelled_at timestamptz,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index appointments_shop_starts_idx on public.appointments (shop_id, starts_at);
create index appointments_bay_starts_idx on public.appointments (bay_id, starts_at);
create index appointments_customer_idx on public.appointments (customer_id);

-- The load-bearing guarantee: two active appointments on the same bay can
-- never overlap, enforced by Postgres itself at insert/update time — not by
-- application code re-checking availability (which only narrows the race
-- window, it can't close it).
alter table public.appointments
  add constraint appointments_no_overlap
  exclude using gist (
    bay_id with =,
    tstzrange(starts_at, ends_at) with &&
  )
  where (status not in ('cancelled'));

-- Snapshotted per-service line on an appointment (an install visit can bundle
-- more than one service back to back on the same bay) — same snapshot
-- reasoning as quote_items: name/duration/price are captured at booking
-- time so a later edit to the Services catalog never rewrites history.
create table public.appointment_services (
  id uuid primary key default gen_random_uuid(),
  appointment_id uuid not null references public.appointments (id) on delete cascade,
  service_id uuid references public.services (id) on delete set null,
  name text not null,
  duration_minutes integer not null check (duration_minutes > 0),
  price_cents bigint check (price_cents is null or price_cents >= 0),
  position integer not null default 0
);

create index appointment_services_appointment_idx on public.appointment_services (appointment_id);

-- ---------------------------------------------------------------------------
-- updated_at triggers, same helper every other table in this schema uses.
-- ---------------------------------------------------------------------------

create trigger services_set_updated_at before update on public.services
  for each row execute function public.set_updated_at();
create trigger bays_set_updated_at before update on public.bays
  for each row execute function public.set_updated_at();
create trigger appointments_set_updated_at before update on public.appointments
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- RLS. Config tables (services/bays/hours/exceptions): any shop member can
-- read (staff needs the list to book), only owner/manager can write — same
-- split shops_update already uses. Appointments/appointment_services: any
-- shop member can read and write (booking is a front-desk task, not an
-- owner-only one) — but is_shop_member specifically, NOT
-- has_inventory_access, so a shared inventory device (see migration 0017)
-- can never see a customer's name, phone, or appointment time. That's the
-- same reasoning migration 0017 itself used for quotes/customers/reports.
-- ---------------------------------------------------------------------------

alter table public.services enable row level security;
alter table public.service_duration_overrides enable row level security;
alter table public.bays enable row level security;
alter table public.business_hours enable row level security;
alter table public.schedule_exceptions enable row level security;
alter table public.appointments enable row level security;
alter table public.appointment_services enable row level security;

create policy services_select on public.services
  for select to authenticated using (public.is_shop_member(shop_id));
create policy services_write on public.services
  for all to authenticated using (public.is_shop_admin(shop_id)) with check (public.is_shop_admin(shop_id));

create policy service_duration_overrides_select on public.service_duration_overrides
  for select to authenticated
  using (exists (select 1 from public.services s where s.id = service_id and public.is_shop_member(s.shop_id)));
create policy service_duration_overrides_write on public.service_duration_overrides
  for all to authenticated
  using (exists (select 1 from public.services s where s.id = service_id and public.is_shop_admin(s.shop_id)))
  with check (exists (select 1 from public.services s where s.id = service_id and public.is_shop_admin(s.shop_id)));

create policy bays_select on public.bays
  for select to authenticated using (public.is_shop_member(shop_id));
create policy bays_write on public.bays
  for all to authenticated using (public.is_shop_admin(shop_id)) with check (public.is_shop_admin(shop_id));

create policy business_hours_select on public.business_hours
  for select to authenticated using (public.is_shop_member(shop_id));
create policy business_hours_write on public.business_hours
  for all to authenticated using (public.is_shop_admin(shop_id)) with check (public.is_shop_admin(shop_id));

create policy schedule_exceptions_select on public.schedule_exceptions
  for select to authenticated using (public.is_shop_member(shop_id));
create policy schedule_exceptions_write on public.schedule_exceptions
  for all to authenticated using (public.is_shop_admin(shop_id)) with check (public.is_shop_admin(shop_id));

create policy appointments_all on public.appointments
  for all to authenticated using (public.is_shop_member(shop_id)) with check (public.is_shop_member(shop_id));

create policy appointment_services_all on public.appointment_services
  for all to authenticated
  using (exists (select 1 from public.appointments a where a.id = appointment_id and public.is_shop_member(a.shop_id)))
  with check (exists (select 1 from public.appointments a where a.id = appointment_id and public.is_shop_member(a.shop_id)));

-- ---------------------------------------------------------------------------
-- get_public_booking_page(shop_slug) — anonymous. Everything a booking
-- wizard needs before an appointment exists: shop display fields, bookable
-- services (with their duration overrides), hours, exceptions, and
-- PII-FREE busy blocks (bay id + time range only — never a customer name or
-- appointment status) so the public page can compute "what's actually open"
-- without ever exposing who else booked what. Mirrors get_public_quote's
-- shape and its 90-day forward window keeps the payload bounded.
-- ---------------------------------------------------------------------------

create or replace function public.get_public_booking_page(p_shop_slug text)
returns jsonb
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_shop_id uuid;
  v_result jsonb;
begin
  select id into v_shop_id from shops where slug = p_shop_slug and coalesce(active, true);
  if v_shop_id is null then
    return null;
  end if;

  select jsonb_build_object(
    'shopId', v_shop_id,
    'shopName', s.name,
    'shopPhone', s.phone,
    'shopAddress', s.address,
    'shopPrimaryColor', s.primary_color,
    'bookingDepositCents', s.booking_deposit_cents,
    'services', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', sv.id,
        'name', sv.name,
        'description', sv.description,
        'durationMinutes', sv.duration_minutes,
        'priceCents', sv.price_cents,
        'durationOverrides', coalesce((
          select jsonb_agg(jsonb_build_object('bodyStyle', o.body_style, 'durationMinutes', o.duration_minutes))
          from service_duration_overrides o where o.service_id = sv.id
        ), '[]'::jsonb)
      ) order by sv.position)
      from services sv where sv.shop_id = v_shop_id and sv.active
    ), '[]'::jsonb),
    'bays', coalesce((
      select jsonb_agg(jsonb_build_object('id', b.id) order by b.position)
      from bays b where b.shop_id = v_shop_id and b.active
    ), '[]'::jsonb),
    'businessHours', coalesce((
      select jsonb_agg(jsonb_build_object(
        'dayOfWeek', h.day_of_week, 'isOpen', h.is_open,
        -- HH:MI, no seconds — matches src/lib/scheduling.ts's timeStringToMinute
        'openTime', to_char(h.open_time, 'HH24:MI'), 'closeTime', to_char(h.close_time, 'HH24:MI')
      ) order by h.day_of_week)
      from business_hours h where h.shop_id = v_shop_id
    ), '[]'::jsonb),
    'scheduleExceptions', coalesce((
      select jsonb_agg(jsonb_build_object(
        'date', e.exception_date, 'isClosed', e.is_closed,
        'openTime', to_char(e.open_time, 'HH24:MI'), 'closeTime', to_char(e.close_time, 'HH24:MI')
      ) order by e.exception_date)
      from schedule_exceptions e
      where e.shop_id = v_shop_id and e.exception_date between current_date and current_date + 90
    ), '[]'::jsonb),
    'busyBlocks', coalesce((
      select jsonb_agg(jsonb_build_object('bayId', a.bay_id, 'startsAt', a.starts_at, 'endsAt', a.ends_at))
      from appointments a
      where a.shop_id = v_shop_id
        and a.status <> 'cancelled'
        and a.starts_at < now() + interval '90 days'
        and a.ends_at > now()
    ), '[]'::jsonb)
  )
  into v_result
  from shops s where s.id = v_shop_id;

  return v_result;
end;
$$;

grant execute on function public.get_public_booking_page to anon, authenticated;

-- ---------------------------------------------------------------------------
-- book_appointment — anonymous write. Re-derives everything server-side
-- (services -> duration, business hours/exceptions -> is this slot even
-- legal) rather than trusting the client's own availability computation,
-- then lets the exclusion constraint above be the final, atomic word on
-- whether the bay was actually free. Tries each active bay in turn inside a
-- PL/pgSQL exception block, which implicitly creates a savepoint per
-- attempt — a losing attempt rolls back to just before its own insert, not
-- the whole transaction, so trying bay 2 after bay 1 conflicts is safe.
-- ---------------------------------------------------------------------------

create or replace function public.book_appointment(
  p_shop_slug text,
  p_service_ids uuid[],
  p_starts_at timestamptz,
  p_body_style text default null,
  p_customer_first_name text default null,
  p_customer_last_name text default null,
  p_customer_email text default null,
  p_customer_phone text default null,
  p_source_quote_public_token uuid default null,
  p_notes text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_shop shops%rowtype;
  v_customer_id uuid;
  v_quote quotes%rowtype;
  v_total_minutes integer := 0;
  v_ends_at timestamptz;
  v_appointment_id uuid;
  v_public_token uuid;
  v_status text;
  v_bay record;
  v_booked boolean := false;
  v_svc record;
  v_duration integer;
  v_position integer := 0;
begin
  select * into v_shop from shops where slug = p_shop_slug and coalesce(active, true);
  if v_shop.id is null then
    raise exception 'Shop not found';
  end if;

  if p_service_ids is null or array_length(p_service_ids, 1) is null then
    raise exception 'At least one service is required';
  end if;
  if p_starts_at < now() then
    raise exception 'That time has already passed';
  end if;

  -- Resolve or create the customer. A quote token, if given, must belong to
  -- this same shop — cross-shop token reuse must never work.
  if p_source_quote_public_token is not null then
    select * into v_quote from quotes where public_token = p_source_quote_public_token and shop_id = v_shop.id;
    if v_quote.id is null then
      raise exception 'Quote not found';
    end if;
    v_customer_id := v_quote.customer_id;
  else
    if coalesce(trim(p_customer_first_name), '') = '' then
      raise exception 'Name is required';
    end if;
    if coalesce(trim(p_customer_email), '') = '' and coalesce(trim(p_customer_phone), '') = '' then
      raise exception 'An email or phone number is required';
    end if;
    -- customers.email is NOT NULL — unlike last_name/phone, it cannot use
    -- nullif-to-null here even when blank; empty string is the "no email"
    -- convention this column already uses everywhere else.
    insert into customers (shop_id, first_name, last_name, email, phone, source)
    values (v_shop.id, trim(p_customer_first_name), nullif(trim(coalesce(p_customer_last_name, '')), ''),
            trim(coalesce(p_customer_email, '')), nullif(trim(coalesce(p_customer_phone, '')), ''),
            'self_serve_booking')
    returning id into v_customer_id;
  end if;

  -- Resolve services -> total duration, applying the body-style override
  -- when one exists for that service.
  for v_svc in
    select s.id, s.name, s.price_cents, s.duration_minutes,
           coalesce(
             (select o.duration_minutes from service_duration_overrides o
              where o.service_id = s.id and o.body_style = p_body_style),
             s.duration_minutes
           ) as effective_minutes
    from services s
    where s.id = any(p_service_ids) and s.shop_id = v_shop.id and s.active
  loop
    v_total_minutes := v_total_minutes + v_svc.effective_minutes;
  end loop;

  if v_total_minutes = 0 then
    raise exception 'No bookable services matched';
  end if;
  v_ends_at := p_starts_at + make_interval(mins => v_total_minutes);

  -- Deposit policy (owner decision): a self-serve booking with a deposit
  -- configured lands as awaiting_deposit — the bay is held (the exclusion
  -- constraint applies to this status too) but the confirmation email is
  -- gated on payment (handled at the application layer once Stripe lands).
  v_status := case when coalesce(v_shop.booking_deposit_cents, 0) > 0 then 'awaiting_deposit' else 'confirmed' end;

  for v_bay in select id from bays where shop_id = v_shop.id and active order by position loop
    begin
      insert into appointments (
        shop_id, bay_id, customer_id, source, status, starts_at, ends_at,
        body_style, notes, source_quote_id, deposit_amount_cents
      ) values (
        v_shop.id, v_bay.id, v_customer_id,
        case when p_source_quote_public_token is not null then 'from_quote' else 'self_serve' end,
        v_status, p_starts_at, v_ends_at, p_body_style, p_notes,
        v_quote.id, nullif(v_shop.booking_deposit_cents, 0)
      )
      returning id, public_token into v_appointment_id, v_public_token;

      v_booked := true;
      exit;
    exception when exclusion_violation then
      -- This bay was taken between the client's availability check and this
      -- request — the savepoint this EXCEPTION block created rolls back
      -- just the failed insert, so the loop can cleanly try the next bay.
      continue;
    end;
  end loop;

  if not v_booked then
    raise exception 'That time was just booked by someone else. Please pick another.';
  end if;

  for v_svc in
    select s.id, s.name, s.price_cents,
           coalesce(
             (select o.duration_minutes from service_duration_overrides o
              where o.service_id = s.id and o.body_style = p_body_style),
             s.duration_minutes
           ) as effective_minutes
    from services s
    where s.id = any(p_service_ids) and s.shop_id = v_shop.id and s.active
  loop
    insert into appointment_services (appointment_id, service_id, name, duration_minutes, price_cents, position)
    values (v_appointment_id, v_svc.id, v_svc.name, v_svc.effective_minutes, v_svc.price_cents, v_position);
    v_position := v_position + 1;
  end loop;

  return jsonb_build_object('publicToken', v_public_token, 'status', v_status);
end;
$$;

grant execute on function public.book_appointment to anon, authenticated;

-- ---------------------------------------------------------------------------
-- get_public_appointment / cancel_appointment_public — the manage page
-- (/booking/:publicToken). Reschedule is intentionally NOT included here:
-- it reuses book_appointment's own validation by cancelling and re-booking
-- in the client, which keeps one code path owning "is this slot legal"
-- instead of two RPCs drifting apart.
-- ---------------------------------------------------------------------------

create or replace function public.get_public_appointment(p_public_token uuid)
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
    'publicToken', a.public_token,
    'status', a.status,
    'startsAt', a.starts_at,
    'endsAt', a.ends_at,
    'customerFirstName', c.first_name,
    'shopName', s.name,
    'shopPhone', s.phone,
    'shopAddress', s.address,
    'shopPrimaryColor', s.primary_color,
    'depositAmountCents', a.deposit_amount_cents,
    'depositPaidAt', a.deposit_paid_at,
    'services', coalesce((
      select jsonb_agg(jsonb_build_object('name', asv.name, 'durationMinutes', asv.duration_minutes) order by asv.position)
      from appointment_services asv where asv.appointment_id = a.id
    ), '[]'::jsonb)
  )
  into v_result
  from appointments a
  join customers c on c.id = a.customer_id
  join shops s on s.id = a.shop_id
  where a.public_token = p_public_token;

  return v_result; -- null when not found
end;
$$;

grant execute on function public.get_public_appointment to anon, authenticated;

create or replace function public.cancel_appointment_public(p_public_token uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update appointments
  set status = 'cancelled', cancelled_at = now()
  where public_token = p_public_token and status not in ('cancelled', 'completed');

  if not found then
    raise exception 'Appointment not found or already cancelled';
  end if;
end;
$$;

grant execute on function public.cancel_appointment_public to anon, authenticated;

notify pgrst, 'reload schema';
