# MVP Plan — ship in 7 days, then pitch

**Status:** active operating document. Every agent working this repo reads
this first and follows the ownership + conflict rules in §4 before touching
a file.

**Goal:** a working product a car-audio or window-tint shop owner can be
walked through in 5 minutes and say yes to. Not feature-complete — *demo-
complete and production-real*.

---

## 1. The demo script defines the MVP

Anything not in this 5-minute script is not MVP. This is the scope test —
if a feature doesn't appear here, it ships after the pitch, not before.

1. **"A customer calls about tint on a 2022 Silverado."**
   Staff opens the app → New Quote → picks the crew-cab body style → taps
   the windows → picks 20% → price. 60 seconds.
2. **"Or they walk in wanting a system."**
   Scan workspace → scan two boxes → products resolve with photos and
   prices → turn the cart into a quote.
3. **"Send it."** Email preview → send → open the customer's view on a
   phone: photos of the actual products, one price, optional add-ons.
4. **"They accept and book their own install."** ← *booking system*
   Customer taps "Book my install" on the quote → picks a slot → confirmed,
   shop's calendar fills.
5. **"You see the week."** Staff calendar, today's jobs, tomorrow's jobs.
6. **"Job's done."** Mark it complete → invoice → mark paid.
7. **"And the ones that went quiet?"** Follow-up queue with suggested
   templates and the recovered-revenue report.

Steps 1, 2, 3, 6, 7 are **built**. Steps 4 and 5 are the gap.

---

## 2. Explicitly cut from MVP

Do not build these this week. They are good ideas parked on purpose.

| Cut | Why it can wait |
| --- | --- |
| Voice ordering / transcription | Impressive but not on the value path; needs 2 new Edge Functions + API keys |
| Label printing + generated UPCs | Internal ops nicety, not a buying reason |
| Vendor receiving / outgoing orders | Inventory depth — pilot shops won't reach it in 14 days |
| Stripe subscriptions / in-app billing | Pilots are hand-onboarded free (see §7) |
| Online deposit *payment* capture | Existing deposit-link/Zelle/CashApp handoff is enough |
| Drag-to-reschedule on the calendar | Tap-to-edit covers it; drag is polish |
| SMS reminders | Email only for MVP; SMS = new vendor + compliance surface |
| Multi-staff assignment on bookings | Bay-based capacity only (see §5) |
| Package template approval screen | Templates can be created; reviewing them isn't pitch-critical |
| Car diagram 3/4 "known car" art | Superseded — going top-down instead (§6, Stream C) |

---

## 3. Work streams

Five streams. A/B/C/D run in parallel; E is continuous integration.

