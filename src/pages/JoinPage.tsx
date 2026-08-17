// Shared-device entry point: type the shop's access code and this
// phone/tablet/PC gets straight into the inventory surface for 30 days —
// no account, no password. See migration 0017's join_shop_with_access_code.
// Anyone who already has a full account should sign in at /login instead —
// this is deliberately the lower-privilege path.

import { useState } from 'react'
import { Link, Navigate, useNavigate } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Logo, Button, Input, Field } from '../components/ui'
import { getSupabase } from '../data/supabaseClient'
import { supabaseConfigured, env } from '../lib/env'
import { useAppData } from '../data/AppDataContext'

const schema = z.object({
  code: z.string().trim().min(4, 'Enter the shop’s access code'),
  deviceName: z.string().trim().max(60).optional(),
})

type FormValues = z.infer<typeof schema>

export default function JoinPage() {
  const { session, mode, completeJoin } = useAppData()
  const navigate = useNavigate()
  const [error, setError] = useState<string | null>(null)
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({ resolver: zodResolver(schema) })

  // A device that already has a full account or is already in (demo or a
  // real shop session) doesn't need this page.
  if (session || mode) return <Navigate to="/app" replace />

  const onSubmit = async (values: FormValues) => {
    setError(null)
    try {
      const supabase = getSupabase()
      // Anonymous sign-in must be enabled in this Supabase project's Auth
      // settings — a disabled-provider error is the most likely failure
      // here, distinct from a wrong code.
      const { error: authError } = await supabase.auth.signInAnonymously()
      if (authError) throw authError

      const { data, error: joinError } = await supabase.rpc('join_shop_with_access_code', {
        p_code: values.code.trim(),
        p_device_name: values.deviceName?.trim() || null,
      })
      if (joinError) throw joinError

      completeJoin(data as string)
      navigate('/app/inventory', { replace: true })
    } catch {
      // Same generic message whether the code is wrong, rate-limited, or
      // anonymous sign-in isn't enabled — see the RPC's own comment for why
      // wrong-vs-rate-limited stays indistinguishable to the client.
      setError(
        "That code didn't work. Double-check it with the shop owner, or ask them to confirm anonymous sign-in is enabled for this shop.",
      )
    }
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-zinc-50 px-4 py-10">
      <Logo className="text-3xl" />
      <div className="mt-8 w-full max-w-md rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
        <h1 className="text-2xl font-bold text-ink">Join with a shop code</h1>
        <p className="mt-1 text-base text-zinc-600">
          For scanning and tracking inventory on a shared phone, tablet, or PC — no account needed. Ask a shop
          owner or manager for the code (Settings → Shared device access).
        </p>

        {!supabaseConfigured ? (
          <div className="mt-5 rounded-xl border border-amber-300 bg-amber-50 p-4 text-base text-amber-900">
            <p className="font-semibold">This install isn&apos;t connected to a shop yet.</p>
            <p className="mt-1">
              An administrator needs to connect Supabase (see the README).
              {env.demoModeEnabled ? ' You can try the demo instead from the home page.' : ''}
            </p>
          </div>
        ) : (
          <form onSubmit={handleSubmit(onSubmit)} className="mt-5 space-y-4" noValidate>
            <Field label="Shop access code" htmlFor="join-code" error={errors.code?.message} required>
              <Input id="join-code" autoComplete="off" autoCapitalize="characters" {...register('code')} />
            </Field>
            <Field label="Name this device" htmlFor="join-device-name" hint="e.g. “Front counter iPad” — helps the shop see who counted what.">
              <Input id="join-device-name" autoComplete="off" {...register('deviceName')} />
            </Field>
            {error ? (
              <p role="alert" className="text-sm font-medium text-red-700">
                {error}
              </p>
            ) : null}
            <Button type="submit" className="w-full" disabled={isSubmitting}>
              {isSubmitting ? 'Joining…' : 'Join'}
            </Button>
          </form>
        )}

        <p className="mt-5 text-center text-sm text-zinc-500">
          Have a full account instead?{' '}
          <Link to="/login" className="font-semibold text-brand underline">
            Sign in
          </Link>
        </p>
      </div>
    </div>
  )
}
