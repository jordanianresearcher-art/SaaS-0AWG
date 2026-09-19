import { useCallback, useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { Star, Check, Phone } from 'lucide-react'
import { Button, LoadingBlock } from '../components/ui'
import { resolveReviewApi, type ReviewApi } from '../data/publicReview'
import { reviewFeedbackCopy } from '../lib/reviewRequests'
import { usePageTitle } from '../lib/usePageTitle'
import type { PublicReviewRequest } from '../types'

type Phase = 'loading' | 'missing' | 'rating' | 'feedback' | 'thanks' | 'leaving' | 'closed'

/**
 * Leave for the review site as if the customer had scanned a QR code.
 *
 * Three things make that true, and all three are the point:
 *
 * 1. The URL is used exactly as the shop stored it. Nothing is appended — no
 *    tracking parameter, no source tag, no fragment. A review link with a
 *    query string of its own arrives with that query string and no other.
 * 2. No referrer. A normal in-page navigation would tell the review site
 *    which page sent the visitor, which is precisely the fingerprint a
 *    scanned code does not leave. The meta tag is set immediately before
 *    navigating so it applies to this one hop.
 * 3. `replace`, not `assign`. The review page does not go into history, so
 *    Back from the review site returns to wherever they were, not to a rating
 *    screen they have already used.
 */
function leaveTo(url: string): void {
  try {
    const meta = document.createElement('meta')
    meta.name = 'referrer'
    meta.content = 'no-referrer'
    document.head.appendChild(meta)
  } catch {
    // A missing head is not a reason to strand the customer.
  }
  window.location.replace(url)
}

/**
 * What a customer sees a few minutes after paying.
 *
 * One question, five targets, nothing above the fold but the stars. A person
 * reading this is standing in a parking lot on a phone, and every extra
 * element between them and a tap costs a response.
 *
 * Where a tap sends them is decided by the SERVER, not here — see
 * submitReviewRating. This page renders the answer and does not compute it,
 * because the browser belongs to the customer and the gate has to hold
 * somewhere they cannot reach.
 */
export default function ReviewPage() {
  const { publicToken = '' } = useParams()
  const [api, setApi] = useState<ReviewApi | null>(null)
  const [request, setRequest] = useState<PublicReviewRequest | null>(null)
  const [phase, setPhase] = useState<Phase>('loading')
  const [hovered, setHovered] = useState<number | null>(null)
  const [chosen, setChosen] = useState<number | null>(null)
  const [feedback, setFeedback] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const resolved = await resolveReviewApi(publicToken)
      if (!resolved) {
        if (!cancelled) setPhase('missing')
        return
      }
      const data = await resolved.get().catch(() => null)
      if (cancelled) return
      if (!data) {
        setPhase('missing')
        return
      }
      setApi(resolved)
      setRequest(data)
      // One question, one answer. A rated link is finished — it still opens,
      // and it still says thank you, but it never asks again.
      setPhase(data.closed ? 'closed' : 'rating')
    })()
    return () => {
      cancelled = true
    }
  }, [publicToken])

  const color = request?.shopPrimaryColor || '#1d4ed8'
  // What a customer sees in the tab, and in a screenshot they send someone.
  usePageTitle(request ? `Leave ${request.shopName} a review` : 'Leave a review')
  const copy = reviewFeedbackCopy(chosen ?? request?.lastRating ?? request?.rating ?? 1, request?.shopName ?? 'the shop')

  const rate = useCallback(
    async (rating: number) => {
      if (!api || busy) return
      setChosen(rating)
      setBusy(true)
      setError(null)
      try {
        const decision = await api.rate(rating)
        if (decision.redirectTo) {
          // Straight out, with nothing said and nothing shown. A happy
          // customer who has already tapped does not need a page telling them
          // they tapped; every extra beat here is a chance to close the tab
          // before the review site loads.
          leaveTo(decision.redirectTo)
          return
        }
        setPhase(decision.showFeedback ? 'feedback' : 'thanks')
      } catch {
        setError('That did not go through. Try tapping again.')
        setChosen(null)
      } finally {
        setBusy(false)
      }
    },
    [api, busy],
  )

  if (phase === 'loading') return <LoadingBlock label="Loading…" />

  if (phase === 'missing' || !request) {
    return (
      <Centered>
        <h1 className="text-2xl font-black text-ink">This link has expired</h1>
        <p className="mt-2 text-base text-zinc-600">
          Ask the shop to send you a new one, or just give them a call.
        </p>
      </Centered>
    )
  }

  return (
    <div className="min-h-screen bg-zinc-50 px-4 py-10">
      <div className="mx-auto w-full max-w-md space-y-6">
        <div className="text-center">
          {request.shopLogoUrl ? (
            <img src={request.shopLogoUrl} alt={request.shopName} className="mx-auto max-h-16 max-w-56" />
          ) : (
            <p className="text-xl font-black text-ink">{request.shopName}</p>
          )}
        </div>

        {phase === 'rating' ? (
          <Card>
            <h1 className="text-center text-3xl font-black text-ink">
              {request.customerName ? `${request.customerName}, how did we do?` : 'How did we do?'}
            </h1>
            <p className="mt-2 text-center text-base text-zinc-600">Tap a star. That&apos;s the whole thing.</p>
            <div className="mt-6 flex justify-center gap-1.5" role="group" aria-label="Your rating">
              {[1, 2, 3, 4, 5].map((n) => {
                const lit = (hovered ?? chosen ?? 0) >= n
                return (
                  <button
                    key={n}
                    type="button"
                    disabled={busy}
                    aria-label={`${n} star${n === 1 ? '' : 's'}`}
                    onMouseEnter={() => setHovered(n)}
                    onMouseLeave={() => setHovered(null)}
                    onClick={() => void rate(n)}
                    className="rounded-xl p-1.5 transition-transform active:scale-90 disabled:opacity-60"
                  >
                    <Star
                      className={`h-12 w-12 ${lit ? 'fill-amber-400 text-amber-400' : 'text-zinc-300'}`}
                      aria-hidden="true"
                    />
                  </button>
                )
              })}
            </div>
            {error ? (
              <p role="alert" className="mt-4 text-center text-base font-medium text-red-700">
                {error}
              </p>
            ) : null}
          </Card>
        ) : null}

        {phase === 'feedback' ? (
          <Card>
            {/* The words change with the rating. An apology is only honest
                below four — see reviewFeedbackCopy. */}
            <h1 className="text-2xl font-black text-ink">{copy.heading}</h1>
            <p className="mt-2 text-base text-zinc-600">{copy.body}</p>
            <label htmlFor="review-feedback" className="sr-only">
              {copy.heading}
            </label>
            <textarea
              id="review-feedback"
              rows={5}
              maxLength={4000}
              autoFocus
              value={feedback}
              onChange={(e) => setFeedback(e.target.value)}
              placeholder={copy.placeholder}
              className="mt-4 w-full rounded-xl border-2 border-zinc-200 px-3.5 py-3 text-base text-ink outline-none focus:border-zinc-400"
            />
            <Button
              className="mt-3 w-full"
              style={{ backgroundColor: color, borderColor: color }}
              disabled={busy || feedback.trim() === ''}
              onClick={async () => {
                if (!api) return
                setBusy(true)
                try {
                  await api.submitFeedback(feedback)
                  setPhase('thanks')
                } catch {
                  setError('That did not send. Try again.')
                } finally {
                  setBusy(false)
                }
              }}
            >
              {busy ? 'Sending…' : copy.submitLabel}
            </Button>
            {/* Deliberately quieter than the submit button. Someone who is
                unhappy enough to want a person should find this without it
                competing with the thing that gets the shop a written record. */}
            <a
              href={`tel:${request.shopPhone}`}
              className="mt-3 flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-zinc-300 bg-white text-base font-semibold text-zinc-700"
            >
              <Phone className="h-4 w-4" aria-hidden="true" /> Rather talk to someone? Call the shop
            </a>
          </Card>
        ) : null}

        {phase === 'thanks' || phase === 'closed' ? (
          <Card>
            <div className="flex flex-col items-center text-center">
              <span
                className="flex h-16 w-16 items-center justify-center rounded-full"
                style={{ backgroundColor: `${color}1a`, color }}
              >
                <Check className="h-9 w-9" aria-hidden="true" />
              </span>
              {/* The last thing they see, so it is the warmest thing on the
                  page — and the same whether they left five stars or told the
                  owner what went wrong. */}
              <h1 className="mt-5 text-3xl leading-tight font-black text-ink">
                Thank you for visiting {request.shopName}!
              </h1>
              <p className="mt-3 text-lg text-zinc-600">
                {phase === 'closed'
                  ? 'You have already answered this one — nothing else needed.'
                  : 'That went straight to the owner, and someone will read it.'}
              </p>
              <p className="mt-4 text-base text-zinc-500">We appreciate you.</p>
            </div>
          </Card>
        ) : null}
      </div>
    </div>
  )
}

function Card({ children }: { children: React.ReactNode }) {
  return <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">{children}</div>
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-50 px-4">
      <div className="max-w-md text-center">{children}</div>
    </div>
  )
}
