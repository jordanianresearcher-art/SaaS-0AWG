import { useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import {
  useFieldArray,
  useForm,
  useWatch,
  type Control,
  type FieldErrors,
  type UseFormRegister,
  type UseFormSetValue,
} from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { addDays, format } from 'date-fns'
import { Package, Plus, Trash2 } from 'lucide-react'
import { useAppData, useRepo } from '../../data/AppDataContext'
import { useToast } from '../../components/Toast'
import { Button, Card, Field, Input, Modal, Select, Textarea } from '../../components/ui'
import WindowTintEditor from '../../components/WindowTintEditor'
import { parseDollarsToCents } from '../../lib/format'
import { COMMON_MAKES, OTHER_MAKE, VEHICLE_YEARS, fetchModelsForMakeYear } from '../../lib/vehicleData'
import { DEFAULT_DEPOSIT_PERCENT, PAYMENT_METHOD_INFO, computeDefaultDepositCents } from '../../lib/paymentMethods'
import { TINT_VLT_PERCENTS } from '../../lib/windowTint'
import type { NewQuoteInput } from '../../data/repository'
import type { CatalogItem, PaymentMethod, QuoteBundle, Tier } from '../../types'

const PAYMENT_METHODS = Object.keys(PAYMENT_METHOD_INFO) as PaymentMethod[]

const itemSchema = z.object({
  brand: z.string(),
  model: z.string(),
  name: z.string().min(1, 'What is this item?'),
  quantity: z.coerce.number().int().min(1, 'At least 1'),
})

const optionSchema = z
  .object({
    tier: z.enum(['good', 'better', 'insane', 'custom']),
    name: z.string().min(1, 'Give this option a name'),
    description: z.string(),
    price: z
      .string()
      .min(1, 'Enter a price')
      .refine((v) => parseDollarsToCents(v) !== null, 'Enter a valid dollar amount'),
    laborIncluded: z.boolean(),
    depositAmount: z
      .string()
      .refine((v) => v.trim() === '' || parseDollarsToCents(v) !== null, 'Enter a valid dollar amount'),
    depositOverride: z.boolean(),
    depositMethod: z.enum(['none', 'link', 'zelle', 'cashapp', 'venmo', 'paypal']),
    depositHandle: z.string(),
    items: z.array(itemSchema).min(1, 'Add at least one product'),
  })
  .superRefine((values, ctx) => {
    if (!values.depositOverride || values.depositMethod === 'none') return
    if (!values.depositHandle.trim()) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['depositHandle'], message: 'Enter your payment info' })
      return
    }
    if (values.depositMethod === 'link') {
      try {
        new URL(values.depositHandle.trim())
      } catch {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['depositHandle'],
          message: 'Enter a full URL (https://…)',
        })
      }
    }
  })

const tintPercentSchema = z
  .number()
  .refine((v) => (TINT_VLT_PERCENTS as readonly number[]).includes(v), 'Choose a valid tint %')
  .nullable()

const tintWindowSchema = z
  .object({
    position: z.enum([
      'front_left',
      'front_right',
      'rear_left',
      'rear_right',
      'rear_quarter_left',
      'rear_quarter_right',
      'back_glass',
    ]),
    included: z.boolean(),
    vltPercent: tintPercentSchema,
  })
  .superRefine((v, ctx) => {
    if (v.included && v.vltPercent === null) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['vltPercent'], message: 'Choose a tint %' })
    }
  })

const windowTintSchema = z
  .object({
    bodyStyle: z.enum(['sedan_coupe', 'suv_wagon_van']),
    windows: z.array(tintWindowSchema),
    windshieldIncluded: z.boolean(),
    windshieldVltPercent: tintPercentSchema,
  })
  .superRefine((v, ctx) => {
    if (v.windshieldIncluded && v.windshieldVltPercent === null) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['windshieldVltPercent'], message: 'Choose a tint %' })
    }
  })

