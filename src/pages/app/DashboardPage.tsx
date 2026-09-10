// Home. The owner's own phone screen, and the only page they open on a normal
// day — so it answers two questions above the fold and nothing else: how much
// money did this thing make me, and what has to happen today.
//
// Everything that claims to be windowed obeys one range control, defaulting to
// 60 days. That default is deliberate: a car-audio shop's quote-to-install
// cycle regularly runs past a month, and the old hardcoded 14-day window cut
// most recovered revenue out of the number it was supposed to prove. Cards
// that are genuinely all-time (money still on the table, the pipeline funnel)
// say so rather than quietly borrowing the window.

import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { isSameDay, subDays } from 'date-fns'
import { Plus, ArrowRight, Award, CalendarDays, BellRing, MessageSquare, Printer } from 'lucide-react'
import { useAppData, useRepo } from '../../data/AppDataContext'
import { Card, Badge, Button, EmptyState, LinkButton, LoadingBlock, PageHeader, SectionHeader } from '../../components/ui'
import { RecoveryScoreGauge } from '../../components/RecoveryScoreGauge'
import { Confetti } from '../../components/Confetti'
import {
  activeQuoteValueCents,
  computeMetrics,
  computeMilestones,
  computeRecoveryScore,
  statusFunnel,
  type PilotMetrics,
  type RecoveryTier,
} from '../../lib/metrics'
import { formatCurrency, customerDisplayName, formatVehicle, formatDateTime, formatTime } from '../../lib/format'
import { STATUS_CONFIG, RESPONSE_CONFIG } from '../../lib/status'
import { followUpBucket } from '../../lib/followUp'
import { computeInventorySummary } from '../../lib/inventory'
import type { Appointment, CatalogItem, QuoteBundle } from '../../types'

/** Windows the owner actually asks for. 60 is the default — see the file note. */
const RANGE_CHOICES = [
  { days: 7, label: '7 days' },
  { days: 30, label: '30 days' },
  { days: 60, label: '60 days' },
  { days: 90, label: '90 days' },
] as const

const TIER_RANK: Record<RecoveryTier, number> = { none: 0, bronze: 1, silver: 2, gold: 3, platinum: 4 }
const BEST_TIER_KEY = '0gauge-best-tier'
const SEEN_MILESTONES_KEY = '0gauge-seen-milestones'

/** One number, big. `note` carries the window so no figure is silently ambiguous. */
function Figure({
  label,
  value,
  note,
  accent = false,
}: {
  label: string
  value: string
  note?: string
  accent?: boolean
}) {
  return (
    <div>
      <p className="text-sm font-semibold tracking-wide text-zinc-500 uppercase">{label}</p>
      <p className={`text-3xl font-black ${accent ? 'text-green-700' : 'text-ink'}`}>{value}</p>
      {note ? <p className="text-xs text-zinc-500">{note}</p> : null}
    </div>
  )
}

/**
 * Who actually brought the won jobs back.
 *
 * "Recovered revenue" is the claim this whole app makes, and until now it was
 * a number with nothing behind it — which is why it could not survive the
 * first question a shop owner asks: "I closed those on the phone anyway."
 * This line answers that in the shop's own words, and answers it honestly:
 * a win nobody attributed is shown as unrecorded, never quietly credited.
 */
function WinCredit({ metrics }: { metrics: PilotMetrics }) {
  if (metrics.wonJobs === 0) return null
  const { appAttributedWins, shopAttributedWins, unattributedWins, wonJobs } = metrics

  if (appAttributedWins === 0 && shopAttributedWins === 0) {
    return (
      <p className="mt-4 border-t border-zinc-200 pt-3 text-sm text-zinc-500">
        None of these {wonJobs === 1 ? 'wins says' : `${wonJobs} wins say`} what brought the customer back. Open a won
        quote and tap the answer — it takes a second, and it is what shows whether this app earned the sale or you did.
      </p>
    )
  }

  const parts = [
    appAttributedWins > 0 ? `${appAttributedWins} came back through the app` : null,
    shopAttributedWins > 0 ? `${shopAttributedWins} you closed yourself` : null,
    unattributedWins > 0 ? `${unattributedWins} not recorded` : null,
  ].filter((part): part is string => part !== null)

  return (
    <div className="mt-4 border-t border-zinc-200 pt-3">
      <p className="text-sm text-zinc-600">
        Of {wonJobs} {wonJobs === 1 ? 'job' : 'jobs'} won: {parts.join(' · ')}.
      </p>
      {appAttributedWins > 0 ? (
        <p className="text-sm font-semibold text-green-700">
          {formatCurrency(metrics.appAttributedRevenueCents)} of that is revenue this app brought back.
        </p>
      ) : null}
    </div>
  )
}

