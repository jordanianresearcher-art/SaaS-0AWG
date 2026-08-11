-- 0Gauge Recovery — replace the good/better/insane tier system with one
-- main package + optional named add-ons, and let a quote item carry a
-- product image so the customer email can show pictures of what they're
-- getting. Driven directly by shop feedback: "I need to remove the tiers
-- option, just want the main price, and price of certain optional
-- add-ons" + "need the customer to receive images of the products
-- they're getting in the email."
--
-- Why option_kind replaces both `tier` AND `recommended`: with exactly one
-- main package per quote, "the recommended option" and "the main option"
-- are now the same thing by construction — keeping both fields risked them
-- disagreeing (recommended pointing at a different option than the one
-- meant to be primary). One field, one meaning.

-- ---------------------------------------------------------------------------
-- quote_options: tier + recommended -> option_kind
-- ---------------------------------------------------------------------------

alter table public.quote_options add column option_kind text;

-- Backfill: the previously-recommended option becomes 'main'; if a quote
-- somehow had none marked recommended (shouldn't happen given the old UI
-- always defaulted one), fall back to its lowest-position option. Every
-- other option on the quote becomes 'addon'.
with picked_main as (
  select distinct on (quote_id) id
  from public.quote_options
  order by quote_id, (case when recommended then 0 else 1 end), position
)
update public.quote_options o
set option_kind = case when o.id in (select id from picked_main) then 'main' else 'addon' end;

alter table public.quote_options alter column option_kind set not null;
alter table public.quote_options add constraint quote_options_kind_check
  check (option_kind in ('main', 'addon'));

alter table public.quote_options drop column tier;
alter table public.quote_options drop column recommended;
drop type if exists public.quote_option_tier;

-- ---------------------------------------------------------------------------
-- quote_items: snapshot an image URL (from the catalog item or resolver
-- candidate it was added from) so the email/quote page can show a picture
-- without a live join back to catalog_items — same snapshot philosophy as
-- package_template_items.image_url.
-- ---------------------------------------------------------------------------

alter table public.quote_items add column image_url text;

-- ---------------------------------------------------------------------------
-- quotes: staff opt-in to show one extra "everything included" total line
-- (main + every add-on) alongside the per-add-on incremental pricing.
-- Defaults false — showing it is a deliberate choice, not automatic, since
-- some shops don't want to nudge customers toward stacking every upsell.
-- ---------------------------------------------------------------------------

alter table public.quotes add column show_full_addon_total boolean not null default false;

-- ---------------------------------------------------------------------------
-- get_public_quote: tier -> optionKind, items gain imageUrl, top-level
-- showFullAddonTotal. Signature unchanged, so create-or-replace is safe.
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
