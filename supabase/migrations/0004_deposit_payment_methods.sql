-- 0Gauge Recovery — deposit payment methods (Zelle/Cash App/Venmo/PayPal.me)
-- and an explicit deposit dollar amount, for shops without a Shopify/Stripe
-- account to take a payment link from. Replaces the single free-text
-- "deposit link" URL with a method + handle pair (a raw payment link is
-- still one of the methods, for shops that do have one), plus a deposit
-- amount baked in at quote-creation time (defaults to 15% of the option
-- price in the UI, editable by staff).

create type payment_method as enum ('link', 'zelle', 'cashapp', 'venmo', 'paypal');

-- ---------------------------------------------------------------------------
-- shops: shop-level default payment method
-- ---------------------------------------------------------------------------

alter table public.shops add column default_payment_method payment_method;
alter table public.shops add column default_payment_handle text;

update public.shops
set default_payment_method = 'link',
    default_payment_handle = nullif(trim(default_payment_link), '')
where nullif(trim(default_payment_link), '') is not null;

alter table public.shops drop column default_payment_link;

alter table public.shops add constraint shops_payment_method_handle_pair
  check ((default_payment_method is null) = (default_payment_handle is null));

-- ---------------------------------------------------------------------------
-- quote_options: per-option override + explicit deposit amount
-- ---------------------------------------------------------------------------

alter table public.quote_options add column deposit_payment_method payment_method;
alter table public.quote_options add column deposit_payment_handle text;
alter table public.quote_options add column deposit_amount_cents bigint
  check (deposit_amount_cents is null or deposit_amount_cents >= 0);

update public.quote_options
set deposit_payment_method = 'link',
    deposit_payment_handle = nullif(trim(deposit_link), '')
where nullif(trim(deposit_link), '') is not null;

alter table public.quote_options drop column deposit_link;

alter table public.quote_options add constraint quote_options_payment_method_handle_pair
  check ((deposit_payment_method is null) = (deposit_payment_handle is null));

-- ---------------------------------------------------------------------------
-- create_shop_with_owner: p_default_payment_link -> p_default_payment_method
-- + p_default_payment_handle. This changes the function's identifying type
-- signature, so create-or-replace would leave the old overload in place —
-- drop it explicitly first.
-- ---------------------------------------------------------------------------

drop function if exists public.create_shop_with_owner(
  text, text, text, text, text, text, text, text, text, integer, integer[], text
);

create function public.create_shop_with_owner(
  p_name text,
  p_phone text,
  p_email text,
  p_reply_to_email text,
  p_address text,
  p_website text default null,
  p_logo_url text default null,
  p_primary_color text default '#1d4ed8',
  p_default_payment_method payment_method default null,
  p_default_payment_handle text default null,
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
    primary_color, default_payment_method, default_payment_handle, quote_expiration_days,
    follow_up_schedule_days, quote_disclaimer
  ) values (
    trim(p_name), v_slug, coalesce(p_phone, ''), coalesce(p_email, ''),
    coalesce(p_reply_to_email, p_email, ''), coalesce(p_address, ''),
    nullif(trim(coalesce(p_website, '')), ''), nullif(trim(coalesce(p_logo_url, '')), ''),
    coalesce(p_primary_color, '#1d4ed8'), p_default_payment_method,
    nullif(trim(coalesce(p_default_payment_handle, '')), ''),
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
-- get_public_quote: depositLink -> depositPaymentMethod/depositPaymentHandle/
-- depositAmountCents. Signature is unchanged, so create-or-replace is safe.
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
          'depositPaymentMethod', o.deposit_payment_method,
          'depositPaymentHandle', o.deposit_payment_handle,
          'depositAmountCents', o.deposit_amount_cents,
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
