-- Inventory merge, Slice 2 (data migration) — see docs/INVENTORY_MERGE_PLAN.md.
--
-- Copies car-audio-inventory's live data (items, settings, pos_invoices,
-- pos_invoice_items — all in this SAME Supabase project, per that app's own
-- 0005 migration comment) into this app's shop-scoped tables. Defined as a
-- callable function, not a bare script, so it's a genuine dry run/commit
-- workflow rather than hand-edited SQL:
--
--   select public.import_legacy_inventory('<shop-uuid>', true);   -- preview
--   select public.import_legacy_inventory('<shop-uuid>', false);  -- commit
--
-- Guarantees:
--  - Non-destructive. items/settings/pos_invoices/pos_invoice_items are
--    only ever SELECTed, never written or dropped, by this file.
--  - Idempotent. Re-running with dry_run = false is always safe — every
--    insert is `on conflict (id) do update`, keyed on the *same* uuid the
--    source row already has.
--  - Guarded. If the source tables don't exist (any install that never ran
--    car-audio-inventory), this is a documented no-op, not a broken
--    migration — this file is safe to leave in the permanent chain.
--  - Run as an admin (SQL editor / migration runner), not through the app,
--    so it writes directly rather than through apply_stock_movement (which
--    requires an authenticated auth.uid() the SQL editor doesn't have).
--
-- Run this only after confirming (Slice 0 in the plan doc) that both apps
-- really do point at the same Supabase project — if they don't, this
-- becomes a cross-project export/import instead and needs a different
-- script entirely.

-- ---------------------------------------------------------------------------
-- Best-effort free-text category -> product_category mapping. Mirrors
-- src/lib/categorize.ts's intent (never guesses; no match -> null, listed
-- for manual triage rather than silently miscategorized). Checked against
-- items.category first (an explicit synonym table, since shop-typed
-- category labels are arbitrary strings, not audio jargon), then against
-- items.name as a fallback using the same ordering categorize.ts uses
-- (more specific patterns before the broad ones they'd otherwise shadow).
-- ---------------------------------------------------------------------------

create or replace function public._legacy_category_to_enum(p_category text, p_name text)
returns product_category
language plpgsql
immutable
as $$
declare
  v_cat text := lower(coalesce(p_category, ''));
  v_name text := lower(coalesce(p_name, ''));
begin
  -- Pass 1: category label already names (or near-names) an enum value.
  if v_cat ~ 'enclosure|\ybox\y|ported|loaded' then return 'enclosure'; end if;
  if v_cat ~ 'subwoofer|\ysubs?\y' then return 'subwoofer'; end if;
  if v_cat ~ 'wiring kit|amp kit|wire kit|install.*kit|gauge kit|power kit' then return 'wiring_kit'; end if;
  if v_cat ~ 'mono.?block|mono.*amp' then return 'mono_amp'; end if;
  if v_cat ~ '[45].?(ch|channel)' and v_cat ~ 'amp' then return 'four_five_channel_amp'; end if;
  if v_cat ~ 'amp(lifier)?' then return 'multi_amp'; end if;
  if v_cat ~ 'line output converter|\yloc\y' then return 'integration'; end if;
  if v_cat ~ 'bass knob|bass control|bass remote|remote level control|\yrlc\y' then return 'bass_control'; end if;
  if v_cat ~ 'batter(y|ies)' then return 'battery'; end if;
  if v_cat ~ 'big.?three|big.?3\y' then return 'big_three'; end if;
  if v_cat ~ 'epicenter|bass restoration|bass reconstruction' then return 'epicenter'; end if;
  if v_cat ~ 'integration module|steering wheel control|\yswc\y|can.?bus' then return 'integration_module'; end if;
  if v_cat ~ 'sound (deadening|treatment)|dynamat|sound.?proof' then return 'sound_treatment'; end if;
  if v_cat ~ 'ofc|oxygen.?free' then return 'ofc_wiring'; end if;
  if v_cat ~ 'component speaker|coaxial|door speaker|speakers?\y' then return 'door_speaker'; end if;
  if v_cat ~ 'tweeter' then return 'tweeter'; end if;
  if v_cat ~ 'head unit|radio|receiver|stereo\y' then return 'radio'; end if;
  if v_cat ~ '\ydsp\y|sound processor|digital signal' then return 'dsp'; end if;
  if v_cat ~ 'camera|backup cam|dash cam' then return 'camera'; end if;
  if v_cat ~ 'fabrication|custom box|custom install' then return 'fabrication'; end if;
  if v_cat ~ '\ylabor\y|installation fee|install fee' then return 'labor'; end if;
  if v_cat ~ 'accessor(y|ies)' then return 'accessory'; end if;

  -- Pass 2: no usable category label — fall back to the product name,
  -- same specific-before-broad ordering as categorize.ts.
  if v_name ~ 'enclosure|\ybox\y|ported|sealed (sub|box)|bandpass|\yloaded\y' then return 'enclosure'; end if;
  if v_name ~ 'subwoofer|\ysubs?\y' then return 'subwoofer'; end if;
  if v_name ~ 'wiring kit|amp kit|wire kit|install(ation)? kit|gauge kit|power kit' then return 'wiring_kit'; end if;
  if v_name ~ 'mono.?block|mono.*amp' then return 'mono_amp'; end if;
  if v_name ~ 'amp' and v_name ~ '[45][ /-]*[45]?[ -]?(ch|channel)' then return 'four_five_channel_amp'; end if;
  if v_name ~ 'amp(lifier)?\y' then return 'multi_amp'; end if;
  if v_name ~ 'line output converter|\yloc\y' then return 'integration'; end if;
  if v_name ~ 'bass knob|bass control|bass remote|remote level control|\yrlc\y' then return 'bass_control'; end if;
  if v_name ~ '\ybatter(y|ies)\y' then return 'battery'; end if;
  if v_name ~ 'big.?three|big.?3\y' then return 'big_three'; end if;
  if v_name ~ 'epicenter|bass restoration|bass reconstruction' then return 'epicenter'; end if;
  if v_name ~ 'integration module|steering wheel control|\yswc\y|oem.*bypass|\ycan.?bus\y' then return 'integration_module'; end if;
  if v_name ~ 'sound (deadening|treatment)|dynamat' then return 'sound_treatment'; end if;
  if v_name ~ '\yofc\y|oxygen.?free' then return 'ofc_wiring'; end if;
  if v_name ~ 'component speaker|coaxial|door speaker' then return 'door_speaker'; end if;
  if v_name ~ 'tweeter' then return 'tweeter'; end if;
  if v_name ~ 'head unit|\yradio\y|receiver' then return 'radio'; end if;
  if v_name ~ '\ydsp\y|sound processor' then return 'dsp'; end if;
  if v_name ~ 'camera|backup cam|dash cam' then return 'camera'; end if;

  return null;
end;
$$;

-- ---------------------------------------------------------------------------
-- The import itself.
-- ---------------------------------------------------------------------------

create or replace function public.import_legacy_inventory(p_shop_id uuid, p_dry_run boolean default true)
returns jsonb
language plpgsql
as $$
declare
  v_has_items boolean;
  v_has_invoices boolean;
  v_item_count integer := 0;
  v_item_already integer := 0;
  v_unmapped jsonb := '[]'::jsonb;
  v_invoice_count integer := 0;
  v_invoice_item_count integer := 0;
  r record;
  v_category product_category;
  v_import_source product_import_source;
  v_existing_qty integer;
begin
  if p_shop_id is null then
    raise exception 'p_shop_id is required';
  end if;
  if not exists (select 1 from public.shops where id = p_shop_id) then
    raise exception 'No shop with id %', p_shop_id;
  end if;

  select exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'items')
    into v_has_items;
  select exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'pos_invoices')
    into v_has_invoices;

  if not v_has_items then
    return jsonb_build_object(
      'ran', false,
      'reason', 'No public.items table found — car-audio-inventory''s schema is not present in this database. Nothing to import.'
    );
  end if;

  -- ---- items -> catalog_items -------------------------------------------
  for r in select * from public.items loop
    v_category := public._legacy_category_to_enum(r.category, r.name);
    if v_category is null then
      v_unmapped := v_unmapped || jsonb_build_object('id', r.id, 'name', r.name, 'category', r.category);
    end if;

    v_import_source := case
      when coalesce(r.barcode_generated, false) then 'manual'
      when r.source = 'vision' then 'ai_photo_import'
      when r.source = 'barcode' then 'upc_lookup'
      else 'manual'
    end;

    if exists (select 1 from public.catalog_items where id = r.id) then
      v_item_already := v_item_already + 1;
    else
      v_item_count := v_item_count + 1;
    end if;

    if not p_dry_run then
      insert into public.catalog_items (
        id, shop_id, brand, model, name, category, description, sku, upc,
        default_price_cents, image_url, active, availability, import_source,
        identification_confidence, approval_status, quantity_on_hand,
        upc_is_generated, low_stock_threshold, last_counted_at,
        shopify_product_id, shopify_variant_id, shopify_synced_at,
        shopify_sync_error, shopify_matched_existing, shopify_status,
        created_at, updated_at
      ) values (
        r.id, p_shop_id, r.brand, null, r.name, v_category, r.description, null, r.upc,
        round(r.unit_price * 100)::bigint, r.photo_url, true, 'available', v_import_source,
        null, 'approved', greatest(r.quantity, 0),
        coalesce(r.barcode_generated, false), r.low_stock_threshold, r.last_counted_at,
        r.shopify_product_id, r.shopify_variant_id, r.shopify_synced_at,
        r.shopify_sync_error, coalesce(r.shopify_matched_existing, false),
        lower(coalesce(r.shopify_status, 'ACTIVE')),
        r.created_at, r.updated_at
      )
      on conflict (id) do update set
        shop_id = excluded.shop_id, brand = excluded.brand, name = excluded.name,
        category = excluded.category, description = excluded.description, upc = excluded.upc,
        default_price_cents = excluded.default_price_cents, image_url = excluded.image_url,
        import_source = excluded.import_source, quantity_on_hand = excluded.quantity_on_hand,
        upc_is_generated = excluded.upc_is_generated, low_stock_threshold = excluded.low_stock_threshold,
        last_counted_at = excluded.last_counted_at, shopify_product_id = excluded.shopify_product_id,
        shopify_variant_id = excluded.shopify_variant_id, shopify_synced_at = excluded.shopify_synced_at,
        shopify_sync_error = excluded.shopify_sync_error, shopify_matched_existing = excluded.shopify_matched_existing,
        shopify_status = excluded.shopify_status, updated_at = excluded.updated_at;

      -- One opening-balance movement per item, so the ledger isn't
      -- retroactively fictional — only on first import (checked by note,
      -- since this whole insert is otherwise re-runnable).
      if r.quantity > 0 and not exists (
        select 1 from public.stock_movements
        where catalog_item_id = r.id and note = 'Opening balance imported from car-audio-inventory'
      ) then
        insert into public.stock_movements (
          shop_id, catalog_item_id, movement_type, quantity_delta, note, created_at
        ) values (
          p_shop_id, r.id, 'adjustment', r.quantity,
          'Opening balance imported from car-audio-inventory', now()
        );
      end if;
    end if;
  end loop;

  -- ---- pos_invoices -> invoices, pos_invoice_items -> invoice_items -----
  if v_has_invoices then
    for r in select * from public.pos_invoices loop
      v_invoice_count := v_invoice_count + 1;
      if not p_dry_run then
        -- invoice_number is reassigned by the assign_invoice_number
        -- trigger regardless of what's inserted here — imported invoices
        -- get fresh sequential numbers per shop, interleaved with any
        -- invoices already created directly in 0Gauge. Every pos_invoices
        -- row is a completed POS sale with no status field of its own, so
        -- it imports as 'paid', fully paid, method 'other' — correct the
        -- payment method by hand afterward for any that need it.
        insert into public.invoices (
          id, shop_id, invoice_number, status, payment_method, payment_amount_cents,
          paid_at, subtotal_cents, total_cents, notes, tax_rate, tax_cents, discount_cents,
          customer_name, customer_phone, customer_email, customer_address,
          vehicle_year, vehicle_make, vehicle_model, created_at, updated_at
        ) values (
          r.id, p_shop_id, 0, 'paid', 'other', round(r.total * 100)::bigint,
          r.created_at, round(r.subtotal * 100)::bigint, round(r.total * 100)::bigint, r.notes,
          r.tax_rate, round(r.tax_amount * 100)::bigint, round(r.discount_amount * 100)::bigint,
          r.customer_name, r.customer_phone, r.customer_email, r.customer_address,
          nullif(r.vehicle_year, '')::integer, r.vehicle_make, r.vehicle_model, r.created_at, r.created_at
        )
        on conflict (id) do update set
          subtotal_cents = excluded.subtotal_cents, total_cents = excluded.total_cents,
          tax_rate = excluded.tax_rate, tax_cents = excluded.tax_cents, discount_cents = excluded.discount_cents,
          customer_name = excluded.customer_name, customer_phone = excluded.customer_phone,
          customer_email = excluded.customer_email, customer_address = excluded.customer_address,
          vehicle_year = excluded.vehicle_year, vehicle_make = excluded.vehicle_make,
          vehicle_model = excluded.vehicle_model;
      end if;
    end loop;

    for r in select * from public.pos_invoice_items loop
      v_invoice_item_count := v_invoice_item_count + 1;
      if not p_dry_run then
        insert into public.invoice_items (
          id, invoice_id, catalog_item_id, name, quantity, unit_price_cents,
          discount_percent, taxable, position
        ) values (
          r.id, r.invoice_id, r.item_id, r.description, r.quantity,
          round(r.unit_price * 100)::bigint, r.discount_percent, r.taxable, 0
        )
        on conflict (id) do update set
          name = excluded.name, quantity = excluded.quantity, unit_price_cents = excluded.unit_price_cents,
          discount_percent = excluded.discount_percent, taxable = excluded.taxable;
      end if;
    end loop;
  end if;

  return jsonb_build_object(
    'ran', true,
    'dry_run', p_dry_run,
    'items_new', v_item_count,
    'items_already_present', v_item_already,
    'items_with_unmapped_category', jsonb_array_length(v_unmapped),
    'unmapped_category_items', v_unmapped,
    'invoices', v_invoice_count,
    'invoice_items', v_invoice_item_count
  );
end;
$$;
