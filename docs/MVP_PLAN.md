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

### Stream A — Production readiness ⚠️ BLOCKING
**This outranks every feature.** The app has been built and verified almost
entirely in demo mode. If the live Supabase project is behind on migrations,
a real prospect who signs up gets a broken app and the pitch is dead.

- Verify which migrations are actually applied to the live project. `0009`
  through `0016` are the suspects — `0016` alone adds `option_kind`,
  `quote_items.image_url`, and `quotes.show_full_addon_total`, all of which
  the current UI **requires**.
- Apply anything missing (`supabase db push`).
- Set Edge Function secrets: `RESEND_API_KEY` (required — no email without
  it), and `OPENAI_API_KEY` and/or `ANTHROPIC_API_KEY` (product resolution
  degrades gracefully without these, but the scan demo is much weaker).
- Deploy all Edge Functions: `send-quote-email`, `send-invoice-email`,
  `resolve-product`, `shopify-import-catalog`, `notify-shop-response`,
  `admin-create-shop`.
- Deploy the frontend to a real domain.
- **Run the §1 demo script end to end against production with a fresh shop
  account.** Real signup, real email arriving in a real inbox, real public
  quote link opened on a real phone. Until someone has done this, the
  product is unproven.

Requires Supabase credentials — **only the project owner can do this part.**
An agent can prepare the checklist and verify the app-side behavior, but
cannot push migrations or set secrets.

### Stream B — Booking system
Full spec in §5. The largest build. Owns all new booking files plus
migration `0017`.

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
- `0017` → Stream B (booking)
- `0018` → reserved, unassigned
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

### Data model (migration `0017`)

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

### Booking cut list for MVP
Ship: services/bays/hours config, staff day+week calendar with
create/edit/cancel, public self-booking, confirmation email, quote→book
link.
Defer: drag-to-reschedule, recurring blocks, staff assignment, waitlist,
online deposit capture, multi-day jobs (long durations are enough),
resource-specific service routing.

---

## 6. Tint diagrams — top-down (Stream C)

Direction changed on owner feedback: **top-down, not 3/4.** Top-down shows
every window at once including the sunroof, avoids the perspective and
proportion problems that made the 3/4 art look wrong, and matches the
convention shops already recognize from other tint software.

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

| Day | A · Production | B · Booking | C · Diagrams | D · Polish |
| --- | --- | --- | --- | --- |
| 1 | **Verify + apply migrations, set secrets, deploy** | Migration 0017, types, repository interfaces | *waiting on source art* | — |
| 2 | Prod smoke: signup → quote → real email → public link | `scheduling.ts` + full test suite | Geometry from supplied SVGs | — |
| 3 | Fix whatever prod smoke found | Staff calendar screen | Web rendering + editor | — |
| 4 | — | Public booking page | Email SVG duplicate + verify | Demo data rebuild |
| 5 | — | Emails + quote→book link | done | Landing + pricing |
| 6 | **Integrate all streams, full regression, deploy** | | | |
| 7 | **Buffer + timed demo rehearsal** | | | |

---

## 9. Honest risk assessment

- **Production has never been proven end to end.** Highest risk on the
  board, and it's the one thing an agent can't fully close alone. Do it
  Day 1.
- **Booking in ~5 days is aggressive but real** — *if* the pure scheduling
  logic is tested before any UI is written. The failure mode is building
  three screens on top of slot math that turns out to be subtly wrong.
- **Parallel agents colliding in `types.ts` / the repositories** is the
  most likely way a day gets lost. §4 exists specifically to prevent it.
- **Day 7 is a buffer, not a workday.** If a stream is planning to finish
  on Day 7, it is already late.
