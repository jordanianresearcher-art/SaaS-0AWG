# 30-Day Pilot Playbook

How to run a 0Gauge pilot with an independent car-audio / window-tint shop and
convert it into a paid account.

The pitch is one sentence: *"Give me the quotes you already wrote that went
quiet. In a month I'll hand you a printed sheet showing what came back."*

The close is the **Day-30 printed report**. Everything below exists to make that
sheet honest and to make the number on it big.

---

## Who this is for

Shops that take customers by phone, text, and Facebook ads. No website, no
Shopify, inventory checked by eye. The owner usually answers the phone
themselves. That last fact drives most of the product decisions: everything is
designed for one busy person holding a phone, not a back-office team.

---

## Day 0 — Setup (30 minutes, in person)

1. Create the shop: name, phone, address, reply-to email, **logo** (upload —
   they'll have a file, not a URL), brand color, disclaimer.
2. Add financing options in Settings — **scan the QR code** off their Snap /
   Acima / Progressive counter card. Takes seconds and it's the single highest-
   converting thing on a quote (see `docs/FINANCING_INTENT.md`).
3. Set up booking: services with real durations, bays, business hours. If they
   take deposits, set the deposit amount.
4. Add the owner and one employee.
5. Hand a phone or tablet a **shop access code** (Settings → Shared device) so
   anyone on the floor can scan inventory without an account.
6. Send a test quote email to the owner's own phone so they see exactly what a
   customer gets.

## Eligible customers

Only enter customers who:

- Asked the shop for a quote (walk-in, phone, or referral)
- Left a working email address
- Were quoted in the last ~60 days (fresher is better)
- Have not already bought or clearly refused

Skip cold lists, purchased leads, and anyone who never asked. That protects the
shop's sender reputation and keeps the pilot honest — a recovered-revenue number
built on spam is worthless to both of you.

## Quote preparation

- Build one **main package** at the real installed price, plus any **add-ons**
  priced as the incremental cost on top. (The old Good/Better/Insane tiers are
  gone — shops found three full alternatives confusing to explain on the phone.)
- Set the expiration (default 30 days) — it gives the follow-ups a reason.
- Use real installed prices; the report is only as honest as the quotes.

---

## The email sequence — now automatic

| Day | Template | Purpose |
| --- | --- | --- |
| 0 | Initial quote | Deliver the quote link (**staff presses Send**) |
| 2 | Two-day check-in | "Any questions?" nudge |
| 5 | Financing / lower-cost option | Remove the price objection |
| 10 | Final check-in | Polite last touch, then stop |

**The first email is always a human decision. Everything after it sends
itself** — that's what makes the cadence survive a busy week.

The machine stops immediately and permanently when the customer replies, books,
opts out, the quote expires or closes, or the sequence finishes. It never starts
a conversation on its own. Per-shop switch in Settings; per-quote pause on any
quote.

Subject lines are written per job type — bass hooks for audio, heat hooks for
tint — and never repeat across the four touches.

**Texts are never automatic.** Every quote row and appointment has a "Text"
button that opens the owner's own messaging app with the message already
written, name filled in. It comes from the number the customer recognizes.

How to say this to an owner: *"The emails chase the quote for you and know when
to stop. The texts always come from you."*

---

## Booking and no-shows

The phone script the product is built around:

> *"I've got you tomorrow at 2. You'll get a text with the details — and a link
> for the $20 deposit that holds the slot."*

- Staff booking on the phone holds the slot immediately; the deposit is a
  request. Regulars still get the owner's grace.
- Customers booking themselves online hold the slot only once the deposit is
  paid.
- A reminder goes out ~24 hours before every appointment, automatically. The
  owner can also fire a personal text with one tap.

A no-show costs a tint bay $200–400 that can't be resold that day. Deposits and
reminders are the whole argument for the monthly price.

---

## Inventory (the stickiness play)

Never say "inventory management" — they've ignored that pitch for decades. Say:

> *"Never tell a customer you're out of something that's sitting on your shelf,
> and never buy a case of what's already in the back."*

- Scan a product; if it's unknown, the app looks it up (barcode → free UPC
  database → AI + web search) and fills in brand, model, specs, and a photo.
- No barcode on the box? The app generates a code and prints a 4×6" label.
  After that it scans instantly, forever, with no lookup cost.
- "Check stock" mode lets anyone walk the shelves with a phone.

Quiet upside worth knowing but not pitching on Day 0: after a few months of
ordinary use the shop owns a complete, photo-rich, consistently named product
database — which is exactly what a Shopify launch needs. That's a natural
upsell later.

---

## Metrics on the report

Eligible quotes · total quoted value · quote emails sent · **follow-ups sent
automatically** · quote views · responses · cheaper-package requests · financing
requests · **appointments booked** · **reminders sent** · **show rate** ·
**no-shows** · deposits collected · won jobs · **recovered revenue**.

## What counts as a qualified result

A **recovered sale** is a quote that (a) had gone quiet before the pilot,
(b) received at least one pilot email, and (c) was marked Won during the pilot
window with a real sale amount.

Appointments, reminders, deposits, and show rate are leading indicators — real,
and worth showing, but not revenue. Don't blur the line.

---

## Day 7 — first check-in

Print the 7-day report and review it in person. Talking points: views prove the
emails land; responses prove customers engage; a single booked appointment
already justifies attention.

Adjust here: add more eligible quotes, tighten prices, fix the reply-to address
if replies aren't arriving, confirm financing links actually open.

## Day 30 — the close

Print the 30-day report. Put recovered revenue next to the monthly price.

> *"This found $X you had already earned and nearly lost, and it kept $Y worth
> of bay time from walking. It costs $Z a month. Want to keep it running?"*

If recovered revenue is zero, say so plainly. Review whether the quote list was
really eligible, and either extend or part as friends. **Never dress up the
numbers — the printed report is the product.**

---

## Converting to paid

1. Owner keeps the same account — nothing to migrate.
2. New quotes go in as normal business, not just recovery.
3. Set up their own Resend sending domain if the pilot used a shared sender.
4. If they're taking card deposits, connect their own Stripe.
5. Schedule a check-in to review the first full month after conversion.
