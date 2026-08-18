-- 0024: record a financed sale as its own payment method.
--
-- The shop hands the customer to Snap/Acima/Progressive (see
-- shops.financing_offers, migration 0019), the lender pays the shop, and the
-- sale closes. Until now that had to be recorded as 'other', which made
-- financed revenue invisible in reporting — exactly the number a shop wants to
-- see when deciding whether the financing partnership is worth keeping.
--
-- This file contains ONE statement on purpose. Postgres refuses to use a new
-- enum label in the same transaction that added it, and the Supabase SQL
-- editor runs a script as a single transaction — so bundling this with
-- anything else produces "unsafe use of new value" (the same lesson migration
-- 0015 learned). Run this file by itself.

alter type invoice_payment_method add value if not exists 'financed';

-- Enum change — PostgREST caches the schema and will reject the new value
-- until it re-reads.
notify pgrst, 'reload schema';
