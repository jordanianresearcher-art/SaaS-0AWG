import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Plus, Search } from 'lucide-react'
import { useAppData } from '../../data/AppDataContext'
import { Badge, Card, EmptyState, Input, LinkButton, LoadingBlock, Select } from '../../components/ui'
import { STATUS_CONFIG } from '../../lib/status'
import { customerDisplayName, formatCurrency, formatDate, formatVehicle, quoteValueCents } from '../../lib/format'
import type { QuoteStatus } from '../../types'

export default function QuotesPage() {
  const { bundles, loading } = useAppData()
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<QuoteStatus | 'all'>('all')

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase()
    return bundles.filter((b) => {
      if (statusFilter !== 'all' && b.quote.status !== statusFilter) return false
      if (!term) return true
      const haystack = `${customerDisplayName(b.customer)} ${formatVehicle(b.customer) ?? ''} ${b.customer.email}`.toLowerCase()
      return haystack.includes(term)
    })
  }, [bundles, search, statusFilter])

  if (loading && bundles.length === 0) return <LoadingBlock label="Loading quotes…" />

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-3xl font-black text-ink">Quotes</h1>
        <LinkButton to="/app/quotes/new">
          <Plus className="h-5 w-5" aria-hidden="true" /> Create Quote
        </LinkButton>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-3 h-5 w-5 -translate-y-1/2 text-zinc-400" aria-hidden="true" />
          <Input
            type="search"
            aria-label="Search quotes"
            placeholder="Search name, vehicle, or email"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-10"
          />
        </div>
        <div className="sm:w-56">
          <Select
            aria-label="Filter by status"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as QuoteStatus | 'all')}
          >
            <option value="all">All statuses</option>
            {Object.entries(STATUS_CONFIG).map(([value, config]) => (
              <option key={value} value={value}>
                {config.label}
              </option>
            ))}
          </Select>
        </div>
      </div>

      {filtered.length === 0 ? (
        bundles.length === 0 ? (
          <EmptyState
            title="No quotes yet"
            message="Your quotes will live here — drafts, emailed quotes, and everything the customer has responded to."
            action={
              <LinkButton to="/app/quotes/new">
                <Plus className="h-5 w-5" aria-hidden="true" /> Create your first quote
              </LinkButton>
            }
          />
        ) : (
          <EmptyState title="No matches" message="No quotes match that search or filter. Try clearing it." />
        )
      ) : (
        <ul className="space-y-3">
          {filtered.map((b) => (
            <li key={b.quote.id}>
              <Link to={`/app/quotes/${b.quote.id}`} className="block">
                <Card className="flex items-center justify-between gap-3 hover:border-brand">
                  <div className="min-w-0">
                    <p className="truncate text-lg font-bold text-ink">{customerDisplayName(b.customer)}</p>
                    <p className="truncate text-base text-zinc-600">{formatVehicle(b.customer) ?? 'No vehicle on file'}</p>
                    <p className="mt-1 text-sm text-zinc-500">
                      Created {formatDate(b.quote.createdAt)}
                      {b.quote.lastEmailedAt ? ` · Emailed ${formatDate(b.quote.lastEmailedAt)}` : ' · Not emailed yet'}
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1.5">
                    <span className="text-lg font-black text-ink">{formatCurrency(quoteValueCents(b.options))}</span>
                    <Badge className={STATUS_CONFIG[b.quote.status].badgeClass}>{STATUS_CONFIG[b.quote.status].label}</Badge>
                  </div>
                </Card>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
