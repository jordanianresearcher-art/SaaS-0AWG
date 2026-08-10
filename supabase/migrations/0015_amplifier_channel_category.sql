-- 0Gauge Recovery — a dedicated "4/5-channel amplifier" product category.
-- Previously every multi-channel amp (2, 3, 4, 5, 6+ channels) landed in
-- the single generic `multi_amp` bucket. 4/5-channel amps are common and
-- distinct enough in car audio (they're what powers a front+rear speaker
-- set, or front+rear+sub off the 5th channel) to deserve their own
-- category rather than staying lumped in with everything else — staff
-- asked for this specifically. `multi_amp` still covers 2/3/6+-channel amps.
--
-- Purely additive: a new enum value, nothing existing changes meaning.
-- Existing catalog_items/quote_items/invoice_items rows already
-- categorized as multi_amp are untouched — this is a new option going
-- forward, not a retroactive reclassification (see docs/CATALOG_AND_PACKAGES.md's
-- "adapt existing tables when equivalent behavior exists" precedent — this
-- is the "add a genuinely new value" case, not an equivalent-behavior one).

alter type product_category add value 'four_five_channel_amp';