### Stream A — Production readiness ✅ resolved
Was reopened over a live tint-only quote save failing with "Could not
find the 'show_full_addon_total' column of 'quotes' in the schema cache"
— `0016` looked unapplied. The owner ran `supabase/check_migrations.sql`
against the live database and confirmed `0001`–`0016` are all applied
(`0007` isn't tracked by that script — superseded by `0008`, not a gap).
That closes this out; if the schema-cache error recurs, it's PostgREST's
cache, not a missing column — reload with `notify pgrst, 'reload schema';`
or restart the project from the dashboard, then re-run the §1 demo script
end to end against production (a tint-only quote especially) to confirm.

**Migration numbering note:** this section used to reserve `0017` for
booking. That number is now taken — `0017_inventory_merge.sql` and
`0018_import_legacy_inventory.sql` ship the inventory/car-audio-inventory
merge (see `docs/INVENTORY_MERGE_PLAN.md`). Booking's migration is `0019`+
whenever that work starts. Whichever migration reaches this repo next,
apply it to production the same way (`supabase db push` or the SQL
editor) rather than letting it sit unapplied while screens ship against
it — and re-run the demo script against production again after any
stream that touches the schema merges.
- **Lesson for the week:** "deployed" and "schema current" are different
  claims. Verify by running the flow, not by remembering a past deploy.

### Stream B — Booking system 🎯 the build
Now the critical path. Full spec and the parity sequencing in §5.

### Stream B — Booking system
Full spec in §5. The largest build. Owns all new booking files plus
migration `0019`.

### Stream C — Top-down tint diagrams
Replaces the rejected 3/4-view art. Owns `src/lib/carDiagrams.ts`,
`src/components/TintDiagram.tsx`, and the geometry duplicate inside
`supabase/functions/send-quote-email/index.ts`. **Blocked until the owner
supplies source diagrams** (see §6).

### Stream D — Sales-ready polish
- **Demo data quality is a sales asset.** `/demo` is what a prospect sees.
  It should read like a real, busy shop: believable customer names, real
  product photos, quotes at plausible Dallas-market prices, a filled
  calendar once booking lands.
- Landing page: what it does, who it's for, pricing.
- Onboarding: a shop owner should get from signup to first quote without a
  phone call.
- Refresh `docs/PILOT_PLAYBOOK.md` — it still describes the removed
  Good/Better/Insane tier system and needs rewriting for main + add-ons.

### Stream E — Integration & QA
Owned by the planner. Branch merges, conflict resolution, full regression
before each production deploy.

---

## 4. Rules for parallel agents (read before touching anything)

The real risk of running several agents on one repo is not bad code — it's
merge collisions in a handful of shared files. These rules exist so that
never happens.

**Reserved migration numbers.** Claim before you write:
- `0017`, `0018` → taken by the inventory/car-audio-inventory merge
  (`0017_inventory_merge.sql`, `0018_import_legacy_inventory.sql` — see
  `docs/INVENTORY_MERGE_PLAN.md`). Booking's reservation moved to `0019`
  as a result — every "migration 0017" reference below in the Booking
  spec means `0019` now.
- `0019` → Stream B (booking)
- `0020` → reserved, unassigned
- Stream C needs no migration.
- Never write a migration number you haven't been assigned.

**Shared files are append-only.** These are touched by nearly every stream:

```
src/types.ts
src/data/repository.ts
src/data/demoRepository.ts
src/data/supabaseRepository.ts
src/data/demoData.ts
src/App.tsx
src/components/AppLayout.tsx  (nav)
```

In these files: **add at the end of the relevant section. Never reorder,
reformat, rename, or "tidy" existing code.** A formatting pass on
`types.ts` will collide with every other stream simultaneously. If you need
to *change* existing shared code (not add to it), stop and ask the planner.

**One branch per stream**, off the current `claude/autonomous-execution-90min-sk40xw`
head. Rebase before pushing. The planner does final integration.

**The gate — every agent, before every push, no exceptions:**
```
npx tsc -b --noEmit && npx eslint . && npx vitest run && npm run build
```
plus a Playwright smoke covering your own screens. This repo has caught
real production bugs (a DOM id collision, a modal focus-steal) in the
Playwright layer that typecheck and unit tests both passed clean — do not
skip it.

**Pure logic before UI.** Established pattern here: the hard reasoning
lands in a tested `src/lib/*.ts` module first, then the React component
consumes it. Booking's slot math especially (§5).

**Both repositories, always.** Any new repository method must be
implemented in `DemoRepository` *and* `SupabaseRepository`. Demo mode is
the sales demo — a method that only works in production breaks the pitch.

---

## 5. Booking system spec (Stream B)

### Positioning

Booksy for auto shops — but the differentiator is that **the quote is the
funnel.** Booksy is *pick a service → book*. A $2,400 audio install or a
$375 tint job doesn't work that way: the customer gets quoted first, then
books. We already own the quote half. Booking closes the loop, and that
combination is something Booksy structurally can't offer these shops.

Three more things generic booking software gets wrong for this trade, and
we should get right:

1. **Duration depends on the vehicle, not just the service.** Tinting a
   coupe is not tinting a 6-window Suburban. We already have `TintBodyStyle`
   (7 values) in `types.ts` — reuse it to drive per-vehicle durations. This
   is a genuine edge; Booksy makes you pick one fixed-length service.
2. **Capacity is bays, not staff.** A tint shop with two bays can run two
   jobs regardless of headcount. Model the resource as a bay.
3. **Jobs are hours, not minutes.** Slot math must handle 2–6 hour blocks
   and not offer a 3-hour slot at 4pm when the shop closes at 6.

### Data model (migration `0019`)

Follow the existing conventions exactly: shop-scoped, RLS keyed on shop
membership, `snake_case` columns mapped once at the repository boundary.

```sql
services
  id, shop_id, name, category text,           -- 'tint' | 'audio' | 'other'
  base_duration_minutes int not null,
  buffer_minutes int not null default 15,     -- cleanup/pull-out between jobs
  price_cents bigint,                          -- null = "quote required"
  bookable_online boolean not null default true,
  active boolean not null default true,
  position int

service_duration_overrides
  service_id, body_style text,                -- TintBodyStyle value
  duration_minutes int
  -- "Full tint" = 120min coupe, 180min suv_6_window

bays
  id, shop_id, name, active, position
  -- capacity: one appointment per bay per time range

business_hours
  shop_id, day_of_week int (0-6), open_time time, close_time time, closed boolean

schedule_exceptions
  shop_id, date, closed boolean, open_time, close_time, note
  -- holidays, half days, vacation

appointments
  id, shop_id, customer_id, quote_id (nullable), bay_id,
  starts_at timestamptz, ends_at timestamptz,
  status text,        -- 'requested'|'confirmed'|'in_progress'|'completed'|'no_show'|'cancelled'
  source text,        -- 'staff'|'self_serve'|'from_quote'
  vehicle_year/make/model/trim,               -- snapshot, same philosophy as quote items
  customer_notes, internal_notes,
  deposit_amount_cents, deposit_paid_at,
  public_token uuid unique,                   -- customer's manage/cancel link
  created_by, created_at, updated_at

appointment_services
  appointment_id, service_id, name, duration_minutes, price_cents, position
  -- all snapshots; editing a service later never rewrites history
```

Add a `get_public_booking_page(shop_slug)` and `book_appointment(...)`
SECURITY DEFINER RPC pair, mirroring how `get_public_quote` /
`submit_public_quote_response` already expose the anonymous surface.

### The hard part — `src/lib/scheduling.ts` (pure, unit-tested first)

```ts
availableSlots({
  date, businessHours, exceptions, bays, existingAppointments,
  durationMinutes, bufferMinutes,
  slotIntervalMinutes = 30,
  minLeadTimeMinutes, maxAdvanceDays, now,
}): Array<{ startAt: string; endAt: string; bayId: string }>
```

For each bay, walk the open window in `slotIntervalMinutes` steps. A start
time is valid when `[start, start + duration + buffer)` fits entirely
inside open hours, overlaps no existing appointment in that bay, and is at
least `minLeadTimeMinutes` past `now`. Collapse to unique start times for
display — the customer picks a *time*, the shop assigns the bay.

Write the tests before the UI. Cases that must be covered: a fully booked
day, a closed day, an exception day, a half day, a job too long to fit
before close, back-to-back jobs with buffer, lead time excluding today's
early slots, `maxAdvanceDays` bounding the far end, and multiple bays
offering the same start time only once.

**Race condition — do not skip.** Two customers can request the last slot
at the same moment. Availability must be re-checked *inside* the
`book_appointment` RPC in the same transaction as the insert — the same
atomicity pattern `apply_stock_movement` already uses for stock. Client-side
availability is a display convenience, never the guard.

### Screens

| Route | Who | What |
| --- | --- | --- |
| `/app/calendar` | staff | Day + week view, jobs in bay columns, tap to open/edit, "Add appointment" |
| `/app/settings` → Booking section | owner | Services + durations, bays, business hours, exceptions |
| `/book/:shopSlug` | public | Self-serve: service → vehicle → date → time → contact → confirm |
| `/q/:publicToken` | public | Add a **"Book my install"** CTA → `/book/:shopSlug?quote=…` |

**Ruthless simplicity on the public page.** Booksy's whole advantage is
three taps. From a cold link: 4 steps. From an accepted quote: 2 steps
(service and vehicle are already known — go straight to time → confirm).
No account creation, ever.

### Emails
Reuse `src/lib/emailTemplates.ts` conventions and the Resend Edge Function
pattern: booking confirmation (immediate), reminder (24h before),
cancellation. The 24h reminder needs a scheduled trigger — if that's not
trivial, ship confirmation + cancellation for MVP and make the reminder a
staff-pressed action like the quote follow-ups already are.

### Target: full Booksy parity — built in slices, not in parallel

Decision: go for parity. The way to make that survivable in a week is to
build **complete vertical slices in descending demo value**, so the product
is shippable at the end of every slice. Never have four half-features on
Day 6.

**Slice 0 — Core (Days 1–2, blocking everything else)**
Migration `0019`, types, `scheduling.ts` + its full test suite,
`book_appointment` RPC, repository methods in *both* implementations.
No UI. This is the bottleneck — one strong agent, nothing else in the way.

**Slice 1 — Bookable (Days 2–4)** → *pitch-viable from here*
Staff calendar (day + week, create/edit/cancel), services/bays/hours
config, public self-booking page, confirmation email, quote→book link.
Two agents in parallel once Slice 0 lands: one staff-side, one
customer-side.

**Slice 2 — No-show killer (Days 4–5)**
24h reminder email, customer self-reschedule and self-cancel from their
`public_token` link. These are the two things shop owners actually complain
about — phone tag and no-shows — and they demo in fifteen seconds. Highest
value per hour of build in the whole booking system.

**Slice 3 — Money (Day 5–6)** ⚠️ *see the deposit note below*
Deposit at booking time.

**Slice 4 — Parity tail (Day 6+, only if green)**
Waitlist, staff assignment alongside bays, drag-to-reschedule,
resource-specific service routing, recurring blocks.

**Hard checkpoint: end of Day 4.** If Slice 1 is not fully merged, working
in production, and demoable, Slices 3 and 4 are dropped without further
discussion and the week finishes on polish. Decide this by looking at
merged code, not by how close it feels.

### The deposit decision — read before building Slice 3

"Take a deposit online" sounds like one feature and is actually a project.
Because the money belongs to the *shop* and not to us, this is Stripe
**Connect**, not plain Checkout: per-shop onboarding flows, KYC, payouts,
webhooks, refunds, failure states. Realistically 3–4 days on its own, and
it puts a KYC wall between a pilot shop and their first booking — during
the exact week we're trying to get shops to say yes.

**Recommended alternative that keeps the demo moment:** the app already
stores each shop's deposit method and handle (Zelle / CashApp / Venmo /
PayPal / payment link) from the existing quote deposit feature. At booking
confirmation, show *"Send your $75 deposit to [handle] to hold this slot"*,
put the same line in the confirmation email, and give staff a one-tap
"deposit received" toggle on the appointment. Roughly half a day, no new
vendor, and it matches how these shops already take money today.

