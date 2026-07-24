# 0Gauge Roadmap

Phase 1 is the only phase that exists in the product today. Later phases are
documented here so the vision is clear — none of them are implemented, and the
app shows no fake previews of them.

## Phase 1 — Quote Recovery (current)

Recover customers who requested a quote but never returned.

- Good / Better / Insane quotes, emailed with a public link
- View tracking, customer responses, manual email follow-ups, opt-out
- Appointments, deposits, won/lost, recovered revenue
- Printable 7/14-day pilot report used to convert pilots into paid accounts

Near-term Phase 1 polish candidates: QR code for the public quote, quote
duplication, customer history view, PWA install, quote auto-expiration,
role-restricted settings UI, pagination.

## Phase 2 — System Builder (foundation underway)

Guided package building for common vehicles: pick the truck, pick the goal
(daily driver / bass / show), and get a starting parts list with labor, priced
from the shop's own preferred brands. Output feeds directly into a quote.

The universal-configuration engine, expanded catalog model, and package
template schema are built and tested (`src/lib/audioConfigs.ts`,
migrations `0009`/`0010`) — see
[docs/CATALOG_AND_PACKAGES.md](CATALOG_AND_PACKAGES.md) and
[docs/IMPLEMENTATION_STATUS.md](IMPLEMENTATION_STATUS.md). The visual
builder UI, Shopify catalog import, and AI bulk-photo onboarding are next.

## Phase 3 — Package Page Generator

Turn a shop's best-selling packages into clean, shareable product pages
(per-vehicle landing pages) the shop can post on social media or print QR codes
for. Each page funnels into a quote request.

## Phase 4 — Digital Build Passport

A permanent, customer-facing record of each completed build: parts installed,
settings, photos, warranty dates, service history. Increases resale value of the
build and brings the customer back for the next vehicle.

## Phase 5 — Curated Marketplace

A consumer-facing directory of vetted independent shops and their signature
packages, fed by the passport and package pages. Shops get discovery; consumers
get trustworthy installers instead of big-box retail.

## Explicitly postponed decisions

- **SMS/text follow-ups** — postponed. Phase 1 is email-only by design
  (permission trail, printable history, no carrier compliance burden). Whether
  SMS is ever added will be decided later with real pilot data; nothing in the
  current product depends on it.
- Automated email campaigns/drip sequences — postponed; every send is manual.
- POS/inventory integration, payroll, scheduling, native mobile app — out of
  scope for the foreseeable future.
