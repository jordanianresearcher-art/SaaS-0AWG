import { useCallback, useEffect, useState } from 'react'
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom'
import { format } from 'date-fns'
import {
  ArrowLeft,
  BadgeCheck,
  Ban,
  CalendarClock,
  Copy,
  CreditCard,
  ExternalLink,
  Files,
  Mail,
  Pencil,
  Phone,
  Printer,
  Trash2,
  Sparkles,
  Star,
  Trophy,
  XCircle,
} from 'lucide-react'
import { useAppData, useRepo } from '../../data/AppDataContext'
import { useToast } from '../../components/Toast'
import { Badge, Button, Card, EmptyState, Field, Input, LoadingBlock, Modal, Textarea } from '../../components/ui'
import { EmailPreviewModal, publicQuoteUrl } from '../../components/EmailPreviewModal'
import { RESPONSE_CONFIG, STATUS_CONFIG, TEMPLATE_CONFIG, isTerminal } from '../../lib/status'
import { suggestNextTemplate } from '../../lib/followUp'
import {
  customerDisplayName,
  formatCurrency,
  formatDate,
  formatDateTime,
  formatVehicle,
  parseDollarsToCents,
  quoteValueCents,
} from '../../lib/format'
import { errorMessage } from '../../lib/errors'
import { summarizeWindowTint } from '../../lib/windowTint'
import { addonOptions, computeAddonBreakdown, fullTotalCents, mainOption } from '../../lib/quotePricing'
import type { QuoteBundle, TemplateType } from '../../types'
import { formatItemDisplayName } from '../../lib/productNaming'

