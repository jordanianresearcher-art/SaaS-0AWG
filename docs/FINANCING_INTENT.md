# Financing as a real CRM signal

Why this exists: this product's first real win came from a customer
clicking a plain "I need financing" response on their quote page — the
shop followed up and closed a $3,245 sale. That's not a hardcoded example
anywhere in this codebase; it's the reason this specific action gets
special treatment instead of being one of six equal-weight buttons.

## What already existed

`need_financing` was already a real `ResponseType`/`quote_response_type`
value, already flowing into `quote_responses`/`quote_events`, already
counted in the pilot report's recovery metrics (`financingRequests`), and
already visible in `QuoteDetailPage`'s "Customer responses" list. The gap
wasn't the data model — it was that the action was buried in a 6-choice
generic grid, wasn't idempotent server-side, and wasn't surfaced anywhere
a shop would actually notice it in time to follow up.

## What this round changed

### A real, prominent, one-tap action (`src/pages/PublicQuotePage.tsx`)

- Pulled `need_financing` out of the generic `RESPONSE_CHOICES` grid
  entirely — it's now its own large, bordered CTA directly under the
  priced options, styled in the shop's own color.
- Added a genuine "Choose this option" action per option card (this
  didn't exist before at all — there was no way for a customer to
  indicate which option they were even looking at except an optional
  dropdown buried inside the generic response panel). Selecting one sets
  `selectedOption`, which both the financing CTA and the generic response
  panel now share.
- Clicking "I need financing" submits immediately — no confirmation
  dialog, no required message field — carrying whatever option is
  currently selected (or `null` if none). It's meant to stay exactly as
  easy as the one that already worked once.
- The confirmation renders right where the customer tapped (not just in
  the response section further down the page), so there's no ambiguity
  about whether it went through.

### Idempotent, not just client-guarded (migration `0014`)

`submit_public_quote_response` now checks for a response of the *same
type* on the same quote within the last 2 minutes before inserting, and
treats a match as the same submission — no duplicate row, no duplicate
`quote_events` entry. This covers what a client-side `disabled` state
can't: a retried request after a timeout, or a second browser tab.
Applies to every response type, not just financing.

### Staff actually see it

- `QuotesPage`'s list now shows a "Needs financing" badge on any quote
  whose most recent response is `need_financing` and isn't in a terminal
  state (won/lost/expired) — visible without opening each quote.
- `QuoteDetailPage` shows a prominent banner at the top under the same
  condition.
- A new best-effort Edge Function, `notify-shop-response`, emails the
  shop (reusing the already-configured `RESEND_API_KEY`/`EMAIL_FROM` —
  no new secret) when a high-intent response (`need_financing` or
  `ready_to_book`) comes in. `PublicQuotePage` calls it fire-and-forget
  right after a successful submission; it never blocks or affects the
  customer's own confirmation, and demo mode never makes a real call. A
  cheap replay guard (only sends if a matching `customer_responded` event
  was recorded in the last 30 seconds) keeps a stale/retried call from
  re-notifying.

## What this round deliberately did not touch

- **Never auto-advances the quote past `responded`.** A financing request
  doesn't mark a quote accepted, paid, or financed — that's still a
  manual staff decision (Booked / Deposit paid / Won), unchanged.
- **No dedicated "option selected" tracking event.** Choosing an option
  is local UI state that rides along with whatever response is eventually
  submitted (financing or otherwise) — there's no separate
  `option_selected` row/event fired the instant a card is tapped. Adding
  that is a small, real, separate follow-up if the CRM timeline ever
  needs to distinguish "looked at an option" from "actually responded."
- **Quote-to-invoice conversion attribution** ("connect later conversion
  to invoice/closed-won so revenue can be attributed without hardcoded
  amounts") is explicitly deferred, not built shallowly. Quotes and
  invoices remain two unlinked systems this round — see the top-level
  handoff notes for why this was scoped out rather than rushed.
