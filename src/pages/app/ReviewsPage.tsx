import { useCallback, useEffect, useMemo, useState } from 'react'
import { MessageSquare, Star, Trash2, Eye, Send } from 'lucide-react'
import { useAppData, useRepo } from '../../data/AppDataContext'
import { useToast } from '../../components/Toast'
import { Badge, Button, Card, EmptyState, Field, Input, LoadingBlock, Modal, PageHeader } from '../../components/ui'
import { buildSmsLink } from '../../lib/sms'
import {
  buildReviewRequestSmsBody,
  formatPhoneDisplay,
  reviewStage,
  summarizeReviewRequests,
  type ReviewStage,
} from '../../lib/reviewRequests'
import { env } from '../../lib/env'
import { formatDateTime } from '../../lib/format'
import { errorMessage } from '../../lib/errors'
import type { ReviewRequest } from '../../types'

const STAGE_CONFIG: Record<ReviewStage, { label: string; badge: string }> = {
  sent: { label: 'Texted', badge: 'bg-zinc-100 text-zinc-600' },
  opened: { label: 'Opened', badge: 'bg-amber-100 text-amber-800' },
  rated: { label: 'Rated', badge: 'bg-green-100 text-green-800' },
  feedback: { label: 'Left feedback', badge: 'bg-red-100 text-red-700' },
}

const FILTERS: { key: ReviewStage | 'all'; label: string }[] = [
  { key: 'all', label: 'Everyone' },
  { key: 'sent', label: 'Not opened' },
  { key: 'opened', label: 'Opened, no stars' },
  { key: 'rated', label: 'Rated' },
  { key: 'feedback', label: 'Told you something' },
]

/**
 * The counter workflow, and what happened next.
 *
 * Replaces a slip of paper: staff type the number the customer just gave them,
 * tap once, and their own phone sends the text. Nothing here sends an SMS
 * itself — see src/lib/sms.ts for why, and note that the column is called
 * "Texted" rather than "Sent" because this app never learns whether the staff
 * member actually pressed send.
 */
