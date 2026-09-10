-- 0027: record what brought a won job back.
--
-- Recovered revenue is this product's entire claim, and after five weeks of
-- pilot use it rests on nothing but "somebody tapped Mark won". Eight jobs are
-- recorded as won and not one row anywhere says why. That makes the number
-- indefensible against the one question every prospect asks:
--
--   "No — I closed those on the phone. I'd have gotten them anyway."
--
-- Nobody can reconstruct the answer later. The person who closed the deal knew
-- it at the moment they marked it won, and the app never asked. One nullable
-- column, six allowed values, asked once at Mark won.
--
-- Nullable on purpose, and not backfilled. NULL means "never asked" — every
-- win recorded before this migration, plus any staff member who skips the
-- question. It is deliberately distinct from 'unsure', which means the app
-- asked and the answer was genuinely unknown. Collapsing those two would hide
-- the fact that only one of them gets better as the pilot runs.
--
-- The allowed values mirror WIN_SOURCE_OPTIONS in src/lib/winSource.ts, which
-- also carries the app/shop attribution split. Keep the two lists in step: a
-- value the app can write but the check rejects surfaces to a shop owner as a
-- failed Mark won, mid-sale.

alter table public.quotes
  add column win_source text
  check (
    win_source is null
    or win_source in ('quote_reply', 'follow_up', 'financing', 'we_reached_out', 'walked_in', 'unsure')
  );

comment on column public.quotes.win_source is
  'What brought this won job back, as staff reported it at Mark won. NULL = never asked (includes every win before 2026-09). '
  'quote_reply/follow_up/financing are attributable to the app; we_reached_out/walked_in are the shop closing it itself; '
  'unsure means asked and unknown. Mirrors WIN_SOURCE_OPTIONS in src/lib/winSource.ts.';

-- Reporting reads this alongside won_amount_cents, always filtered to won
-- quotes for one shop. Partial index so the ~91% of quotes that never reach a
-- win cost nothing to skip.
create index if not exists quotes_win_source_idx
  on public.quotes (shop_id, win_source)
  where win_source is not null;

-- No RLS change. quotes already carries a per-shop policy from 0001 and this
-- column rides on it; nothing here is exposed to the public quote payload.
