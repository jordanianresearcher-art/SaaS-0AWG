import { useEffect } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { RotateCcw } from 'lucide-react'
import { useAppData, useRepo } from '../../data/AppDataContext'
import { useToast } from '../../components/Toast'
import { Button, Card, Field, Input, LoadingBlock, Textarea } from '../../components/ui'

const schema = z.object({
  name: z.string().min(2, 'Enter your shop name'),
  phone: z.string().min(7, 'Enter the shop phone number'),
  email: z.string().email('Enter a valid shop email'),
  replyToEmail: z.string().email('Enter a valid reply-to email'),
  address: z.string().min(5, 'Enter the shop street address'),
  website: z.string().url('Enter a full URL (https://…)').or(z.literal('')),
  logoUrl: z.string().url('Enter a full image URL').or(z.literal('')),
  primaryColor: z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Pick a color'),
  defaultPaymentLink: z.string().url('Enter a full URL (https://…)').or(z.literal('')),
  quoteExpirationDays: z.coerce.number().int().min(1, 'At least 1 day').max(365, 'No more than a year'),
  followUpSchedule: z
    .string()
    .regex(/^\d+(\s*,\s*\d+)*$/, 'Use numbers separated by commas, like 2, 3, 5'),
  quoteDisclaimer: z.string().min(10, 'A short disclaimer is required'),
})

type FormValues = z.infer<typeof schema>

export default function SettingsPage() {
  const { shop, mode, refresh, resetDemo } = useAppData()
  const repo = useRepo()
  const toast = useToast()

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting, isDirty },
  } = useForm<FormValues>({ resolver: zodResolver(schema) })

  useEffect(() => {
    if (shop) {
      reset({
        name: shop.name,
        phone: shop.phone,
        email: shop.email,
        replyToEmail: shop.replyToEmail,
        address: shop.address,
        website: shop.website ?? '',
        logoUrl: shop.logoUrl ?? '',
        primaryColor: shop.primaryColor,
        defaultPaymentLink: shop.defaultPaymentLink ?? '',
        quoteExpirationDays: shop.quoteExpirationDays,
        followUpSchedule: shop.followUpScheduleDays.join(', '),
        quoteDisclaimer: shop.quoteDisclaimer,
      })
    }
  }, [shop, reset])

  if (!shop) return <LoadingBlock label="Loading settings…" />

  const onSubmit = async (values: FormValues) => {
    try {
      await repo.updateShop({
        name: values.name,
        phone: values.phone,
        email: values.email,
        replyToEmail: values.replyToEmail,
        address: values.address,
        website: values.website || null,
        logoUrl: values.logoUrl || null,
        primaryColor: values.primaryColor,
        defaultPaymentLink: values.defaultPaymentLink || null,
        quoteExpirationDays: values.quoteExpirationDays,
        followUpScheduleDays: values.followUpSchedule.split(',').map((n) => parseInt(n.trim(), 10)),
        quoteDisclaimer: values.quoteDisclaimer,
      })
      await refresh()
      toast('success', 'Settings saved.')
    } catch {
      toast('error', 'Could not save settings. Please try again.')
    }
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="text-3xl font-black text-ink">Settings</h1>
        <p className="mt-1 text-base text-zinc-600">This is what customers see on quotes and in emails.</p>
      </div>

      <form onSubmit={handleSubmit(onSubmit)} noValidate>
        <Card className="space-y-4">
          <Field label="Shop name" htmlFor="s-name" error={errors.name?.message} required>
            <Input id="s-name" {...register('name')} />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Shop phone" htmlFor="s-phone" error={errors.phone?.message} required>
              <Input id="s-phone" type="tel" {...register('phone')} />
            </Field>
            <Field label="Shop email" htmlFor="s-email" error={errors.email?.message} required>
              <Input id="s-email" type="email" {...register('email')} />
            </Field>
          </div>
          <Field
            label="Reply-to email for quotes"
            htmlFor="s-reply"
            error={errors.replyToEmail?.message}
            hint="When customers reply to a quote email, it goes here."
            required
          >
            <Input id="s-reply" type="email" {...register('replyToEmail')} />
          </Field>
          <Field label="Street address" htmlFor="s-address" error={errors.address?.message} required>
            <Input id="s-address" {...register('address')} />
          </Field>
          <Field label="Website" htmlFor="s-website" error={errors.website?.message}>
            <Input id="s-website" type="url" {...register('website')} />
          </Field>
          <Field label="Logo image URL" htmlFor="s-logo" error={errors.logoUrl?.message} hint="Optional. Shown on quote emails and the public quote page.">
            <Input id="s-logo" type="url" {...register('logoUrl')} />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Brand color" htmlFor="s-color" error={errors.primaryColor?.message}>
              <Input id="s-color" type="color" className="h-14 w-24 p-1" {...register('primaryColor')} />
            </Field>
            <Field label="Quotes are good for (days)" htmlFor="s-exp" error={errors.quoteExpirationDays?.message}>
              <Input id="s-exp" type="number" inputMode="numeric" {...register('quoteExpirationDays')} />
            </Field>
          </div>
          <Field label="Deposit / payment link" htmlFor="s-pay" error={errors.defaultPaymentLink?.message} hint="Customers use this to put down a deposit.">
            <Input id="s-pay" type="url" {...register('defaultPaymentLink')} />
          </Field>
          <Field
            label="Follow-up rhythm (days between emails)"
            htmlFor="s-schedule"
            error={errors.followUpSchedule?.message}
            hint="Example: 2, 3, 5 = check in after 2 days, again 3 days later, again 5 days later."
          >
            <Input id="s-schedule" {...register('followUpSchedule')} />
          </Field>
          <Field label="Quote disclaimer" htmlFor="s-disclaimer" error={errors.quoteDisclaimer?.message}>
            <Textarea id="s-disclaimer" rows={3} {...register('quoteDisclaimer')} />
          </Field>
          <Button type="submit" disabled={isSubmitting || !isDirty} className="w-full sm:w-auto">
            {isSubmitting ? 'Saving…' : 'Save settings'}
          </Button>
        </Card>
      </form>

      {mode === 'demo' ? (
        <Card className="space-y-3">
          <h2 className="text-xl font-bold text-ink">Demo data</h2>
          <p className="text-base text-zinc-600">
            Put the sample shop back exactly how it started. Any quotes or changes you made in the demo will be erased.
          </p>
          <Button
            variant="danger"
            onClick={() => {
              resetDemo()
              toast('success', 'Demo data has been reset.')
            }}
          >
            <RotateCcw className="h-5 w-5" aria-hidden="true" /> Reset demo data
          </Button>
        </Card>
      ) : null}
    </div>
  )
}
