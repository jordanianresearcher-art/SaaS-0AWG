// Landing page for a clicked magic-link email — replaces the old pattern of
// letting Supabase's own /auth/v1/verify redirect straight into the app.
//
// Why this page exists: the previous flow ("worked on PC, not on phone") had
// two independent failure modes baked into it. First, many mail apps and
// corporate security scanners execute the JS on a linked page — or even fetch
// the link itself — before a human ever taps it, which silently burns a
// single-use OTP token. Second, Supabase's default confirmation URL verifies
// server-side and hands back a session via a URL fragment, which only lands
// in the browser that's loading that exact URL — fine on a desktop where you
// click your own email, unpredictable on a phone where the link can open in
// whatever app/browser the OS chooses.
//
// The fix (Supabase's own documented pattern): the email template links here
// with a bare token_hash instead of a live confirmation URL, and verification
// only happens after a real tap on this page — see the "Sign in" button
// below. A scanner that loads this page and even runs its JS still can't
// trigger verifyOtp, because that only fires from the button's onClick.
//
// Requires the shop owner to edit the Supabase "Magic Link" email template
// (Authentication → Email Templates) to link here instead of using
// {{ .ConfirmationURL }} — see README's login/signup section for the exact
// template text. One template covers both /login and /signup (both call
// signInWithOtp, so Supabase only ever sends the Magic Link template) —
// this page always lands on /app and lets RequireShop's existing
// needsOnboarding check redirect to /onboarding when appropriate, so there's
// no "next" param to get wrong.

import { useState } from 'react'
import { Link, Navigate, useSearchParams } from 'react-router-dom'
import { KeyRound } from 'lucide-react'
import { Logo, Button, LoadingBlock } from '../components/ui'
import { getSupabase } from '../data/supabaseClient'
import { supabaseConfigured } from '../lib/env'
import { useAppData } from '../data/AppDataContext'

// The Supabase email-otp types this app can plausibly receive. Any other
// value in the link is treated as malformed rather than guessed at.
const VALID_TYPES = new Set(['magiclink', 'email', 'signup', 'invite'])

export default function AuthConfirmPage() {
  const { session, mode } = useAppData()
  const [searchParams] = useSearchParams()
  const [status, setStatus] = useState<'idle' | 'verifying' | 'error'>('idle')

  // Already signed in (e.g. a re-click after success) — just go.
  if (session || mode === 'demo') return <Navigate to="/app" replace />

  const tokenHash = searchParams.get('token_hash')
  const type = searchParams.get('type')
  const linkIsWellFormed = Boolean(tokenHash) && Boolean(type) && VALID_TYPES.has(type ?? '')

  const onConfirm = async () => {
    if (!tokenHash || !type) return
    setStatus('verifying')
    try {
      const { error } = await getSupabase().auth.verifyOtp({
        token_hash: tokenHash,
        // Narrowed by linkIsWellFormed above; verifyOtp's type union covers
        // exactly VALID_TYPES plus 'recovery'/'email_change', which this app
        // never links to.
        type: type as 'magiclink' | 'email' | 'signup' | 'invite',
      })
      if (error) throw error
      // onAuthStateChange (AppDataContext) picks up the new session and
      // RequireShop sends a brand-new owner to /onboarding on its own —
      // no destination logic needs duplicating here.
    } catch {
      setStatus('error')
    }
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-zinc-50 px-4 py-10">
      <Link to="/" aria-label="0Gauge Recovery home">
        <Logo className="text-3xl" />
      </Link>
      <div className="mt-8 w-full max-w-md rounded-2xl border border-zinc-200 bg-white p-6 text-center shadow-sm">
        {!supabaseConfigured ? (
          <p className="text-base text-amber-900">Login isn&apos;t set up on this install yet.</p>
        ) : !linkIsWellFormed ? (
          <>
            <p className="text-lg font-bold text-ink">This link isn&apos;t valid</p>
            <p className="mt-2 text-base text-zinc-600">
              It may be incomplete or already used. Request a new one from{' '}
              <Link to="/login" className="font-semibold text-brand underline">
                sign in
              </Link>{' '}
              or{' '}
              <Link to="/signup" className="font-semibold text-brand underline">
                create your shop
              </Link>
              .
            </p>
          </>
        ) : status === 'verifying' ? (
          <LoadingBlock label="Signing you in…" />
        ) : status === 'error' ? (
          <>
            <p className="text-lg font-bold text-ink">That link has expired</p>
            <p className="mt-2 text-base text-zinc-600">
              Magic links are single-use and only last a little while. Head back to{' '}
              <Link to="/login" className="font-semibold text-brand underline">
                sign in
              </Link>{' '}
              for a fresh one.
            </p>
          </>
        ) : (
          <>
            <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-blue-50 text-brand">
              <KeyRound className="h-7 w-7" aria-hidden="true" />
            </span>
            <p className="mt-4 text-lg font-bold text-ink">You&apos;re almost in</p>
            <p className="mt-1 text-base text-zinc-600">Tap below to finish signing in.</p>
            <Button onClick={() => void onConfirm()} className="mt-5 w-full">
              Continue to your shop
            </Button>
          </>
        )}
      </div>
    </div>
  )
}
