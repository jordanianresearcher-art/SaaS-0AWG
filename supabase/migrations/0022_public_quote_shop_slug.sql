-- 0022: expose the shop's slug on the public quote payload.
--
-- The "Book my install" CTA on the public quote page (/q/:publicToken)
-- links to the public booking wizard at /book/:shopSlug?quote=<token> — the
-- quote payload needs to carry that slug so the customer-facing page can
-- build that link without a second round trip. Signature is unchanged, so
-- create-or-replace is safe (no drop needed).

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
    'shopSlug', s.slug,
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

notify pgrst, 'reload schema';
