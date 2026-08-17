import { useState } from 'react'
import { Link, Navigate } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Logo, Button, Input, Field } from '../components/ui'
import { getSupabase } from '../data/supabaseClient'
import { supabaseConfigured, env } from '../lib/env'
import { useAppData } from '../data/AppDataContext'

const schema = z.object({
  email: z.string().email('Enter a valid email address'),
})

type FormValues = z.infer<typeof schema>

export default function LoginPage() {
  const { session, mode } = useAppData()
  const [sent, setSent] = useState(false)
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
      // Deliberately NOT shouldCreateUser:false. That was tried and reverted —
      // it broke real sign-ins: Supabase's OTP endpoint can reject an existing
      // but not-yet-confirmed user as "no account" (e.g. someone who requested
      // a link before but never clicked it), and there's no reliable way to
      // tell that error apart from a genuine unknown email from the message
      // text alone. Leaving this at the default (true) is what makes
      // signInWithOtp idempotent for a returning user — it does not create a
      // second account for an email that already has one, it just sends the
      // link. /signup exists as a separate, friendlier front door for new
      // owners; this page no longer tries to police who's "allowed" to sign in.
      const { error: authError } = await getSupabase().auth.signInWithOtp({
        email: values.email,
        options: { emailRedirectTo: `${env.appUrl}/app` },
      })
      if (authError) throw authError
      setSent(true)
    } catch {
      setError('Could not send the sign-in link. Please try again in a minute.')
    }
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-zinc-50 px-4 py-10">
      <Link to="/" aria-label="0Gauge Recovery home">
        <Logo className="text-3xl" />
      </Link>
      <div className="mt-8 w-full max-w-md rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
        <h1 className="text-2xl font-bold text-ink">Shop login</h1>
        <p className="mt-1 text-base text-zinc-600">
          Enter your email and we&apos;ll send you a sign-in link. No password to remember.
        </p>

        {!supabaseConfigured ? (
          <div className="mt-5 rounded-xl border border-amber-300 bg-amber-50 p-4 text-base text-amber-900">
            <p className="font-semibold">Login isn&apos;t set up on this install yet.</p>
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
        ) : sent ? (
          <div role="status" className="mt-5 rounded-xl border border-green-300 bg-green-50 p-4 text-base text-green-900">
            <p className="font-semibold">Check your email.</p>
            <p className="mt-1">We sent you a sign-in link. Open it on this device to get into your shop.</p>
          </div>
        ) : (
          <form onSubmit={handleSubmit(onSubmit)} className="mt-5 space-y-4" noValidate>
            <Field label="Email address" htmlFor="login-email" error={errors.email?.message} required>
              <Input
                id="login-email"
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
              {isSubmitting ? 'Sending…' : 'Email me a sign-in link'}
            </Button>
          </form>
        )}
      </div>
      <p className="mt-6 text-base text-zinc-600">
        New here?{' '}
        <Link to="/signup" className="font-semibold text-brand underline">
          Create your shop account
        </Link>
      </p>
      {env.demoModeEnabled ? (
        <p className="mt-2 text-base text-zinc-600">
          Just looking around?{' '}
          <Link to="/demo" className="font-semibold text-brand underline">
            Try the demo
          </Link>
        </p>
      ) : null}
    </div>
  )
}