const schema = z
  .object({
    firstName: z.string(),
    lastName: z.string(),
    email: z.string().email('A valid email is required — quotes are sent by email'),
    phone: z.string(),
    // Blank ('') means "no vehicle yet" — a real select from VEHICLE_YEARS is
    // the only other possible value, so no numeric range check is needed here.
    vehicleYear: z.string(),
    vehicleMake: z.string(),
    vehicleModel: z.string(),
    vehicleTrim: z.string(),
    source: z.string(),
    permissionConfirmed: z.literal(true, {
      errorMap: () => ({ message: 'You must confirm the customer asked for this quote' }),
    }),
    expirationDate: z.string(),
    internalNotes: z.string(),
    nextFollowUpAt: z.string(),
    options: z.array(optionSchema).max(3, 'No more than three options'),
    recommendedIndex: z.coerce.number().int().min(0),
    windowTint: windowTintSchema.nullable(),
  })
  .superRefine((values, ctx) => {
    // Vehicle is all-or-nothing: blank is fine, a partial entry is not.
    const hasAny = values.vehicleYear !== '' || values.vehicleMake.trim() !== '' || values.vehicleModel.trim() !== ''
    if (!hasAny) return
    if (values.vehicleYear === '') {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['vehicleYear'], message: 'Enter the vehicle year' })
    }
    if (!values.vehicleMake.trim()) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['vehicleMake'], message: 'Vehicle make is required' })
    }
    if (!values.vehicleModel.trim()) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['vehicleModel'], message: 'Vehicle model is required' })
    }
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
    depositAmount: '',
    depositOverride: false,
    depositMethod: 'none',
    depositHandle: '',
    items: [{ brand: '', model: '', name: '', quantity: 1 }],
  }
}

function optionsFromBundle(bundle: QuoteBundle): FormValues['options'] {
  return bundle.options.map((o) => ({
    tier: o.tier,
    name: o.name,
    description: o.description,
    price: (o.priceCents / 100).toString(),
    laborIncluded: o.laborIncluded,
    depositAmount: o.depositAmountCents != null ? (o.depositAmountCents / 100).toString() : '',
    // Verbatim carryover, matching today's behavior: a resolved deposit method
    // always wins over the shop's *current* default when duplicating; if the
    // original had none, leave it unchecked so submit-time resolution falls
    // back to the shop's live current default (not a frozen historical one).
    depositOverride: o.depositPaymentMethod !== null,
    depositMethod: o.depositPaymentMethod ?? 'none',
    depositHandle: o.depositPaymentHandle ?? '',
    items: o.items.map((i) => ({ brand: i.brand ?? '', model: i.model ?? '', name: i.name, quantity: i.quantity })),
  }))
}