export default function ReviewsPage() {
  const { shop } = useAppData()
  const repo = useRepo()
  const toast = useToast()
  const [requests, setRequests] = useState<ReviewRequest[] | null>(null)
  const [phone, setPhone] = useState('')
  const [name, setName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [filter, setFilter] = useState<ReviewStage | 'all'>('all')
  const [reading, setReading] = useState<ReviewRequest | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<ReviewRequest | null>(null)

  const load = useCallback(async () => {
    setRequests(await repo.listReviewRequests())
  }, [repo])

  useEffect(() => {
    void load()
  }, [load])

  const summary = useMemo(() => summarizeReviewRequests(requests ?? []), [requests])
  const shown = useMemo(
    () => (requests ?? []).filter((r) => filter === 'all' || reviewStage(r) === filter),
    [requests, filter],
  )

  const reviewUrl = (request: ReviewRequest) => `${env.appUrl}/r/${request.publicToken}`

  const textLink = (request: ReviewRequest) =>
    buildSmsLink(
      request.phone,
      buildReviewRequestSmsBody({
        firstName: request.customerName,
        shopName: shop?.name ?? 'the shop',
        reviewUrl: reviewUrl(request),
      }),
    )

  const add = async () => {
    if (saving) return
    setSaving(true)
    setError(null)
    try {
      const created = await repo.createReviewRequest({ phone, customerName: name })
      setPhone('')
      setName('')
      await load()
      const link = textLink(created)
      if (link) {
        // Straight into the messaging app. The whole point is one tap while
        // the customer is still standing there.
        await repo.markReviewRequestHandedToPhone(created.id)
        window.location.href = link
        await load()
      } else {
        toast('error', 'Saved, but that number could not be texted.')
      }
    } catch (err) {
      setError(errorMessage(err) || 'Could not save that number.')
    } finally {
      setSaving(false)
    }
  }

  if (!requests) return <LoadingBlock label="Loading review requests…" />

  const noLink = !shop?.reviewLink

  return (
    <div className="space-y-5">
      <PageHeader
        title="Reviews"
        subtitle="Type the number off the slip, tap once, and your own phone sends them the link."
      />

      {noLink ? (
        <div className="rounded-2xl border-2 border-amber-300 bg-amber-50 p-4">
          <p className="text-base font-bold text-ink">No review link set yet</p>
          <p className="mt-1 text-base text-zinc-700">
            Add the link customers should leave a public review on, in Settings. Until then the page still collects
            star ratings and written feedback — it just doesn&apos;t send anyone anywhere.
          </p>
        </div>
      ) : null}

      <Card>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Their phone number" htmlFor="rev-phone">
            <Input
              id="rev-phone"
              inputMode="tel"
              autoComplete="off"
              placeholder="214-555-0100"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void add()
              }}
            />
          </Field>
          <Field label="First name (optional)" htmlFor="rev-name" hint="Makes the text read like a person wrote it.">
            <Input
              id="rev-name"
              autoComplete="off"
              placeholder="Marcus"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void add()
              }}
            />
          </Field>
        </div>
        {error ? (
          <p role="alert" className="mt-2 text-base font-medium text-red-700">
            {error}
          </p>
        ) : null}
        <Button className="mt-3 w-full" disabled={saving || phone.trim() === ''} onClick={() => void add()}>
          <Send className="h-5 w-5" aria-hidden="true" /> {saving ? 'Saving…' : 'Text them the link'}
        </Button>
      </Card>

      <Card>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Figure label="Texted" value={String(summary.sent)} />
          <Figure
            label="Opened"
            value={summary.openRate === null ? '—' : `${Math.round(summary.openRate * 100)}%`}
            note={`${summary.opened} of ${summary.sent}`}
          />
          <Figure
            label="Average stars"
            value={summary.averageRating === null ? '—' : summary.averageRating.toFixed(1)}
            note={`${summary.rated} rated`}
          />
          <Figure label="Told you something" value={String(summary.feedback)} note="Read these first" accent />
        </div>
      </Card>

      <div className="flex flex-wrap gap-2" role="group" aria-label="Filter review requests">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            type="button"
            aria-pressed={filter === f.key}
            onClick={() => setFilter(f.key)}
            className={`min-h-10 rounded-xl border-2 px-3 text-sm font-bold transition-colors ${
              filter === f.key ? 'border-brand bg-brand-tint text-brand' : 'border-zinc-200 text-zinc-600'
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {shown.length === 0 ? (
        <EmptyState
          title={requests.length === 0 ? 'Nobody asked yet' : 'Nobody in this group'}
          message={
            requests.length === 0
              ? 'Type a number above when someone pays. The link goes out from your own phone.'
              : 'Try another filter.'
          }
        />
      ) : (
        <ul className="space-y-3">
          {shown.map((request) => {
            const stage = reviewStage(request)
            const config = STAGE_CONFIG[stage]
            const link = textLink(request)
            return (
              <li key={request.id}>
                <Card className="space-y-2.5">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-lg font-bold text-ink">
                        {request.customerName || formatPhoneDisplay(request.phone)}
                      </p>
                      {request.customerName ? (
                        <p className="text-base text-zinc-600">{formatPhoneDisplay(request.phone)}</p>
                      ) : null}
                      <p className="mt-0.5 text-sm text-zinc-500">Texted {formatDateTime(request.createdAt)}</p>
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-1.5">
                      <Badge className={config.badge}>{config.label}</Badge>
                      {request.rating !== null ? <Stars rating={request.rating} /> : null}
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-zinc-600">
                    <span className="inline-flex items-center gap-1.5">
                      <Eye className="h-4 w-4" aria-hidden="true" />
                      {request.firstOpenedAt
                        ? `Opened ${formatDateTime(request.firstOpenedAt)}${request.openCount > 1 ? ` · ${request.openCount}×` : ''}`
                        : 'Not opened yet'}
                    </span>
                    {request.redirectedAt ? <span className="text-green-700">Sent to your review page</span> : null}
                    {/* The one fact staff would otherwise have to guess at: this
                        person came back and tried for the review link after
                        rating low, and the app held the line. */}
                    {request.redirectBlocked ? (
                      <span className="font-semibold text-amber-800">
                        Review link off for good
                        {request.lastRating !== null && request.rating !== null && request.lastRating > request.rating
                          ? ` · came back and tapped ${request.lastRating}`
                          : ''}
                      </span>
                    ) : null}
                  </div>

                  {request.feedback ? (
                    <button
                      type="button"
                      onClick={() => setReading(request)}
                      className="block w-full rounded-xl bg-zinc-50 px-3.5 py-2.5 text-left text-base text-ink hover:bg-zinc-100"
                    >
                      <MessageSquare className="mr-1.5 inline h-4 w-4 text-zinc-500" aria-hidden="true" />
                      <span className="line-clamp-2">{request.feedback}</span>
                    </button>
                  ) : null}

                  <div className="flex flex-wrap gap-2">
                    {link ? (
                      <a
                        href={link}
                        onClick={() => void repo.markReviewRequestHandedToPhone(request.id)}
                        className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl border border-zinc-300 bg-white px-4 text-base font-semibold text-ink hover:bg-zinc-50"
                      >
                        <Send className="h-5 w-5" aria-hidden="true" />
                        {request.handedToPhoneAt ? 'Text again' : 'Text the link'}
                      </a>
                    ) : null}
                    <Button variant="ghost" onClick={() => setDeleteTarget(request)}>
                      <Trash2 className="h-5 w-5" aria-hidden="true" /> Remove
                    </Button>
                  </div>
                </Card>
              </li>
            )
          })}
        </ul>
      )}

      <Modal open={reading !== null} onClose={() => setReading(null)} title="What they told you">
        <div className="space-y-4">
          <p className="text-base leading-relaxed whitespace-pre-wrap text-ink">{reading?.feedback}</p>
          <p className="text-sm text-zinc-500">
            {reading?.customerName || formatPhoneDisplay(reading?.phone)} ·{' '}
            {reading?.feedbackAt ? formatDateTime(reading.feedbackAt) : ''}
          </p>
          <div className="flex justify-end">
            <Button variant="secondary" onClick={() => setReading(null)}>
              Close
            </Button>
          </div>
        </div>
      </Modal>

      <Modal open={deleteTarget !== null} onClose={() => setDeleteTarget(null)} title="Remove this request?">
        <div className="space-y-4">
          <p className="text-base text-ink">
            This deletes the record and the link stops working. Anything they already told you goes with it.
          </p>
          <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
            <Button variant="secondary" onClick={() => setDeleteTarget(null)}>
              Keep it
            </Button>
            <Button
              variant="danger"
              onClick={async () => {
                if (!deleteTarget) return
                await repo.deleteReviewRequest(deleteTarget.id)
                setDeleteTarget(null)
                await load()
                toast('success', 'Removed.')
              }}
            >
              <Trash2 className="h-5 w-5" aria-hidden="true" /> Remove
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  )
}

function Stars({ rating }: { rating: number }) {
  return (
    <span className="flex items-center gap-0.5" aria-label={`${rating} out of 5 stars`}>
      {[1, 2, 3, 4, 5].map((n) => (
        <Star
          key={n}
          className={`h-4 w-4 ${n <= rating ? 'fill-amber-400 text-amber-400' : 'text-zinc-300'}`}
          aria-hidden="true"
        />
      ))}
    </span>
  )
}

function Figure({ label, value, note, accent = false }: { label: string; value: string; note?: string; accent?: boolean }) {
  return (
    <div>
      <p className="text-sm font-semibold tracking-wide text-zinc-500 uppercase">{label}</p>
      <p className={`text-2xl font-black ${accent ? 'text-red-700' : 'text-ink'}`}>{value}</p>
      {note ? <p className="text-xs text-zinc-500">{note}</p> : null}
    </div>
  )
}
