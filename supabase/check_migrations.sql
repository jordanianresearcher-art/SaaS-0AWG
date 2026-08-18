-- Which migrations are actually applied to this database?
--
-- Use this instead of supabase_migrations.schema_migrations when that table
-- is empty or untrustworthy — which is the case on this project, because the
-- schema was applied by hand (SQL editor / dashboard) rather than through
-- `supabase db push`, so the CLI's tracking table never got written.
--
-- This probes for each migration's actual effect (a table, a column, an enum
-- value, a function body) rather than trusting bookkeeping. Run it in the
-- Supabase SQL editor. Every row should read `applied = true`; anything false
-- means that migration's SQL still needs to run, in ascending order.
--
-- Note on 0005 and 0007: 0005 only DROPs NOT NULL constraints and 0007 only
-- changes the shape of a JSONB blob, so neither leaves a distinctly
-- detectable schema fingerprint. 0005 is probed via nullability below; 0007
-- has no probe and effectively rides along with 0008.

select migration, applied
from (
  values
    ('0001 init',
     to_regclass('public.quotes') is not null),

    ('0002 platform admin',
     to_regclass('public.platform_admins') is not null),

    ('0003 catalog items',
     to_regclass('public.catalog_items') is not null),

    ('0004 deposit payment methods',
     to_regtype('public.payment_method') is not null),

    ('0005 nullable vehicle fields',
     exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'customers'
               and column_name = 'vehicle_year' and is_nullable = 'YES')),

    ('0006 quote window tint',
     exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'quotes'
               and column_name in ('window_tint', 'window_tints'))),

    ('0008 window tint multiple',
     exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'quotes'
               and column_name = 'window_tints')),

    ('0009 catalog product model',
     to_regtype('public.product_category') is not null),

    ('0010 package templates',
     to_regclass('public.package_templates') is not null),

    ('0011 inventory + invoices',
     to_regclass('public.invoices') is not null
       and to_regclass('public.stock_movements') is not null),

    ('0012 product resolution cache',
     to_regclass('public.product_resolution_cache') is not null),

    ('0013 quote delivery tracking',
     exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'email_messages'
               and column_name = 'delivery_token')),

    ('0014 response idempotency',
     exists (select 1 from pg_proc p
             join pg_namespace n on n.oid = p.pronamespace
             where n.nspname = 'public'
               and p.proname = 'submit_public_quote_response'
               and pg_get_functiondef(p.oid) like '%2 minutes%')),

    ('0015 four/five channel amp',
     exists (select 1 from pg_enum e
             join pg_type t on t.oid = e.enumtypid
             where t.typname = 'product_category'
               and e.enumlabel = 'four_five_channel_amp')),

    ('0016 addons + item images',
     exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'quotes'
               and column_name = 'show_full_addon_total')),

    -- Checks for the *corrected* definitions specifically (search_path
    -- includes `extensions`, where Supabase installs pgcrypto) — an older,
    -- broken 0017 would read as unapplied here even if some earlier attempt
    -- got partway through, which is the honest answer: it needs re-running.
    ('0017 inventory merge',
     to_regclass('public.join_attempts') is not null
       and exists (select 1 from pg_proc p
                   join pg_namespace n on n.oid = p.pronamespace
                   where n.nspname = 'public'
                     and p.proname = 'join_shop_with_access_code'
                     and pg_get_functiondef(p.oid) like '%extensions%')),

    ('0018 shop logo storage',
     exists (select 1 from storage.buckets where id = 'shop-logos')),

    ('0019 shop financing offers',
     exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'shops'
               and column_name = 'financing_offers')),

    ('0020 import legacy inventory',
     exists (select 1 from pg_proc p
             join pg_namespace n on n.oid = p.pronamespace
             where n.nspname = 'public'
               and p.proname = 'import_legacy_inventory'))
) as t(migration, applied)
order by migration;
