import { Navigate, useNavigate } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Logo, Button, Input, Select, Textarea, Field } from '../components/ui'
import { getSupabase } from '../data/supabaseClient'
import { useAppData } from '../data/AppDataContext'
import { useToast } from '../components/Toast'
import { useState } from 'react'
import { PAYMENT_METHOD_INFO } from '../lib/paymentMethods'
import type { PaymentMethod } from '../types'

const PAYMENT_METHODS = Object.keys(PAYMENT_METHOD_INFO) as PaymentMethod[]

const schema = z
  .object({
    name: z.string().min(2, 'Enter your shop name'),
    phone: z.string().min(7, 'Enter the shop phone number'),
    email: z.string().email('Enter a valid shop email'),
    replyToEmail: z.string().email('Enter a valid reply-to email'),
    address: z.string().min(5, 'Enter the shop street address'),
    website: z.string().url('Enter a full URL (https://…)').or(z.literal('')),
    logoUrl: z.string().url('Enter a full image URL').or(z.literal('')),
    primaryColor: z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Pick a color'),
    defaultPaymentMethod: z.enum(['none', 'link', 'zelle', 'cashapp', 'venmo', 'paypal']),
    defaultPaymentHandle: z.string(),
    quoteExpirationDays: z.coerce.number().int().min(1).max(365),
    followUpSchedule: z
      .string()
      .regex(/^\d+(\s*,\s*\d+)*$/, 'Use numbers separated by commas, like 2, 3, 5'),
    quoteDisclaimer: z.string().min(10, 'A short disclaimer is required'),
  })
  .superRefine((values, ctx) => {
    if (values.defaultPaymentMethod === 'none') return
    if (!values.defaultPaymentHandle.trim()) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['defaultPaymentHandle'], message: 'Enter your payment info' })
      return
    }
    if (values.defaultPaymentMethod === 'link') {
      try {
        new URL(values.defaultPaymentHandle.trim())
      } catch {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['defaultPaymentHandle'],
          message: 'Enter a full URL (https://…)',
        })
      }
    }
  })

type FormValues = z.infer<typeof schema>

export default function OnboardingPage() {
  const { session, needsOnboarding, completeOnboarding, authReady } = useAppData()
  const toast = useToast()
  const navigate = useNavigate()
  const [submitError, setSubmitError] = useState<string | null>(null)
  const {
    register,
    handleSubmit,
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
      defaultPaymentMethod: 'none',
      defaultPaymentHandle: '',
      quoteDisclaimer:
        'Final pricing and compatibility may require vehicle inspection. Products and availability are subject to confirmation by the shop.',
    },
  })

  const watchedPaymentMethod = watch('defaultPaymentMethod')

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
        p_default_payment_method: values.defaultPaymentMethod === 'none' ? null : values.defaultPaymentMethod,
        p_default_payment_handle:
          values.defaultPaymentMethod === 'none' ? null : values.defaultPaymentHandle.trim(),
        p_quote_expiration_days: values.quoteExpirationDays,
        p_follow_up_schedule_days: scheduleDays,
        p_quote_disclaimer: values.quoteDisclaimer,
      })
      if (error) throw error
      completeOnboarding(data as string)
      toast('success', 'Your shop is ready.')
      navigate('/app', { replace: true })
    } catch {
      setSubmitError('Could not create your shop. Please check the fields and try again.')
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
        <form onSubmit={handleSubmit(onSubmit)} className="mt-6 space-y-5 rounded-2xl border border-zinc-200 bg-white p-5" noValidate>
          <Field label="Shop name" htmlFor="ob-name" error={errors.name?.message} required>
            <Input id="ob-name" {...register('name')} placeholder="Big Tex Audio" />
          </Field>
          <Field label="Shop phone" htmlFor="ob-phone" error={errors.phone?.message} required>
            <Input id="ob-phone" type="tel" inputMode="tel" {...register('phone')} placeholder="214-555-0100" />
          </Field>
          <Field label="Shop email" htmlFor="ob-email" error={errors.email?.message} required>
            <Input id="ob-email" type="email" {...register('email')} placeholder="shop@yourshop.com" />
          </Field>
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
          <Field label="Logo image URL" htmlFor="ob-logo" error={errors.logoUrl?.message} hint="Optional. A link to your logo image.">
            <Input id="ob-logo" type="url" {...register('logoUrl')} />
          </Field>
          <Field label="Brand color" htmlFor="ob-color" error={errors.primaryColor?.message}>
            <Input id="ob-color" type="color" className="h-14 w-24 p-1" {...register('primaryColor')} />
          </Field>
          <Field label="How do customers pay a deposit?" htmlFor="ob-pay-method" hint="Optional — you can set this up later in Settings.">
            <Select id="ob-pay-method" {...register('defaultPaymentMethod')}>
              <option value="none">No default set</option>
              {PAYMENT_METHODS.map((m) => (
                <option key={m} value={m}>
                  {PAYMENT_METHOD_INFO[m].label}
                </option>
              ))}
            </Select>
          </Field>
          {watchedPaymentMethod && watchedPaymentMethod !== 'none' ? (
            <Field
              label={PAYMENT_METHOD_INFO[watchedPaymentMethod].handleLabel}
              htmlFor="ob-pay-handle"
              error={errors.defaultPaymentHandle?.message}
              hint={PAYMENT_METHOD_INFO[watchedPaymentMethod].hint}
            >
              <Input
                id="ob-pay-handle"
                placeholder={PAYMENT_METHOD_INFO[watchedPaymentMethod].placeholder}
                {...register('defaultPaymentHandle')}
              />
            </Field>
          ) : null}
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
          {submitError ? (
            <p role="alert" className="text-base font-medium text-red-700">
              {submitError}
            </p>
          ) : null}
          <Button type="submit" disabled={isSubmitting} className="w-full">
            {isSubmitting ? 'Creating your shop…' : 'Create my shop'}
          </Button>
        </form>
      </div>
    </div>
  )
}
