import { useNavigate } from 'react-router-dom'
import { useFieldArray, useForm, type Control, type FieldErrors, type UseFormRegister } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { addDays, format } from 'date-fns'
import { Plus, Trash2 } from 'lucide-react'
import { useAppData, useRepo } from '../../data/AppDataContext'
import { useToast } from '../../components/Toast'
import { Button, Card, Field, Input, Select, Textarea } from '../../components/ui'
import { parseDollarsToCents } from '../../lib/format'
import type { NewQuoteInput } from '../../data/repository'
import type { Tier } from '../../types'

const itemSchema = z.object({
  brand: z.string(),
  model: z.string(),
  name: z.string().min(1, 'What is this item?'),
  quantity: z.coerce.number().int().min(1, 'At least 1'),
})

const optionSchema = z.object({
  tier: z.enum(['good', 'better', 'insane', 'custom']),
  name: z.string().min(1, 'Give this option a name'),
  description: z.string(),
  price: z
    .string()
    .min(1, 'Enter a price')
    .refine((v) => parseDollarsToCents(v) !== null, 'Enter a valid dollar amount'),
  laborIncluded: z.boolean(),
  depositLink: z.string().url('Enter a full URL (https://…)').or(z.literal('')),
  items: z.array(itemSchema).min(1, 'Add at least one product'),
})

const schema = z.object({
  firstName: z.string().min(1, "Customer's first name is required"),
  lastName: z.string(),
  email: z.string().email('A valid email is required — quotes are sent by email'),
  phone: z.string(),
  vehicleYear: z.coerce
    .number()
    .int()
    .min(1950, 'Enter the vehicle year')
    .max(new Date().getFullYear() + 2, 'That year is in the future'),
  vehicleMake: z.string().min(1, 'Vehicle make is required'),
  vehicleModel: z.string().min(1, 'Vehicle model is required'),
  vehicleTrim: z.string(),
  source: z.string(),
  permissionConfirmed: z.literal(true, {
    errorMap: () => ({ message: 'You must confirm the customer asked for this quote' }),
  }),
  expirationDate: z.string(),
  internalNotes: z.string(),
  nextFollowUpAt: z.string(),
  options: z.array(optionSchema).min(1, 'Add at least one option').max(3, 'No more than three options'),
  recommendedIndex: z.coerce.number().int().min(0),
})

type FormValues = z.infer<typeof schema>

const TIER_DEFAULTS: Array<{ tier: Tier; name: string }> = [
  { tier: 'good', name: 'Good' },
  { tier: 'better', name: 'Better' },
  { tier: 'insane', name: 'Insane' },
]

function emptyOption(index: number): FormValues['options'][number] {
  const preset = TIER_DEFAULTS[index] ?? { tier: 'custom' as Tier, name: 'Option' }
  return {
    tier: preset.tier,
    name: preset.name,
    description: '',
    price: '',
    laborIncluded: true,
    depositLink: '',
    items: [{ brand: '', model: '', name: '', quantity: 1 }],
  }
}

