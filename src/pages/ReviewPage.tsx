import { useCallback, useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { Star, Check } from 'lucide-react'
import { Button, LoadingBlock } from '../components/ui'
import { resolveReviewApi, type ReviewApi } from '../data/publicReview'
import type { PublicReviewRequest } from '../types'

type Phase = 'loading' | 'missing' | 'rating' | 'feedback' | 'thanks' | 'leaving'

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
      setPhase('rating')
    })()
    return () => {
      cancelled = true
    }
  }, [publicToken])

  const color = request?.shopPrimaryColor || '#1d4ed8'

  const rate = useCallback(
    async (rating: number) => {
      if (!api || busy) return
      setChosen(rating)
      setBusy(true)
      setError(null)
      try {
        const decision = await api.rate(rating)
        if (decision.redirectTo) {
          // Full navigation, not a new tab: this is the end of the journey and
          // a popup would be blocked on most phones anyway.
          setPhase('leaving')
          window.location.href = decision.redirectTo
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

        {phase === 'leaving' ? (
          <Card>
            <p className="text-center text-lg font-bold text-ink">Thanks! Taking you there now…</p>
          </Card>
        ) : null}

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
            <h1 className="text-2xl font-black text-ink">Sorry we missed the mark.</h1>
            <p className="mt-2 text-base text-zinc-600">
              Tell {request.shopName} what happened. This goes straight to the owner — it is not posted anywhere.
            </p>
            <label htmlFor="review-feedback" className="sr-only">
              What happened
            </label>
            <textarea
              id="review-feedback"
              rows={5}
              maxLength={4000}
              autoFocus
              value={feedback}
              onChange={(e) => setFeedback(e.target.value)}
              placeholder="What would have made it a five?"
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
              {busy ? 'Sending…' : 'Send it to the owner'}
            </Button>
            <p className="mt-3 text-center text-sm text-zinc-500">
              Or call them directly:{' '}
              <a href={`tel:${request.shopPhone}`} className="font-semibold" style={{ color }}>
                {request.shopPhone}
              </a>
            </p>
          </Card>
        ) : null}

        {phase === 'thanks' ? (
          <Card>
            <div className="flex flex-col items-center text-center">
              <span
                className="flex h-14 w-14 items-center justify-center rounded-full"
                style={{ backgroundColor: `${color}1a`, color }}
              >
                <Check className="h-7 w-7" aria-hidden="true" />
              </span>
              <h1 className="mt-4 text-2xl font-black text-ink">Thank you.</h1>
              <p className="mt-2 text-base text-zinc-600">
                {request.shopName} has it, and someone will read it.
              </p>
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