Real Stripe Connect goes on the post-pitch roadmap, where it belongs —
it's a much easier sell to a shop already using the product than a
prerequisite to trying it.

---

## 6. Tint diagrams — top-down (Stream C)

**Current state: diagrams are pulled from the product entirely.** Rather
than ship art the owner rejected, the tint feature now runs on a written
per-slot breakdown everywhere — editor, quote detail page, public quote
page, and email. The tint flow is fully functional without any diagram:
pick body style (plain labels) → check the job categories → set a % per
category → windshield and sunroof as separate add-ons.

What that bought: the ~190-line duplicate of the SVG geometry inside
`send-quote-email/index.ts` is gone, so when the diagrams return there is
one less copy to keep byte-identical across two runtimes.

`src/components/TintDiagram.tsx` and `src/lib/carDiagrams.ts` both stay in
the repo. `carDiagrams.ts` is still load-bearing — `windowTint.ts` imports
`TINT_VISUAL_SLOT_POSITIONS` from it for the left/right grouping.
`TintDiagram.tsx` renders nowhere right now and is marked at the top as
deliberately parked; **do not delete it as dead code.**

Direction when the art arrives: **top-down, not 3/4.** Top-down shows every
window at once including the sunroof, avoids the perspective and proportion
problems that made the 3/4 art look wrong, and matches the convention shops
already recognize from other tint software.