export default function NewQuotePage() {
  const repo = useRepo()
  const { shop, refresh } = useAppData()
  const toast = useToast()
  const navigate = useNavigate()

  const defaultExpiration = format(addDays(new Date(), shop?.quoteExpirationDays ?? 30), 'yyyy-MM-dd')

  const {
    register,
    control,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      firstName: '',
      lastName: '',
      email: '',
      phone: '',
      vehicleTrim: '',
      source: '',
      expirationDate: defaultExpiration,
      internalNotes: '',
      nextFollowUpAt: '',
      options: [emptyOption(0), emptyOption(1)],
      recommendedIndex: 1,
    },
  })

  const { fields: optionFields, append, remove } = useFieldArray({ control, name: 'options' })

  const onSubmit = async (values: FormValues) => {
    const input: NewQuoteInput = {
      customer: {
        firstName: values.firstName.trim(),
        lastName: values.lastName.trim() || null,
        email: values.email.trim(),
        phone: values.phone.trim() || null,
        vehicleYear: values.vehicleYear,
        vehicleMake: values.vehicleMake.trim(),
        vehicleModel: values.vehicleModel.trim(),
        vehicleTrim: values.vehicleTrim.trim() || null,
        source: values.source || null,
        emailContactPermissionConfirmed: values.permissionConfirmed,
      },
      quote: {
        internalNotes: values.internalNotes.trim() || null,
        expirationDate: values.expirationDate ? new Date(`${values.expirationDate}T12:00:00`).toISOString() : null,
        nextFollowUpAt: values.nextFollowUpAt ? new Date(`${values.nextFollowUpAt}T09:00:00`).toISOString() : null,
      },
      options: values.options.map((opt, i) => ({
        tier: opt.tier,
        name: opt.name.trim(),
        description: opt.description.trim(),
        priceCents: parseDollarsToCents(opt.price) ?? 0,
        laborIncluded: opt.laborIncluded,
        depositLink: opt.depositLink.trim() || shop?.defaultPaymentLink || null,
        recommended: i === Number(values.recommendedIndex),
        items: opt.items.map((item) => ({
          brand: item.brand.trim() || null,
          model: item.model.trim() || null,
          name: item.name.trim(),
          quantity: item.quantity,
          description: null,
        })),
      })),
    }
    try {
      const quote = await repo.createQuote(input)
      await refresh()
      toast('success', 'Quote created. Now preview and send the email.')
      navigate(`/app/quotes/${quote.id}`)
    } catch {
      toast('error', 'Could not save the quote. Please try again.')
    }
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="text-3xl font-black text-ink">Create Quote</h1>
        <p className="mt-1 text-base text-zinc-600">
          Fill this out while the customer is in the shop or right after the call. Then email it before they change their mind.
        </p>
      </div>

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-6" noValidate>
        <Card className="space-y-4">
          <h2 className="text-xl font-bold text-ink">Customer</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="First name" htmlFor="q-first" error={errors.firstName?.message} required>
              <Input id="q-first" autoComplete="off" {...register('firstName')} />
            </Field>
            <Field label="Last name" htmlFor="q-last">
              <Input id="q-last" autoComplete="off" {...register('lastName')} />
            </Field>
          </div>
          <Field label="Email" htmlFor="q-email" error={errors.email?.message} required>
            <Input id="q-email" type="email" inputMode="email" autoComplete="off" {...register('email')} />
          </Field>
          <Field label="Phone" htmlFor="q-phone" hint="For click-to-call. We never text customers.">
            <Input id="q-phone" type="tel" inputMode="tel" autoComplete="off" {...register('phone')} />
          </Field>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <Field label="Year" htmlFor="q-year" error={errors.vehicleYear?.message} required>
              <Input id="q-year" type="number" inputMode="numeric" placeholder="2022" {...register('vehicleYear')} />
            </Field>
            <Field label="Make" htmlFor="q-make" error={errors.vehicleMake?.message} required>
              <Input id="q-make" placeholder="Ford" {...register('vehicleMake')} />
            </Field>
            <Field label="Model" htmlFor="q-model" error={errors.vehicleModel?.message} required>
              <Input id="q-model" placeholder="F-150" {...register('vehicleModel')} />
            </Field>
            <Field label="Trim" htmlFor="q-trim">
              <Input id="q-trim" placeholder="Lariat" {...register('vehicleTrim')} />
            </Field>
          </div>
          <Field label="How did they find you?" htmlFor="q-source">
            <Select id="q-source" {...register('source')}>
              <option value="">Not sure</option>
              <option>Walk-in</option>
              <option>Phone call</option>
              <option>Referral</option>
              <option>Google</option>
              <option>Facebook</option>
              <option>Instagram</option>
              <option>Other</option>
            </Select>
          </Field>
          <div className="rounded-xl bg-blue-50 p-4">
            <label className="flex items-start gap-3 text-base font-medium text-ink">
              <input
                type="checkbox"
                className="mt-1 h-5 w-5 rounded border-zinc-300 accent-[#1d4ed8]"
                {...register('permissionConfirmed')}
              />
              This customer requested a quote and the shop is permitted to email them about it.
            </label>
            {errors.permissionConfirmed ? (
              <p role="alert" className="mt-2 text-sm font-medium text-red-700">
                {errors.permissionConfirmed.message}
              </p>
            ) : null}
          </div>
        </Card>

        <Card className="space-y-5">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-bold text-ink">Options</h2>
            {optionFields.length < 3 ? (
              <Button variant="secondary" onClick={() => append(emptyOption(optionFields.length))}>
                <Plus className="h-5 w-5" aria-hidden="true" /> Add option
              </Button>
            ) : null}
          </div>
          <p className="-mt-3 text-sm text-zinc-500">
            One option is fine if you don&apos;t do tiers. Three (Good / Better / Insane) sells best.
          </p>
          {optionFields.map((field, index) => (
            <OptionEditor
              key={field.id}
              index={index}
              control={control}
              register={register}
              errors={errors}
              canRemove={optionFields.length > 1}
              onRemove={() => remove(index)}
            />
          ))}
          {typeof errors.options?.message === 'string' ? (
            <p role="alert" className="text-sm font-medium text-red-700">
              {errors.options.message}
            </p>
          ) : null}
        </Card>

        <Card className="space-y-4">
          <h2 className="text-xl font-bold text-ink">Quote details</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Good through" htmlFor="q-exp" hint="Shown to the customer on the quote.">
              <Input id="q-exp" type="date" {...register('expirationDate')} />
            </Field>
            <Field label="Next follow-up" htmlFor="q-follow" hint="Leave blank — it's set automatically when you email the quote.">
              <Input id="q-follow" type="date" {...register('nextFollowUpAt')} />
            </Field>
          </div>
          <Field label="Internal notes" htmlFor="q-notes" hint="Only your team sees these. Never emailed.">
            <Textarea id="q-notes" rows={3} {...register('internalNotes')} />
          </Field>
        </Card>

        <div className="flex flex-col gap-3 sm:flex-row sm:justify-end">
          <Button variant="secondary" onClick={() => navigate(-1)}>
            Cancel
          </Button>
          <Button type="submit" disabled={isSubmitting} className="sm:min-w-52">
            {isSubmitting ? 'Saving…' : 'Save quote'}
          </Button>
        </div>
      </form>
    </div>
  )
}

