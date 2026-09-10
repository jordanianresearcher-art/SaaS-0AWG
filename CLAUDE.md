# 0Gauge Recovery — working brief

Shop software for independent car-audio and window-tint shops. Quote a customer,
email it, see when they open it, follow up automatically, book the install, take
a deposit, invoice at the counter, keep the shelves straight — from a phone.

**This is live software with a real customer.** Super Car Audio (Dallas) runs
their business on it. One recovered sale through this app was $3,245. Mistakes
here cost a real shop real money, so verify before claiming, and never dress up
a number.

Full background: `docs/PROJECT_BRIEF.md`. Go-to-market: `docs/PILOT_PLAYBOOK.md`.
Working plan: `docs/MVP_PLAN.md`.

---

## Start every session with this

The cloud container has silently reverted this checkout to an older commit
**four times**, discarding work that was already pushed. Before touching
anything:

```bash
git fetch origin claude/autonomous-execution-90min-sk40xw && git status -sb
```

If it reports "behind", run `git merge --ff-only
origin/claude/autonomous-execution-90min-sk40xw` **before any other work**.
Editing a stale tree produces conflicts and re-does work that already shipped.

Then remember the app and the backend ship separately — see Deploy below. A bug
report may just be a version skew.

---

## The gate — before every commit, no exceptions

```bash
npx tsc -b --noEmit && npx eslint . --max-warnings 0 && npx vitest run && npm run build
```

Plus `node scripts/check-edge-functions.mjs` whenever Deno code under
`supabase/functions/` changed — it type-checks with real scope, which `esbuild`
parsing does not. That check exists because a scope bug shipped and broke the
resolver in production.

Plus a Playwright smoke over the screens you touched. From `docs/MVP_PLAN.md`:
*"This repo has caught real production bugs (a DOM id collision, a modal
focus-steal) in the Playwright layer that typecheck and unit tests both passed
clean — do not skip it."* Build, run `npx vite preview --port 4173`, drive it
with `playwright-core` at `/opt/pw-browsers/chromium`.

---

## Invariants

Each of these has already been violated once and cost something.

1. **No secret ever reaches the browser.** *"No custom Node server. No
   service-role or Resend keys ever reach the browser."* Secrets live only as
   Supabase Edge Function secrets. Never put one in a `VITE_` variable.
2. **Both repositories, always.** *"Any new repository method must be
   implemented in `DemoRepository` and `SupabaseRepository`. Demo mode is the
   sales demo — a method that only works in production breaks the pitch."*
3. **Mirrored Deno code must stay behaviourally identical.** Deno cannot import
   from `src/`, so several pure helpers exist twice, wrapped in
   `MIRROR-BEGIN <tag>` / `MIRROR-END <tag>` markers.
   `src/lib/edgeFunctionMirrors.test.ts` runs both copies over the same inputs.
   Change one copy, change the other, in the same commit.
4. **Migrations are applied by hand, by the owner.** Numbered sequentially,
   claimed before writing (`docs/MVP_PLAN.md` §4 holds the ledger). A single
   `ALTER TYPE` must be alone in its file. *A migration applying cleanly is not
   evidence its functions run* — exercise every `SECURITY DEFINER` function
   against a real project. **`scripts/local-db.sh` replays the whole ledger
   into a throwaway Postgres in ~10s**, so a migration or analysis query can be
   proven here before the owner pastes it into production. It stubs Supabase
   rather than reproducing it: policies compile, but RLS behaviour there proves
   nothing about protection.
5. **Shared files are append-only.** `src/types.ts`, `src/data/repository.ts`,
   both repositories, `src/data/demoData.ts`, `src/App.tsx`, the layout. Add at
   the end of the relevant section; never reorder, reformat, or tidy. Demo seed
   ids are positional (`demo-cat-N`) and seeded stock movements reference them,
   so new demo items append — inserting one at the front breaks tests.
6. **Demo mode never lies.** No real network calls, deterministic outcomes,
   labelled as demo, and email shows "Demo email sent" — never a fake
   "delivered".
7. **AI proposes, a human decides.** Every AI identification reaches staff as an
   option they confirm — intake alternates, fitment previews, candidate lists.
   Schema-valid output is not true output: a repetition-looped answer once
   became a catalog product named `A100-P-P-P-P-P-cd-cd-corp`.
8. **Email keeps a permission trail.** Opt-out is honoured, the public quote and
   every email show the customer's first name only, and the app never claims a
   send that did not happen. The first email is a human decision; follow-ups
   send themselves and know when to stop.
9. **No required fields anywhere.** A blank item name still lands as a real line
   item. Shops enter data mid-phone-call.
10. **Canonicalize at the one choke point.** Brand / model / descriptor are
    separate fields, normalized on write in `catalogItemRow` via
    `canonicalizeProductFields`, so "kicker", "KICKER" and "Kicker Audio" are one
    brand. Never re-implement naming logic at a call site.
11. **Pure logic before UI.** The hard reasoning lands in a tested
    `src/lib/*.ts` module first; the component consumes it. Slot math, money
    math, and barcode semantics are where correctness bugs hide.

---

## Deploy: three pipelines, one human

| What | How it ships | Who |
|---|---|---|
| The app | Cloudflare rebuilds from a git push | automatic |
| Edge Functions | `npm run deploy:functions` | the owner, by hand |
| Migrations | pasted into the Supabase SQL editor | the owner, by hand |

Skew between these has caused several "it's still broken" reports that were
really "half of it shipped". When product lookup misbehaves, check the deployed
function version first: Settings → **Test product lookup** reports it, along
with a per-retailer health readout. Setting a secret is not a deploy.

---

## The agent roster

Specialists carry their domain's rules permanently so they never need
re-explaining. **This session is the mastermind**: it plans, delegates, runs the
gate, and is the only thing that touches git. Agents report here; nothing they
say reaches the user except through this session.

| Agent | Use it for | Owns |
|---|---|---|
| `resolver` | product identification: barcode, retailers, fitment, the AI ladder | `supabase/functions/resolve-product/**`, the mirrored `src/lib` helpers |
| `data` | migrations, RLS, repositories, types, demo seed | `supabase/migrations/**`, `src/data/**`, `src/types.ts`, other Edge Functions |
| `interface` | building screens and flows | `src/pages/**`, `src/components/**` except `ui.tsx` |
| `design` | how it looks and feels; visual critique | `src/index.css`, `src/components/ui.tsx` |
| `verify` | running the gate and hunting drift (read-only) | nothing |
| `analyst` | reading the live database: pilot health, funnel, attribution (read-only, SELECT only) | nothing |
| `dashboard` | the founder's private platform-admin view | `src/pages/AdminPage.tsx`, `src/data/adminRepository.ts` |
| `business` | pricing, positioning, strategy (read-only, no files) | nothing |
| `marketing` | pitch, demo script, landing copy (read-only, no files) | nothing |

Two agents may run in parallel only when their owned paths do not overlap.
Anything touching a shared file from invariant 5 goes to `data` alone.

**Delegate when** the work is squarely one domain's and the domain rules are
dense. **Do it here when** the change is small, spans domains, or you already
hold the context — a spawn starts cold and re-derives what you know.

---

## Voice

Commit subjects say what changed for the user, not what the mechanism is —
"Stop a genuine 'not found' costing three web searches", not "refactor ladder".
The body explains the reasoning: what was wrong, why it mattered, why this fix.
Match the existing history.

Product copy is for a shop owner holding a phone between customers: plain
language, big buttons, no jargon. From the playbook: *never say "inventory
management"* — say "never tell a customer you're out of something that's sitting
on your shelf". And when a number is bad, report the bad number.
