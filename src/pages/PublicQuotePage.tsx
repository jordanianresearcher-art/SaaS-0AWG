import { useCallback, useEffect, useState } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import { MapPin, Phone, Mail, CreditCard, Check } from 'lucide-react'
import type { PublicQuote, ResponseType } from '../types'
import { resolvePublicQuoteApi, type PublicQuoteApi } from '../data/publicQuote'
import { RESPONSE_CONFIG } from '../lib/status'
import { formatCurrency, formatDate } from '../lib/format'
import { buildPaymentUrl, paymentInstructions } from '../lib/paymentMethods'
import { summarizeWindowTint } from '../lib/windowTint'
import { addonOptions, computeAddonBreakdown, fullTotalCents, mainOption } from '../lib/quotePricing'
import { Button, LoadingBlock } from '../components/ui'

/** A row of small product thumbnails/names — no per-item price (see docs/QUOTE_TRACKING.md's email section: the shop wants the customer to see pictures of what they're getting without a line-by-line price breakdown, just the option total). */
function ItemPreviewList({ items }: { items: PublicQuote['options'][number]['items'] }) {
  if (items.length === 0) return null
  return (
    <ul className="mt-3 flex flex-wrap gap-2 border-t border-zinc-100 pt-3">
      {items.map((item, i) => (
        <li key={i} className="flex items-center gap-2 rounded-full border border-zinc-200 py-1 pr-3 pl-1 text-sm text-zinc-700">
          <span className="flex h-7 w-7 shrink-0 items-center justify-center overflow-hidden rounded-full bg-zinc-100">
            {item.imageUrl ? <img src={item.imageUrl} alt="" className="h-full w-full object-cover" /> : null}
          </span>
          {item.quantity > 1 ? `${item.quantity}× ` : ''}
          {[item.brand, item.model].filter(Boolean).join(' ')}
          {item.brand || item.model ? ' — ' : ''}
          {item.name.trim() || 'Item'}
        </li>
      ))}
    </ul>
  )
}

// What the customer sees. No login, no jargon, big buttons.

