import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import AuthConfirmPage from './AuthConfirmPage'

const mockVerifyOtp = vi.fn()
const mockUseAppData = vi.fn()

vi.mock('../data/supabaseClient', () => ({
  getSupabase: () => ({ auth: { verifyOtp: mockVerifyOtp } }),
}))
vi.mock('../lib/env', () => ({ supabaseConfigured: true }))
vi.mock('../data/AppDataContext', () => ({ useAppData: () => mockUseAppData() }))

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/auth/confirm" element={<AuthConfirmPage />} />
        <Route path="/app" element={<div>App home</div>} />
        <Route path="/login" element={<div>Login page</div>} />
      </Routes>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  mockVerifyOtp.mockReset()
  mockUseAppData.mockReset()
  mockUseAppData.mockReturnValue({ session: null, mode: null })
})

describe('AuthConfirmPage', () => {
  it('rejects a link missing token_hash or type instead of guessing', () => {
    renderAt('/auth/confirm?type=magiclink')
    expect(screen.getByText(/link isn.t valid/i)).toBeInTheDocument()
    expect(mockVerifyOtp).not.toHaveBeenCalled()
  })

  it('does not call verifyOtp until the button is tapped (defeats email-scanner prefetch)', () => {
    renderAt('/auth/confirm?token_hash=abc123&type=magiclink')
    expect(screen.getByText(/you.re almost in/i)).toBeInTheDocument()
    expect(mockVerifyOtp).not.toHaveBeenCalled()
  })

  it('verifies with the exact token_hash and type from the URL on tap', async () => {
    mockVerifyOtp.mockResolvedValue({ error: null })
    renderAt('/auth/confirm?token_hash=abc123&type=magiclink')
    fireEvent.click(screen.getByRole('button', { name: /continue to your shop/i }))
    await waitFor(() =>
      expect(mockVerifyOtp).toHaveBeenCalledWith({ token_hash: 'abc123', type: 'magiclink' }),
    )
  })

  it('shows an expired-link message on verification failure, not a generic error', async () => {
    mockVerifyOtp.mockResolvedValue({ error: new Error('Token has expired or is invalid') })
    renderAt('/auth/confirm?token_hash=abc123&type=magiclink')
    fireEvent.click(screen.getByRole('button', { name: /continue to your shop/i }))
    await waitFor(() => expect(screen.getByText(/link has expired/i)).toBeInTheDocument())
  })

  it('redirects to /app immediately once a session already exists (re-click after success)', () => {
    mockUseAppData.mockReturnValue({ session: { user: { id: 'u1' } }, mode: 'production' })
    renderAt('/auth/confirm?token_hash=abc123&type=magiclink')
    expect(screen.getByText('App home')).toBeInTheDocument()
  })

  it('treats an unrecognized type value as malformed rather than passing it through', () => {
    renderAt('/auth/confirm?token_hash=abc123&type=recovery')
    expect(screen.getByText(/link isn.t valid/i)).toBeInTheDocument()
  })
})
