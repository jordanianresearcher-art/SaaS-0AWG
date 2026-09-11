import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { CreditCard, MessageSquare, Pencil, Plus, Search, Trash2 } from 'lucide-react'
import { useAppData, useRepo } from '../../data/AppDataContext'
import { useToast } from '../../components/Toast'
import { Badge, Button, Card, EmptyState, Input, LinkButton, LoadingBlock, Modal, PageHeader, Select } from '../../components/ui'
import { isTerminal, STATUS_CONFIG } from '../../lib/status'
import { errorMessage } from '../../lib/errors'
import { customerDisplayName, formatCurrency, formatDate, formatVehicle, quoteValueCents } from '../../lib/format'
import type { QuoteBundle, QuoteStatus } from '../../types'

/** Latest response is a still-open ask for financing — worth a glance from the list, not just the detail page. */
function needsFinancingFollowUp(b: QuoteBundle): boolean {
  return b.responses[0]?.responseType === 'need_financing' && !isTerminal(b.quote.status)
}

export default function QuotesPage() {
  const { bundles, loading, refresh } = useAppData()
  const repo = useRepo()
  const toast = useToast()
  const navigate = useNavigate()
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<QuoteStatus | 'all'>('all')
  /** The quote awaiting delete confirmation, or null. Holds the whole bundle so the dialog can name the customer. */
  const [deleteTarget, setDeleteTarget] = useState<QuoteBundle | null>(null)
  const [deleting, setDeleting] = useState(false)
  /** Unread customer messages per quote id. Empty until it loads, so the list never waits on it. */
  const [unread, setUnread] = useState<Record<string, number>>({})

  useEffect(() => {
    // A quote with someone waiting on an answer has to be visible from the
    // list. Staff open this screen, not the thread.
    void repo.countUnreadQuoteMessages().then(setUnread).catch(() => {})
  }, [repo, bundles])

  const doDelete = async () => {
    if (!deleteTarget) return
    setDeleting(true)
    try {
      await repo.deleteQuote(deleteTarget.quote.id)
      await refresh()
      toast('success', 'Quote deleted.')
      setDeleteTarget(null)
    } catch (err) {
      console.error('deleteQuote failed', err)
      const detail = errorMessage(err)
      toast('error', detail ? `Could not delete the quote: ${detail}` : 'Could not delete the quote. Please try again.')
    } finally {
      setDeleting(false)
    }
  }

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
      <PageHeader
        title="Quotes"
        actions={
          <LinkButton to="/app/quotes/new">
            <Plus className="h-5 w-5" aria-hidden="true" /> Create Quote
          </LinkButton>
        }
      />

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
              {/* The row's link covers only the content, not the whole card —
                 edit/delete are real buttons and must not be nested inside an
                 anchor (invalid HTML, and a tap on either would also navigate). */}
              <Card className="flex items-center gap-3 hover:border-brand">
                <Link to={`/app/quotes/${b.quote.id}`} className="flex min-w-0 flex-1 items-center justify-between gap-3">
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
                    {unread[b.quote.id] ? (
                      <Badge className="bg-green-100 text-green-800">
                        <MessageSquare className="h-3.5 w-3.5" aria-hidden="true" />
                        {unread[b.quote.id] === 1 ? 'New message' : `${unread[b.quote.id]} new messages`}
                      </Badge>
                    ) : null}
                    {needsFinancingFollowUp(b) ? (
                      <Badge className="bg-amber-100 text-amber-800">
                        <CreditCard className="h-3.5 w-3.5" aria-hidden="true" /> Needs financing
                      </Badge>
                    ) : null}
                  </div>
                </Link>
                <div className="flex shrink-0 items-center gap-1 border-l border-zinc-100 pl-2">
                  <button
                    type="button"
                    aria-label={`Edit ${customerDisplayName(b.customer)}'s quote`}
                    title="Edit"
                    onClick={() => navigate('/app/quotes/new', { state: { editFrom: b } })}
                    className="flex h-11 w-11 items-center justify-center rounded-xl text-zinc-400 hover:bg-zinc-100 hover:text-ink"
                  >
                    <Pencil className="h-5 w-5" aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    aria-label={`Delete ${customerDisplayName(b.customer)}'s quote`}
                    title="Delete"
                    onClick={() => setDeleteTarget(b)}
                    className="flex h-11 w-11 items-center justify-center rounded-xl text-zinc-400 hover:bg-red-50 hover:text-red-600"
                  >
                    <Trash2 className="h-5 w-5" aria-hidden="true" />
                  </button>
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}

      <Modal open={deleteTarget !== null} onClose={() => setDeleteTarget(null)} title="Delete this quote?">
        <div className="space-y-4">
          <p className="text-base text-ink">
            This permanently deletes {deleteTarget ? customerDisplayName(deleteTarget.customer) : 'this customer'}&apos;s
            quote and everything attached to it — its options, send history, and the customer&apos;s responses. Their
            quote link will stop working. This can&apos;t be undone.
          </p>
          <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
            <Button variant="secondary" onClick={() => setDeleteTarget(null)} disabled={deleting}>
              Keep it
            </Button>
            <Button variant="danger" onClick={() => void doDelete()} disabled={deleting}>
              <Trash2 className="h-5 w-5" aria-hidden="true" /> {deleting ? 'Deleting…' : 'Delete quote'}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
