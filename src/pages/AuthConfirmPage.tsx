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
import { Check, Copy, ExternalLink, KeyRound } from 'lucide-react'
import { Logo, Button, LoadingBlock } from '../components/ui'
import { getSupabase } from '../data/supabaseClient'
import { supabaseConfigured } from '../lib/env'
import { useAppData } from '../data/AppDataContext'
import { currentInAppBrowser } from '../lib/inAppBrowser'

// The Supabase email-otp types this app can plausibly receive. Any other
// value in the link is treated as malformed rather than guessed at.
const VALID_TYPES = new Set(['magiclink', 'email', 'signup', 'invite'])

export default function AuthConfirmPage() {
  const { session, mode } = useAppData()
  const [searchParams] = useSearchParams()
  const [status, setStatus] = useState<'idle' | 'verifying' | 'error'>('idle')
  const [copied, setCopied] = useState(false)
  const inApp = currentInAppBrowser()

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 4000)
    } catch {
      // Clipboard access is frequently blocked inside embedded browsers, which
      // is exactly where this button matters most — so the link is also
      // rendered as selectable text below and never depends on this working.
      setCopied(false)
    }
  }

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
            <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-brand-tint text-brand">
              <KeyRound className="h-7 w-7" aria-hidden="true" />
            </span>
            <p className="mt-4 text-lg font-bold text-ink">You&apos;re almost in</p>

            {/* The link has not been spent yet — verifying only happens on the
                tap below — so it can still be finished somewhere else. That is
                the whole reason this offer can exist: a session created in an
                app's built-in browser lives only there, and no web API can
                move it to Chrome or Safari afterwards. Better to land in the
                right browser than to sign in twice. */}
            {inApp.isInApp ? (
              <div className="mt-3 rounded-xl border border-amber-300 bg-amber-50 p-4 text-left">
                <p className="text-base font-semibold text-amber-900">
                  You&apos;re in {inApp.app === 'this app' ? 'an app' : `${inApp.app}`}&apos;s built-in browser
                </p>
                <p className="mt-1 text-sm text-amber-800">
                  Signing in here only signs you in here — you&apos;d be signed out again in Chrome or Safari.
                  Open this link in your normal browser first and you&apos;ll stay signed in.
                </p>
                <Button variant="secondary" className="mt-3 w-full" onClick={() => void copyLink()}>
                  {copied ? (
                    <>
                      <Check className="h-5 w-5" aria-hidden="true" /> Link copied — paste it in your browser
                    </>
                  ) : (
                    <>
                      <Copy className="h-5 w-5" aria-hidden="true" /> Copy this link
                    </>
                  )}
                </Button>
                <p className="mt-2 text-xs text-amber-800">
                  Or use this app&apos;s menu (⋮) and choose &ldquo;Open in browser&rdquo;.
                </p>
              </div>
            ) : (
              <p className="mt-1 text-base text-zinc-600">Tap below to finish signing in.</p>
            )}

            <Button
              onClick={() => void onConfirm()}
              variant={inApp.isInApp ? 'secondary' : 'primary'}
              className="mt-4 w-full"
            >
              {inApp.isInApp ? 'Sign in here anyway' : 'Continue to your shop'}
            </Button>

            {/* Always available, never only on detection: an iOS app opening
                links in SFSafariViewController is close to indistinguishable
                from Safari, so the escape hatch cannot depend on spotting it. */}
            {!inApp.isInApp ? (
              <details className="mt-4 text-left">
                <summary className="cursor-pointer text-sm font-semibold text-zinc-500">
                  Opened this inside an app?
                </summary>
                <p className="mt-2 text-sm text-zinc-600">
                  Signing in from an app&apos;s built-in browser only signs you in there. Copy this link and
                  paste it into Chrome or Safari to stay signed in.
                </p>
                <Button variant="secondary" className="mt-2 w-full" onClick={() => void copyLink()}>
                  {copied ? (
                    <>
                      <Check className="h-5 w-5" aria-hidden="true" /> Copied
                    </>
                  ) : (
                    <>
                      <ExternalLink className="h-5 w-5" aria-hidden="true" /> Copy this link
                    </>
                  )}
                </Button>
              </details>
            ) : null}
          </>
        )}
      </div>
    </div>
  )
}
