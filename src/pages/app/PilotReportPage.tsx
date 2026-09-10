// The printable pilot report: letterhead, one number per row, footnote.
//
// This is a sales instrument, not a dashboard. It exists to be printed on
// paper and left on a shop owner's counter at the end of a free pilot, which
// is why it is a plain vertical table rather than charts — a printed chart is
// decoration, a printed number is an argument.
//
// It has no nav entry on purpose. The owner asked for the analytics to live on
// Home, and this page is reached from Home's "Print report" button, which
// hands it the range Home is currently showing via ?days=.

import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { format, subDays } from 'date-fns'
import { Download, Printer } from 'lucide-react'
import { useAppData, useRepo } from '../../data/AppDataContext'
import { Button, Card, LoadingBlock, PageHeader } from '../../components/ui'
import { computeBookingMetrics, computeMetrics } from '../../lib/metrics'
import { formatCurrency, formatDate } from '../../lib/format'
import type { Appointment } from '../../types'

/** Matches the choices Home offers. Anything else in the URL falls back to 60. */
const ALLOWED_DAYS = [7, 30, 60, 90] as const

export default function PilotReportPage() {
  const { bundles, shop, mode, loading } = useAppData()
  const repo = useRepo()
  const [searchParams] = useSearchParams()
  const [appointments, setAppointments] = useState<Appointment[]>([])

  const days = useMemo(() => {
    const raw = Number(searchParams.get('days'))
    return (ALLOWED_DAYS as readonly number[]).includes(raw) ? raw : 60
  }, [searchParams])

  const { from, to } = useMemo(() => {
    const now = new Date()
    return { from: subDays(now, days), to: now }
  }, [days])

  const metrics = useMemo(() => computeMetrics(bundles, from, to), [bundles, from, to])

  // Appointments aren't part of the shared bundle load (the calendar fetches
  // them per visible range), so this page pulls its own slice.
  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const list = await repo.listAppointments(from.toISOString(), to.toISOString())
        if (!cancelled) setAppointments(list)
      } catch (err) {
        // A report that shows quote numbers but no booking numbers is far
        // better than a report that fails to render.
        console.error('listAppointments for report failed', err)
        if (!cancelled) setAppointments([])
      }
    })()
    return () => {
      cancelled = true
    }
  }, [repo, from, to])

  const booking = useMemo(() => computeBookingMetrics(appointments, from, to), [appointments, from, to])

  if (loading && bundles.length === 0) return <LoadingBlock label="Building your report…" />

  const rows: Array<{ label: string; value: string; highlight?: boolean }> = [
    { label: 'Eligible quotes created', value: String(metrics.eligibleQuotes) },
    { label: 'Total quoted value', value: formatCurrency(metrics.totalQuotedCents) },
    { label: 'Quote emails sent', value: String(metrics.emailsSent) },
    { label: 'Quote link views', value: String(metrics.quoteViews) },
    { label: 'Customer responses', value: String(metrics.responses) },
    { label: 'Asked for a cheaper package', value: String(metrics.cheaperRequests) },
    { label: 'Asked about financing', value: String(metrics.financingRequests) },
    { label: 'Follow-ups sent automatically', value: String(metrics.autoFollowUpsSent) },
    { label: 'Appointments booked', value: String(booking.booked) },
    { label: 'Reminders sent', value: String(booking.remindersSent) },
    {
      label: 'Showed up',
      value: booking.showRate === null ? '—' : `${Math.round(booking.showRate * 100)}%`,
    },
    { label: 'No-shows', value: String(booking.noShows) },
    ...(booking.depositsCollectedCents > 0
      ? [{ label: 'Deposits collected', value: formatCurrency(booking.depositsCollectedCents) }]
      : []),
    { label: 'Jobs won', value: String(metrics.wonJobs), highlight: true },
    { label: 'Recovered revenue', value: formatCurrency(metrics.recoveredRevenueCents), highlight: true },
    // Only printed once somebody has actually answered the question. A row
    // reading "0 of 8" on a report handed to a prospect would be worse than
    // no row: it invites the objection instead of answering it. Once wins are
    // attributed, this is the strongest line on the page — and it prints the
    // honest split, including the ones the shop closed itself.
    ...(metrics.appAttributedWins + metrics.shopAttributedWins > 0
      ? [
          {
            label: 'Wins the app brought back',
            value: `${metrics.appAttributedWins} of ${metrics.wonJobs} · ${formatCurrency(metrics.appAttributedRevenueCents)}`,
            highlight: true,
          },
          { label: 'Wins the shop closed itself', value: String(metrics.shopAttributedWins) },
          ...(metrics.unattributedWins > 0
            ? [{ label: 'Wins with no source recorded', value: String(metrics.unattributedWins) }]
            : []),
        ]
      : []),
  ]

  const exportCsv = () => {
    const lines = [
      ['Metric', 'Value'],
      ['Report period', `${formatDate(from.toISOString())} to ${formatDate(to.toISOString())}`],
      ...rows.map((r) => [r.label, r.value.replace(/,/g, '')]),
    ]
    const csv = lines.map((cols) => cols.map((c) => `"${c.replace(/"/g, '""')}"`).join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `0gauge-pilot-report-${format(new Date(), 'yyyy-MM-dd')}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="space-y-5">
      <div className="no-print">
        <PageHeader
          back={{ to: '/app', label: 'Home' }}
          title="Pilot report"
          subtitle={`Last ${days} days. Print it and put it on the counter — the numbers speak for themselves.`}
          actions={
            <>
              <Button variant="secondary" onClick={exportCsv}>
                <Download className="h-5 w-5" aria-hidden="true" /> CSV
              </Button>
              <Button onClick={() => window.print()}>
                <Printer className="h-5 w-5" aria-hidden="true" /> Print report
              </Button>
            </>
          }
        />
      </div>

      <Card tone="raised" className="print-block mx-auto max-w-2xl p-6 sm:p-8">
        <div className="border-b border-zinc-200 pb-5 text-center">
          <p className="text-sm font-bold tracking-widest text-brand uppercase">0Gauge Recovery — Pilot Report</p>
          <h2 className="mt-2 text-2xl font-black text-ink">{shop?.name}</h2>
          <p className="mt-1 text-base text-zinc-600">
            {formatDate(from.toISOString())} — {formatDate(to.toISOString())}
          </p>
          {mode === 'demo' ? (
            <p className="mt-2 inline-block rounded-full bg-amber-100 px-3 py-1 text-sm font-bold text-amber-900">
              Demo data — sample numbers only
            </p>
          ) : null}
        </div>
        <table className="mt-5 w-full">
          <caption className="sr-only">Pilot metrics for the selected period</caption>
          <tbody>
            {rows.map((row) => (
              <tr key={row.label} className="border-b border-zinc-100 last:border-0">
                <th scope="row" className="py-3 text-left text-base font-semibold text-zinc-700">
                  {row.label}
                </th>
                <td className={`py-3 text-right text-xl font-black ${row.highlight ? 'text-green-700' : 'text-ink'}`}>
                  {row.value}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mt-5 text-sm leading-relaxed text-zinc-500">
          Recovered revenue counts jobs marked won during the period, at the amount your team recorded.
          Quote views count each time a customer opened their quote link. "Showed up" is the share of
          finished appointments that weren't no-shows — upcoming bookings aren't counted either way.
          Email counts include both the emails your team sent and the follow-ups the app sent on its own
          {mode === 'demo' ? ' (demo emails in demo mode)' : ''}.
        </p>
      </Card>
    </div>
  )
}
