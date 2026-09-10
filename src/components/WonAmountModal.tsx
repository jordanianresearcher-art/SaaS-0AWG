import { useState } from 'react'
import { Trophy } from 'lucide-react'
import { Button, Field, Input, Modal } from './ui'
import { WinSourcePicker } from './WinSourcePicker'
import { parseDollarsToCents } from '../lib/format'
import type { WinSource } from '../types'

/**
 * Mark a job won: what it sold for, and what brought the customer back.
 *
 * Lives here rather than on the quote page because closing a job out is not
 * only something you do while looking at one quote. The follow-ups queue ends
 * with a pile that has run out of emails and needs a verdict, and that pile is
 * where a win from a follow-up gets recorded — or, until now, forgotten.
 */
export function WonAmountModal({
  open,
  onClose,
  defaultCents,
  onConfirm,
  mode,
}: {
  open: boolean
  onClose: () => void
  defaultCents: number
  onConfirm: (cents: number, winSource: WinSource | null) => Promise<void>
  mode: 'mark' | 'correct'
}) {
  const correcting = mode === 'correct'
  // Pre-fill when correcting so the current number is there to edit rather
  // than retype; blank when marking won so the placeholder default applies.
  const [value, setValue] = useState(correcting ? (defaultCents / 100).toFixed(2) : '')
  const [winSource, setWinSource] = useState<WinSource | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const placeholder = (defaultCents / 100).toFixed(0)

  return (
    <Modal open={open} onClose={onClose} title={correcting ? 'Correct the sale amount' : 'Mark this job won'}>
      <div className="space-y-4">
        <Field
          label="Final sale amount"
          htmlFor="won-amount"
          error={error ?? undefined}
          hint={
            correcting
              ? 'What the customer actually paid. This updates your recovered-revenue total.'
              : 'What the customer actually paid, in dollars.'
          }
        >
          <Input
            id="won-amount"
            inputMode="decimal"
            autoFocus
            placeholder={`$${placeholder}`}
            value={value}
            onChange={(e) => setValue(e.target.value)}
          />
        </Field>
        {/* Only asked at the moment of the win. Correcting an amount later is
            a typo fix; asking "what brought them back?" a week afterwards
            gets a guess, and a guessed attribution is worse than none. */}
        {correcting ? null : (
          // Deliberately not a <Field>: its <label htmlFor> would attach to the
          // first chip, and a <label> on a <button> replaces that button's
          // accessible name — a screen reader would read the first option as
          // "What brought them back?". The picker carries its own group label.
          <div>
            <p className="mb-1.5 text-base font-semibold text-ink">What brought them back?</p>
            <WinSourcePicker value={winSource} onChange={setWinSource} idPrefix="won-source" />
            <p className="mt-1.5 text-sm text-zinc-500">
              Optional, and worth the tap — this is what shows whether the app earned the sale or you did.
            </p>
          </div>
        )}
        <div className="flex justify-end gap-3">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="success"
            disabled={saving}
            onClick={() => {
              // A correction must be deliberate: blank falls back to the quote
              // value when marking won, but silently rewriting a real sale
              // amount because someone cleared the field would be wrong.
              const raw = value.trim()
              if (correcting && raw === '') {
                setError('Enter the sale amount.')
                return
              }
              const cents = raw === '' ? defaultCents : parseDollarsToCents(raw)
              if (cents === null) {
                setError('Enter a valid dollar amount.')
                return
              }
              setError(null)
              setSaving(true)
              void onConfirm(cents, winSource).finally(() => setSaving(false))
            }}
          >
            <Trophy className="h-5 w-5" aria-hidden="true" />
            {correcting ? (saving ? 'Saving…' : 'Save amount') : 'Mark won'}
          </Button>
        </div>
      </div>
    </Modal>
  )
}
