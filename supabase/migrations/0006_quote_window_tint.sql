-- 0Gauge Recovery — window tint spec on a quote. Purely descriptive (no
-- price attached, no line-item integration) — a fixed-shape blob describing
-- which windows get tinted and at what percentage, shown to staff and the
-- customer alongside the vehicle info. Stored as a single JSONB column
-- rather than a normalized table, same precedent as quote_events.metadata
-- and shops.follow_up_schedule_days — no per-window query/reporting need.

alter table public.quotes add column window_tint jsonb;

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
    'windowTint', q.window_tint,
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
