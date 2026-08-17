// Where a new shop actually gets created (create_shop_with_owner).
//
// Grouped into three steps' worth of sections rather than one long column of
// inputs: a shop owner filling this out on a phone between jobs needs to see
// that it ends. The brand section carries a live preview of the quote-email
// header, because "logo and colors" only means something once you can see what
// the customer will see.

import { Navigate, useNavigate } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Logo, Button, Input, Textarea, Field } from '../components/ui'
import { LogoUploadField } from '../components/LogoUploadField'
import { getSupabase } from '../data/supabaseClient'
import { useAppData } from '../data/AppDataContext'
import { useToast } from '../components/Toast'
import { errorMessage } from '../lib/errors'
import { useState } from 'react'

const schema = z.object({
  name: z.string().min(2, 'Enter your shop name'),
  phone: z.string().min(7, 'Enter the shop phone number'),
  email: z.string().email('Enter a valid shop email'),
  replyToEmail: z.string().email('Enter a valid reply-to email'),
  address: z.string().min(5, 'Enter the shop street address'),
  website: z.string().url('Enter a full URL (https://…)').or(z.literal('')),
  logoUrl: z.string().url('Enter a full image URL').or(z.literal('')),
  primaryColor: z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Pick a color'),
  quoteExpirationDays: z.coerce.number().int().min(1).max(365),
  followUpSchedule: z
    .string()
    .regex(/^\d+(\s*,\s*\d+)*$/, 'Use numbers separated by commas, like 2, 3, 5'),
  quoteDisclaimer: z.string().min(10, 'A short disclaimer is required'),
})

type FormValues = z.infer<typeof schema>

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="space-y-5 rounded-2xl border border-zinc-200 bg-white p-5">
      <div>
        <h2 className="text-xl font-bold text-ink">{title}</h2>
        {hint ? <p className="mt-1 text-base text-zinc-600">{hint}</p> : null}
      </div>
      {children}
    </section>
  )
}