export default function NewQuotePage() {
  const repo = useRepo()
  const { shop, bundles, refresh } = useAppData()
  const toast = useToast()
  const navigate = useNavigate()
  const location = useLocation()
  const duplicateFrom = (location.state as { duplicateFrom?: QuoteBundle } | null)?.duplicateFrom

  const [catalogItems, setCatalogItems] = useState<CatalogItem[]>([])
  useEffect(() => {
    void repo.listCatalogItems().then(setCatalogItems)
  }, [repo])

  // Suggestions for brand/model/item-name, drawn from this shop's own quote
  // history (already loaded for the dashboard — no extra query needed).
  const itemHistory = useMemo(() => {
    const brands = new Set<string>()
    const models = new Set<string>()
    const names = new Set<string>()
    for (const b of bundles) {
      for (const o of b.options) {
        for (const i of o.items) {
          if (i.brand) brands.add(i.brand)
          if (i.model) models.add(i.model)
          if (i.name) names.add(i.name)
        }
      }
    }
    return {
      brands: Array.from(brands).sort(),
      models: Array.from(models).sort(),
      names: Array.from(names).sort(),
    }
  }, [bundles])

  const defaultExpiration = format(addDays(new Date(), shop?.quoteExpirationDays ?? 30), 'yyyy-MM-dd')

  const {
    register,
    control,
    handleSubmit,
    setValue,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: duplicateFrom
      ? {
          firstName: '',
          lastName: '',
          email: '',
          phone: '',
          vehicleYear: duplicateFrom.customer.vehicleYear != null ? String(duplicateFrom.customer.vehicleYear) : '',
          vehicleMake: duplicateFrom.customer.vehicleMake ?? '',
          vehicleModel: duplicateFrom.customer.vehicleModel ?? '',
          vehicleTrim: duplicateFrom.customer.vehicleTrim ?? '',
          source: duplicateFrom.customer.source ?? '',
          expirationDate: defaultExpiration,
          internalNotes: '',
          nextFollowUpAt: '',
          options: optionsFromBundle(duplicateFrom),
          recommendedIndex: Math.max(0, duplicateFrom.options.findIndex((o) => o.recommended)),
          windowTint: duplicateFrom.quote.windowTint,
        }
      : {
          firstName: '',
          lastName: '',
          email: '',
          phone: '',
          vehicleYear: '',
          vehicleMake: '',
          vehicleModel: '',
          vehicleTrim: '',
          source: '',
          expirationDate: defaultExpiration,
          internalNotes: '',
          nextFollowUpAt: '',
          options: [],
          recommendedIndex: 0,
          windowTint: null,
        },
  })

  const { fields: optionFields, append, remove } = useFieldArray({ control, name: 'options' })

  const watchedMake = watch('vehicleMake')
  const [customMake, setCustomMake] = useState(() =>
    Boolean(duplicateFrom && duplicateFrom.customer.vehicleMake && !COMMON_MAKES.includes(duplicateFrom.customer.vehicleMake)),
  )
  const [vehicleOpen, setVehicleOpen] = useState(() =>
    Boolean(duplicateFrom && (duplicateFrom.customer.vehicleYear || duplicateFrom.customer.vehicleMake || duplicateFrom.customer.vehicleModel)),
  )
  const [tintOpen, setTintOpen] = useState(() => Boolean(duplicateFrom?.quote.windowTint))

  const onSubmit = async (values: FormValues) => {
    const input: NewQuoteInput = {
      customer: {
        firstName: values.firstName.trim(),
        lastName: values.lastName.trim() || null,
        email: values.email.trim(),
        phone: values.phone.trim() || null,
        vehicleYear: values.vehicleYear ? Number(values.vehicleYear) : null,
        vehicleMake: values.vehicleMake.trim() || null,
        vehicleModel: values.vehicleModel.trim() || null,
        vehicleTrim: values.vehicleTrim.trim() || null,
        source: values.source || null,
        emailContactPermissionConfirmed: values.permissionConfirmed,
      },
      quote: {
        internalNotes: values.internalNotes.trim() || null,
        expirationDate: values.expirationDate ? new Date(`${values.expirationDate}T12:00:00`).toISOString() : null,
        nextFollowUpAt: values.nextFollowUpAt ? new Date(`${values.nextFollowUpAt}T09:00:00`).toISOString() : null,
        windowTint: values.windowTint,
      },
      options: values.options.map((opt, i) => {
        const priceCents = parseDollarsToCents(opt.price) ?? 0
        const resolvedMethod: PaymentMethod | null = opt.depositOverride
          ? opt.depositMethod === 'none'
            ? null
            : opt.depositMethod
          : (shop?.defaultPaymentMethod ?? null)
        const resolvedHandle: string | null = opt.depositOverride
          ? opt.depositMethod === 'none'
            ? null
            : opt.depositHandle.trim()
          : (shop?.defaultPaymentHandle ?? null)
        const resolvedAmount =
          resolvedMethod === null
            ? null
            : opt.depositAmount.trim()
              ? parseDollarsToCents(opt.depositAmount)
              : computeDefaultDepositCents(priceCents)
        return {
          tier: opt.tier,
          name: opt.name.trim(),
          description: opt.description.trim(),
          priceCents,
          laborIncluded: opt.laborIncluded,
          depositPaymentMethod: resolvedMethod,
          depositPaymentHandle: resolvedHandle,
          depositAmountCents: resolvedAmount,
          recommended: i === Number(values.recommendedIndex),
          items: opt.items.map((item) => ({
            brand: item.brand.trim() || null,
            model: item.model.trim() || null,
            name: item.name.trim(),
            quantity: item.quantity,
            description: null,
          })),
        }
      }),
    }
    try {
      const quote = await repo.createQuote(input)
      await refresh()
      toast('success', 'Quote created. Review the email and send it.')
      navigate(`/app/quotes/${quote.id}`, { state: { openEmailPreview: true } })
    } catch {
      toast('error', 'Could not save the quote. Please try again.')
    }
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6 lg:max-w-none">
      <div>
        <h1 className="text-3xl font-black text-ink">Create Quote</h1>
        <p className="mt-1 text-base text-zinc-600">
          Fill this out while the customer is in the shop or right after the call. Then email it before they change their mind.
        </p>
      </div>

      {duplicateFrom ? (
        <div className="rounded-xl bg-blue-50 p-4 text-base font-medium text-ink">
          Duplicated from {duplicateFrom.customer.firstName}&apos;s quote — update the customer info below.
        </div>
      ) : null}

      <form
        onSubmit={handleSubmit(onSubmit)}
        className="space-y-6 lg:grid lg:grid-cols-2 lg:items-start lg:gap-6 lg:space-y-0"
        noValidate
      >
        <Card className="space-y-4">
          <h2 className="text-xl font-bold text-ink">Customer</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="First name" htmlFor="q-first" error={errors.firstName?.message}>
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

        <Card className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-bold text-ink">Vehicle</h2>
            {!vehicleOpen ? (
              <Button variant="secondary" onClick={() => setVehicleOpen(true)}>
                <Plus className="h-5 w-5" aria-hidden="true" /> Add vehicle
              </Button>
            ) : (
              <Button
                variant="ghost"
                onClick={() => {
                  setVehicleOpen(false)
                  setCustomMake(false)
                  setValue('vehicleYear', '')
                  setValue('vehicleMake', '')
                  setValue('vehicleModel', '')
                  setValue('vehicleTrim', '')
                }}
              >
                <Trash2 className="h-5 w-5" aria-hidden="true" /> Remove vehicle
              </Button>
            )}
          </div>
          {vehicleOpen ? (
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <Field label="Year" htmlFor="q-year" error={errors.vehicleYear?.message}>
                <Select id="q-year" defaultValue="" {...register('vehicleYear')}>
                  <option value="" disabled>
                    Year
                  </option>
                  {VEHICLE_YEARS.map((y) => (
                    <option key={y} value={y}>
                      {y}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Make" htmlFor="q-make" error={errors.vehicleMake?.message}>
                {customMake ? (
                  <div className="flex gap-1.5">
                    <Input id="q-make" placeholder="Make" {...register('vehicleMake')} />
                    <button
                      type="button"
                      onClick={() => {
                        setCustomMake(false)
                        setValue('vehicleMake', '')
                      }}
                      className="shrink-0 whitespace-nowrap px-2 text-sm font-semibold text-brand"
                    >
                      List
                    </button>
                  </div>
                ) : (
                  <Select
                    id="q-make"
                    defaultValue=""
                    {...register('vehicleMake', {
                      onChange: (e) => {
                        if (e.target.value === OTHER_MAKE) {
                          setCustomMake(true)
                          setValue('vehicleMake', '')
                        }
                      },
                    })}
                  >
                    <option value="" disabled>
                      Make
                    </option>
                    {COMMON_MAKES.map((m) => (
                      <option key={m} value={m}>
                        {m}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
              <ModelField register={register} error={errors.vehicleModel?.message} year={watch('vehicleYear')} make={watchedMake} />
              <Field label="Trim" htmlFor="q-trim">
                <Input id="q-trim" placeholder="Lariat" {...register('vehicleTrim')} />
              </Field>
            </div>
          ) : (
            <p className="text-sm text-zinc-500">Optional — add if you want the vehicle shown on the quote and email.</p>
          )}
        </Card>

        <Card className="space-y-5 lg:col-span-2">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-bold text-ink">Options</h2>
            {optionFields.length < 3 ? (
              <Button
                variant="secondary"
                onClick={() => {
                  const wasEmpty = optionFields.length === 0
                  append(emptyOption(optionFields.length))
                  if (wasEmpty) setValue('recommendedIndex', 0)
                }}
              >
                <Plus className="h-5 w-5" aria-hidden="true" /> Add option
              </Button>
            ) : null}
          </div>
          <p className="-mt-3 text-sm text-zinc-500">
            One option is fine if you don&apos;t do tiers. Three (Good / Better / Insane) sells best. Optional — you
            can save a bare quote and price it later.
          </p>
          {optionFields.length === 0 ? (
            <p className="text-sm text-zinc-500">No pricing options yet — add one when you&apos;re ready.</p>
          ) : null}
          <div className="flex flex-col gap-4 lg:flex-row lg:flex-nowrap lg:items-start">
            {optionFields.map((field, index) => (
              <div key={field.id} className="lg:min-w-0 lg:flex-1 lg:basis-72">
                <OptionEditor
                  index={index}
                  control={control}
                  register={register}
                  setValue={setValue}
                  errors={errors}
                  canRemove={true}
                  onRemove={() => remove(index)}
                  catalogItems={catalogItems}
                  itemHistory={itemHistory}
                />
              </div>
            ))}
          </div>
          {typeof errors.options?.message === 'string' ? (
            <p role="alert" className="text-sm font-medium text-red-700">
              {errors.options.message}
            </p>
          ) : null}
        </Card>

        <Card className="space-y-4 lg:col-span-2">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-bold text-ink">Window Tint</h2>
            {!tintOpen ? (
              <Button variant="secondary" onClick={() => setTintOpen(true)}>
                <Plus className="h-5 w-5" aria-hidden="true" /> Add window tint
              </Button>
            ) : (
              <Button
                variant="ghost"
                onClick={() => {
                  setTintOpen(false)
                  setValue('windowTint', null)
                }}
              >
                <Trash2 className="h-5 w-5" aria-hidden="true" /> Remove window tint
              </Button>
            )}
          </div>
          {tintOpen ? (
            <>
              <WindowTintEditor
                value={watch('windowTint')}
                onChange={(next) => setValue('windowTint', next, { shouldValidate: true, shouldDirty: true })}
              />
              {errors.windowTint ? (
                <p role="alert" className="text-sm font-medium text-red-700">
                  Choose a tint % for each window you&apos;re including, or turn it off.
                </p>
              ) : null}
            </>
          ) : (
            <p className="text-sm text-zinc-500">Optional — describe any window tint work to include on the quote.</p>
          )}
        </Card>

        <Card className="space-y-4 lg:col-span-2">
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

        <div className="flex flex-col gap-3 sm:flex-row sm:justify-end lg:col-span-2">
          <Button variant="secondary" onClick={() => navigate(-1)}>
            Cancel
          </Button>
          <Button type="submit" disabled={isSubmitting} className="sm:min-w-52">
            {isSubmitting ? 'Saving…' : 'Save & review email'}
          </Button>
        </div>
      </form>
    </div>
  )
}

function ModelField({
  register,
  error,
  year,
  make,
}: {
  register: UseFormRegister<FormValues>
  error?: string
  year: string
  make: string
}) {
  const [suggestions, setSuggestions] = useState<string[]>([])
  const [loading, setLoading] = useState(false)
  const yearNum = year ? Number(year) : 0

  useEffect(() => {
    if (!yearNum || !make) {
      setSuggestions([])
      return
    }
    let cancelled = false
    setLoading(true)
    fetchModelsForMakeYear(make, yearNum)
      .then((models) => {
        if (!cancelled) setSuggestions(models)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [yearNum, make])

  return (
    <Field label="Model" htmlFor="q-model" error={error} hint={loading ? 'Looking up models…' : undefined}>
      <Input id="q-model" list="q-model-suggestions" placeholder="F-150" {...register('vehicleModel')} />
      <datalist id="q-model-suggestions">
        {suggestions.map((m) => (
          <option key={m} value={m} />
        ))}
      </datalist>
    </Field>
  )
}

function OptionEditor({
  index,
  control,
  register,
  setValue,
  errors,
  canRemove,
  onRemove,
  catalogItems,
  itemHistory,
}: {
  index: number
  control: Control<FormValues>
  register: UseFormRegister<FormValues>
  setValue: UseFormSetValue<FormValues>
  errors: FieldErrors<FormValues>
  canRemove: boolean
  onRemove: () => void
  catalogItems: CatalogItem[]
  itemHistory: { brands: string[]; models: string[]; names: string[] }
}) {
  const { fields: itemFields, append, remove } = useFieldArray({ control, name: `options.${index}.items` })
  const optionErrors = errors.options?.[index]
  const [catalogOpen, setCatalogOpen] = useState(false)

  const brandListId = `brand-suggestions-${index}`
  const modelListId = `model-suggestions-${index}`
  const nameListId = `name-suggestions-${index}`

  // Deposit amount auto-fills at 15% of the price above, live, unless the
  // staff has manually edited it — tracked by comparing against the last
  // value this effect itself wrote, so a later price tweak never clobbers a
  // manual override.
  const priceValue = useWatch({ control, name: `options.${index}.price` })
  const depositAmountValue = useWatch({ control, name: `options.${index}.depositAmount` })
  const lastAutoDepositRef = useRef<string | null>(null)

  useEffect(() => {
    const cents = parseDollarsToCents(priceValue)
    if (cents === null) return
    const suggested = (computeDefaultDepositCents(cents) / 100).toFixed(2)
    if (depositAmountValue === '' || depositAmountValue === lastAutoDepositRef.current) {
      setValue(`options.${index}.depositAmount`, suggested)
      lastAutoDepositRef.current = suggested
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only recompute when price changes, not on every depositAmount keystroke
  }, [priceValue])

  const depositOverride = useWatch({ control, name: `options.${index}.depositOverride` })
  const depositMethod = useWatch({ control, name: `options.${index}.depositMethod` })

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
          <datalist id={brandListId}>
            {itemHistory.brands.map((b) => (
              <option key={b} value={b} />
            ))}
          </datalist>
          <datalist id={modelListId}>
            {itemHistory.models.map((m) => (
              <option key={m} value={m} />
            ))}
          </datalist>
          <datalist id={nameListId}>
            {itemHistory.names.map((n) => (
              <option key={n} value={n} />
            ))}
          </datalist>
          <div className="space-y-2">
            {itemFields.map((item, j) => (
              <div key={item.id} className="grid grid-cols-[1fr_1fr_auto] gap-2 sm:grid-cols-[1fr_1fr_2fr_4.5rem_auto]">
                <Input
                  aria-label="Brand"
                  placeholder="Brand"
                  list={brandListId}
                  {...register(`options.${index}.items.${j}.brand`)}
                />
                <Input
                  aria-label="Model"
                  placeholder="Model #"
                  list={modelListId}
                  {...register(`options.${index}.items.${j}.model`)}
                />
                <Input
                  aria-label="Item name"
                  placeholder="What is it? (e.g. 12-inch subwoofer)"
                  list={nameListId}
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
          <div className="mt-2 flex flex-wrap gap-2">
            <Button variant="ghost" onClick={() => append({ brand: '', model: '', name: '', quantity: 1 })}>
              <Plus className="h-5 w-5" aria-hidden="true" /> Add product
            </Button>
            {catalogItems.length > 0 ? (
              <Button variant="ghost" onClick={() => setCatalogOpen(true)}>
                <Package className="h-5 w-5" aria-hidden="true" /> From catalog
              </Button>
            ) : null}
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Price (installed)" htmlFor={`opt-${index}-price`} error={optionErrors?.price?.message} required>
            <Input id={`opt-${index}-price`} inputMode="decimal" placeholder="$2,899" {...register(`options.${index}.price`)} />
          </Field>
          <Field
            label="Deposit amount"
            htmlFor={`opt-${index}-deposit-amount`}
            error={optionErrors?.depositAmount?.message}
            hint={`Auto-filled at ${DEFAULT_DEPOSIT_PERCENT}% of the price above — change it if you want a different amount.`}
          >
            <Input
              id={`opt-${index}-deposit-amount`}
              inputMode="decimal"
              placeholder="$435"
              {...register(`options.${index}.depositAmount`)}
            />
          </Field>
        </div>
        <label className="flex items-center gap-2.5 text-base font-medium text-ink">
          <input
            type="checkbox"
            className="h-5 w-5 accent-[#1d4ed8]"
            {...register(`options.${index}.depositOverride`)}
          />
          Use a different payment method for this deposit
        </label>
        {depositOverride ? (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Payment method" htmlFor={`opt-${index}-deposit-method`}>
              <Select id={`opt-${index}-deposit-method`} {...register(`options.${index}.depositMethod`)}>
                <option value="none">No deposit for this option</option>
                {PAYMENT_METHODS.map((m) => (
                  <option key={m} value={m}>
                    {PAYMENT_METHOD_INFO[m].label}
                  </option>
                ))}
              </Select>
            </Field>
            {depositMethod && depositMethod !== 'none' ? (
              <Field
                label={PAYMENT_METHOD_INFO[depositMethod].handleLabel}
                htmlFor={`opt-${index}-deposit-handle`}
                error={optionErrors?.depositHandle?.message}
                hint={PAYMENT_METHOD_INFO[depositMethod].hint}
              >
                <Input
                  id={`opt-${index}-deposit-handle`}
                  placeholder={PAYMENT_METHOD_INFO[depositMethod].placeholder}
                  {...register(`options.${index}.depositHandle`)}
                />
              </Field>
            ) : null}
          </div>
        ) : null}
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

      <Modal open={catalogOpen} onClose={() => setCatalogOpen(false)} title="Insert from catalog">
        <ul className="divide-y divide-zinc-100">
          {catalogItems.map((catalogItem) => (
            <li key={catalogItem.id}>
              <button
                type="button"
                onClick={() => {
                  append({
                    brand: catalogItem.brand ?? '',
                    model: catalogItem.model ?? '',
                    name: catalogItem.name,
                    quantity: 1,
                  })
                  setCatalogOpen(false)
                }}
                className="flex min-h-14 w-full items-center gap-3 py-2.5 text-left hover:bg-zinc-50"
              >
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-blue-50 text-brand">
                  <Package className="h-5 w-5" aria-hidden="true" />
                </span>
                <span className="text-base font-semibold text-ink">
                  {[catalogItem.brand, catalogItem.model].filter(Boolean).join(' ')}
                  {catalogItem.brand || catalogItem.model ? ' — ' : ''}
                  {catalogItem.name}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </Modal>
    </fieldset>
  )
}
