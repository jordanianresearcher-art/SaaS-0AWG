import { useMemo, useState } from 'react'
import { Mail, Send } from 'lucide-react'
import type { QuoteBundle, TemplateType } from '../types'
import { useAppData } from '../data/AppDataContext'
import { renderEmail } from '../lib/emailTemplates'
import { checkSendEligibility } from '../lib/eligibility'
import { TEMPLATE_CONFIG } from '../lib/status'
import { env } from '../lib/env'
import { Button, Modal, Select } from './ui'
import { useToast } from './Toast'

export function publicQuoteUrl(publicToken: string): string {
  const base = typeof window !== 'undefined' ? window.location.origin : env.appUrl
  return `${base}/q/${publicToken}`
}

/**
 * Preview-then-send for every template. Demo mode records an honest
 * "demo email" event; production goes through the Edge Function. Nothing is
 * ever shown as sent unless the repository confirmed it.
 */
export function EmailPreviewModal({
  bundle,
  initialTemplate,
  open,
  onClose,
  onSent,
}: {
  bundle: QuoteBundle
  initialTemplate: TemplateType
  open: boolean
  onClose: () => void
  onSent: () => void
}) {
  const { repo, shop, mode } = useAppData()
  const toast = useToast()
  const [template, setTemplate] = useState<TemplateType>(initialTemplate)
  const [sending, setSending] = useState(false)
  const [sendError, setSendError] = useState<string | null>(null)

  const eligibility = checkSendEligibility(bundle.customer, bundle.quote)

  const rendered = useMemo(() => {
    if (!shop) return null
    return renderEmail(template, {
      shop,
      customer: bundle.customer,
      quote: bundle.quote,
      options: bundle.options,
      publicUrl: publicQuoteUrl(bundle.quote.publicToken),
      optOutUrl: `${publicQuoteUrl(bundle.quote.publicToken)}?stop=1`,
    })
  }, [shop, template, bundle])

  const handleSend = async () => {
    if (!repo || !rendered) return
    setSending(true)
    setSendError(null)
    try {
      const result = await repo.sendEmail(bundle.quote.id, template)
      if (result.ok) {
        toast('success', result.message)
        onSent()
        onClose()
      } else {
        setSendError(result.message)
      }
    } catch (err) {
      console.error('sendEmail failed', err)
      setSendError('Something went wrong while sending. The email was not sent.')
    } finally {
      setSending(false)
    }
  }

  const mailtoHref = rendered
    ? `mailto:${encodeURIComponent(bundle.customer.email)}?subject=${encodeURIComponent(rendered.subject)}&body=${encodeURIComponent(rendered.text)}`
    : '#'

  return (
    <Modal open={open} onClose={onClose} title="Email preview" wide>
      <div className="space-y-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <div className="flex-1">
            <label htmlFor="email-template" className="mb-1.5 block text-base font-semibold text-ink">
              Which email?
            </label>
            <Select id="email-template" value={template} onChange={(e) => setTemplate(e.target.value as TemplateType)}>
              {Object.entries(TEMPLATE_CONFIG).map(([value, config]) => (
                <option key={value} value={value}>
                  {config.label}
                </option>
              ))}
            </Select>
          </div>
          <p className="text-base text-zinc-600">
            To: <span className="font-semibold text-ink">{bundle.customer.email}</span>
          </p>
        </div>

        {rendered ? (
          <>
            <div className="rounded-xl border border-zinc-200">
              <div className="border-b border-zinc-200 px-4 py-3">
                <p className="text-sm font-semibold tracking-wide text-zinc-500 uppercase">Subject</p>
                <p className="text-base font-semibold text-ink">{rendered.subject}</p>
              </div>
              <iframe
                title="Email preview"
                srcDoc={rendered.html}
                className="h-96 w-full rounded-b-xl bg-zinc-100"
                sandbox=""
              />
            </div>

            {!eligibility.allowed ? (
              <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-base font-medium text-red-800">
                {eligibility.reason}
              </div>
            ) : (
              <>
                {mode === 'demo' ? (
                  <p className="rounded-xl bg-amber-50 p-3 text-sm font-medium text-amber-900">
                    Demo mode: pressing Send records a “Demo email sent” event. No real email goes out.
                  </p>
                ) : null}
                {sendError ? (
                  <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-base font-medium text-red-800">
                    <p>{sendError}</p>
                    <p className="mt-2 text-sm font-normal">
                      You can still send it from your own email app:{' '}
                      <a href={mailtoHref} className="font-semibold underline">
                        open in email app
                      </a>
                    </p>
                  </div>
                ) : null}
                <div className="flex flex-col gap-3 sm:flex-row sm:justify-end">
                  <Button variant="secondary" onClick={onClose}>
                    Close
                  </Button>
                  <a
                    href={mailtoHref}
                    className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl border border-zinc-300 bg-white px-4 text-base font-semibold text-ink hover:bg-zinc-50"
                  >
                    <Mail className="h-5 w-5" aria-hidden="true" /> Open in email app
                  </a>
                  <Button onClick={handleSend} disabled={sending}>
                    <Send className="h-5 w-5" aria-hidden="true" />
                    {sending ? 'Sending…' : mode === 'demo' ? 'Send demo email' : 'Send email'}
                  </Button>
                </div>
              </>
            )}
          </>
        ) : null}
      </div>
    </Modal>
  )
}