export default function OnboardingPage() {
  const { session, needsOnboarding, completeOnboarding, authReady } = useAppData()
  const toast = useToast()
  const navigate = useNavigate()
  const [submitError, setSubmitError] = useState<string | null>(null)
  const {
    register,
    handleSubmit,
    setValue,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      primaryColor: '#1d4ed8',
      quoteExpirationDays: 30,
      followUpSchedule: '2, 3, 5',
      website: '',
      logoUrl: '',
      quoteDisclaimer:
        'Final pricing and compatibility may require vehicle inspection. Products and availability are subject to confirmation by the shop.',
    },
  })

  const logoUrl = watch('logoUrl')
  const primaryColor = watch('primaryColor')
  const shopName = watch('name')

  if (authReady && !session) return <Navigate to="/login" replace />
  if (session && !needsOnboarding) return <Navigate to="/app" replace />

  const onSubmit = async (values: FormValues) => {
    setSubmitError(null)
    try {
      const scheduleDays = values.followUpSchedule.split(',').map((n) => parseInt(n.trim(), 10))
      const { data, error } = await getSupabase().rpc('create_shop_with_owner', {
        p_name: values.name,
        p_phone: values.phone,
        p_email: values.email,
        p_reply_to_email: values.replyToEmail,
        p_address: values.address,
        p_website: values.website || null,
        p_logo_url: values.logoUrl || null,
        p_primary_color: values.primaryColor,
        p_default_payment_method: null,
        p_default_payment_handle: null,
        p_quote_expiration_days: values.quoteExpirationDays,
        p_follow_up_schedule_days: scheduleDays,
        p_quote_disclaimer: values.quoteDisclaimer,
      })
      if (error) throw error
      completeOnboarding(data as string)
      toast('success', 'Your shop is ready.')
      navigate('/app', { replace: true })
    } catch (err) {
      console.error('create_shop_with_owner failed', err)
      const detail = errorMessage(err)
      setSubmitError(
        detail ? `Could not create your shop: ${detail}` : 'Could not create your shop. Please check the fields and try again.',
      )
    }
  }

  return (
    <div className="min-h-screen bg-zinc-50 px-4 py-10">
      <div className="mx-auto max-w-xl">
        <Logo className="text-2xl" />
        <h1 className="mt-6 text-3xl font-black text-ink">Set up your shop</h1>
        <p className="mt-2 text-base text-zinc-600">
          This is what customers see on quotes and emails. You can change everything later in Settings.
        </p>

        <form onSubmit={handleSubmit(onSubmit)} className="mt-6 space-y-5" noValidate>
          <Section title="Your shop" hint="How customers find you and reach you back.">
            <Field label="Shop name" htmlFor="ob-name" error={errors.name?.message} required>
              <Input id="ob-name" {...register('name')} placeholder="Big Tex Audio" />
            </Field>
            <div className="grid gap-5 sm:grid-cols-2">
              <Field label="Shop phone" htmlFor="ob-phone" error={errors.phone?.message} required>
                <Input id="ob-phone" type="tel" inputMode="tel" {...register('phone')} placeholder="214-555-0100" />
              </Field>
              <Field label="Shop email" htmlFor="ob-email" error={errors.email?.message} required>
                <Input id="ob-email" type="email" {...register('email')} placeholder="shop@yourshop.com" />
              </Field>
            </div>
            <Field
              label="Reply-to email for quotes"
              htmlFor="ob-reply"
              error={errors.replyToEmail?.message}
              hint="When customers hit Reply on a quote email, it goes here."
              required
            >
              <Input id="ob-reply" type="email" {...register('replyToEmail')} />
            </Field>
            <Field label="Street address" htmlFor="ob-address" error={errors.address?.message} required>
              <Input id="ob-address" {...register('address')} placeholder="4820 Ross Ave, Dallas, TX 75204" />
            </Field>
            <Field label="Website" htmlFor="ob-website" error={errors.website?.message}>
              <Input id="ob-website" type="url" {...register('website')} placeholder="https://yourshop.com" />
            </Field>
          </Section>

          <Section title="Your brand" hint="Your logo and color go on every quote and every email you send.">
            <Field label="Logo" htmlFor="ob-logo" error={errors.logoUrl?.message}>
              <LogoUploadField
                value={logoUrl || null}
                onChange={(url) => setValue('logoUrl', url ?? '', { shouldValidate: true })}
              />
            </Field>
            <Field label="Brand color" htmlFor="ob-color" error={errors.primaryColor?.message}>
              <Input id="ob-color" type="color" className="h-14 w-24 p-1" {...register('primaryColor')} />
            </Field>

            {/* Same header treatment the quote email uses — this is a preview,
                not decoration, so it has to match what actually gets sent. */}
            <div>
              <p className="mb-2 text-sm font-semibold text-zinc-500">This is what customers will see</p>
              <div className="overflow-hidden rounded-xl border border-zinc-200">
                <div className="border-b-[3px] bg-white px-5 py-4" style={{ borderBottomColor: primaryColor }}>
                  {logoUrl ? (
                    <img src={logoUrl} alt="" className="max-h-12 max-w-56 object-contain" />
                  ) : (
                    <span className="text-xl font-black text-ink">{shopName?.trim() || 'Your shop name'}</span>
                  )}
                </div>
                <div className="space-y-3 bg-white px-5 py-4">
                  <p className="text-base text-zinc-700">Hi Marcus, here&apos;s the quote you asked for.</p>
                  <span
                    className="inline-flex rounded-lg px-6 py-3 text-base font-bold text-white"
                    style={{ backgroundColor: primaryColor }}
                  >
                    View My Quote
                  </span>
                </div>
              </div>
            </div>
          </Section>

          <Section title="Quote defaults" hint="Sensible defaults are filled in — change them any time.">
            <Field label="Quotes are good for (days)" htmlFor="ob-exp" error={errors.quoteExpirationDays?.message}>
              <Input id="ob-exp" type="number" inputMode="numeric" min={1} max={365} {...register('quoteExpirationDays')} />
            </Field>
            <Field
              label="Follow-up rhythm (days between emails)"
              htmlFor="ob-schedule"
              error={errors.followUpSchedule?.message}
              hint="Example: 2, 3, 5 = check in after 2 days, again 3 days later, again 5 days later."
            >
              <Input id="ob-schedule" {...register('followUpSchedule')} />
            </Field>
            <Field label="Quote disclaimer" htmlFor="ob-disclaimer" error={errors.quoteDisclaimer?.message}>
              <Textarea id="ob-disclaimer" rows={3} {...register('quoteDisclaimer')} />
            </Field>
          </Section>

          {submitError ? (
            <p role="alert" className="text-base font-medium text-red-700">
              {submitError}
            </p>
          ) : null}

          <Button type="submit" disabled={isSubmitting} className="w-full">
            {isSubmitting ? 'Creating your shop…' : 'Create my shop'}
          </Button>
          <p className="pb-4 text-center text-sm text-zinc-500">
            You can add financing options and your product catalog from Settings once you&apos;re in.
          </p>
        </form>
      </div>
    </div>
  )
}
