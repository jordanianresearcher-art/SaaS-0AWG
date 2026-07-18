import { useMemo, useState } from 'react'
import { format, subDays } from 'date-fns'
import { Download, Printer } from 'lucide-react'
import { useAppData } from '../../data/AppDataContext'
import { Button, Card, LoadingBlock } from '../../components/ui'
import { computeMetrics } from '../../lib/metrics'
import { formatCurrency, formatDate } from '../../lib/format'

type RangeChoice = '7' | '14' | 'custom'

export default function ReportsPage() {
  const { bundles, shop, mode, loading } = useAppData()
  const [range, setRange] = useState<RangeChoice>('14')
  const [customFrom, setCustomFrom] = useState(format(subDays(new Date(), 14), 'yyyy-MM-dd'))
  const [customTo, setCustomTo] = useState(format(new Date(), 'yyyy-MM-dd'))

  const { from, to } = useMemo(() => {
    const now = new Date()
    if (range === 'custom') {
      return {
        from: new Date(`${customFrom}T00:00:00`),
        to: new Date(`${customTo}T23:59:59`),
      }
    }
    return { from: subDays(now, Number(range)), to: now }
  }, [range, customFrom, customTo])

  const metrics = useMemo(() => computeMetrics(bundles, from, to), [bundles, from, to])

  if (loading && bundles.length === 0) return <LoadingBlock label="Building your report…" />

  const rows: Array<{ label: string; value: string; highlight?: boolean }> = [
    { label: 'Eligible quotes created', value: String(metrics.eligibleQuotes) },
    { label: 'Total quoted value', value: formatCurrency(metrics.totalQuotedCents) },
    { label: 'Quote emails sent', value: String(metrics.emailsSent) },
    { label: 'Quote link views', value: String(metrics.quoteViews) },
    { label: 'Customer responses', value: String(metrics.responses) },
    { label: 'Asked for a cheaper package', value: String(metrics.cheaperRequests) },
    { label: 'Asked about financing', value: String(metrics.financingRequests) },
    { label: 'Appointments booked', value: String(metrics.appointments) },
    { label: 'Deposits paid', value: String(metrics.deposits) },
    { label: 'Jobs won', value: String(metrics.wonJobs), highlight: true },
    { label: 'Recovered revenue', value: formatCurrency(metrics.recoveredRevenueCents), highlight: true },
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
      <div className="no-print flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-3xl font-black text-ink">Pilot report</h1>
          <p className="mt-1 text-base text-zinc-600">Print this and put it on the counter. The numbers speak for themselves.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={exportCsv}>
            <Download className="h-5 w-5" aria-hidden="true" /> CSV
          </Button>
          <Button onClick={() => window.print()}>
            <Printer className="h-5 w-5" aria-hidden="true" /> Print report
          </Button>
        </div>
      </div>

      <div className="no-print flex flex-wrap items-center gap-2" role="group" aria-label="Report period">
        <Button variant={range === '7' ? 'primary' : 'secondary'} onClick={() => setRange('7')}>
          Last 7 days
        </Button>
        <Button variant={range === '14' ? 'primary' : 'secondary'} onClick={() => setRange('14')}>
          Last 14 days
        </Button>
        <Button variant={range === 'custom' ? 'primary' : 'secondary'} onClick={() => setRange('custom')}>
          Custom
        </Button>
        {range === 'custom' ? (
          <span className="flex items-center gap-2">
            <label htmlFor="report-from" className="sr-only">From date</label>
            <input
              id="report-from"
              type="date"
              value={customFrom}
              onChange={(e) => setCustomFrom(e.target.value)}
              className="min-h-12 rounded-xl border border-zinc-300 px-3 text-base"
            />
            <span aria-hidden="true">–</span>
            <label htmlFor="report-to" className="sr-only">To date</label>
            <input
              id="report-to"
              type="date"
              value={customTo}
              onChange={(e) => setCustomTo(e.target.value)}
              className="min-h-12 rounded-xl border border-zinc-300 px-3 text-base"
            />
          </span>
        ) : null}
      </div>

      <Card className="mx-auto max-w-2xl p-6 sm:p-8">
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
          Quote views count each time a customer opened their quote link. Email counts include only emails
          your team pressed Send on{mode === 'demo' ? ' (demo emails in demo mode)' : ''}.
        </p>
      </Card>
    </div>
  )
}