// need_financing has its own big, dedicated CTA right under the options
// (see the Financing section below) — this real quote's proof of value —
// so it's deliberately left out of the generic response grid rather than
// buried as one of six equal-weight choices.
const RESPONSE_CHOICES: ResponseType[] = ['ready_to_book', 'want_cheaper', 'after_payday', 'question', 'not_interested']

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
  // Only present on a real emailed link (embedded server-side in
  // send-quote-email) — the bare link staff use for "Open quote"/"Copy
  // link" never carries one, so a null here means "don't record a view,"
  // not "record it anonymously." See docs/QUOTE_TRACKING.md.
  const deliveryToken = searchParams.get('d')

  const respondedKey = `0g-responded-${publicToken}`
  const viewedKey = `0g-viewed-${publicToken}-${deliveryToken ?? 'none'}`

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
        // Record only the first meaningful view per browser session — the
        // repository layer is the real source of truth for "first view
        // ever" (idempotent server-side), this is just avoiding a redundant
        // call on every remount. A deliveryToken-less load (bare/staff
        // link) always no-ops inside recordView itself.
        if (!sessionStorage.getItem(viewedKey)) {
          sessionStorage.setItem(viewedKey, '1')
          void resolved.recordView(deliveryToken)
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
  }, [publicToken, respondedKey, viewedKey, deliveryToken])

  const color = quote?.shopPrimaryColor || '#1d4ed8'

  // Shared by the generic response panel and the dedicated financing CTA —
  // one tap, one call, one confirmation state, regardless of which action
  // triggered it. The server itself also de-dupes a rapid repeat of the
  // same response type (see migration 0014), so a double-click/retry here
  // is safe even before the disabled-while-submitting guard kicks in.
  const submit = useCallback(
    async (responseType: ResponseType, optionId: string | null, msg: string | null) => {
      if (!api) return
      setSubmitting(true)
      try {
        await api.submitResponse(responseType, optionId, msg)
        sessionStorage.setItem(respondedKey, responseType)
        setSubmitted(responseType)
        // Fire-and-forget — never blocks or affects this confirmation.
        void api.notifyHighIntent(responseType)
      } catch {
        setState('error')
      } finally {
        setSubmitting(false)
      }
    },
    [api, respondedKey],
  )

  const submitResponse = useCallback(async () => {
    if (!selectedResponse) return
    await submit(selectedResponse, selectedOption, message.trim() || null)
  }, [submit, selectedResponse, selectedOption, message])

  // The financing CTA is meant to stay "extremely easy" — one tap, no
  // intermediate form — carrying whichever option the customer has chosen
  // (via "Choose this option" on a card below), or null if they haven't
  // picked one yet. This is the exact action that produced this product's
  // first real sale.
  const requestFinancing = useCallback(async () => {
    await submit('need_financing', selectedOption, null)
  }, [submit, selectedOption])

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

  const main = mainOption(quote.options)
  const addons = addonOptions(quote.options)
  const addonBreakdown = computeAddonBreakdown(quote.options)
  const mainDepositUrl =
    main?.depositPaymentMethod && main.depositPaymentHandle
      ? buildPaymentUrl(main.depositPaymentMethod, main.depositPaymentHandle, main.depositAmountCents)
      : null
  const mainDepositInstructions =
    main?.depositPaymentMethod && main.depositPaymentHandle ? paymentInstructions(main.depositPaymentMethod, main.depositPaymentHandle) : null
  const mainDepositAmountLabel = main?.depositAmountCents != null ? formatCurrency(main.depositAmountCents) : null

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
          {quote.vehicle.year && quote.vehicle.make && quote.vehicle.model ? (
            <p className="mt-1 text-lg text-zinc-600">
              {quote.vehicle.year} {quote.vehicle.make} {quote.vehicle.model}
              {quote.vehicle.trim ? ` ${quote.vehicle.trim}` : ''}
            </p>
          ) : null}
          {quote.expirationDate ? (
            <p className="mt-2 text-base font-semibold text-zinc-700">
              Good through {formatDate(quote.expirationDate)}
            </p>
          ) : null}
        </section>

        {/* Main package + optional add-ons — replaces the old good/better/insane
            tier grid with one main price plus named upsells, each priced as
            the incremental cost on top of it (see src/lib/quotePricing.ts). */}
        <section aria-label="Your quote" className="space-y-4">
          {quote.options.length === 0 ? (
            <p className="text-center text-base text-zinc-500">Pricing for this quote is coming soon.</p>
          ) : null}
          {main ? (
            <div className="rounded-2xl border-2 bg-white p-5 shadow-sm" style={{ borderColor: color }}>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="text-xl font-black text-ink">{main.name.trim() || 'Complete system'}</h2>
                  {main.description ? <p className="mt-1 text-base text-zinc-600">{main.description}</p> : null}
                </div>
                <p className="shrink-0 text-2xl font-black text-ink">{formatCurrency(main.priceCents)}</p>
              </div>
              <ItemPreviewList items={main.items} />
              <p className="mt-2 text-sm font-medium text-zinc-500">
                {main.laborIncluded ? '✓ Professional installation included' : 'Installation billed separately'}
              </p>
              {mainDepositUrl ? (
                <div className="mt-3 space-y-1.5">
                  {mainDepositAmountLabel ? (
                    <p className="text-sm font-semibold text-zinc-600">
                      {mainDepositAmountLabel} deposit
                      {main.depositPaymentMethod === 'venmo' ? " — tap Pay, then enter the amount if it isn't already filled in" : ''}
                    </p>
                  ) : null}
                  <a
                    href={mainDepositUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex min-h-12 w-full items-center justify-center rounded-xl text-base font-bold text-white"
                    style={{ backgroundColor: color }}
                  >
                    Hold my spot with a deposit
                  </a>
                </div>
              ) : mainDepositInstructions ? (
                <div className="mt-3 rounded-xl border-2 p-3 text-center text-base font-semibold" style={{ borderColor: color, color }}>
                  {mainDepositAmountLabel ? `${mainDepositAmountLabel} deposit — ` : ''}
                  {mainDepositInstructions}
                </div>
              ) : null}
            </div>
          ) : null}

          {addons.length > 0 ? (
            <div className="space-y-3">
              <h3 className="text-lg font-black text-ink">Optional add-ons</h3>
              {addonBreakdown.map(({ option, addonPriceCents, totalWithAddonCents }) => (
                <div key={option.id} className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-base font-bold text-ink">{option.name.trim() || 'Add-on'}</p>
                      {option.description ? <p className="text-sm text-zinc-600">{option.description}</p> : null}
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="text-lg font-black text-ink">+{formatCurrency(addonPriceCents)}</p>
                      <p className="text-xs font-medium text-zinc-500">total {formatCurrency(totalWithAddonCents)}</p>
                    </div>
                  </div>
                  <ItemPreviewList items={option.items} />
                </div>
              ))}
              {quote.showFullAddonTotal ? (
                <div className="rounded-2xl border-2 p-4 text-center" style={{ borderColor: color }}>
                  <p className="text-sm font-bold tracking-wide text-zinc-600 uppercase">Everything included</p>
                  <p className="text-2xl font-black" style={{ color }}>
                    {formatCurrency(fullTotalCents(quote.options))}
                  </p>
                </div>
              ) : null}
            </div>
          ) : null}
        </section>

        {/* Financing — a real, extremely-easy, one-tap action. Not buried
            in the generic response grid: this exact action produced this
            product's first real sale ($3,245), so it stays prominent. */}
        {quote.options.length > 0 && !optedOut ? (
          <section aria-label="Financing" className="mt-6">
            {submitted === 'need_financing' ? (
              <div className="flex items-center justify-center gap-2 rounded-2xl border-2 border-green-300 bg-green-50 p-4 text-center text-base font-bold text-green-800">
                <Check className="h-5 w-5 shrink-0" aria-hidden="true" />
                Got it — {quote.shopName} will follow up about financing.
              </div>
            ) : submitted ? null : (
              <button
                type="button"
                onClick={() => void requestFinancing()}
                disabled={submitting}
                className="flex min-h-16 w-full items-center justify-center gap-2 rounded-2xl border-2 text-lg font-bold transition-colors disabled:cursor-not-allowed disabled:opacity-60"
                style={{ borderColor: color, color }}
              >
                <CreditCard className="h-6 w-6" aria-hidden="true" />
                {submitting ? 'Sending…' : 'I need financing'}
              </button>
            )}
          </section>
        ) : null}

        {/* Window tint */}
        {quote.windowTints.length > 0 ? (
          <section aria-label="Window tint" className="mt-6 space-y-3">
            <h2 className="text-lg font-black text-ink">Window tint</h2>
            {quote.windowTints.map((tint, i) => {
              const summary = summarizeWindowTint(tint)
              const percentLabel =
                summary.uniformPercent !== null
                  ? `${summary.uniformPercent}%`
                  : summary.windowLines.length > 0
                    ? summary.windowLines.map((w) => `${w.label} ${w.vltPercent}%`).join(', ')
                    : null
              const extras = [
                summary.removeOldTint ? 'old tint removed' : null,
                summary.windshield ? `windshield ${summary.windshield.vltPercent}%` : null,
                summary.sunroof ? `sunroof ${summary.sunroof.vltPercent}%` : null,
              ].filter(Boolean)
              return (
                <div key={i} className="flex flex-wrap items-center gap-4 rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm">
                  <div className="min-w-0 flex-1">
                    <p className="text-base font-bold text-ink">{summary.name}</p>
                    <p className="mt-0.5 text-sm text-zinc-600">
                      {summary.bodyStyleLabel} &middot; {summary.tintTypeLabel}
                      {percentLabel ? ` · ${percentLabel}` : ''}
                      {extras.length > 0 ? ` · ${extras.join(', ')}` : ''}
                    </p>
                    {summary.totalCents > 0 ? (
                      <p className="mt-1 text-sm font-semibold text-zinc-700">Tint total: {formatCurrency(summary.totalCents)}</p>
                    ) : null}
                  </div>
                </div>
              )
            })}
          </section>
        ) : null}

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
