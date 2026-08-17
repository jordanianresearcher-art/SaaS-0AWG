// Self-serve shop signup.
//
// Auth-wise this is the same magic link as /login — Supabase's signInWithOtp
// creates the user when one doesn't exist. What makes it a *signup* is where it
// sends you afterwards: /onboarding, where the shop record is actually created.
// /login sends existing owners straight to /app instead.
//
// Splitting the two pages matters for a reason that isn't technical: a shop
// owner arriving from a sales pitch needs to see a door that says "create an
// account". A single "Shop login" page reads as members-only and turns them
// away before they ever type an email.

import { useState } from 'react'
import { Link, Navigate } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Check } from 'lucide-react'
import { Logo, Button, Input, Field } from '../components/ui'
import { getSupabase } from '../data/supabaseClient'
import { supabaseConfigured, env } from '../lib/env'
import { useAppData } from '../data/AppDataContext'

const schema = z.object({
  email: z.string().email('Enter a valid email address'),
})

type FormValues = z.infer<typeof schema>

const WHAT_YOU_GET = [
  'Send branded quotes by email in under a minute',
  'See exactly who opened their quote and when',
  'Financing links and one-tap booking on every quote',
]

export default function SignupPage() {
  const { session, mode } = useAppData()
  const [sentTo, setSentTo] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({ resolver: zodResolver(schema) })

  if (session || mode === 'demo') return <Navigate to="/app" replace />

  const onSubmit = async (values: FormValues) => {
    setError(null)
    try {
      const { error: authError } = await getSupabase().auth.signInWithOtp({
        email: values.email,
        options: {
          // Land on onboarding, not /app: a brand-new user has no shop yet, and
          // /app would just bounce them here anyway.
          emailRedirectTo: `${env.appUrl}/onboarding`,
          shouldCreateUser: true,
        },
      })
      if (authError) throw authError
      setSentTo(values.email)
    } catch {
      setError('Could not send the link. Please try again in a minute.')
    }
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-zinc-50 px-4 py-10">
      <Link to="/" aria-label="0Gauge Recovery home">
        <Logo className="text-3xl" />
      </Link>
      <div className="mt-8 w-full max-w-md rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
        <h1 className="text-2xl font-bold text-ink">Create your shop account</h1>
        <p className="mt-1 text-base text-zinc-600">
          Enter your email and we&apos;ll send you a link to get started. No password to remember.
        </p>

        {!supabaseConfigured ? (
          <div className="mt-5 rounded-xl border border-amber-300 bg-amber-50 p-4 text-base text-amber-900">
            <p className="font-semibold">Sign-up isn&apos;t set up on this install yet.</p>
            <p className="mt-1">
              An administrator needs to connect Supabase (see the README). In the meantime you can{' '}
              {env.demoModeEnabled ? (
                <Link to="/demo" className="font-semibold text-brand underline">
                  try the demo
                </Link>
              ) : (
                'try the demo'
              )}{' '}
              with sample data.
            </p>
          </div>
        ) : sentTo ? (
          <div role="status" className="mt-5 rounded-xl border border-green-300 bg-green-50 p-4 text-base text-green-900">
            <p className="font-semibold">Check your email.</p>
            <p className="mt-1">
              We sent a link to <strong>{sentTo}</strong>. Open it on this device and we&apos;ll walk you through setting
              up your shop — takes about two minutes.
            </p>
          </div>
        ) : (
          <>
            <ul className="mt-5 space-y-2">
              {WHAT_YOU_GET.map((line) => (
                <li key={line} className="flex gap-2 text-base text-zinc-700">
                  <Check className="mt-1 h-4 w-4 shrink-0 text-brand" aria-hidden="true" />
                  {line}
                </li>
              ))}
            </ul>
            <form onSubmit={handleSubmit(onSubmit)} className="mt-5 space-y-4" noValidate>
              <Field label="Your email" htmlFor="signup-email" error={errors.email?.message} required>
                <Input
                  id="signup-email"
                  type="email"
                  autoComplete="email"
                  inputMode="email"
                  placeholder="you@yourshop.com"
                  {...register('email')}
                />
              </Field>
              {error ? (
                <p role="alert" className="text-sm font-medium text-red-700">
                  {error}
                </p>
              ) : null}
              <Button type="submit" disabled={isSubmitting} className="w-full">
                {isSubmitting ? 'Sending…' : 'Create my account'}
              </Button>
            </form>
          </>
        )}
      </div>
      <p className="mt-6 text-base text-zinc-600">
        Already set up?{' '}
        <Link to="/login" className="font-semibold text-brand underline">
          Sign in
        </Link>
      </p>
    </div>
  )
}
