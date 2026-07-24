-- 0Gauge Recovery — window tint pricing (tint type, base job price,
-- old-tint removal, windshield price). No DDL needed: window_tint is
-- already a schemaless jsonb column, so the new keys just appear on
-- future writes. This defensively backfills tintType/removeOldTint onto
-- any pre-existing window_tint blob from before pricing existed, so old
-- records read back with sensible values rather than relying solely on
-- application-level (?? default) guards.

update public.quotes
set window_tint = window_tint || jsonb_build_object(
  'tintType', coalesce(window_tint->>'tintType', 'normal'),
  'removeOldTint', coalesce((window_tint->>'removeOldTint')::boolean, false)
)
where window_tint is not null
  and (window_tint->>'tintType' is null or window_tint->>'removeOldTint' is null);
