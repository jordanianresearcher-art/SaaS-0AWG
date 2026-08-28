# 0Gauge Recovery — Project & Pilot Brief

*A complete, self-contained briefing on the product, the first customer, the data,
and the open business questions. Written to be handed to an advisor (human or AI)
with no access to the codebase. Last updated August 2026.*

---

## 1. What this is

**0Gauge Recovery is shop software for independent car-audio and window-tint
shops.** Quote a customer, email it, see when they open it, follow up
automatically, book the install, take a deposit, invoice at the counter, and keep
the shelves straight — all from a phone.

The thesis in one breath: *the quote a shop didn't follow up on is revenue it
already earned and lost; the product a shop can't identify is a sale it slowed
down.* The app exists to recover both. The name comes from 0-gauge OFC wire — the
thick copper power cable at the heart of every serious install — and the app
wears it: dark instrument-panel chrome with copper accents, styled after amp
faceplates.

It is built to be **sold in person to family-owned shops**: big buttons, plain
language, phone-first layout, scan-first data entry, and no required fields
anywhere. The internal positioning line: *"Booksy for auto shops — but the
differentiator is that the quote is the funnel."* A tint job is ~$375; an audio
install is ~$2,400–3,200. Generic booking software gets three things wrong for
this trade: job duration depends on the vehicle, not the service; capacity is
bays, not staff; and jobs are measured in hours, not minutes.

**Stack, one line:** React/Vite progressive web app on Cloudflare (static bundle,
no server of its own) · Supabase (Postgres with row-level security, Auth via
magic links, Edge Functions for anything secret-bearing) · Resend for email · AI
product lookup through any OpenAI-compatible endpoint, provider-agnostic by
design. ~120 commits over roughly five weeks (July 18 – late August 2026), 49
test files, ~727 passing tests.

**The origin story that shapes everything:** the product's first real win came
from a customer tapping a plain **"I need financing"** button on their emailed
quote page. The shop followed up and closed a **$3,245 sale**. That one event
drove a series of decisions: financing is a first-class call-to-action in the
shop's own color, high-intent responses email the shop instantly, and the whole
product philosophy became *make the customer's next step effortless and put the
signal in front of the owner fast.*

---

## 2. The customer, and the pilot: Super Car Audio

### Who this is for

The target shop takes customers by phone, text, and Facebook ads. No website
worth the name, no e-commerce, inventory checked by eye, and the owner answers
the phone personally. That last fact drives most product decisions: **everything
is designed for one busy person holding a phone.** Quotes happen mid-phone-call.
Scanning happens with a laser scanner tethered to that same phone, eyes on the
pallet, not the screen.

### The pilot shop

**Super Car Audio, Dallas** (supercaraudio.com) is the first real customer.
The pilot so far, as it actually happened:

- The owner signed up through the app's own self-serve signup, created the shop,
  and onboarded branding (logo, colors) through the real onboarding flow.
- Email sending was set up on the shop's own domain — including diagnosing a real
  DNS mess: the wrong domain configured at first, the right one
  (supercaraudio.com) hosted at WordPress.com, three DNS records added by the
  owner, and quotes now sending as `Super Car Audio <quotes@supercaraudio.com>`.
- The shop has a Shopify store; the app can import its catalog (the import
  mapping is tested against real Super Car Audio product data — a Nemesis Audio
  NA-8SLM subwoofer is the canonical test fixture).
- The shop exported its hand-kept inventory spreadsheet — **123 products** — and
  that export became the app's test fixture and its most instructive dataset
  (next section).
- Real daily use surfaced real failures: barcodes no database could resolve,
  product lookups that took 88 seconds, mobile sign-in links that mail apps
  silently destroyed, degenerate AI answers landing in the catalog. Every one of
  those became a fix and a design principle (section 7).

### The pilot playbook (go-to-market, as documented)

The pitch, verbatim from the playbook: *"Give me the quotes you already wrote
that went quiet. In a month I'll hand you a printed sheet showing what came
back."* Day-0 setup is 30 minutes, in person, and includes scanning the QR code
off the shop's Snap/Acima/Progressive financing counter card — "the single
highest-converting thing on a quote." The close at day 30 is a **printed
report**: 15 metrics, with a strict definition of a "recovered sale" (went quiet
before the pilot, received at least one pilot email, marked Won with a real
amount during the window). The playbook's own words: *"Never dress up the
numbers — the printed report is the product."* Pilots are free and
hand-onboarded; billing code deliberately doesn't exist yet.

---

## 3. What the pilot's data taught us

