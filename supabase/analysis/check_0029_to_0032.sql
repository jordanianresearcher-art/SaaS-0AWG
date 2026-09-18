-- Did migrations 0029-0032 actually land? Read-only, safe to run any time.
--
-- Probes each migration's real effect rather than trusting bookkeeping: a
-- column, a function, a table. Run it after pasting all four. Every row
-- should say YES.

select '0029 financing clicks'  as migration,
       case when exists (select 1 from pg_proc where proname = 'record_financing_click')
            then 'YES' else 'NO — paste 0029' end as applied
union all
select '0030 review requests',
       case when exists (select 1 from information_schema.tables
                          where table_schema='public' and table_name='review_requests')
             and exists (select 1 from information_schema.columns
                          where table_schema='public' and table_name='shops' and column_name='review_link')
            then 'YES' else 'NO — paste 0030' end
union all
select '0031 counter shortcut',
       case when exists (select 1 from information_schema.columns
                          where table_schema='public' and table_name='shops' and column_name='review_intake_token')
            then 'YES' else 'NO — paste 0031' end
union all
select '0032 custom domains',
       case when exists (select 1 from information_schema.columns
                          where table_schema='public' and table_name='shops' and column_name='custom_domain')
            then 'YES' else 'NO — paste 0032' end
order by 1;
