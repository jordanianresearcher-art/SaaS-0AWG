-- 0Gauge Recovery — make vehicle info optional on a quote. A shop can now
-- save a bare quote (just customer contact info) and fill in the vehicle
-- later via Duplicate, or never at all. The existing range check on
-- vehicle_year already passes on NULL automatically, so it needs no change.

alter table public.customers alter column vehicle_year drop not null;
alter table public.customers alter column vehicle_make drop not null;
alter table public.customers alter column vehicle_model drop not null;