The 123-product export is the ground truth this market runs on, and it is worth
staring at. (The full catalog is Appendix A. Stock quantities are excluded — they
are the shop's private numbers.)

### Barcode reality

| Class | Count | Share |
|---|---|---|
| Valid UPC-A (scannable, check digit verifies) | 75 | 61% |
| Valid EAN-13 (incl. Russian- and Chinese-prefix imports) | 12 | 10% |
| Valid EAN-8 | 1 | 1% |
| **Total resolvable by scanning** | **88** | **72%** |
| No barcode at all (spreadsheet shows `0.0` — Excel mangled a blank — or `o`) | 24 | 20% |
| Manufacturer part number / serial as the "barcode" (e.g. `FR-M800.4D11250239`) | 8 | 7% |
| Digits at a non-barcode length (16–24 digits: double-pastes, unknown codes) | 3 | 2% |

**The headline: more than a quarter of a real shop's inventory can never be
resolved by any barcode database, at any price.** House-brand and importer
products (Nemesis Audio above all — roughly 47 of the 123 rows) ship with serial
stickers or nothing. This single fact drove the app's core inventory design:
*identify a product once — by hand if necessary — bind whatever code is on the
box to it, and never pay for that identification again.*

### Data quality as found

- One barcode (`650905749735`) is reused across **nine different products** —
  different speaker models, one code.
- One "barcode" is a barcode pasted twice into one cell
  (`810005184656810005184656`).
- The same product appears twice under different names and spellings (an
  AudioControl speaker set, a JVC head unit, JBL speakers as both "JBL" and
  "JBC HARMAN").
- Typos throughout: MIBDASS, MEADIA, CHENNEL, SPEKERS, RANDE — this is a
  hand-typed spreadsheet maintained between customers.

None of this is a criticism of the shop. **It is the market.** Every independent
shop's inventory looks like this, because the tools they were offered never fit
how they work. The mess is the opportunity.

### Brand mix (what an independent actually stocks)

Dominated by house/importer brands: Nemesis Audio ("NA", ~47 rows), DS18, Deaf
Bonce/Apocalypse/Machete (Russian EAN prefix), PRV Audio, Down4Sound, Diablo,
Memphis. Mainstream fill: JBL/Harman, Kicker, AudioControl, Soundstream,
Blaupunkt, Infinity, SSL, and head units from Alpine, Pioneer, JVC, Kenwood.
Security and remote start: Viper/Directed, Avital, Excalibur. And — important —
**vehicle-integration parts: PAC AmpPro/RadioPro modules and a Maestro kit**,
which is why vehicle fitment became a feature (section 4).

### What testing against this data proved

The 123 rows are a permanent test fixture. All 88 retail barcodes classify and
check-digit correctly; internal codes and serials are refused *before* any
network call is spent on them; and **369 realistic typed queries** (models typed
as printed, run together, or half-typed) surface the right product every time.
When "search felt slow and inaccurate," the data showed the ranking was fine —
the architecture just wasn't consulting the shop's own catalog first. Real data
kept the diagnosis honest.

---

## 4. What's built — feature by feature

**Quotes.** One main package at a real installed price, plus optional add-ons
priced as increments. (The original Good/Better/Best tiers were removed on
direct shop feedback — three full alternatives were confusing to explain on the
phone.) Nothing on the form is required. A drag-and-drop package builder is the
primary way products go on a quote — tap or drag off a catalog tray, one
deliberate "put these on the quote." Packages can be saved as reusable
templates.

**The public quote page.** Customer gets a link (their first name only —
privacy by design), sees product photos, one price, and one-tap responses. "I
need financing" is the big CTA in the shop's color. Views are tracked
trustworthily (staff previewing a quote can't fake a customer open — that was a
real bug, fixed structurally). Responses are idempotent and rate-limited.

**Follow-up automation — the "recovery" engine.** The first email is always a
human decision; everything after it sends itself on a schedule (day 2, day 5
with the financing/lower-cost angle, day 10 final) and knows when to stop.
Playbook line for the owner: *"The emails chase the quote for you and know when
to stop. The texts always come from you"* — SMS is deliberately not automated
(US carrier registration is weeks of per-shop compliance; and a text from the
owner's own number lands better). Tap-to-text prefills are provided instead.

**Booking.** Staff calendar with one column per bay (capacity is bays, not
staff), a booking flow built around the phone call it happens during —
"next opening: Thursday 2:00 PM" in one tap, reschedule without destroying the
customer's manage link. Public self-serve booking at the shop's own URL,
optionally pre-filled from a quote. Automated 24-hour reminders ("the no-show
killer" — a no-show costs a tint bay $200–400 that can't be resold). Deposits
by Zelle/CashApp/Venmo/PayPal handle with a staff "received" toggle.

**Counter sales / invoicing.** A scan-to-invoice workspace: point a laser
scanner (they type like keyboards — the app distinguishes scanner keystrokes
from human typing by timing), build the cart, take payment including *financed*
as its own method so financed revenue is visible in reporting, email the
invoice. Selling a product the catalog doesn't know files it into the catalog
on the way past — the catalog builds itself as a side effect of ordinary work.

**Rapid intake.** Scan-first batch receiving: scan the whole pallet, quantities
merge per code, identification runs behind, review once at the end. A typed
lane for boxes with no barcode. On phones, a fixed thumb-sized quantity bar
shows the box just scanned, and every registered scan vibrates the phone — the
operator never has to look. AI identifications arrive as **options with a
human decision**, never as silent fact.

**Product identification — the ladder.** Every lookup climbs, cheapest first:

1. **The shop's own catalog** — in-memory, ~200 ms, free.
2. **The shared cross-shop catalog** — a product any shop identified once is
   free and instant for every other shop. Strict privacy boundary: brand,
   model, specs, photo, barcode, manufacturer list price are shared; **prices,
   costs, stock levels, and customers are never shared** (enforced in code and
   tested with sentinel values).
3. **Live retailer storefront search** — the specialist stores this trade buys
   from run ordinary storefront platforms whose own search endpoints return
   name, live price, image, and URL in under a second, free. Two or more real
   listings end the search — no AI call at all.
4. **A barcode database** (free tier) for scanned codes.
5. **AI with live web search** — only for the long tail, under a hard 40-second
   budget, with prompts that name the exact retailers and manufacturers to
   search. Answers whose text has structurally collapsed (repetition loops) are
   rejected before they can become a catalog entry.

**Vehicle fitment.** PAC, Metra, Scosche, Axxess, Maestro parts are
vehicle-specific — "what does this fit?" IS the product question. The app looks
up the manufacturer's published application list, a human approves it, and the
inventory list gains a "Fits vehicle" chooser: make, model, year → the parts on
the shelf that fit that truck.

**Labels.** Generated Code 128 codes for products that have none, printed as
4×6" sheets, six labels up, sized to scan reliably.

**Financing offers.** The shop's Snap/Acima/Progressive application links,
captured by scanning the QR code off their counter card, rendered on quotes and
emails.

**Multi-tenant platform.** Row-level security isolates every shop on every
table. A platform-admin console creates shops and invites owners; the admin
role is grantable only by direct SQL — deliberately no in-app path. A shared
low-privilege "inventory" role lets any device join via a shop access code and
count stock without ever seeing revenue.

**Demo mode.** A fully seeded fictional shop ("Big Tex Audio," Dallas) that
runs entirely in the browser with no backend — every flow demoable in a
walk-in sales conversation, honestly labeled, never faking a "delivered" email.

**Reporting.** The owner's home screen answers "how much money did this make
me" over a 60-day default window (quote-to-install regularly runs past a
month), plus the printable pilot report — *"a printed chart is decoration, a
printed number is an argument."*

---

## 5. The economics of product lookup (a story worth telling an advisor)

Product lookup went through three architectures in five weeks, and the cost
curve is the lesson:

1. **Pure AI web search** (v1): every typed query was a grounded model call.
   Measured reality at the pilot shop: a self-test clocked **88.2 seconds**,
   and per-keystroke costs drained a prepaid AI account during normal use.
2. **Fixes on the same architecture**: caching, a cheaper provider behind a
   generic OpenAI-compatible endpoint (three secrets, no code change), model
   auto-discovery so a retired model ID can't kill the feature, a fault-aware
   retry ladder, hard latency budgets. Better, still fundamentally slow.
3. **Retailers first** (current): ask the stores' own public search endpoints —
   ~1 second, $0, live prices and photos — and reserve AI for what no store
   carries. Most lookups now cost nothing and feel instant, and the AI spend
   became a long-tail line item instead of a per-keystroke tax.

Layered over all of it, the **shared catalog compounds**: every one-time
identification any shop performs (including the hand-identifications no
database could ever sell) becomes a free instant answer for every future shop.
Marginal lookup cost trends toward zero as the network grows — *the data asset
is the moat, and it accretes from ordinary daily work.*

---

## 6. Architecture in one page

- **Client-heavy PWA.** The frontend is a static bundle on Cloudflare; there is
  no application server. Postgres row-level security is the security model —
  every table gated by shop membership, public access only through sanitized
  `SECURITY DEFINER` functions with rate limits (20 views/quote/hour, 3 email
  sends/quote/day, etc.).
- **Edge Functions for secrets.** Email keys and AI keys exist only as
  Supabase Edge Function secrets. Nothing secret ever reaches the browser.
- **The naming contract.** Brand / model / descriptor are separate fields,
  canonicalized at one choke point on write, so "kicker," "KICKER," and
  "Kicker Audio" are one brand. Consistency comes from structure, not
  discipline.
- **Tests where bugs are expensive or invisible.** ~727 tests concentrated on
  money math, scheduling, barcode identity, email eligibility, and the parsing
  layers — with the pilot shop's real 123 products as a permanent fixture. Test
  hygiene includes *mutation verification*: deliberately breaking code to prove
  the test actually fails.
- **The mirror rule.** Server-side Deno code can't import the app's libraries,
  so critical pure logic exists twice — and an automated test runs both copies
  over the same inputs so they can never silently drift.
- **Deploy topology (and its cost).** The app auto-deploys from git via
  Cloudflare; Edge Functions deploy only when a human runs one command;
  database migrations are applied by hand in the Supabase dashboard. Three
  pipelines, one human — and the skew between them caused several real
  incidents (section 7). 26 migrations to date.

---

## 7. Hard lessons (told honestly)

1. **Deploy skew is the #1 operational hazard.** The app updating while the
   backend function stayed stale produced "it's still broken" reports that were
   really "half of it shipped." Fixes: a self-test button in Settings that
   reports the deployed function's exact version, per-store health probes, and
   a pre-deploy type-checker that caught a crash before it shipped.
2. **Mobile magic links get eaten by mail apps.** Email scanners prefetch
   links and burn single-use auth URLs. The fix is an app-owned confirmation
   page — and it's a required setup step, documented in bold, because every
   shop owner signs in from a phone.
3. **A per-call timeout is not a latency guarantee.** Six sequential 25-second
   calls is 150 seconds of spinner. Budgets must bound the *whole request*.
4. **Well-formed AI output can be meaningless.** A repetition-looped answer
   parses, validates, and lands in the catalog as a product named
   `A100-P-P-P-P-P-cd-cd-corp`. Schema validation is not truth validation.
5. **AI proposes, humans decide — as product law.** Every AI identification is
   now an option a person confirms: intake alternates, fitment previews,
   candidate pick lists. Error reduction came from interaction design, not
   from a better model.
6. **Real data beats synthetic tests.** Invented test products are tidy; the
   pilot's spreadsheet found the truth (and vindicated the ranking logic).
7. **Charge nothing until the printed number exists.** The playbook's
   discipline: the day-30 report is the sales instrument; if recovered revenue
   is zero, say so plainly.

---

## 8. Not built / open items

**Blocked on the owner:** Stripe Connect card deposits (needs the shop's
Stripe keys; the Zelle/Venmo-handle path ships instead); running the Shopify
import against Super Car Audio's live store end-to-end; a couple of database
migrations and the latest backend function deploy are applied by hand and lag
the code at any given moment.

**Designed but not built:**
- Vendor receiving and outgoing-order document types (tiles exist, marked
  "Soon").
- Voice ordering (record → transcribe → parse → fuzzy-match against catalog).
- Bulk photo onboarding — shelf photos → multi-product identification → owner
  review queue. Deferred; the single-photo path exists.
- An owner approval screen for staff-saved package templates (plumbing exists,
  UI doesn't).
- "This combination won N jobs — make it a package?" intelligence (the data is
  recorded; nothing queries it yet).
- Customer-facing visual quote redesign (images-first, plain-language
  outcomes).
- Quote-to-invoice attribution — quotes and invoices remain two unlinked
  systems, so "recovered revenue" relies on staff marking Won.
- Phase 1 polish list: QR code for the public quote, quote duplication,
  customer history, PWA install prompt, auto-expiration, pagination.

**The long-game roadmap (phases 3–5, unbuilt by design):**
- **Package Page Generator** — per-vehicle shareable landing pages for a
  shop's signature packages, printable QR codes, funneling into quote requests.
- **Digital Build Passport** — a permanent customer-facing record of a
  completed build (parts, settings, photos, warranty dates); raises resale
  value, drives repeat business.
- **Curated Marketplace** — a consumer directory of vetted independent shops
  and their signature packages, fed by the passports and package pages.

**Known doc/marketing staleness (housekeeping):** the public roadmap file and
landing page still describe two retired behaviors (three-tier quotes; "every
email needs a person to press Send" — follow-ups are automatic now).

---

## 9. Business questions worth taking into a vision conversation

1. **Pricing is genuinely unset.** No dollar figure exists anywhere — the
   playbook literally says "$Z a month." The close is engineered
   ("this found $X you'd already lost; it costs $Z"), so $Z can anchor to
   recovered revenue. One recovered install ($2,400–3,200) plausibly pays for
   a year. What's the number, and is it flat, tiered by bays, or
   value-anchored?
2. **The shared catalog is the moat — how is it governed?** Every shop's
   identifications enrich a common product database (never pricing/customers).
   That asset compounds and is hard for a generic POS to replicate. Does it
   stay a free accelerant, become the paid tier, or eventually power the
   consumer marketplace (Phase 5)?
3. **Wedge vs. suite.** Intake + product identification is the painkiller
   demo ("scan the pallet, watch it name itself"); quote recovery is the
   revenue story with a printed proof; booking/no-shows is the retention.
   Which leads the pitch, per the buyer?
4. **AI cost at scale is now a solved-ish problem** — retailers-first made
   marginal lookup cost ~$0 and the AI a long-tail item on the operator's own
   pluggable key. Who holds the key at scale: the platform (bundle it into the
   price) or the shop (bring-your-own)?
5. **Vertical data IS the product.** Shopify POS and Lightspeed do not know
   what a JP234 is, what a Metra 99-8215 fits, or that Nemesis never published
   a barcode in its life. Depth in one trade — including fitment and the
   house-brand long tail — is the defensible position. Adjacent verticals
   (general used-car inventory — a sister app already exists and was merged
   in; powersports; marine, a category shell already in the schema) are
   expansion, not the start.
6. **Distribution is in-person and referral-shaped.** Pilots are free,
   hand-onboarded, 30 minutes on-site. The printed report converts; the demo
   mode sells in a walk-in. When does this stop being founder-led sales, and
   what replaces it — distributor channels (the same importers whose products
   dominate the catalog), or shop-to-shop referral off the shared catalog?
7. **What proof exists today:** one closed $3,245 recovered sale attributable
   to the product; a live pilot shop sending from its own domain; a
   123-product real catalog in the system; and a defined 15-metric report
   whose first real printing is the next milestone. The honest next business
   goal is one number: **the first day-30 report with recovered revenue on
   it.**

---

## Appendix A — The Super Car Audio catalog (123 products, as exported)

Legend: ✅ scannable retail barcode (check digit verifies) · ⬜ no barcode
(spreadsheet blank / mangled) · 🔧 manufacturer part number or serial · ❓
digits at a non-barcode length. Stock quantities are the shop's private data
and are excluded.

| # | Code | Class | Model | Name (as typed) |
|---|---|---|---|---|
| 1 | 677478807501 | ✅ | UM-1200X4D | 4-channel Amp |
| 2 | 850038647889 | ✅ | EPICPRO6S | AUDIOCONTROL 6.5" EPIC PRO SPEAKERS |
| 3 | 713034001423 | ✅ | KISLOC2 | KICKER |
| 4 | 709483018389 | ✅ | TWS.4 | SOUNDSTREAM 1" NEODYMIUM TWEETER |
| 5 | FR-M800.4D11250239 | 🔧 | FR-M800.4D | NEMESIS AUDIO 4-CHANNEL AMPLIFIER 800W |
| 6 | 093207100994 | ✅ | DB3 | DIRECTED |
| 7 | 093207104015 | ✅ | VSM550 | VIPER SMARTSTART PRO |
| 8 | 728953000006 | ✅ | LINKR-LT3 | LINKR MOBILE CONTORL TRACK.ALERT |
| 9 | 663593066923 | ✅ | BT-TWO BTAUDIO RECEIVER | DS18 BTAUDIO RECEIVER |
| 10 | 609098903509 | ✅ | AP4-GM71 | AMP-GM71 MODULAR |
| 11 | 609098817400 | ✅ | RP4.2_TY11 | RADIOPRO4 MODULAR |
| 12 | 8261051023200787 | ❓ | AP4_GM61 | AMPPRO4 MODULAR |
| 13 | 627780000008 | ✅ | KIT_CHA1 | MAESTRO DODGE 2015+ |
| 14 | — | ⬜ | COL-65MR | NA SPEAKER 6.5" COLOSSAL SERIES 300W RMS |
| 15 | — | ⬜ | NA-PRO65 | NA SPEAKER 275WRMS PRO 6.5 |
| 16 | — | ⬜ | NA-65MR | NA SPEAKER 350W MIDRANGE 6.5 |
| 17 | — | ⬜ | NA-6.5SLM | NA SPEAKER MIDRANDE RMS 200W 6.5 |
| 18 | — | ⬜ | NEOPRO-6.5 | NA SPEAKER MIDRANGE RMS 150W |
| 19 | — | ⬜ | NEO-BAMF65 | NA SPEAKER MIDRANGR RMS 175W |
| 20 | — | ⬜ | PRO-DRV55 | DRIVER HORN 6.2 RMS 350W |
| 21 | 810075521047 | ✅ | TW350TI-4 SLIM | PRV AUDIO TWEETER 120W |
| 22 | 810075520293 | ✅ | 69MR500-4BULLET | PRV 6X9" 250W RMS 1 PC |
| 23 | 810075521887 | ✅ | 6MB550FT | PRV MIBDASS 6.5 275W |
| 24 | 810075520651 | ✅ | 6MR400-4BULLET | PRV AUDIO 400W |
| 25 | 850038647889 | ✅ | EPICPRO6S | AUDIOCONTROLEPIC |
| 26 | — | ⬜ | NA SUPER TWEETER 500W MAX | SUPER TWEETER |
| 27 | 650905749735 | ✅ | NA-TW-1 | NA 1" HIGH PERFORMANCE TWEETERS |
| 28 | — | ⬜ | NEO-TW33 400W MAX | NA SUPER TWEETER NEO BLACK |
| 29 | — | ⬜ | SUPER TWEETER 480W MAX | NA SUPER TWEETER |
| 30 | — | ⬜ | NA-5MR | NA MIDRANGE SPEAKER 5.25" |
| 31 | — | ⬜ | NA-4MR | NA MIDRANGE SPEAKER 4" |
| 32 | 810005184441 | ✅ | PRO-TWN4 | DS18 TWEETER 280W |
| 33 | 810005184656810005184656 | ❓ | PRO-TWX1/SLSILVER | DS18 TWEETER 120W |
| 34 | 663593058232 | ✅ | PRO-X6.4BM | DS18 6.5" 250W RMS |
| 35 | 810005181877 | ✅ | PRO-X694BM | DS18MID RANGE 6X9" |
| 36 | NA-PS1200X4D23080085 | 🔧 | NA-PS1200X4D | CLASS D AMPLIFIER 1200 W |
| 37 | 687077404889 | ✅ | 012-AK4G | OMNI12 TWELVEVOLT CCA |
| 38 | 650905748592 | ✅ | SL-4PK | STREETLINK 4AWG AMP KIT 3500W |
| 39 | 687077404902 | ✅ | 4AWGAMPKIT | OMNI12 4AMGAMPIK OFC |
| 40 | 343485432257 | ✅ | 4AWGAMPKIT | OMNI12 OFC |
| 41 | 687077404896 | ✅ | OAWGAMPKIT OFC. | OMNI12 OFC AMP KIT |
| 42 | 687077404872 | ✅ | CCA OMNI12 | OAWGAMPKIT AMPKIT |
| 43 | 4650185710919 | ✅ | M67AC PRO RMS300W. | DEAF BONCE APOCALYPE 300W |
| 44 | 330820468082400029 | ❓ | NA-6.5MRPK 280W | NA 6.5 MIDRANGE TWEETER |
| 45 | 4650185709999 | ✅ | APM67AC NEO 300W | APOCALYPSE NEO RMS 300W |
| 46 | 4650185710667 | ✅ | MG1SE NEO RMS 180W | APOCALYPSE DEAF BONCE 180W |
| 47 | 4650185706158 | ✅ | AP-M61SE SYLVESTER | MIN- RANGE SPEAKERS DEAF BONCE RMS 130W |
| 48 | 4650185708664 | ✅ | AP-X69A RMS 200W | APOCALYPSE  DEAF BONCE COAXIAL SPEAKERS |
| 49 | 4650185709814 | ✅ | MLH69  RMS 75W | MACHETE LITE RMS 75W |
| 50 | 702588002918 | ✅ | PRX6903 3 WAY SPEAKER | MEMPHIS AUDIO 3 WAY COAXIAL SPEAKER |
| 51 | 650905749735 | ✅ | NA 5-.7HCX  HECTIC SERIES | NA 5.7 HIGH-PERORMANCE COAXIAL SPEAKER |
| 52 | — | ⬜ | DB-2800D | DIABLO MONOBLOCK AMPLIFIER |
| 53 | DB-4500D202108300792+ | 🔧 | DB- 4500D | DIABLO MONOBLOCK AMPLIFIER |
| 54 | DB-2K0042024120692 | 🔧 | DB- 2500.4 2500W 4CH AMPLIFIER | DIABLO  4 CHENNEL |
| 55 | 677478807495 | ✅ | MICRO- 2600X5D | NA 5CH AMP |
| 56 | 677478848436 | ✅ | NANO-3600X5D | NA 5 CHANNEL FULL RANGE |
| 57 | 677478848405 | ✅ | NANO-3500X4D | NA 4 CHANNEL AMPLIFIER |
| 58 | 677478848474 | ✅ | FIERCE-4500X5D 5 CHANNELS FULL RANGE DIGITAL AMPLIFIER | NA 5 CHANNELS |
| 59 | 732388973088 | ✅ | FIERCE-3000X4D | NA FIERCE 4 CH AMP |
| 60 | — | ⬜ | RL680.4 L-3 SERIES | RECOIL CLASS-D 4 CHANNEL AMPLIFIER |
| 61 | 677478807501 | ✅ | UM-1200X4D | NA 4 CHANNEL CLASS D ULTRA AMPLIFIER |
| 62 | 850038647797 | ✅ | EPIC FOUR | EPIC FOUR CHANNEL AUDIO CONTROL |
| 63 | 732388974481 | ✅ | FR-M800.4D | NA 4 CHANNEL 800W RMS |
| 64 | 677478807464 | ✅ | MICRO- 2000X4D | NA 4 CH FULL RANGE CLASS D AMPLIFIER |
| 65 | 677478848429 | ✅ | NANO- 1800X4D | NA 4 CHANNEL CLASS D AMPIFIER |
| 66 | 40NA500X4D04240266 | 🔧 | NA - 500X4D | NA  CLASS AB MOSFET AMPLIFIER |
| 67 | NA-1600X4D25090795 | 🔧 | NA- 1600X4D | NA CLASS AB MOSFET AMPLIFIER |
| 68 | — | ⬜ | MP-800 | P.L.Z RADIO |
| 69 | 677478807945 | ✅ | N.A-FR2500D  V.2 | NA FULL RANGE CLASS D 2500W RMS |
| 70 | 677478807082 | ✅ | NA-BZ12000D | NA MONO FULL RANGE CLASS D AMPLIFIER |
| 71 | DB-8500D202105300168 | 🔧 | DB-8500D | DIABLO 8500W MAX |
| 72 | — | ⬜ | NA-6KM | NA 6K |
| 73 | — | ⬜ | NA-2KM | NA 2000W MAX |
| 74 | 677478848498 | ✅ | FIERCE-5KD | NA 5000W MAX/1CH |
| 75 | 677478848481 | ✅ | FIERCE-6KD | NA 6000W MAX |
| 76 | 677478807013 | ✅ | FIERCE-3.5KD | NA 3500W MAX/1CH |
| 77 | 25112955 | ✅ | JP234 | D4C 640W |
| 78 | 4650185708787 | ✅ | MACHETE | MFA 1920W |
| 79 | 851523007997 | ✅ | BASS RESTORATION PROCESSOR | AUDIO  CONTROL |
| 80 | 850038647216 | ✅ | LC7-PRO | AUDIO CONTROL SIX CHANNEL |
| 81 | 815592026914 | ✅ | EP1800X OUTPUT VOLTAGE 7V | BLAUPUNKT 7- BAND EQUALIZER |
| 82 | 815592026914 | ✅ | 7-BAND EQUALIZER | BLAUPUNKT OUTPUT VOLTAGE 7V RMS |
| 83 | 650905748073 | ✅ | NA-BASSPRO | NA SERIS DIGITAL BASS PROCESSOR |
| 84 | 855814005860 | ✅ | BASS RESTORATION PROCESSOR | AUDIO CONTROL RESTORATION PROCESSOR |
| 85 | 160585NTW25H0042175 | 🔧 | 5908V | VIPER 1 WAY REMOTE START & SECURITY |
| 86 | 783855995706 | ✅ | 552-SSR | SILENCER  PLUS |
| 87 | 728953000204 | ✅ | AL- 1870-308 | EXCALIBUR REMOTE START & SECURITY PERFECTED |
| 88 | 044476160592 | ✅ | 5308V | VIPER 2 WAY LCD REMOTE START & SECURITY |
| 89 | 093207064715 | ✅ | 3105V | VIPER 1 WAY SECURITY  SYS |
| 90 | 783855995386 | ✅ | 322SS | SILENCER PLUS |
| 91 | — | ⬜ | NA-69MR | NA 6.8 700W MAX |
| 92 | — | ⬜ | NA-PRO69 | NA 6.9 600W MAX |
| 93 | — | ⬜ | NA 57PRO | NA 5.7 500W MAX |
| 94 | — | ⬜ | NA-57MR | NA 5.7 400W MAX |
| 95 | — | ⬜ | NAO-BAMF65 | NA SPEAKER MIDRANGE 350WMAX |
| 96 | — | ⬜ | REF-8632CFX | INFINITY 6.8 180W |
| 97 | 050036364058 | ✅ | CLUB8622F | JBL  6.8\ 60W RMS |
| 98 | 650905749407 | ✅ | NA-65FMRLT | NA MID-RANGE LOUDSPEAKER WITH RGB LED BULLET 6.5 500W |
| 99 | 650905749735 | ✅ | NA-6.9HCX | NA SPEKERS HECTIC SERIES 6.9 |
| 100 | — | ⬜ | STAGE3637F | JBL 125W 45 RMS |
| 101 | 650905749735 | ✅ | NA-6.5M SPEAKERS | NA - MYSTICAL  SERIES |
| 102 | 6925281948060 | ✅ | STAGES 637F | JBC HARMAN 135W 45W RMS |
| 103 | 650905749735 | ✅ | NA -5.25M | NA COAXIAL SPEAKERS |
| 104 | 650905749735 | ✅ | NA - 46M | NA MYSTICAL SERIES |
| 105 | 650905749735 | ✅ | 3.5 COAXIAL SPEAKERS | NA COAXIAL SPEAKERS |
| 106 | 650905749735 | ✅ | 2.75 FULL RANGE | NA  2.75 FULL RANDE SPEAKER |
| 107 | 709483051072 | ✅ | VR-651B | SOUND STREAM TECHNOLOGIES |
| 108 | 650905749735 | ✅ | NA - 3.5 COAXIAL | NA 3.5 COAXIAL SPEAKERS |
| 109 | 6925281961168 | ✅ | 8622F | JBL SPEAKERS 180W 60W RMS |
| 110 | 6925281961168 | ✅ | 8622F | JBL HARMAN SPEAKERS |
| 111 | 6925281948077 | ✅ | STAGE3 9637F | JBL SPEAKERS |
| 112 | 713034088332 | ✅ | 50W RMS CSC4 | KICKER  COAXIAL SPEAKERS |
| 113 | 791489128827 | ✅ | ML43B | SSL 200 WATTS |
| 114 | 046838002427 | ✅ | KD- X280BT | JVC DIGITAL MEDIA RECEIVER |
| 115 | 046838002427 | ✅ | KD- X280BT | JVC DIGITAL MEDIA RECEIVER |
| 116 | 046838002410 | ✅ | KD- X38MBS | JVC DIGITAL MEADIA RECEIVER |
| 117 | 019048234056 | ✅ | KMM- BT408 | KENWOOD  DIGITAL MEDIA RECEIVER |
| 118 | 4650185710285 | ✅ | DB- 53ODSP | DEAF BONCE RECEIER |
| 119 | 793276040855 | ✅ | UTE- 73BT | ALPINE DRIVING MOBILE MEDIA |
| 120 | 793276085979 | ✅ | ILX- W770 | ALPINE 7- INCH AUDIO |
| 121 | 793276085979 | ✅ | KW- M595BT | JVC MONITOR WITH RECEIVER / MONITOR AVEC RECEPTEUR |
| 122 | 884938533720 | ✅ | DMH-1800NEX | PIONEER  RD AV RECEIVER / RECEPTEUR AV  AVES |
| 123 | 810005181570 | ✅ | NXL-PS8R | DS18 HYDRO |

---

## Appendix B — Glossary

- **UPC-A / EAN-13 / EAN-8** — the standard retail barcode formats (12, 13,
  and 8 digits). A 12-digit UPC-A and its 13-digit EAN form with a leading
  zero are the same product.
- **Check digit** — the last digit of a retail barcode, computed from the
  others; if it doesn't verify, the number was misread or invented, not a
  real code.
- **GS1 prefix** — the first digits of an EAN-13 identify the issuing
  country/range (e.g. 465 = Russia, 690–699 = China). Prefix 2 means
  *store-assigned*: real codes that exist only inside one retailer and appear
  in no public database.
- **Integration part / fitment** — dash kits, wiring harnesses, and
  interfaces (PAC, Metra, Scosche…) that fit specific vehicle models and
  years; the manufacturer publishes an exact application list.
- **RLS (row-level security)** — Postgres enforcing, at the database layer,
  that a shop can only ever read and write its own rows. The app's
  multi-tenant security model.
- **Edge Function** — small server-side function (Supabase/Deno) holding the
  secrets and doing the work the browser must never do: sending email,
  calling AI providers, cross-shop operations.
- **Magic link** — passwordless sign-in by emailed link. Mail apps prefetch
  links, which burns single-use auth URLs — the reason the app hosts its own
  confirmation page.
- **Grounded AI search** — a model call that performs live web searches and
  must cite what it found, as opposed to answering from memory.
- **Code 128** — a barcode format that can encode letters as well as digits;
  what the app prints for products that have no manufacturer code.
- **A2P 10DLC** — US carrier registration required to send automated business
  SMS; weeks of per-shop compliance, and the reason follow-ups are email-only
  with tap-to-text left personal.

---

*End of brief. This document contains real business data belonging to the
project owner and Super Car Audio; share deliberately.*
