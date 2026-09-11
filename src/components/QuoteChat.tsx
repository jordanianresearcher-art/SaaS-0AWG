import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Send } from 'lucide-react'
import { Button } from './ui'
import { formatDateTime } from '../lib/format'
import type { QuoteMessage } from '../types'

/**
 * The conversation on a quote, used by both sides of it.
 *
 * One component rather than two because the two screens have to agree about
 * what was said. A staff member reading "I can do Saturday" in a different
 * order, or without the customer's last line, is how a shop turns up to an
 * install nobody booked.
 *
 * `me` decides which side is which. Chat convention is that your own messages
 * sit on the right, and on the public page "you" is the customer while in the
 * app it is the shop — so the same thread mirrors depending on who is looking
 * at it, which is exactly what a person expects and would notice if it did
 * not.
 */
export function QuoteChat({
  messages,
  me,
  accentColor,
  onSend,
  disabled = false,
  placeholder = 'Type a message…',
  emptyHint,
}: {
  messages: QuoteMessage[]
  me: 'shop' | 'customer'
  /** The shop's brand colour on the public page; the app's own accent inside the app. */
  accentColor?: string
  onSend: (body: string) => Promise<void>
  disabled?: boolean
  placeholder?: string
  emptyHint: string
}) {
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const endRef = useRef<HTMLDivElement | null>(null)
  const count = messages.length

  // Scroll the newest message into view when one arrives, but never on first
  // paint — yanking the page down to a thread the reader has not asked about
  // is how a quote page loses someone before they have seen the price.
  const seen = useRef(count)
  useEffect(() => {
    if (count > seen.current) endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
    seen.current = count
  }, [count])

  const submit = async (e?: FormEvent) => {
    e?.preventDefault()
    const body = draft.trim()
    if (!body || sending) return
    setSending(true)
    setError(null)
    try {
      await onSend(body)
      setDraft('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That did not send. Try again.')
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="space-y-3">
      {messages.length === 0 ? (
        <p className="rounded-xl bg-zinc-50 px-3.5 py-3 text-base text-zinc-500">{emptyHint}</p>
      ) : (
        <ul className="space-y-2.5">
          {messages.map((m) => {
            const mine = m.sender === me
            return (
              <li key={m.id} className={mine ? 'flex justify-end' : 'flex justify-start'}>
                <div className="max-w-[85%]">
                  <div
                    className={`rounded-2xl px-3.5 py-2.5 text-base leading-relaxed whitespace-pre-wrap ${
                      mine ? 'text-white' : 'bg-zinc-100 text-ink'
                    }`}
                    style={mine ? { backgroundColor: accentColor ?? '#0b0b0c' } : undefined}
                  >
                    {m.body}
                  </div>
                  <p className={`mt-1 text-xs text-zinc-500 ${mine ? 'text-right' : ''}`}>
                    {formatDateTime(m.createdAt)}
                    {/* Only ever shown on your own messages, and only once the
                        other side actually loaded it. This is the one delivery
                        signal in this product that is not a guess. */}
                    {mine && m.readAt ? ' · Seen' : ''}
                  </p>
                </div>
              </li>
            )
          })}
          <div ref={endRef} />
        </ul>
      )}

      <form onSubmit={submit} className="space-y-2">
        <label htmlFor="quote-chat-input" className="sr-only">
          Message
        </label>
        <textarea
          id="quote-chat-input"
          rows={2}
          value={draft}
          disabled={disabled || sending}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            // Enter sends, Shift+Enter makes a new line — but only with a
            // real keyboard. On a phone the Enter key is the only way to get
            // a line break, and stealing it would make a two-line message
            // impossible to type.
            if (e.key === 'Enter' && !e.shiftKey && !/Mobi|Android/i.test(navigator.userAgent)) {
              e.preventDefault()
              void submit()
            }
          }}
          placeholder={placeholder}
          maxLength={2000}
          className="min-h-[52px] w-full rounded-xl border-2 border-zinc-200 px-3.5 py-2.5 text-base text-ink outline-none focus:border-zinc-400"
        />
        {error ? (
          <p role="alert" className="text-base font-medium text-red-700">
            {error}
          </p>
        ) : null}
        <Button
          type="submit"
          className="w-full"
          disabled={disabled || sending || draft.trim() === ''}
          style={accentColor ? { backgroundColor: accentColor, borderColor: accentColor } : undefined}
        >
          <Send className="h-5 w-5" aria-hidden="true" /> {sending ? 'Sending…' : 'Send'}
        </Button>
      </form>
    </div>
  )
}
