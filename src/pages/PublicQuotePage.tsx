import { useCallback, useEffect, useState } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import { MapPin, Phone, Mail, BadgeCheck } from 'lucide-react'
import type { PublicQuote, ResponseType } from '../types'
import { resolvePublicQuoteApi, type PublicQuoteApi } from '../data/publicQuote'
import { RESPONSE_CONFIG } from '../lib/status'
import { formatCurrency, formatDate } from '../lib/format'
import { buildPaymentUrl, paymentInstructions } from '../lib/paymentMethods'
import { Button, LoadingBlock } from '../components/ui'

// What the customer sees. No login, no jargon, big buttons.

const RESPONSE_CHOICES: ResponseType[] = [
  'ready_to_book',
  'need_financing',
  'want_cheaper',
  'after_payday',
  'question',
  'not_interested',
]

export default function PublicQuotePage() {
  const { publicToken = '' } = useParams<{ publicToken: string }>()
  const [searchParams] = useSearchParams()
  const [api, setApi] = useState<PublicQuoteApi | null>(null)
  const [quote, setQuote] = useState<PublicQuote | null>(null)
  const [state, setState] = useState<'loading' | 'ready' | 'missing' | 'error'>('loading')
  const [selectedOption, setSelectedOption] = useState<string | null>(null)
  const [selectedResponse, setSelectedResponse] = useState<ResponseType | null>(null)
  const [message, setMessage] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState<ResponseType | null>(null)
  const [optedOut, setOptedOut] = useState(false)
  const wantsStop = searchParams.get('stop') === '1'

  const respondedKey = `0g-responded-${publicToken}`
  const viewedKey = `0g-viewed-${publicToken}`

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const resolved = await resolvePublicQuoteApi(publicToken)
        if (cancelled) return
        if (!resolved) {
          setState('missing')
          return
        }
        const data = await resolved.get()
        if (cancelled) return
        if (!data) {
          setState('missing')
          return
        }
        setApi(resolved)
        setQuote(data)
        setOptedOut(data.optedOut)
        setState('ready')
        // Record only the first meaningful view per browser session.
        if (!sessionStorage.getItem(viewedKey)) {
          sessionStorage.setItem(viewedKey, '1')
          void resolved.recordView()
        }
        if (sessionStorage.getItem(respondedKey)) {
          setSubmitted(sessionStorage.getItem(respondedKey) as ResponseType)
        }
      } catch {
        if (!cancelled) setState('error')
      }
    })()
    return () => {
      cancelled = true
    }
  }, [publicToken, respondedKey, viewedKey])

  const color = quote?.shopPrimaryColor || '#1d4ed8'

  const submitResponse = useCallback(async () => {
    if (!api || !selectedResponse) return
    setSubmitting(true)
    try {
      await api.submitResponse(selectedResponse, selectedOption, message.trim() || null)
      sessionStorage.setItem(respondedKey, selectedResponse)
      setSubmitted(selectedResponse)
    } catch {
      setState('error')
    } finally {
      setSubmitting(false)
    }
  }, [api, selectedResponse, selectedOption, message, respondedKey])

  const doOptOut = useCallback(async () => {
    if (!api) return
    setSubmitting(true)
    try {
      await api.optOut()
      setOptedOut(true)
    } finally {
      setSubmitting(false)
    }
  }, [api])

  if (state === 'loading') return <LoadingBlock label="Loading your quote…" />
  if (state === 'missing' || !quote) {
    return (
      <CenteredNote title="Quote not found" body="This quote link isn't valid anymore. Please contact the shop for a current quote." />
    )
  }
  if (state === 'error') {
    return <CenteredNote title="Something went wrong" body="We couldn't load your quote right now. Please try again in a minute, or call the shop." />
  }

  return (
    <div className="min-h-screen bg-zinc-50 pb-16">
      {/* Shop header */}
      <header className="bg-white" style={{ borderBottom: `4px solid ${color}` }}>
        <div className="mx-auto flex max-w-2xl flex-col items-center gap-2 px-4 py-6 text-center">
          {quote.shopLogoUrl ? (
            <img src={quote.shopLogoUrl} alt={quote.shopName} className="max-h-14" />
          ) : (
            <p className="text-2xl font-black text-ink">{quote.shopName}</p>
          )}
          <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-sm text-zinc-600">
            <a href={`tel:${quote.shopPhone}`} className="flex items-center gap-1 font-semibold" style={{ color }}>
              <Phone className="h-4 w-4" aria-hidden="true" /> {quote.shopPhone}
            </a>
            <span className="flex items-center gap-1">
              <MapPin className="h-4 w-4" aria-hidden="true" /> {quote.shopAddress}
            </span>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-2xl px-4">
        <section className="py-6 text-center">
          <h1 className="text-3xl font-black text-ink">
            {quote.customerFirstName}, here&apos;s your quote
          </h1>
          <p className="mt-1 text-lg text-zinc-600">
            {quote.vehicle.year} {quote.vehicle.make} {quote.vehicle.model}
            {quote.vehicle.trim ? ` ${quote.vehicle.trim}` : ''}
          </p>
          {quote.expirationDate ? (
            <p className="mt-2 text-base font-semibold text-zinc-700">
              Good through {formatDate(quote.expirationDate)}
            </p>
          ) : null}
        </section>

        {/* Options */}
        <section aria-label="Quote options" className="space-y-4">
          {quote.options.map((option) => {
            const depositUrl =
              option.depositPaymentMethod && option.depositPaymentHandle
                ? buildPaymentUrl(option.depositPaymentMethod, option.depositPaymentHandle, option.depositAmountCents)
                : null
            const depositInstructions =
              option.depositPaymentMethod && option.depositPaymentHandle
                ? paymentInstructions(option.depositPaymentMethod, option.depositPaymentHandle)
                : null
            const depositAmountLabel = option.depositAmountCents != null ? formatCurrency(option.depositAmountCents) : null

            return (
              <div
                key={option.id}
                className="rounded-2xl border bg-white p-5 shadow-sm"
                style={option.recommended ? { borderColor: color, borderWidth: 2 } : { borderColor: '#e4e4e7' }}
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <h2 className="text-xl font-black text-ink">{option.name}</h2>
                      {option.recommended ? (
                        <span
                          className="flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-bold text-white"
                          style={{ backgroundColor: color }}
                        >
                          <BadgeCheck className="h-3.5 w-3.5" aria-hidden="true" /> Shop pick
                        </span>
                      ) : null}
                    </div>
                    {option.description ? <p className="mt-1 text-base text-zinc-600">{option.description}</p> : null}
                  </div>
                  <p className="shrink-0 text-2xl font-black text-ink">{formatCurrency(option.priceCents)}</p>
                </div>
                <ul className="mt-3 space-y-1.5 border-t border-zinc-100 pt-3">
                  {option.items.map((item, i) => (
                    <li key={i} className="text-base text-zinc-700">
                      {item.quantity > 1 ? `${item.quantity}× ` : ''}
                      {[item.brand, item.model].filter(Boolean).join(' ')}
                      {item.brand || item.model ? ' — ' : ''}
                      {item.name}
                    </li>
                  ))}
                </ul>
                <p className="mt-2 text-sm font-medium text-zinc-500">
                  {option.laborIncluded ? '✓ Professional installation included' : 'Installation billed separately'}
                </p>
                {depositUrl ? (
                  <div className="mt-3 space-y-1.5">
                    {depositAmountLabel ? (
                      <p className="text-sm font-semibold text-zinc-600">
                        {depositAmountLabel} deposit
                        {option.depositPaymentMethod === 'venmo'
                          ? " — tap Pay, then enter the amount if it isn't already filled in"
                          : ''}
                      </p>
                    ) : null}
                    <a
                      href={depositUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex min-h-12 w-full items-center justify-center rounded-xl text-base font-bold text-white"
                      style={{ backgroundColor: color }}
                    >
                      Hold my spot with a deposit
                    </a>
                  </div>
                ) : depositInstructions ? (
                  <div
                    className="mt-3 rounded-xl border-2 p-3 text-center text-base font-semibold"
                    style={{ borderColor: color, color }}
                  >
                    {depositAmountLabel ? `${depositAmountLabel} deposit — ` : ''}
                    {depositInstructions}
                  </div>
                ) : null}
              </div>
            )
          })}
        </section>

        {/* Contact buttons */}
        <section className="mt-6 grid grid-cols-2 gap-3">
          <a
            href={`tel:${quote.shopPhone}`}
            className="inline-flex min-h-14 items-center justify-center gap-2 rounded-xl border-2 bg-white text-base font-bold"
            style={{ borderColor: color, color }}
          >
            <Phone className="h-5 w-5" aria-hidden="true" /> Call the shop
          </a>
          <a
            href={`mailto:${quote.shopEmail}`}
            className="inline-flex min-h-14 items-center justify-center gap-2 rounded-xl border-2 bg-white text-base font-bold"
            style={{ borderColor: color, color }}
          >
            <Mail className="h-5 w-5" aria-hidden="true" /> Email the shop
          </a>
        </section>

        {/* Response area */}
        <section aria-label="Tell the shop what you think" className="mt-8">
          {submitted ? (
            <div className="rounded-2xl border border-green-300 bg-green-50 p-6 text-center">
              <p className="text-xl font-bold text-green-900">Got it — thanks!</p>
              <p className="mt-2 text-base text-green-800">
                {quote.shopName} received your answer ({RESPONSE_CONFIG[submitted].publicLabel.toLowerCase()}).
                They&apos;ll be in touch soon. Need them now? Call{' '}
                <a href={`tel:${quote.shopPhone}`} className="font-bold underline">
                  {quote.shopPhone}
                </a>
                .
              </p>
            </div>
          ) : (
            <div className="rounded-2xl border border-zinc-200 bg-white p-5">
              <h2 className="text-xl font-bold text-ink">Where are you at with this?</h2>
              <p className="mt-1 text-base text-zinc-600">One tap tells the shop — no phone call needed.</p>
              <div className="mt-4 grid gap-2 sm:grid-cols-2">
                {RESPONSE_CHOICES.map((choice) => (
                  <button
                    key={choice}
                    type="button"
                    onClick={() => setSelectedResponse(choice)}
                    aria-pressed={selectedResponse === choice}
                    className="min-h-13 rounded-xl border-2 px-4 py-3 text-left text-base font-semibold transition-colors"
                    style={
                      selectedResponse === choice
                        ? { borderColor: color, backgroundColor: `${color}14`, color: '#18181b' }
                        : { borderColor: '#e4e4e7', color: '#3f3f46' }
                    }
                  >
                    {RESPONSE_CONFIG[choice].publicLabel}
                  </button>
                ))}
              </div>
              {selectedResponse ? (
                <div className="mt-4 space-y-3">
                  {quote.options.length > 1 ? (
                    <div>
                      <label htmlFor="pq-option" className="mb-1.5 block text-base font-semibold text-ink">
                        Which option are you thinking about? (optional)
                      </label>
                      <select
                        id="pq-option"
                        value={selectedOption ?? ''}
                        onChange={(e) => setSelectedOption(e.target.value || null)}
                        className="min-h-12 w-full rounded-xl border border-zinc-300 bg-white px-3 text-base"
                      >
                        <option value="">Not sure yet</option>
                        {quote.options.map((o) => (
                          <option key={o.id} value={o.id}>
                            {o.name} — {formatCurrency(o.priceCents)}
                          </option>
                        ))}
                      </select>
                    </div>
                  ) : null}
                  <div>
                    <label htmlFor="pq-message" className="mb-1.5 block text-base font-semibold text-ink">
                      Anything to add? (optional)
                    </label>
                    <textarea
                      id="pq-message"
                      rows={3}
                      maxLength={500}
                      value={message}
                      onChange={(e) => setMessage(e.target.value)}
                      className="w-full rounded-xl border border-zinc-300 bg-white px-3 py-3 text-base"
                      placeholder="Example: does that price include tint too?"
                    />
                  </div>
                  <Button
                    onClick={() => void submitResponse()}
                    disabled={submitting}
                    className="w-full"
                  >
                    {submitting ? 'Sending…' : 'Send to the shop'}
                  </Button>
                </div>
              ) : null}
            </div>
          )}
        </section>

        {/* Opt out */}
        <section className="mt-8 text-center">
          {optedOut ? (
            <p className="rounded-xl bg-zinc-100 px-4 py-3 text-base text-zinc-700">
              You won&apos;t get any more follow-up emails about this quote. You can always call the shop if you change your mind.
            </p>
          ) : (
            <div className={wantsStop ? 'rounded-xl border border-zinc-300 bg-white p-4' : ''}>
              {wantsStop ? (
                <p className="mb-2 text-base font-semibold text-ink">Want to stop follow-up emails about this quote?</p>
              ) : null}
              <button
                type="button"
                onClick={() => void doOptOut()}
                disabled={submitting}
                className="min-h-11 text-base text-zinc-500 underline hover:text-zinc-700"
              >
                Stop follow-up emails about this quote
              </button>
            </div>
          )}
        </section>

        <footer className="mt-10 border-t border-zinc-200 pt-5 pb-4 text-center text-sm leading-relaxed text-zinc-500">
          <p>{quote.quoteDisclaimer}</p>
          <p className="mt-3 font-semibold">{quote.shopName} · {quote.shopPhone}</p>
          <p>{quote.shopAddress}</p>
        </footer>
      </main>
    </div>
  )
}

function CenteredNote({ title, body }: { title: string; body: string }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-50 px-4">
      <div className="max-w-md rounded-2xl border border-zinc-200 bg-white p-8 text-center shadow-sm">
        <h1 className="text-xl font-bold text-ink">{title}</h1>
        <p className="mt-2 text-base text-zinc-600">{body}</p>
      </div>
    </div>
  )
}
