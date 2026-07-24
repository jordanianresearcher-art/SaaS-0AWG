import { beforeEach, describe, expect, it } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import PublicQuotePage from './PublicQuotePage'
import { DemoRepository } from '../data/demoRepository'

// Drives the real customer-facing flow against the demo repository in jsdom.

function renderPage(token: string) {
  return render(
    <MemoryRouter initialEntries={[`/q/${token}`]}>
      <Routes>
        <Route path="/q/:publicToken" element={<PublicQuotePage />} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('PublicQuotePage', () => {
  let repo: DemoRepository
  let token: string

  beforeEach(async () => {
    localStorage.clear()
    sessionStorage.clear()
    repo = new DemoRepository() // seeds localStorage
    const bundles = await repo.listQuoteBundles()
    token = bundles.find((b) => b.quote.status === 'viewed')!.quote.publicToken
  })

  it('shows the shop, first name, vehicle, and options — never private data', async () => {
    renderPage(token)
    expect(await screen.findByText(/here's your quote/i)).toBeInTheDocument()
    expect(screen.getByText('Big Tex Audio')).toBeInTheDocument()
    expect(screen.getByText(/2022 Ford F-150/)).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Better' })).toBeInTheDocument()
    // Sanitized: the demo customer is "Marcus Bell" — last name must not render.
    expect(screen.queryByText(/Bell/)).not.toBeInTheDocument()
    expect(screen.queryByText(/marcus\.bell@example\.com/)).not.toBeInTheDocument()
  })

  it('records the view once per browser session', async () => {
    renderPage(token)
    await screen.findByText(/here's your quote/i)
    await waitFor(async () => {
      const fresh = new DemoRepository()
      const bundles = await fresh.listQuoteBundles()
      const target = bundles.find((b) => b.quote.publicToken === token)!
      const views = target.events.filter((e) => e.eventType === 'quote_viewed')
      expect(views.length).toBeGreaterThanOrEqual(2) // 1 seeded + 1 new
    })
    expect(sessionStorage.getItem(`0g-viewed-${token}`)).toBe('1')
  })

  it('lets the customer submit a response and shows confirmation', async () => {
    const user = userEvent.setup()
    renderPage(token)
    await screen.findByText(/here's your quote/i)

    await user.click(screen.getByRole('button', { name: /i'm ready to book/i }))
    await user.type(screen.getByLabelText(/anything to add/i), 'Saturday works best')
    await user.click(screen.getByRole('button', { name: /send to the shop/i }))

    expect(await screen.findByText(/got it — thanks!/i)).toBeInTheDocument()

    const fresh = new DemoRepository()
    const bundles = await fresh.listQuoteBundles()
    const target = bundles.find((b) => b.quote.publicToken === token)!
    expect(target.responses[0].responseType).toBe('ready_to_book')
    expect(target.responses[0].message).toBe('Saturday works best')
    expect(target.quote.status).toBe('responded')
  })

  it('blocks duplicate submissions in the same browser session', async () => {
    sessionStorage.setItem(`0g-responded-${token}`, 'ready_to_book')
    renderPage(token)
    expect(await screen.findByText(/got it — thanks!/i)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /send to the shop/i })).not.toBeInTheDocument()
  })

  it('lets the customer stop follow-up emails', async () => {
    const user = userEvent.setup()
    renderPage(token)
    await screen.findByText(/here's your quote/i)

    await user.click(screen.getByRole('button', { name: /stop follow-up emails/i }))
    expect(await screen.findByText(/won't get any more follow-up emails/i)).toBeInTheDocument()

    const fresh = new DemoRepository()
    const bundles = await fresh.listQuoteBundles()
    const target = bundles.find((b) => b.quote.publicToken === token)!
    expect(target.customer.emailOptOutAt).toBeTruthy()
    expect(target.quote.emailFollowUpAllowed).toBe(false)
  })

  it('shows a friendly not-found state for bad tokens', async () => {
    renderPage('not-a-real-token')
    // This path re-seeds and scans the full demo dataset before concluding
    // "not found," which can run close to the default 1s async-util timeout
    // under sandbox CPU contention — give it more headroom than the default.
    expect(await screen.findByText(/quote not found/i, {}, { timeout: 5000 })).toBeInTheDocument()
  })
})