function OptionEditor({
  index,
  control,
  register,
  errors,
  canRemove,
  onRemove,
}: {
  index: number
  control: Control<FormValues>
  register: UseFormRegister<FormValues>
  errors: FieldErrors<FormValues>
  canRemove: boolean
  onRemove: () => void
}) {
  const { fields: itemFields, append, remove } = useFieldArray({ control, name: `options.${index}.items` })
  const optionErrors = errors.options?.[index]

  return (
    <fieldset className="rounded-xl border border-zinc-200 p-4">
      <legend className="px-1 text-base font-bold text-charcoal">Option {index + 1}</legend>
      <div className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-[8rem_1fr]">
          <Field label="Tier" htmlFor={`opt-${index}-tier`}>
            <Select id={`opt-${index}-tier`} {...register(`options.${index}.tier`)}>
              <option value="good">Good</option>
              <option value="better">Better</option>
              <option value="insane">Insane</option>
              <option value="custom">Custom</option>
            </Select>
          </Field>
          <Field label="Option name" htmlFor={`opt-${index}-name`} error={optionErrors?.name?.message} required>
            <Input id={`opt-${index}-name`} {...register(`options.${index}.name`)} />
          </Field>
        </div>
        <Field label="One-line description" htmlFor={`opt-${index}-desc`} hint="What does the customer get with this option?">
          <Input id={`opt-${index}-desc`} {...register(`options.${index}.description`)} />
        </Field>

        <div>
          <p className="mb-1.5 text-base font-semibold text-ink">Products</p>
          <div className="space-y-2">
            {itemFields.map((item, j) => (
              <div key={item.id} className="grid grid-cols-[1fr_1fr_auto] gap-2 sm:grid-cols-[1fr_1fr_2fr_4.5rem_auto]">
                <Input aria-label="Brand" placeholder="Brand" {...register(`options.${index}.items.${j}.brand`)} />
                <Input aria-label="Model" placeholder="Model #" {...register(`options.${index}.items.${j}.model`)} />
                <Input
                  aria-label="Item name"
                  placeholder="What is it? (e.g. 12-inch subwoofer)"
                  className="col-span-2 sm:col-span-1"
                  {...register(`options.${index}.items.${j}.name`)}
                />
                <Input
                  aria-label="Quantity"
                  type="number"
                  min={1}
                  inputMode="numeric"
                  {...register(`options.${index}.items.${j}.quantity`)}
                />
                <button
                  type="button"
                  aria-label="Remove item"
                  disabled={itemFields.length === 1}
                  onClick={() => remove(j)}
                  className="flex h-12 w-12 items-center justify-center rounded-xl text-zinc-400 hover:bg-red-50 hover:text-red-600 disabled:opacity-30"
                >
                  <Trash2 className="h-5 w-5" aria-hidden="true" />
                </button>
              </div>
            ))}
          </div>
          {optionErrors?.items?.[0]?.name?.message ? (
            <p role="alert" className="mt-1 text-sm font-medium text-red-700">
              {optionErrors.items[0].name.message}
            </p>
          ) : null}
          <Button variant="ghost" className="mt-2" onClick={() => append({ brand: '', model: '', name: '', quantity: 1 })}>
            <Plus className="h-5 w-5" aria-hidden="true" /> Add product
          </Button>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Price (installed)" htmlFor={`opt-${index}-price`} error={optionErrors?.price?.message} required>
            <Input id={`opt-${index}-price`} inputMode="decimal" placeholder="$2,899" {...register(`options.${index}.price`)} />
          </Field>
          <Field label="Deposit link" htmlFor={`opt-${index}-deposit`} error={optionErrors?.depositLink?.message} hint="Blank = your shop's default payment link.">
            <Input id={`opt-${index}-deposit`} type="url" {...register(`options.${index}.depositLink`)} />
          </Field>
        </div>
        <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
          <label className="flex items-center gap-2.5 text-base font-medium text-ink">
            <input type="checkbox" className="h-5 w-5 accent-[#1d4ed8]" {...register(`options.${index}.laborIncluded`)} />
            Labor included
          </label>
          <label className="flex items-center gap-2.5 text-base font-medium text-ink">
            <input type="radio" value={index} className="h-5 w-5 accent-[#1d4ed8]" {...register('recommendedIndex')} />
            Recommend this option
          </label>
          {canRemove ? (
            <Button variant="danger" onClick={onRemove}>
              <Trash2 className="h-5 w-5" aria-hidden="true" /> Remove option
            </Button>
          ) : null}
        </div>
      </div>
    </fieldset>
  )
}
