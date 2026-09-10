import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { format } from 'date-fns'
import { CalendarClock, CheckCheck, ExternalLink, Mail, Ban, MessageSquare, Bot, Trophy, XCircle } from 'lucide-react'
import { useAppData, useRepo } from '../../data/AppDataContext'
import { useToast } from '../../components/Toast'
import { Badge, Button, Card, EmptyState, Field, Input, LoadingBlock, Modal, PageHeader } from '../../components/ui'
import { EmailPreviewModal } from '../../components/EmailPreviewModal'
import { WonAmountModal } from '../../components/WonAmountModal'
import { BUCKET_CONFIG, BUCKET_ORDER, followUpBucket, suggestNextTemplate, type FollowUpBucket } from '../../lib/followUp'
import { describeAutoFollowUp } from '../../lib/autoFollowUp'
import { buildQuoteSmsBody, buildSmsLink, type QuoteSmsTemplate } from '../../lib/sms'
import { env } from '../../lib/env'
import { STATUS_CONFIG, TEMPLATE_CONFIG } from '../../lib/status'
import { customerDisplayName, formatCurrency, formatDateTime, formatVehicle, quoteValueCents } from '../../lib/format'
import type { QuoteBundle, TemplateType } from '../../types'

export default function FollowUpsPage() {
  const { bundles, loading, refresh, shop } = useAppData()
  const repo = useRepo()
  const toast = useToast()
  const [emailBundle, setEmailBundle] = useState<QuoteBundle | null>(null)
  const [emailTemplate, setEmailTemplate] = useState<TemplateType>('check_in')
  const [rescheduleBundle, setRescheduleBundle] = useState<QuoteBundle | null>(null)
  const [rescheduleDate, setRescheduleDate] = useState(format(new Date(), 'yyyy-MM-dd'))
  const [wonBundle, setWonBundle] = useState<QuoteBundle | null>(null)

  const grouped = useMemo(() => {
    const groups = new Map<FollowUpBucket, QuoteBundle[]>()
    for (const b of bundles) {
      const bucket = followUpBucket(
        b.quote,
        b.customer.emailOptOutAt !== null,
        new Date(),
        b.emails.filter((e) => e.status === 'sent' || e.status === 'demo_sent').map((e) => e.templateType),
      )
      if (!bucket) continue
      if (bucket === 'none' && b.quote.status === 'draft') continue // drafts live on the quotes page
      const list = groups.get(bucket) ?? []
      list.push(b)
      groups.set(bucket, list)
    }
    return groups
  }, [bundles])

  if (loading && bundles.length === 0) return <LoadingBlock label="Loading follow-ups…" />

  const total = [...grouped.values()].reduce((n, list) => n + list.length, 0)

  return (
    <div className="space-y-6">
      <PageHeader
        title="Follow-ups"
        subtitle={
          shop?.autoFollowUpEnabled
            ? 'Emails go out on their own and stop the moment a customer replies. Texts are always sent by you.'
            : 'Automatic follow-ups are off — every email here waits for you. Turn them on in Settings.'
        }
      />

      {total === 0 ? (
        <EmptyState
          title="Nothing to follow up on"
          message="When you email quotes, the ones waiting on a nudge will line up here by how urgent they are."
        />
      ) : (
        BUCKET_ORDER.map((bucket) => {
          const list = grouped.get(bucket)
          if (!list || list.length === 0) return null
          const config = BUCKET_CONFIG[bucket]
          return (
            <section key={bucket} aria-label={config.label}>
              <div className="mb-2 flex items-baseline gap-3">
                <h2 className={`text-xl font-bold ${bucket === 'overdue' ? 'text-red-700' : 'text-ink'}`}>
                  {config.label} ({list.length})
                </h2>
                <p className="text-sm text-zinc-500">{config.hint}</p>
              </div>
              <ul className="space-y-3">
                {list.map((b) => {
                  const suggested = suggestNextTemplate(b.emails, b.responses[0]?.responseType ?? null)
                  const lastEmail = b.emails[0] ?? null
                  const disabled = bucket === 'disabled'
                  const finished = bucket === 'finished'
                  // What the scheduled sender will do with this quote — the
                  // same rules the Edge Function applies, so the queue never
                  // promises a send that won't happen.
                  const auto = describeAutoFollowUp(
                    {
                      status: b.quote.status,
                      nextFollowUpAt: b.quote.nextFollowUpAt,
                      emailFollowUpAllowed: b.quote.emailFollowUpAllowed,
                      expirationDate: b.quote.expirationDate,
                      customerEmail: b.customer.email,
                      customerEmailPermissionConfirmed: b.customer.emailContactPermissionConfirmed,
                      customerOptedOutAt: b.customer.emailOptOutAt,
                      hasCustomerResponse: b.responses.length > 0,
                      sentTemplates: b.emails
                        .filter((e) => e.status === 'sent' || e.status === 'demo_sent')
                        .map((e) => e.templateType),
                    },
                    shop?.autoFollowUpEnabled ?? false,
                  )
                  const smsLink = buildSmsLink(
                    b.customer.phone,
                    buildQuoteSmsBody((auto.template ?? suggested) as QuoteSmsTemplate, {
                      firstName: b.customer.firstName,
                      shopName: shop?.name ?? 'the shop',
                      vehicle: formatVehicle(b.customer),
                      quoteUrl: `${env.appUrl}/q/${b.quote.publicToken}`,
                    }),
                  )
                  return (
                    <li key={b.quote.id}>
                      <Card className="space-y-3">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div>
                            <p className="text-lg font-bold text-ink">{customerDisplayName(b.customer)}</p>
                            <p className="text-base text-zinc-600">{formatVehicle(b.customer) ?? 'No vehicle on file'}</p>
                            <p className="mt-0.5 text-sm text-zinc-500">
                              {lastEmail
                                ? `Last email: ${TEMPLATE_CONFIG[lastEmail.templateType].shortLabel} · ${formatDateTime(lastEmail.createdAt)}`
                                : 'No emails sent yet'}
                            </p>
                          </div>
                          <div className="flex flex-col items-end gap-1.5">
                            <span className="text-lg font-black text-ink">{formatCurrency(quoteValueCents(b.options))}</span>
                            <Badge className={STATUS_CONFIG[b.quote.status].badgeClass}>
                              {STATUS_CONFIG[b.quote.status].label}
                            </Badge>
                          </div>
                        </div>
                        {!disabled ? (
                          auto.willSend && auto.template ? (
                            <p className="flex items-center gap-1.5 text-base font-semibold text-brand">
                              <Bot className="h-4 w-4" aria-hidden="true" />
                              {auto.detail}: {TEMPLATE_CONFIG[auto.template].label}
                            </p>
                          ) : (
                            <p className="text-base font-semibold text-zinc-600">
                              {auto.detail} · Suggested: {TEMPLATE_CONFIG[suggested].label}
                            </p>
                          )
                        ) : (
                          <p className="text-base text-zinc-500">
                            {b.customer.emailOptOutAt ? 'Customer asked to stop emails.' : 'Follow-up was turned off for this quote.'}
                          </p>
                        )}
                        <div className="flex flex-wrap gap-2">
                          {/* A quote the machine has finished with needs a
                             verdict, not another nudge — so Won and Lost lead
                             the row here and the send button steps back. */}
                          {finished ? (
                            <>
                              <Button variant="success" onClick={() => setWonBundle(b)}>
                                <Trophy className="h-5 w-5" aria-hidden="true" /> Won
                              </Button>
                              <Button
                                variant="secondary"
                                onClick={async () => {
                                  await repo.setQuoteStatus(b.quote.id, 'lost')
                                  await refresh()
                                  toast('success', `Marked lost — ${customerDisplayName(b.customer)}.`)
                                }}
                              >
                                <XCircle className="h-5 w-5" aria-hidden="true" /> Lost
                              </Button>
                            </>
                          ) : null}
                          {!disabled ? (
                            <Button
                              variant={finished ? 'secondary' : 'primary'}
                              onClick={() => {
                                setEmailTemplate(suggested)
                                setEmailBundle(b)
                              }}
                            >
                              <Mail className="h-5 w-5" aria-hidden="true" /> Preview &amp; send
                            </Button>
                          ) : null}
                          {/* Tap-to-text: opens the staff member's own SMS app
                             with the message written. Hidden when there's no
                             usable number rather than rendering a dead link. */}
                          {!disabled && smsLink ? (
                            <a
                              href={smsLink}
                              className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl border border-zinc-300 bg-white px-4 text-base font-semibold text-ink hover:bg-zinc-50"
                            >
                              <MessageSquare className="h-5 w-5" aria-hidden="true" /> Text
                            </a>
                          ) : null}
                          <Link
                            to={`/app/quotes/${b.quote.id}`}
                            className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl border border-zinc-300 bg-white px-4 text-base font-semibold text-ink hover:bg-zinc-50"
                          >
                            <ExternalLink className="h-5 w-5" aria-hidden="true" /> Open quote
                          </Link>
                          {!disabled ? (
                            <>
                              <Button
                                variant="secondary"
                                onClick={() => {
                                  setRescheduleDate(format(new Date(), 'yyyy-MM-dd'))
                                  setRescheduleBundle(b)
                                }}
                              >
                                <CalendarClock className="h-5 w-5" aria-hidden="true" /> Reschedule
                              </Button>
                              <Button
                                variant="ghost"
                                onClick={async () => {
                                  await repo.markContacted(b.quote.id)
                                  await refresh()
                                  toast('success', 'Marked contacted.')
                                }}
                              >
                                <CheckCheck className="h-5 w-5" aria-hidden="true" /> Contacted
                              </Button>
                              <Button
                                variant="ghost"
                                onClick={async () => {
                                  await repo.setFollowUpAllowed(b.quote.id, false)
                                  await refresh()
                                  toast('success', 'Follow-up turned off for this quote.')
                                }}
                              >
                                <Ban className="h-5 w-5" aria-hidden="true" /> Turn off
                              </Button>
                            </>
                          ) : null}
                        </div>
                      </Card>
                    </li>
                  )
                })}
              </ul>
            </section>
          )
        })
      )}

      {emailBundle ? (
        <EmailPreviewModal
          bundle={emailBundle}
          initialTemplate={emailTemplate}
          open
          onClose={() => setEmailBundle(null)}
          onSent={() => void refresh()}
        />
      ) : null}

      {wonBundle ? (
        <WonAmountModal
          mode="mark"
          open
          onClose={() => setWonBundle(null)}
          defaultCents={quoteValueCents(wonBundle.options)}
          onConfirm={async (cents, winSource) => {
            await repo.setQuoteStatus(wonBundle.quote.id, 'won', cents, winSource)
            setWonBundle(null)
            await refresh()
            toast('success', `Marked won — ${formatCurrency(cents)} recovered.`)
          }}
        />
      ) : null}

      <Modal open={rescheduleBundle !== null} onClose={() => setRescheduleBundle(null)} title="Reschedule follow-up">
        <div className="space-y-4">
          <Field label="Next follow-up date" htmlFor="fu-resched">
            <Input id="fu-resched" type="date" value={rescheduleDate} onChange={(e) => setRescheduleDate(e.target.value)} />
          </Field>
          <div className="flex justify-end gap-3">
            <Button variant="secondary" onClick={() => setRescheduleBundle(null)}>
              Cancel
            </Button>
            <Button
              onClick={async () => {
                if (!rescheduleBundle) return
                await repo.rescheduleFollowUp(
                  rescheduleBundle.quote.id,
                  new Date(`${rescheduleDate}T09:00:00`).toISOString(),
                )
                setRescheduleBundle(null)
                await refresh()
                toast('success', 'Follow-up rescheduled.')
              }}
            >
              Save date
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
