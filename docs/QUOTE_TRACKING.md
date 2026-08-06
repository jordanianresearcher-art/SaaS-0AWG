# Quote-open tracking

How the app tells a real customer opening their emailed quote apart from
staff previewing it from the dashboard — a strict requirement from the
product brief, and a real bug this round found and fixed.

## The bug

`quotes.public_token` was the *only* token in the system, and it was used
for two entirely different purposes at once:

1. The link embedded in the actual quote email (`send-quote-email`).
2. Staff's own "Open quote" / "Copy link" buttons on `QuoteDetailPage`,
   for internally previewing what the customer sees.

Both resolved to the exact same route, `/q/:publicToken`, and
`PublicQuotePage` called `record_public_quote_view()` unconditionally the
first time it loaded in a browser session (deduped only by
`sessionStorage`). So a staff member clicking "Open quote" to sanity-check
a quote before sending it — or just to glance at it later — silently
flipped the quote's status from `emailed` to `viewed` and logged a fake
"customer opened the quote" event. There was no way to tell the two apart.

## The fix

`email_messages` already *is* one delivery record per quote email (see
migration `0001`) — this round added three columns to it (migration
`0013`) rather than inventing a parallel table:

- `delivery_token uuid default gen_random_uuid()` — a distinct, opaque
  token per send, separate from `quotes.public_token`.
- `first_viewed_at timestamptz` — null until a real first view.
- `view_count integer` — deduplicated repeat-open count.

`send-quote-email` now inserts the `email_messages` row *before* building
the link (the subject line never depends on the URL — see the Edge
Function's `COPY` table — so this reordering is free), reads back that
row's `delivery_token`, and embeds it in the actual emailed link:
`{appUrl}/q/{publicToken}?d={deliveryToken}`. The opt-out link
deliberately does **not** carry it, so an email client's automated
unsubscribe-link prefetching can't masquerade as a customer view either.

A new SECURITY DEFINER RPC, `record_quote_delivery_view(public_token, delivery_token)`,
is the only thing that can ever record a real view or advance status. It:

1. Looks up the quote by `public_token` (must not be `draft`).
2. Returns immediately, doing nothing, if the caller is an authenticated
   member of that quote's own shop — a staff member somehow following the
   emailed link while logged in still doesn't count as a customer.
3. Looks up the `email_messages` row matching *both* `quote_id` and
   `delivery_token`, with `status in ('sent', 'demo_sent')` — a
   `previewed`/`failed` row (never actually sent) can't be used to fake a
   view either.
4. If no match: returns silently (doesn't leak whether a token is
   valid/invalid).
5. First view for that delivery: sets `first_viewed_at`, bumps
   `view_count`, inserts one `quote_events` row (`event_type: 'quote_viewed'`,
   `metadata: { source: 'email_delivery' }`), and advances
   `quotes.status` from `emailed` to `viewed` (advance-only, same rule
   this app already uses everywhere else).
6. Repeat view of the same delivery: just bumps `view_count`. No duplicate
   event, no re-triggering the status transition.

**Staff's bare link never carries a token, so it's structurally
impossible for it to do any of the above** — `QuoteDetailPage`'s "Open
quote"/"Copy link"/"Copy" all still use the plain `publicQuoteUrl(quote.publicToken)`
helper, unchanged. `PublicQuotePage` reads `?d=` from the URL; when it's
absent, `recordView(null)` is called and is a no-op by construction in
both `SupabaseRepository` and `DemoRepository` — there's no "is this a
preview?" flag being trusted anywhere, because the trustworthy signal
(does this link carry a real delivery token) is the only thing that
matters.

## The old RPC

`record_public_quote_view(public_token)` — the original, buggy,
bare-token function — is **not deleted**. It's redefined (migration
`0013`) to a true no-op: still callable without erroring (defense in
depth against a stale cached client build mid-deploy), but it never
writes an event or touches `quotes.status` again. Nothing in the app
calls it anymore.

**Historical data is untouched.** `quote_events` rows the old mechanism
already wrote — including any that came from a staff preview before this
fix shipped — are not deleted or retroactively reclassified; guessing at
which old `quote_viewed` events were "real" vs. staff-caused would be
worse than leaving the historical record alone. Only new events, from
this point forward, use the trustworthy mechanism.

## What staff see

`QuoteDetailPage`'s email history now shows "Opened {timestamp}" (plus a
view count once >1) under any email row with `firstViewedAt` set — this
only ever appears once a genuine customer view has been recorded through
that specific email's delivery link.

## Known limitations

- **Anti-bot dwell time / email-scanner false positives**: the product
  brief asks for a brief dwell before counting a view, to reduce false
  positives from corporate email security scanners that prefetch links.
  This round does not add an explicit dwell timer — `PublicQuotePage`
  already does real client-side rendering (not a simple pixel fetch)
  before calling `recordView`, which filters out the most naive scanners,
  but a scanner that fully renders the page would still count. A proper
  fix (e.g. requiring N seconds of visibility before firing) is a small,
  contained follow-up.
- **No separate `email_opened` (pixel) vs. `quote_viewed` (page render)
  distinction** — this app has no tracking-pixel infrastructure, so there
  is only one signal, page render via the delivery link. If pixel
  tracking is ever added, it should stay clearly separate and never drive
  `quotes.status`.
- **Legacy quote_viewed events are not reclassified** — see above. A
  quote whose status reached `viewed` before this round (possibly via a
  staff preview) keeps that status; nothing retroactively reverts it.
