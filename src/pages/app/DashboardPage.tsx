import { Link } from 'react-router-dom'
import { subDays } from 'date-fns'
import { Plus, ArrowRight } from 'lucide-react'
import { useAppData } from '../../data/AppDataContext'
import { Card, Badge, EmptyState, LinkButton, LoadingBlock } from '../../components/ui'
import { activeQuoteValueCents, computeMetrics, statusFunnel } from '../../lib/metrics'
import { formatCurrency, customerDisplayName, formatVehicle, formatDateTime } from '../../lib/format'
import { STATUS_CONFIG, RESPONSE_CONFIG } from '../../lib/status'
import { followUpBucket } from '../../lib/followUp'
import type { QuoteBundle } from '../../types'

function Stat({ label, value, accent = false }: { label: string; value: string; accent?: boolean }) {
  return (
    <Card className="flex flex-col gap-1">
      <span className="text-sm font-semibold tracking-wide text-zinc-500 uppercase">{label}</span>
      <span className={`text-2xl font-black ${accent ? 'text-green-700' : 'text-ink'}`}>{value}</span>
    </Card>
  )
}

export default function DashboardPage() {
  const { bundles, loading, loadError } = useAppData()

  if (loading && bundles.length === 0) return <LoadingBlock label="Loading your shop…" />
  if (loadError) return <EmptyState title="Could not load" message={loadError} />

  const now = new Date()
  const last14 = computeMetrics(bundles, subDays(now, 14), now)
  const dueToday = bundles.filter((b) => {
    const bucket = followUpBucket(b.quote, b.customer.emailOptOutAt !== null, now)
    return bucket === 'overdue' || bucket === 'due_today'
  })
  const recentResponses = bundles
    .flatMap((b) => b.responses.map((r) => ({ bundle: b, response: r })))
    .sort((a, b) => b.response.createdAt.localeCompare(a.response.createdAt))
    .slice(0, 5)
  const recentActivity = bundles
    .flatMap((b) => b.events.map((e) => ({ bundle: b, event: e })))
    .sort((a, b) => b.event.createdAt.localeCompare(a.event.createdAt))
    .slice(0, 8)
  const funnel = statusFunnel(bundles).filter((f) => f.count > 0)

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-3xl font-black text-ink">Today</h1>
          <p className="text-base text-zinc-600">Last 14 days at a glance.</p>
        </div>
        <LinkButton to="/app/quotes/new">
          <Plus className="h-5 w-5" aria-hidden="true" /> Create Quote
        </LinkButton>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Money still on the table" value={formatCurrency(activeQuoteValueCents(bundles))} />
        <Stat label="Recovered revenue" value={formatCurrency(last14.recoveredRevenueCents)} accent />
        <Stat label="Won jobs" value={String(last14.wonJobs)} accent />
        <Stat label="Emails sent" value={String(last14.emailsSent)} />
        <Stat label="Quote views" value={String(last14.quoteViews)} />
        <Stat label="Customer responses" value={String(last14.responses)} />
        <Stat label="Appointments" value={String(last14.appointments)} />
        <Stat label="Deposits" value={String(last14.deposits)} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-bold text-ink">Follow-ups due today</h2>
            <Link to="/app/follow-ups" className="flex items-center gap-1 text-base font-semibold text-brand">
              All follow-ups <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </Link>
          </div>
          {dueToday.length === 0 ? (
            <p className="mt-4 text-base text-zinc-600">Nothing due today. Nice and caught up.</p>
          ) : (
            <ul className="mt-3 divide-y divide-zinc-100">
              {dueToday.slice(0, 5).map((b) => (
                <li key={b.quote.id}>
                  <Link to={`/app/quotes/${b.quote.id}`} className="flex min-h-14 items-center justify-between gap-3 py-2.5 hover:bg-zinc-50">
                    <div>
                      <p className="text-base font-bold text-ink">{customerDisplayName(b.customer)}</p>
                      <p className="text-sm text-zinc-600">{formatVehicle(b.customer)}</p>
                    </div>
                    <Badge className={STATUS_CONFIG[b.quote.status].badgeClass}>{STATUS_CONFIG[b.quote.status].label}</Badge>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <h2 className="text-xl font-bold text-ink">Recent customer responses</h2>
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

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <h2 className="text-xl font-bold text-ink">Where your quotes stand</h2>
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
          <h2 className="text-xl font-bold text-ink">Recent activity</h2>
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
