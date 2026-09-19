import { useCallback, useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { Send, Check } from 'lucide-react'
import { Button, LoadingBlock } from '../components/ui'
import { resolveIntakeApi, type IntakeApi, type IntakeShop } from '../data/publicIntake'
import { buildReviewRequestSmsBody, formatPhoneDisplay } from '../lib/reviewRequests'
import { buildSmsLink } from '../lib/sms'
import { env } from '../lib/env'
import { errorMessage } from '../lib/errors'

/**
 * The home-screen shortcut: type a number, tap once, done.
 *
 * No login on purpose. This lives behind an icon on a phone at the counter,
 * and a sign-in screen in front of it is the difference between doing this
 * every time and doing it never. The token in the URL is the credential; see
 * the header of migration 0031 for what it can and cannot do.
 *
 * Built for one hand and a queue: two fields, one button, a big confirmation,
 * and it resets itself so the next customer is one tap away.
 */
export default function ReviewIntakePage() {
  const { intakeToken = '' } = useParams()
  const [api, setApi] = useState<IntakeApi | null>(null)
  const [shop, setShop] = useState<IntakeShop | null>(null)
  const [state, setState] = useState<'loading' | 'ready' | 'missing'>('loading')
  const [phone, setPhone] = useState('')
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const resolved = await resolveIntakeApi(intakeToken)
      if (!resolved) {
        if (!cancelled) setState('missing')
        return
      }
      const found = await resolved.shop().catch(() => null)
      if (cancelled) return
      if (!found) {
        setState('missing')
        return
      }
      setApi(resolved)
      setShop(found)
      setState('ready')
    })()
    return () => {
      cancelled = true
    }
  }, [intakeToken])

  const color = shop?.shopPrimaryColor || '#1d4ed8'

  const submit = useCallback(async () => {
    if (!api || busy || phone.trim() === '') return
    setBusy(true)
    setError(null)
    try {
      const created = await api.create(phone, name.trim())
      const link = buildSmsLink(
        created.phone,
        buildReviewRequestSmsBody({
          firstName: name.trim() || null,
          shopName: created.shopName || shop?.shopName || 'us',
          reviewUrl: `${env.appUrl}/r/${created.shortCode}`,
        }),
      )
      setDone(formatPhoneDisplay(created.phone))
      setPhone('')
      setName('')
      // Straight into the messaging app. The customer is still standing there.
      if (link) window.location.href = link
    } catch (err) {
      setError(errorMessage(err) || 'That did not go through. Try again.')
    } finally {
      setBusy(false)
    }
  }, [api, busy, name, phone, shop])

  if (state === 'loading') return <LoadingBlock label="Loading…" />

  if (state === 'missing' || !shop) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-zinc-50 px-4">
        <div className="max-w-md text-center">
          <h1 className="text-2xl font-black text-ink">This shortcut is no longer valid</h1>
          <p className="mt-2 text-base text-zinc-600">
            The shop changed its link. Ask them for the new one and re-save it to your home screen.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-zinc-50 px-4 py-8">
      <div className="mx-auto w-full max-w-md space-y-5">
        <div className="text-center">
          {shop.shopLogoUrl ? (
            <img src={shop.shopLogoUrl} alt={shop.shopName} className="mx-auto max-h-14 max-w-48" />
          ) : (
            <p className="text-lg font-black text-ink">{shop.shopName}</p>
          )}
          <h1 className="mt-3 text-2xl font-black text-ink">Ask for a review</h1>
          <p className="mt-1 text-base text-zinc-600">Type their number. Your phone sends the text.</p>
        </div>

        {done ? (
          <div className="flex items-start gap-3 rounded-2xl border-2 border-green-300 bg-green-50 p-4">
            <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-green-600 text-white">
              <Check className="h-5 w-5" aria-hidden="true" />
            </span>
            <p className="text-base text-ink">
              Ready for <strong>{done}</strong>. If your messaging app did not open, tap the button again.
            </p>
          </div>
        ) : null}

        <div className="space-y-4 rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm">
          <div>
            <label htmlFor="intake-phone" className="mb-1.5 block text-base font-semibold text-ink">
              Their phone number
            </label>
            <input
              id="intake-phone"
              type="tel"
              inputMode="tel"
              autoComplete="off"
              autoFocus
              placeholder="214-555-0100"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void submit()
              }}
              className="min-h-14 w-full rounded-xl border-2 border-zinc-200 px-4 text-xl text-ink outline-none focus:border-zinc-400"
            />
          </div>
          <div>
            <label htmlFor="intake-name" className="mb-1.5 block text-base font-semibold text-ink">
              First name <span className="font-normal text-zinc-500">(optional)</span>
            </label>
            <input
              id="intake-name"
              autoComplete="off"
              placeholder="Marcus"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void submit()
              }}
              className="min-h-14 w-full rounded-xl border-2 border-zinc-200 px-4 text-xl text-ink outline-none focus:border-zinc-400"
            />
          </div>
          {error ? (
            <p role="alert" className="text-base font-medium text-red-700">
              {error}
            </p>
          ) : null}
          <Button
            className="min-h-16 w-full text-lg"
            style={{ backgroundColor: color, borderColor: color }}
            disabled={busy || phone.trim() === ''}
            onClick={() => void submit()}
          >
            <Send className="h-6 w-6" aria-hidden="true" /> {busy ? 'One second…' : 'Text them the link'}
          </Button>
        </div>

        <p className="text-center text-sm text-zinc-500">
          Nothing is sent from here — your own phone opens with the message written.
        </p>
      </div>
    </div>
  )
}