Source art is being supplied by the owner. SVG strongly preferred — the
existing diagram already toggles and shades real vector paths, so real
paths mean the interaction logic carries over almost unchanged.

What survives the rewrite: `TintVisualSlot`, `TINT_VISUAL_SLOT_POSITIONS`,
`tintOpacityForPercent`, `visualSlotOpacity`, `visualSlotsWithOpacity`, the
dual-renderer split (React component + standalone SVG string for email),
and the `TINT_SLOT_LABEL` naming. Only the geometry changes.

What gets *better*: a sunroof zone is now drawable (it was invisible on a
side view, which is why sunroof shipped as a checkbox-only add-on), and the
windshield becomes a real zone too.

Keep the Edge Function's duplicated geometry in sync — that duplication is
deliberate (Deno can't import `src/lib`), so the same change lands twice.

---

## 7. Go-to-market posture for the pitch

- **Free hand-onboarded pilots.** No billing code this week. The admin
  panel already creates shops and sends invite links — that is the
  onboarding mechanism for the first shops. Charge after the pilots prove
  the number.
- **Lead with recovered revenue, not features.** The existing pilot pitch
  is the right one: *"Give me the quotes that went quiet. Two weeks later
  I'll show you what came back."* Booking is the second hook — *"and your
  customers book themselves."*
- **The demo must be run cold and timed before the first real pitch.** Run
  the §1 script start to finish against production, on a phone, on shop
  wifi. Every rough edge found in rehearsal is one not found in front of a
  prospect.

---

## 8. Day-by-day

Production being already verified frees an agent — put it on booking, which
is now the whole critical path. Suggested allocation across 5 agents:

| Day | B1 · Core | B2 · Staff side | B3 · Customer side | C · Diagrams | D · Polish |
| --- | --- | --- | --- | --- | --- |
| 1 | Migration 0019, types, repository | *reading spec, scaffolding* | *reading spec, scaffolding* | *waiting on art* | — |
| 2 | `scheduling.ts` + tests, `book_appointment` RPC | Calendar shell on core | Booking page shell on core | Geometry from SVGs | — |
| 3 | Support both, apply 0019 to prod | Calendar day+week working | Service → vehicle → time flow | Web rendering + editor | — |
| 4 | → moves to Slice 2 | Services/bays/hours config | Confirm + email + quote→book | Email SVG duplicate | Demo data rebuild |
| 4 | **🚩 CHECKPOINT — Slice 1 merged and demoable, or Slices 3–4 are dropped** | | | | |
| 5 | Reminder email | Deposit-on-booking (§5) | Self-reschedule / self-cancel | done | Landing + pricing |
| 6 | **Freeze features. Integrate, full regression, deploy, re-run demo script on prod.** | | | | |
| 7 | **Buffer + timed demo rehearsal. No new code.** | | | | |

If only two or three agents are available, drop D entirely (demo data
polish is the cheapest thing to hand-do later) and run B1 → B2+B3 → C.

---

## 9. Honest risk assessment

- **Full Booksy parity in one week is the aggressive call.** It's chosen
  deliberately, and the slice structure in §5 is what makes it survivable:
  every slice ends shippable, so the week can stop anywhere after Slice 1
  and still produce a product worth pitching. The failure mode to avoid is
  four features at 70% on Day 6. Hence the Day 4 checkpoint — treat it as
  binding.
- **Slice 0 is a genuine bottleneck.** Two agents cannot build the calendar
  and the booking page against a repository that doesn't exist yet. Put the
  strongest agent on it, start it first, and don't let it sprawl into UI.
- **Slot math is where correctness bugs hide.** Write `scheduling.ts`'s
  tests before any screen exists. Double-booking a customer in front of a
  prospect is the single worst demo failure available to us, and the
  `book_appointment` RPC's transactional re-check is the only real guard —
  client-side availability is display, not safety.
- **Deposits are the most likely thing to blow the date.** See §5. Take the
  half-day handle-based version, not Stripe Connect.
- **Parallel agents colliding in `types.ts` / the repositories** is the
  most likely way a day gets lost. §4 exists specifically to prevent it.
- **Day 7 is a buffer, not a workday.** If a stream plans to finish on
  Day 7, it is already late. Day 6 is a feature freeze — everything after
  is integration, regression, and rehearsal.
- **Diagrams (Stream C) are blocked on source art and stay blocked.** If
  the art doesn't arrive by Day 3, ship the pitch with the current
  side-view diagrams and redo them after. They are not worth a slipped
  date, and no prospect will reject the product over diagram style.