export default function QuoteDetailPage() {
  const { quoteId } = useParams<{ quoteId: string }>()
  const repo = useRepo()
  const { refresh } = useAppData()
  const toast = useToast()
  const navigate = useNavigate()
  const location = useLocation()
  const [bundle, setBundle] = useState<QuoteBundle | null>(null)
  const [notFound, setNotFound] = useState(false)
  const [emailOpen, setEmailOpen] = useState(false)
  const [emailTemplate, setEmailTemplate] = useState<TemplateType>('initial')
  const [wonOpen, setWonOpen] = useState(false)
  const [rescheduleOpen, setRescheduleOpen] = useState(false)
  const [notesDraft, setNotesDraft] = useState<string | null>(null)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [deleting, setDeleting] = useState(false)

  const load = useCallback(async () => {
    if (!quoteId) return
    const next = await repo.getQuoteBundle(quoteId)
    if (!next) setNotFound(true)
    else setBundle(next)
  }, [quoteId, repo])

  useEffect(() => {
    void load()
  }, [load])

  // "Save & review email" from the create-quote form lands here with a flag
  // to open the preview immediately — still requires an explicit Send tap.
  useEffect(() => {
    if ((location.state as { openEmailPreview?: boolean } | null)?.openEmailPreview) {
      setEmailOpen(true)
      navigate(location.pathname, { replace: true, state: {} })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only run once per navigation, consuming location.state
  }, [])

  const reloadAll = useCallback(async () => {
    await load()
    await refresh()
  }, [load, refresh])

  if (notFound) {
    return (
      <EmptyState
        title="Quote not found"
        message="This quote may have been removed."
        action={
          <Link to="/app/quotes" className="font-semibold text-brand underline">
            Back to quotes
          </Link>
        }
      />
    )
  }
  if (!bundle) return <LoadingBlock label="Loading quote…" />

  const { quote, customer, options, events, responses, emails } = bundle
  const main = mainOption(options)
  const addons = addonOptions(options)
  const addonBreakdown = computeAddonBreakdown(options)
  const statusConfig = STATUS_CONFIG[quote.status]
  const lastResponse = responses[0] ?? null
  const suggested = suggestNextTemplate(emails, lastResponse?.responseType ?? null)
  const publicUrl = publicQuoteUrl(quote.publicToken)
  const terminal = isTerminal(quote.status)
  const needsFinancingFollowUp = lastResponse?.responseType === 'need_financing' && !terminal

  const openEmail = (template: TemplateType) => {
    setEmailTemplate(template)
    setEmailOpen(true)
  }

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(publicUrl)
      toast('success', 'Quote link copied.')
    } catch {
      toast('error', 'Could not copy. Long-press the Open button link instead.')
    }
  }

  // 'deposit_paid' is intentionally absent — deposits are pulled from the UI
  // for now. The status still exists in the data model (and activityLabel
  // below still names it) so historical quotes that reached it keep reading
  // correctly; there's just no longer a button that puts a quote there.
  const doStatus = async (status: 'booked' | 'lost', label: string) => {
    await repo.setQuoteStatus(quote.id, status)
    await reloadAll()
    toast('success', label)
  }

  const doDelete = async () => {
    setDeleting(true)
    try {
      await repo.deleteQuote(quote.id)
      await refresh()
      toast('success', 'Quote deleted.')
      navigate('/app/quotes')
    } catch (err) {
      console.error('deleteQuote failed', err)
      const detail = errorMessage(err)
      toast('error', detail ? `Could not delete the quote: ${detail}` : 'Could not delete the quote. Please try again.')
      setDeleting(false)
    }
  }

  return (
    <div className="space-y-5">
      <Link to="/app/quotes" className="no-print inline-flex items-center gap-1.5 text-base font-semibold text-zinc-600 hover:text-ink">
        <ArrowLeft className="h-5 w-5" aria-hidden="true" /> All quotes
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-3xl font-black text-ink">{customerDisplayName(customer)}</h1>
          <p className="mt-0.5 text-lg text-zinc-600">{formatVehicle(customer) ?? 'No vehicle on file'}</p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Badge className={statusConfig.badgeClass}>{statusConfig.label}</Badge>
            {quote.expirationDate ? (
              <span className="text-sm text-zinc-500">Good through {formatDate(quote.expirationDate)}</span>
            ) : null}
            {customer.emailOptOutAt ? (
              <Badge className="bg-red-100 text-red-700">Emails stopped by customer</Badge>
            ) : !quote.emailFollowUpAllowed ? (
              <Badge className="bg-zinc-200 text-zinc-700">Follow-up off</Badge>
            ) : null}
          </div>
        </div>
        <div className="text-right">
          <p className="text-sm font-semibold tracking-wide text-zinc-500 uppercase">Quote value</p>
          <p className="text-3xl font-black text-ink">{formatCurrency(quoteValueCents(options))}</p>
          {quote.wonAmountCents !== null ? (
            <p className="text-base font-bold text-green-700">Won at {formatCurrency(quote.wonAmountCents)}</p>
          ) : null}
        </div>
      </div>

      {needsFinancingFollowUp ? (
        <div className="no-print flex items-center gap-3 rounded-2xl border-2 border-amber-300 bg-amber-50 p-4">
          <CreditCard className="h-6 w-6 shrink-0 text-amber-700" aria-hidden="true" />
          <p className="text-base font-bold text-amber-900">
            {customer.firstName} asked about financing — this is the exact kind of interest that's already turned into
            a real sale. Follow up.
          </p>
        </div>
      ) : null}

      {/* Primary actions */}
      <Card className="no-print space-y-3">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Button onClick={() => openEmail(suggested)} className="col-span-2 sm:col-span-2">
            <Mail className="h-5 w-5" aria-hidden="true" />
            {emails.length === 0 ? 'Preview & send quote email' : `Preview ${TEMPLATE_CONFIG[suggested].shortLabel.toLowerCase()} email`}
          </Button>
          <Button variant="secondary" onClick={copyLink}>
            <Copy className="h-5 w-5" aria-hidden="true" /> Copy link
          </Button>
          <a
            href={publicUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl border border-zinc-300 bg-white px-4 text-base font-semibold text-ink hover:bg-zinc-50"
          >
            <ExternalLink className="h-5 w-5" aria-hidden="true" /> Open quote
          </a>
        </div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Button variant="secondary" disabled={terminal} onClick={() => void doStatus('booked', 'Appointment marked as booked.')}>
            <CalendarClock className="h-5 w-5" aria-hidden="true" /> Booked
          </Button>
          <Button variant="secondary" onClick={() => navigate('/app/quotes/new', { state: { editFrom: bundle } })}>
            <Pencil className="h-5 w-5" aria-hidden="true" /> Edit
          </Button>
          <Button variant="success" disabled={quote.status === 'won'} onClick={() => setWonOpen(true)}>
            <Trophy className="h-5 w-5" aria-hidden="true" /> Won
          </Button>
          <Button variant="danger" disabled={quote.status === 'lost'} onClick={() => void doStatus('lost', 'Marked as lost. You can still reopen it by marking it won or booked.')}>
            <XCircle className="h-5 w-5" aria-hidden="true" /> Lost
          </Button>
        </div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Button variant="ghost" onClick={() => setRescheduleOpen(true)}>
            <CalendarClock className="h-5 w-5" aria-hidden="true" /> Reschedule follow-up
          </Button>
          <Button
            variant="ghost"
            onClick={async () => {
              await repo.setFollowUpAllowed(quote.id, !quote.emailFollowUpAllowed)
              await reloadAll()
            }}
            disabled={customer.emailOptOutAt !== null}
          >
            {quote.emailFollowUpAllowed ? (
              <>
                <Ban className="h-5 w-5" aria-hidden="true" /> Turn follow-up off
              </>
            ) : (
              <>
                <BadgeCheck className="h-5 w-5" aria-hidden="true" /> Turn follow-up on
              </>
            )}
          </Button>
          <Button variant="ghost" onClick={() => window.print()}>
            <Printer className="h-5 w-5" aria-hidden="true" /> Print quote
          </Button>
          <Button variant="ghost" onClick={() => navigate('/app/quotes/new', { state: { duplicateFrom: bundle } })}>
            <Files className="h-5 w-5" aria-hidden="true" /> Duplicate
          </Button>
          <Button variant="ghost" className="text-red-700 hover:bg-red-50" onClick={() => setDeleteOpen(true)}>
            <Trash2 className="h-5 w-5" aria-hidden="true" /> Delete
          </Button>
          {customer.phone ? (
            <a
              href={`tel:${customer.phone}`}
              className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl px-4 text-base font-semibold text-charcoal hover:bg-zinc-100"
            >
              <Phone className="h-5 w-5" aria-hidden="true" /> Call {customer.firstName}
            </a>
          ) : null}
        </div>
        <p className="text-sm text-zinc-500">
          Next follow-up: <span className="font-semibold text-ink">{quote.nextFollowUpAt ? formatDate(quote.nextFollowUpAt) : 'not scheduled'}</span>
          {quote.lastEmailedAt ? ` · Last email ${formatDateTime(quote.lastEmailedAt)}` : ''}
        </p>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Main package + add-ons */}
        <div className="space-y-3">
          <h2 className="text-xl font-bold text-ink">Options</h2>
          {options.length === 0 ? (
            <p className="text-base text-zinc-500">No pricing options on this quote yet.</p>
          ) : null}
          {main ? (
            <Card className="border-brand">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <Star className="h-4 w-4 shrink-0 text-brand" aria-hidden="true" />
                  <h3 className="text-lg font-bold text-ink">{main.name.trim() || 'Complete system'}</h3>
                </div>
                <p className="text-xl font-black text-ink">{formatCurrency(main.priceCents)}</p>
              </div>
              {main.description ? <p className="mt-1 text-base text-zinc-600">{main.description}</p> : null}
              <ItemList items={main.items} />
              <p className="mt-2 text-sm text-zinc-500">{main.laborIncluded ? 'Labor included' : 'Labor billed separately'}</p>
            </Card>
          ) : null}
          {addons.length > 0 ? (
            <>
              <h3 className="pt-1 text-base font-bold text-charcoal">Add-ons</h3>
              {addonBreakdown.map(({ option, addonPriceCents, totalWithAddonCents }) => (
                <Card key={option.id}>
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2">
                      <Sparkles className="h-4 w-4 shrink-0 text-brand" aria-hidden="true" />
                      <h3 className="text-base font-bold text-ink">{option.name.trim() || 'Add-on'}</h3>
                    </div>
                    <div className="text-right">
                      <p className="text-lg font-black text-ink">+{formatCurrency(addonPriceCents)}</p>
                      <p className="text-xs text-zinc-500">total {formatCurrency(totalWithAddonCents)}</p>
                    </div>
                  </div>
                  {option.description ? <p className="mt-1 text-sm text-zinc-600">{option.description}</p> : null}
                  <ItemList items={option.items} />
                </Card>
              ))}
              {quote.showFullAddonTotal ? (
                <Card className="border-brand bg-blue-50">
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-bold tracking-wide text-brand uppercase">Everything included</p>
                    <p className="text-xl font-black text-ink">{formatCurrency(fullTotalCents(options))}</p>
                  </div>
                </Card>
              ) : null}
            </>
          ) : null}

          {quote.windowTints.length > 0 ? (
            <>
              <h2 className="pt-2 text-xl font-bold text-ink">Window tint</h2>
              {quote.windowTints.map((tint, i) => {
                const summary = summarizeWindowTint(tint)
                return (
                  <Card key={i} className="flex flex-wrap items-start gap-4">
                    <div className="min-w-0 flex-1 space-y-1.5 text-base">
                      <p className="font-bold text-ink">
                        {summary.name} — {summary.bodyStyleLabel} &middot; {summary.tintTypeLabel}
                      </p>
                      {summary.uniformPercent !== null ? (
                        <p className="text-zinc-700">All included windows at {summary.uniformPercent}%</p>
                      ) : summary.windowLines.length > 0 ? (
                        <ul className="space-y-0.5 text-zinc-700">
                          {summary.windowLines.map((w) => (
                            <li key={w.label}>
                              {w.label}: {w.vltPercent}%
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <p className="text-zinc-500">No tint percentages chosen yet.</p>
                      )}
                      {summary.priceCents !== null ? (
                        <p className="text-sm text-zinc-500">Tint job: {formatCurrency(summary.priceCents)}</p>
                      ) : null}
                      {summary.removeOldTint ? (
                        <p className="text-sm text-zinc-500">
                          Remove old tint
                          {summary.removeOldTint.priceCents !== null ? `: ${formatCurrency(summary.removeOldTint.priceCents)}` : ''}
                        </p>
                      ) : null}
                      {summary.windshield ? (
                        <p className="text-sm text-zinc-500">
                          Windshield: {summary.windshield.vltPercent}%
                          {summary.windshield.priceCents !== null ? ` — ${formatCurrency(summary.windshield.priceCents)}` : ''}
                        </p>
                      ) : null}
                      {summary.sunroof ? (
                        <p className="text-sm text-zinc-500">
                          {summary.sunroof.typeLabel}: {summary.sunroof.vltPercent}%
                          {summary.sunroof.priceCents !== null ? ` — ${formatCurrency(summary.sunroof.priceCents)}` : ''}
                        </p>
                      ) : null}
                      {summary.totalCents > 0 ? (
                        <p className="pt-1 font-bold text-ink">Total: {formatCurrency(summary.totalCents)}</p>
                      ) : null}
                    </div>
                  </Card>
                )
              })}
            </>
          ) : null}

          <h2 className="pt-2 text-xl font-bold text-ink">Customer</h2>
          <Card className="space-y-1.5 text-base">
            <p className="font-bold text-ink">{customerDisplayName(customer)}</p>
            <p className="text-zinc-700">{customer.email}</p>
            {customer.phone ? (
              <p>
                <a href={`tel:${customer.phone}`} className="font-semibold text-brand">
                  {customer.phone}
                </a>
              </p>
            ) : null}
            {customer.source ? <p className="text-sm text-zinc-500">Came from: {customer.source}</p> : null}
            <p className="text-sm text-zinc-500">
              Email permission confirmed {customer.emailContactPermissionConfirmedAt ? formatDate(customer.emailContactPermissionConfirmedAt) : '—'}
            </p>
          </Card>

          <h2 className="pt-2 text-xl font-bold text-ink">Internal notes</h2>
          <Card className="no-print">
            <Textarea
              aria-label="Internal notes"
              rows={3}
              value={notesDraft ?? quote.internalNotes ?? ''}
              onChange={(e) => setNotesDraft(e.target.value)}
              placeholder="Notes only your team can see."
            />
            {notesDraft !== null && notesDraft !== (quote.internalNotes ?? '') ? (
              <Button
                className="mt-2"
                onClick={async () => {
                  await repo.updateInternalNotes(quote.id, notesDraft.trim() || null)
                  setNotesDraft(null)
                  await load()
                  toast('success', 'Notes saved.')
                }}
              >
                Save notes
              </Button>
            ) : null}
          </Card>
        </div>

        {/* Right column: responses, emails, timeline */}
        <div className="space-y-3">
          <h2 className="text-xl font-bold text-ink">Customer responses</h2>
          {responses.length === 0 ? (
            <Card>
              <p className="text-base text-zinc-600">No responses yet. When the customer answers on their quote page, it shows here.</p>
            </Card>
          ) : (
            responses.map((r) => (
              <Card key={r.id}>
                <div className="flex items-center justify-between gap-3">
                  <p className="text-base font-bold text-brand">{RESPONSE_CONFIG[r.responseType].label}</p>
                  <span className="text-sm text-zinc-500">{formatDateTime(r.createdAt)}</span>
                </div>
                {r.message ? <p className="mt-1 text-base text-zinc-700">“{r.message}”</p> : null}
              </Card>
            ))
          )}

          <h2 className="pt-2 text-xl font-bold text-ink">Email history</h2>
          {emails.length === 0 ? (
            <Card>
              <p className="text-base text-zinc-600">No emails yet. Preview and send the quote to get things moving.</p>
            </Card>
          ) : (
            <Card>
              <ul className="divide-y divide-zinc-100">
                {emails.map((e) => (
                  <li key={e.id} className="flex items-center justify-between gap-3 py-2.5">
                    <div>
                      <p className="text-base font-semibold text-ink">{TEMPLATE_CONFIG[e.templateType].label}</p>
                      <p className="text-sm text-zinc-500">{formatDateTime(e.createdAt)} · to {e.recipientEmail}</p>
                      {e.firstViewedAt ? (
                        <p className="mt-0.5 text-sm font-medium text-green-700">
                          Opened {formatDateTime(e.firstViewedAt)}
                          {e.viewCount > 1 ? ` · viewed ${e.viewCount}×` : ''}
                        </p>
                      ) : null}
                    </div>
                    <EmailStatusBadge status={e.status} />
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-xs text-zinc-500">
                “Accepted” means our email provider took the message — it does not prove the customer read it.
                “Opened” only appears once the customer loads their link from this specific email — previewing the
                quote yourself from this page never counts.
              </p>
            </Card>
          )}

          <h2 className="pt-2 text-xl font-bold text-ink">Activity</h2>
          <Card>
            <ul className="space-y-2">
              {events.map((ev) => (
                <li key={ev.id} className="flex items-baseline justify-between gap-3 text-base">
                  <span className="text-zinc-700">{activityLabel(ev.eventType)}</span>
                  <span className="shrink-0 text-sm text-zinc-500">{formatDateTime(ev.createdAt)}</span>
                </li>
              ))}
            </ul>
          </Card>
        </div>
      </div>

      <EmailPreviewModal
        key={`${emailTemplate}-${emailOpen}`}
        bundle={bundle}
        initialTemplate={emailTemplate}
        open={emailOpen}
        onClose={() => setEmailOpen(false)}
        onSent={() => void reloadAll()}
      />

      <MarkWonModal
        open={wonOpen}
        onClose={() => setWonOpen(false)}
        defaultCents={quoteValueCents(options)}
        onConfirm={async (cents) => {
          await repo.setQuoteStatus(quote.id, 'won', cents)
          setWonOpen(false)
          await reloadAll()
          toast('success', `Marked won — ${formatCurrency(cents)} recovered.`)
        }}
      />

      <RescheduleModal
        open={rescheduleOpen}
        onClose={() => setRescheduleOpen(false)}
        onConfirm={async (date) => {
          await repo.rescheduleFollowUp(quote.id, date)
          setRescheduleOpen(false)
          await reloadAll()
          toast('success', date ? 'Follow-up rescheduled.' : 'Follow-up cleared.')
        }}
      />

      <Modal open={deleteOpen} onClose={() => setDeleteOpen(false)} title="Delete this quote?">
        <div className="space-y-4">
          <p className="text-base text-ink">
            This permanently deletes {customerDisplayName(customer)}&apos;s quote and everything attached to it — its
            options, send history, and the customer&apos;s responses. Their quote link will stop working. This can&apos;t
            be undone.
          </p>
          <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
            <Button variant="secondary" onClick={() => setDeleteOpen(false)} disabled={deleting}>
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

/** Products under an option — a small image (when the item carries one, e.g. added from the catalog) plus name, no per-item price (this app prices per option, not per line). */
function ItemList({ items }: { items: QuoteBundle['options'][number]['items'] }) {
  if (items.length === 0) return null
  return (
    <ul className="mt-3 space-y-1.5">
      {items.map((item) => (
        <li key={item.id} className="flex items-center gap-2.5 text-base">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-zinc-100">
            {item.imageUrl ? <img src={item.imageUrl} alt="" className="h-full w-full object-contain" /> : null}
          </span>
          <span className="text-zinc-700">
            {item.quantity > 1 ? `${item.quantity}× ` : ''}
            {formatItemDisplayName(item)}
          </span>
        </li>
      ))}
    </ul>
  )
}

function EmailStatusBadge({ status }: { status: string }) {
  switch (status) {
    case 'sent':
      return <Badge className="bg-green-100 text-green-800">Accepted by provider</Badge>
    case 'demo_sent':
      return <Badge className="bg-amber-100 text-amber-800">Demo email</Badge>
    case 'failed':
      return <Badge className="bg-red-100 text-red-700">Failed</Badge>
    case 'sending':
      return <Badge className="bg-zinc-100 text-zinc-600">Sending…</Badge>
    default:
      return <Badge className="bg-zinc-100 text-zinc-600">Previewed</Badge>
  }
}

function activityLabel(eventType: string): string {
  const labels: Record<string, string> = {
    created: 'Quote created',
    edited: 'Quote edited',
    email_sent: 'Email sent (accepted by provider)',
    email_demo_sent: 'Demo email sent',
    email_failed: 'Email failed to send',
    quote_viewed: 'Customer opened the quote',
    customer_responded: 'Customer responded',
    appointment_booked: 'Appointment booked',
    deposit_paid: 'Deposit paid',
    marked_won: 'Marked won',
    marked_lost: 'Marked lost',
    follow_up_rescheduled: 'Follow-up rescheduled',
    follow_up_disabled: 'Follow-up turned off',
    email_opt_out: 'Customer stopped follow-up emails',
    marked_contacted: 'Marked contacted',
  }
  return labels[eventType] ?? eventType.replaceAll('_', ' ')
}

function MarkWonModal({
  open,
  onClose,
  defaultCents,
  onConfirm,
}: {
  open: boolean
  onClose: () => void
  defaultCents: number
  onConfirm: (cents: number) => Promise<void>
}) {
  const [value, setValue] = useState('')
  const [error, setError] = useState<string | null>(null)
  const placeholder = (defaultCents / 100).toFixed(0)

  return (
    <Modal open={open} onClose={onClose} title="Mark this job won">
      <div className="space-y-4">
        <Field label="Final sale amount" htmlFor="won-amount" error={error ?? undefined} hint="What the customer actually paid, in dollars.">
          <Input
            id="won-amount"
            inputMode="decimal"
            placeholder={`$${placeholder}`}
            value={value}
            onChange={(e) => setValue(e.target.value)}
          />
        </Field>
        <div className="flex justify-end gap-3">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="success"
            onClick={() => {
              const cents = value.trim() === '' ? defaultCents : parseDollarsToCents(value)
              if (cents === null) {
                setError('Enter a valid dollar amount.')
                return
              }
              setError(null)
              void onConfirm(cents)
            }}
          >
            <Trophy className="h-5 w-5" aria-hidden="true" /> Mark won
          </Button>
        </div>
      </div>
    </Modal>
  )
}

function RescheduleModal({
  open,
  onClose,
  onConfirm,
}: {
  open: boolean
  onClose: () => void
  onConfirm: (dateIso: string | null) => Promise<void>
}) {
  const [date, setDate] = useState(() => format(new Date(), 'yyyy-MM-dd'))

  return (
    <Modal open={open} onClose={onClose} title="Reschedule follow-up">
      <div className="space-y-4">
        <Field label="Next follow-up date" htmlFor="resched-date">
          <Input id="resched-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
        <div className="flex flex-wrap justify-end gap-3">
          <Button variant="ghost" onClick={() => void onConfirm(null)}>
            Clear follow-up
          </Button>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => void onConfirm(new Date(`${date}T09:00:00`).toISOString())}>Save date</Button>
        </div>
      </div>
    </Modal>
  )
}
