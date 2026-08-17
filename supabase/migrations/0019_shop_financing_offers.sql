-- 0019: third-party financing offers on the shop.
--
-- Auto shops don't finance work themselves — they hand the customer to Snap,
-- Acima, Progressive, etc. Each shop has its own store-specific application
-- link from those providers, and "I need financing" is already one of the most
-- common responses on a public quote. This lets the shop attach those links so
-- every quote email and public quote page can hand the customer straight to
-- the application instead of waiting on a callback.
--
-- Stored as JSONB on shops rather than in its own table: the list is capped at
-- a handful of rows, it is always read together with the shop, and it needs no
-- access rules beyond the ones shops already has. Shape:
--   [{ "id": uuid, "name": "Snap Finance", "applicationUrl": "https://…" }]
-- The client sanitizes on read (src/lib/financing.ts), so a malformed row
-- degrades to "not shown" rather than breaking a customer-facing email.

alter table public.shops
  add column financing_offers jsonb not null default '[]'::jsonb;

alter table public.shops
  add constraint shops_financing_offers_is_array
  check (jsonb_typeof(financing_offers) = 'array');

-- ---------------------------------------------------------------------------
-- get_public_quote: add top-level financingOffers so the public quote page can
-- show the shop's real application links. Signature is unchanged, so
-- create-or-replace is safe (no drop needed).
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
    'financingOffers', case when jsonb_typeof(s.financing_offers) = 'array' then s.financing_offers else '[]'::jsonb end,
    'quoteDisclaimer', s.quote_disclaimer,
    'customerFirstName', c.first_name,
    'vehicle', jsonb_build_object(
      'year', c.vehicle_year,
      'make', c.vehicle_make,
      'model', c.vehicle_model,
      'trim', c.vehicle_trim
    ),
    'windowTints', case when jsonb_typeof(q.window_tints) = 'array' then q.window_tints else '[]'::jsonb end,
    'status', q.status,
    'expirationDate', q.expiration_date,
    'optedOut', (c.email_opt_out_at is not null),
    'showFullAddonTotal', q.show_full_addon_total,
    'options', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', o.id,
          'optionKind', o.option_kind,
          'name', o.name,
          'description', o.description,
          'priceCents', o.price_cents,
          'laborIncluded', o.labor_included,
          'depositPaymentMethod', o.deposit_payment_method,
          'depositPaymentHandle', o.deposit_payment_handle,
          'depositAmountCents', o.deposit_amount_cents,
          'items', coalesce((
            select jsonb_agg(
              jsonb_build_object(
                'brand', i.brand,
                'model', i.model,
                'name', i.name,
                'quantity', i.quantity,
                'description', i.description,
                'imageUrl', i.image_url
              ) order by i.position
            )
            from quote_items i where i.quote_option_id = o.id
          ), '[]'::jsonb)
        ) order by (case when o.option_kind = 'main' then 0 else 1 end), o.position
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

-- New column — PostgREST caches the schema and will 400 on financing_offers
-- until it is told to look again.
notify pgrst, 'reload schema';