/**
 * One standing count: icon, number, what it is, the window it covers, and
 * where to go about it.
 *
 * `note` is not decoration. This card used to be headed "Today" while its
 * three rows measured three different spans — appointments today, follow-ups
 * due now, responses over the whole selected period — and an analysis of the
 * pilot read "0 appointments" as sixty days of nothing when it meant nobody
 * was booked in that day. Every row states its own window now.
 */
function TodayRow({
  icon: Icon,
  count,
  label,
  note,
  to,
  urgent = false,
}: {
  icon: typeof CalendarDays
  count: number
  label: string
  note: string
  to: string
  urgent?: boolean
}) {
  return (
    <li>
      <Link to={to} className="flex min-h-14 items-center gap-3 rounded-xl px-2 py-2 hover:bg-zinc-50">
        <span
          className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${
            count === 0 ? 'bg-zinc-100 text-zinc-400' : urgent ? 'bg-amber-100 text-amber-800' : 'bg-brand-tint text-brand'
          }`}
        >
          <Icon className="h-5 w-5" aria-hidden="true" />
        </span>
        <span className={`text-2xl font-black ${count === 0 ? 'text-zinc-400' : 'text-ink'}`}>{count}</span>
        <span className="min-w-0 flex-1">
          <span className="block text-base font-semibold text-charcoal">{label}</span>
          <span className="block text-xs text-zinc-500">{note}</span>
        </span>
        <ArrowRight className="h-4 w-4 shrink-0 text-zinc-400" aria-hidden="true" />
      </Link>
    </li>
  )
}

function InventoryCard() {
  const repo = useRepo()
  const { shop } = useAppData()
  const [items, setItems] = useState<CatalogItem[] | null>(null)

  useEffect(() => {
    void repo.listCatalogItems().then(setItems)
  }, [repo])

  const summary = computeInventorySummary(items ?? [], shop?.defaultLowStockThreshold ?? 3)

  return (
    <Card>
      <SectionHeader
        title="Inventory"
        action={
          <Link to="/app/inventory" className="flex items-center gap-1 text-sm font-semibold text-brand">
            All inventory <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </Link>
        }
      />
      {items === null ? (
        <p className="mt-4 text-base text-zinc-600">Loading…</p>
      ) : items.length === 0 ? (
        <p className="mt-4 text-base text-zinc-600">Scan or add your first product to start tracking stock.</p>
      ) : (
        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div>
            <p className="text-sm text-zinc-500">Products</p>
            <p className="text-xl font-bold text-ink">{summary.totalSkus}</p>
          </div>
          <div>
            <p className="text-sm text-zinc-500">Units on hand</p>
            <p className="text-xl font-bold text-ink">{summary.totalUnits}</p>
          </div>
          <div>
            <p className="text-sm text-zinc-500">Value</p>
            <p className="text-xl font-bold text-ink">{formatCurrency(summary.totalValueCents)}</p>
          </div>
          <div>
            <p className="text-sm text-zinc-500">Low stock</p>
            <p className={`text-xl font-bold ${summary.lowStockCount > 0 ? 'text-amber-700' : 'text-ink'}`}>{summary.lowStockCount}</p>
          </div>
        </div>
      )}
    </Card>
  )
}

export default function DashboardPage() {
  const { bundles, loading, loadError } = useAppData()
  const repo = useRepo()
  const [days, setDays] = useState<number>(60)
  const [appointments, setAppointments] = useState<Appointment[]>([])

  // A single `now` for the whole render. Calling new Date() in several places
  // would let the window edge move between calculations.
  const now = useMemo(() => new Date(), [])
  const from = useMemo(() => subDays(now, days), [now, days])

  // Appointments aren't in the shared bundle load (the calendar fetches them
  // per visible range), so Home pulls its own slice — from the start of the
  // window through the end of today, which is what "booked today" needs.
  useEffect(() => {
    let cancelled = false
    const endOfToday = new Date(now)
    endOfToday.setHours(23, 59, 59, 999)
    void (async () => {
      try {
        const list = await repo.listAppointments(from.toISOString(), endOfToday.toISOString())
        if (!cancelled) setAppointments(list)
      } catch (err) {
        // Home showing quote numbers but no booking numbers beats Home
        // failing to render.
        console.error('listAppointments for home failed', err)
        if (!cancelled) setAppointments([])
      }
    })()
    return () => {
      cancelled = true
    }
  }, [repo, from, now])

  const metrics = useMemo(() => computeMetrics(bundles, from, now), [bundles, from, now])
  const recoveryScore = useMemo(() => computeRecoveryScore(metrics), [metrics])
  const milestones = useMemo(() => computeMilestones(bundles), [bundles])

  const dueToday = useMemo(
    () =>
      bundles.filter((b) => {
        const bucket = followUpBucket(b.quote, b.customer.emailOptOutAt !== null, now)
        return bucket === 'overdue' || bucket === 'due_today'
      }),
    [bundles, now],
  )

  const todaysAppointments = useMemo(
    () =>
      appointments
        .filter((a) => a.status !== 'cancelled' && isSameDay(new Date(a.startsAt), now))
        .sort((a, b) => a.startsAt.localeCompare(b.startsAt)),
    [appointments, now],
  )

  const recentResponses = useMemo(
    () =>
      bundles
        .flatMap((b) => b.responses.map((r) => ({ bundle: b, response: r })))
        .sort((a, b) => b.response.createdAt.localeCompare(a.response.createdAt))
        .slice(0, 5),
    [bundles],
  )

  const [confettiTrigger, setConfettiTrigger] = useState(0)
  const celebratedRef = useRef(false)

  // Fire a confetti burst the first time Home sees a new best tier or a newly
  // achieved milestone — never on every render, just on real progress.
  useEffect(() => {
    if (celebratedRef.current) return
    if (loading && bundles.length === 0) return
    celebratedRef.current = true
    let celebrate = false

    const bestTierSoFar = (localStorage.getItem(BEST_TIER_KEY) as RecoveryTier | null) ?? 'none'
    if (recoveryScore.tier !== 'none' && TIER_RANK[recoveryScore.tier] > TIER_RANK[bestTierSoFar]) {
      localStorage.setItem(BEST_TIER_KEY, recoveryScore.tier)
      celebrate = true
    }

    const seen: string[] = JSON.parse(localStorage.getItem(SEEN_MILESTONES_KEY) ?? '[]')
    const newlyAchieved = milestones.filter((m) => m.achieved && !seen.includes(m.id))
    if (newlyAchieved.length > 0) {
      localStorage.setItem(SEEN_MILESTONES_KEY, JSON.stringify([...seen, ...newlyAchieved.map((m) => m.id)]))
      celebrate = true
    }

    if (celebrate) setConfettiTrigger((n) => n + 1)
  }, [recoveryScore.tier, milestones, loading, bundles.length])

  if (loading && bundles.length === 0) return <LoadingBlock label="Loading your shop…" />
  if (loadError) return <EmptyState title="Could not load" message={loadError} />

  const recentActivity = bundles
    .flatMap((b) => b.events.map((e) => ({ bundle: b, event: e })))
    .sort((a, b) => b.event.createdAt.localeCompare(a.event.createdAt))
    .slice(0, 8)
  const funnel = statusFunnel(bundles).filter((f) => f.count > 0)
  const windowNote = `Last ${days} days`

  return (
    <div className="space-y-6">
      <PageHeader
        title="Home"
        actions={
          <>
            <LinkButton to={`/app/report?days=${days}`} variant="secondary">
              <Printer className="h-5 w-5" aria-hidden="true" /> Print report
            </LinkButton>
            <LinkButton to="/app/quotes/new">
              <Plus className="h-5 w-5" aria-hidden="true" /> Create Quote
            </LinkButton>
          </>
        }
      />

      <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Time period">
        {RANGE_CHOICES.map((choice) => (
          <Button
            key={choice.days}
            variant={days === choice.days ? 'primary' : 'secondary'}
            onClick={() => setDays(choice.days)}
            aria-pressed={days === choice.days}
          >
            {choice.label}
          </Button>
        ))}
      </div>

      {/* Money and today, side by side — the two questions the owner opens
          this page to answer. */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <SectionHeader title="Money" />
          <div className="mt-4 grid grid-cols-2 gap-4">
            <Figure
              label="Recovered"
              value={formatCurrency(metrics.recoveredRevenueCents)}
              note={windowNote}
              accent
            />
            <Figure
              label="Still on the table"
              value={formatCurrency(activeQuoteValueCents(bundles))}
              note="All open quotes"
            />
            <Figure label="Jobs won" value={String(metrics.wonJobs)} note={windowNote} accent />
            <Figure label="Quoted" value={formatCurrency(metrics.totalQuotedCents)} note={windowNote} />
          </div>
          <WinCredit metrics={metrics} />
        </Card>

        <Card>
          {/* Not "Today": only the first row is today. See TodayRow. */}
          <SectionHeader title="Where things stand" />
          <ul className="mt-2 -mx-2">
            <TodayRow
              icon={CalendarDays}
              count={todaysAppointments.length}
              label={todaysAppointments.length === 1 ? 'appointment' : 'appointments'}
              note="Booked for today"
              to="/app/calendar"
            />
            <TodayRow
              icon={BellRing}
              count={dueToday.length}
              label="follow-ups due"
              note="Due now"
              to="/app/follow-ups"
              urgent
            />
            <TodayRow
              icon={MessageSquare}
              count={metrics.responses}
              label="customer responses"
              note={windowNote}
              to="/app/quotes"
            />
          </ul>
          {todaysAppointments.length > 0 ? (
            <ul className="mt-2 space-y-1 border-t border-zinc-100 pt-3">
              {todaysAppointments.slice(0, 4).map((a) => (
                <li key={a.id} className="flex items-baseline justify-between gap-3 text-base">
                  <span className="truncate text-zinc-700">
                    {[a.customerFirstName, a.customerLastName].filter(Boolean).join(' ') || 'Appointment'}
                  </span>
                  <span className="shrink-0 text-sm font-semibold text-zinc-500">{formatTime(a.startsAt)}</span>
                </li>
              ))}
            </ul>
          ) : null}
        </Card>
      </div>

      <Card tone="raised" className="relative overflow-hidden p-6 text-center sm:p-8">
        <Confetti trigger={confettiTrigger} />
        <p className="text-sm font-bold tracking-widest text-brand uppercase">Recovery Score</p>
        <div className="mt-4 flex justify-center">
          <RecoveryScoreGauge score={recoveryScore.score} tier={recoveryScore.tier} />
        </div>
        <p className="mt-4 text-base text-zinc-500">
          {recoveryScore.score === null
            ? 'Email a few quotes and this score will come to life.'
            : `Built from recovered revenue, win rate, responses, and views over the last ${days} days.`}
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2 border-t border-zinc-100 pt-5">
          {milestones.map((m) => (
            <Badge
              key={m.id}
              title={m.description}
              className={
                m.achieved
                  ? 'gap-1.5 border border-amber-300 bg-amber-50 text-amber-900'
                  : 'gap-1.5 border border-zinc-200 bg-zinc-50 text-zinc-400'
              }
            >
              <Award className="h-4 w-4" aria-hidden="true" />
              {m.label}
            </Badge>
          ))}
        </div>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <SectionHeader
            title="Follow-ups due today"
            action={
              <Link to="/app/follow-ups" className="flex items-center gap-1 text-sm font-semibold text-brand">
                All follow-ups <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </Link>
            }
          />
          {dueToday.length === 0 ? (
            <p className="mt-4 text-base text-zinc-600">Nothing due today. Nice and caught up.</p>
          ) : (
            <ul className="mt-3 divide-y divide-zinc-100">
              {dueToday.slice(0, 5).map((b) => (
                <li key={b.quote.id}>
                  <Link to={`/app/quotes/${b.quote.id}`} className="flex min-h-14 items-center justify-between gap-3 py-2.5 hover:bg-zinc-50">
                    <div>
                      <p className="text-base font-bold text-ink">{customerDisplayName(b.customer)}</p>
                      <p className="text-sm text-zinc-600">{formatVehicle(b.customer) ?? 'No vehicle on file'}</p>
                    </div>
                    <Badge className={STATUS_CONFIG[b.quote.status].badgeClass}>{STATUS_CONFIG[b.quote.status].label}</Badge>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <SectionHeader title="Recent customer responses" />
          {recentResponses.length === 0 ? (
            <p className="mt-4 text-base text-zinc-600">No responses yet. They&apos;ll show up here the moment a customer answers a quote.</p>
          ) : (
            <ul className="mt-3 divide-y divide-zinc-100">
              {recentResponses.map(({ bundle, response }) => (
                <li key={response.id}>
                  <Link to={`/app/quotes/${bundle.quote.id}`} className="block min-h-14 py-2.5 hover:bg-zinc-50">
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-base font-bold text-ink">{customerDisplayName(bundle.customer)}</p>
                      <span className="text-sm text-zinc-500">{formatDateTime(response.createdAt)}</span>
                    </div>
                    <p className="text-sm font-semibold text-brand">{RESPONSE_CONFIG[response.responseType].label}</p>
                    {response.message ? <p className="mt-0.5 text-sm text-zinc-600">“{response.message}”</p> : null}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <InventoryCard />

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <SectionHeader title="Where your quotes stand" note="All open quotes" />
          {funnel.length === 0 ? (
            <p className="mt-4 text-base text-zinc-600">Create your first quote to see the pipeline.</p>
          ) : (
            <ul className="mt-4 space-y-2.5">
              {funnel.map((f) => {
                const max = Math.max(...funnel.map((x) => x.count))
                const config = STATUS_CONFIG[f.status as keyof typeof STATUS_CONFIG]
                return (
                  <li key={f.status} className="flex items-center gap-3">
                    <span className="w-28 shrink-0 text-sm font-semibold text-zinc-600">{config.label}</span>
                    <div className="h-6 flex-1 overflow-hidden rounded-md bg-zinc-100">
                      <div
                        className="h-full rounded-md bg-brand"
                        style={{ width: `${Math.max(8, (f.count / max) * 100)}%` }}
                      />
                    </div>
                    <span className="w-6 text-right text-base font-bold text-ink">{f.count}</span>
                  </li>
                )
              })}
            </ul>
          )}
        </Card>

        <Card>
          <SectionHeader title="Recent activity" />
          {recentActivity.length === 0 ? (
            <p className="mt-4 text-base text-zinc-600">Activity like sent emails and quote views will appear here.</p>
          ) : (
            <ul className="mt-3 space-y-2.5">
              {recentActivity.map(({ bundle, event }) => (
                <li key={event.id} className="flex items-baseline justify-between gap-3 text-base">
                  <span className="text-zinc-700">
                    <span className="font-semibold text-ink">{customerDisplayName(bundle.customer)}</span>{' '}
                    — {eventLabel(event.eventType, bundle)}
                  </span>
                  <span className="shrink-0 text-sm text-zinc-500">{formatDateTime(event.createdAt)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      {bundles.length === 0 ? (
        <EmptyState
          title="No quotes yet"
          message="Create your first quote and email it to the customer. Everything else builds from there."
          action={
            <LinkButton to="/app/quotes/new">
              <Plus className="h-5 w-5" aria-hidden="true" /> Create Quote
            </LinkButton>
          }
        />
      ) : null}
    </div>
  )
}

function eventLabel(eventType: string, bundle: QuoteBundle): string {
  switch (eventType) {
    case 'created':
      return 'quote created'
    case 'edited':
      return 'quote edited'
    case 'email_sent':
      return 'quote email sent'
    case 'email_demo_sent':
      return 'demo email sent'
    case 'email_failed':
      return 'email failed'
    case 'quote_viewed':
      return 'opened their quote'
    case 'customer_responded':
      return 'responded to their quote'
    case 'appointment_booked':
      return 'appointment booked'
    case 'deposit_paid':
      return 'deposit paid'
    case 'won_amount_edited':
      return 'sale amount corrected'
    case 'win_source_edited':
      return 'win source updated'
    case 'marked_won':
      return `job won${bundle.quote.wonAmountCents ? ` (${formatCurrency(bundle.quote.wonAmountCents)})` : ''}`
    case 'marked_lost':
      return 'marked lost'
    case 'follow_up_rescheduled':
      return 'follow-up rescheduled'
    case 'follow_up_disabled':
      return 'follow-up turned off'
    case 'email_opt_out':
      return 'asked to stop emails'
    case 'marked_contacted':
      return 'marked contacted'
    default:
      return eventType.replaceAll('_', ' ')
  }
}
