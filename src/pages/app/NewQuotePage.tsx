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
import { Check, LayoutGrid, Package, Plus, Sparkles, Star, Trash2, TriangleAlert } from 'lucide-react'
import { useAppData, useRepo } from '../../data/AppDataContext'
import { useToast } from '../../components/Toast'
import { Button, Card, Field, Input, Modal, Select, Textarea } from '../../components/ui'
import { CategoryIcon } from '../../components/categoryIcon'
import WindowTintEditor from '../../components/WindowTintEditor'
import PackageBuilder, { createEmptyPackageBuilderValue, type PackageBuilderValue } from '../../components/PackageBuilder'
import { getConfiguration } from '../../lib/audioConfigs'
import {
  assignmentsToPackageItems,
  assignmentsToQuoteItems,
  computeComponentSubtotalCents,
  customItemsSubtotalCents,
  customItemsToPackageItems,
  customItemsToQuoteItems,
  isBuilderComplete,
  resolveBuilderCatalog,
} from '../../lib/packageBuilder'
import { formatCurrency, parseDollarsToCents } from '../../lib/format'
import { COMMON_MAKES, OTHER_MAKE, VEHICLE_YEARS, fetchModelsForMakeYear } from '../../lib/vehicleData'
import { DEFAULT_DEPOSIT_PERCENT, PAYMENT_METHOD_INFO, computeDefaultDepositCents } from '../../lib/paymentMethods'
import {
  TINT_VLT_PERCENTS,
  createDefaultWindowTintFormValues,
  windowTintConfigToFormValues,
  windowTintFormValuesToConfig,
} from '../../lib/windowTint'
import type { NewQuoteInput } from '../../data/repository'
import type { CatalogItem, PaymentMethod, ProductCategory, QuoteBundle } from '../../types'

const PAYMENT_METHODS = Object.keys(PAYMENT_METHOD_INFO) as PaymentMethod[]

const optionalDollarSchema = z
  .string()
  .refine((v) => v.trim() === '' || parseDollarsToCents(v) !== null, 'Enter a valid dollar amount')

const itemSchema = z.object({
  brand: z.string(),
  model: z.string(),
  // Nothing on this form is required (see the top-level schema comment) —
  // a blank name still lands as a real line item; QuoteDetailPage/
  // PublicQuotePage/emails all fall back to "Item" when name is empty.
  name: z.string(),
  quantity: z.coerce.number().int().min(1, 'At least 1'),
  // Set when this row came from the drag-and-drop package builder, so it can fill a
  // configuration slot again later (e.g. duplicating the quote). Manual/catalog rows leave it null.
  category: z.string().nullable(),
  // Snapshotted from the catalog item/candidate this was added from — lets
  // the customer email show a picture of what they're getting. Null for a
  // freehand-typed row; never user-editable directly on this form.
  imageUrl: z.string().nullable(),
})

const depositFields = {
  depositAmount: z.string().refine((v) => v.trim() === '' || parseDollarsToCents(v) !== null, 'Enter a valid dollar amount'),
  depositOverride: z.boolean(),
  depositMethod: z.enum(['none', 'link', 'zelle', 'cashapp', 'venmo', 'paypal']),
  depositHandle: z.string(),
}

// The one main package on the quote — full treatment: deposit config, the
// drag-and-drop builder, a configId link back to a universal configuration.
const mainOptionSchema = z
  .object({
    name: z.string(),
    description: z.string(),
    price: optionalDollarSchema,
    laborIncluded: z.boolean(),
    ...depositFields,
    items: z.array(itemSchema),
    configId: z.string().nullable(),
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

// An optional named upsell — priced as the *incremental* cost on top of
// the main package (see OptionKind in types.ts), not a full alternative
// price the way an old "tier" was. Deliberately lighter than the main
// option: no deposit config, no drag-and-drop builder — just what it is,
// what it costs extra, and (optionally) the products behind it.
const addonOptionSchema = z.object({
  name: z.string(),
  description: z.string(),
  price: optionalDollarSchema,
  items: z.array(itemSchema),
})

const tintPercentSchema = z
  .number()
  .refine((v) => (TINT_VLT_PERCENTS as readonly number[]).includes(v), 'Choose a valid tint %')
  .nullable()

const tintWindowSchema = z.object({
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
  // A window can be marked included before a % is picked — a shop may not
  // have decided yet. Blank just means "not shown" in the summary.
  vltPercent: tintPercentSchema,
})

const windowTintSchema = z.object({
  // Blank falls back to a generic "Tint option" label at display time —
  // not required, matching how little else on this form is required.
  name: z.string(),
  bodyStyle: z.enum(['coupe', 'sedan', 'truck_single_cab', 'truck_crew_cab', 'suv_4_window', 'suv_6_window', 'minivan']),
  tintType: z.enum(['normal', 'ceramic']),
  windows: z.array(tintWindowSchema),
  price: optionalDollarSchema,
  removeOldTint: z.boolean(),
  removeOldTintPrice: optionalDollarSchema,
  windshieldIncluded: z.boolean(),
  // Not required even when windshieldIncluded — a shop may not have decided yet.
  windshieldVltPercent: tintPercentSchema,
  windshieldPrice: optionalDollarSchema,
})

const schema = z
  .object({
    firstName: z.string(),
    lastName: z.string(),
    // Optional like everything else — a blank email still saves the quote;
    // checkSendEligibility (src/lib/eligibility.ts) blocks *sending* with a
    // clear "no email on file" message until one's added, same safety net
    // as the permission checkbox below.
    email: z.string().refine((v) => v.trim() === '' || z.string().email().safeParse(v).success, 'Enter a valid email address'),
    phone: z.string(),
    // Blank ('') means "no vehicle yet" — a real select from VEHICLE_YEARS is
    // the only other possible value, so no numeric range check is needed here.
    vehicleYear: z.string(),
    vehicleMake: z.string(),
    vehicleModel: z.string(),
    vehicleTrim: z.string(),
    source: z.string(),
    // Not gated on true — staff can save a quote without checking this;
    // it's still recorded on the customer record either way (see onSubmit).
    permissionConfirmed: z.boolean(),
    expirationDate: z.string(),
    internalNotes: z.string(),
    nextFollowUpAt: z.string(),
    main: mainOptionSchema,
    addons: z.array(addonOptionSchema).max(8, 'No more than eight add-ons'),
    showFullAddonTotal: z.boolean(),
    windowTints: z.array(windowTintSchema).max(3, 'No more than three tint options'),
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
type ItemFormValues = FormValues['main']['items'][number]

function emptyItem(): ItemFormValues {
  return { brand: '', model: '', name: '', quantity: 1, category: null, imageUrl: null }
}

function emptyMainOption(): FormValues['main'] {
  return {
    name: 'Complete system',
    description: '',
    price: '',
    laborIncluded: true,
    depositAmount: '',
    depositOverride: false,
    depositMethod: 'none',
    depositHandle: '',
    items: [emptyItem()],
    configId: null,
  }
}

function emptyAddon(): FormValues['addons'][number] {
  return { name: '', description: '', price: '', items: [] }
}

function itemsFromBundle(items: QuoteBundle['options'][number]['items']): ItemFormValues[] {
  return items.map((i) => ({ brand: i.brand ?? '', model: i.model ?? '', name: i.name, quantity: i.quantity, category: i.category, imageUrl: i.imageUrl }))
}

function mainFromBundle(bundle: QuoteBundle): FormValues['main'] {
  const main = bundle.options.find((o) => o.optionKind === 'main') ?? bundle.options[0]
  if (!main) return emptyMainOption()
  return {
    name: main.name,
    description: main.description,
    price: (main.priceCents / 100).toString(),
    laborIncluded: main.laborIncluded,
    depositAmount: main.depositAmountCents != null ? (main.depositAmountCents / 100).toString() : '',
    // Verbatim carryover, matching today's behavior: a resolved deposit method
    // always wins over the shop's *current* default when duplicating; if the
    // original had none, leave it unchecked so submit-time resolution falls
    // back to the shop's live current default (not a frozen historical one).
    depositOverride: main.depositPaymentMethod !== null,
    depositMethod: main.depositPaymentMethod ?? 'none',
    depositHandle: main.depositPaymentHandle ?? '',
    items: itemsFromBundle(main.items),
    configId: main.configId,
  }
}

function addonsFromBundle(bundle: QuoteBundle): FormValues['addons'] {
  const main = bundle.options.find((o) => o.optionKind === 'main') ?? bundle.options[0]
  return bundle.options
    .filter((o) => o !== main)
    .map((o) => ({ name: o.name, description: o.description, price: (o.priceCents / 100).toString(), items: itemsFromBundle(o.items) }))
}

/** Router state shape the scan workspace hands off when staff turn a scan session into a quote instead of an invoice. */
export interface ScanQuotePrefill {
  items: Array<{ brand: string | null; model: string | null; name: string; quantity: number; category: ProductCategory | null; imageUrl?: string | null }>
  /** The cart's subtotal, seeded into the main option's price field as a starting point — staff can still adjust it before saving. */
  priceCents: number
}

function mainFromScan(prefill: ScanQuotePrefill): FormValues['main'] {
  const base = emptyMainOption()
  return {
    ...base,
    name: 'Scanned items',
    price: (prefill.priceCents / 100).toString(),
    items:
      prefill.items.length > 0
        ? prefill.items.map((i) => ({ brand: i.brand ?? '', model: i.model ?? '', name: i.name, quantity: i.quantity, category: i.category, imageUrl: i.imageUrl ?? null }))
        : base.items,
  }
}

export default function NewQuotePage() {
  const repo = useRepo()
  const { shop, bundles, refresh } = useAppData()
  const toast = useToast()
  const navigate = useNavigate()
  const location = useLocation()
  const navState = location.state as { duplicateFrom?: QuoteBundle; fromScan?: ScanQuotePrefill } | null
  const duplicateFrom = navState?.duplicateFrom
  // Only reads on the initial render (react-hook-form's defaultValues, and
  // the customMake/vehicleOpen initializers below, all only run once) — a
  // deliberate one-shot pre-fill, same as duplicateFrom.
  const fromScan = navState?.fromScan

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
          main: mainFromBundle(duplicateFrom),
          addons: addonsFromBundle(duplicateFrom),
          showFullAddonTotal: duplicateFrom.quote.showFullAddonTotal,
          windowTints: duplicateFrom.quote.windowTints.map(windowTintConfigToFormValues),
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
          main: fromScan ? mainFromScan(fromScan) : emptyMainOption(),
          addons: [],
          showFullAddonTotal: false,
          windowTints: [],
        },
  })

  const { fields: addonFields, append: appendAddon, remove: removeAddon } = useFieldArray({ control, name: 'addons' })
  const { fields: tintFields, append: appendTint, remove: removeTint } = useFieldArray({ control, name: 'windowTints' })

  const watchedMake = watch('vehicleMake')
  const [customMake, setCustomMake] = useState(() =>
    Boolean(duplicateFrom && duplicateFrom.customer.vehicleMake && !COMMON_MAKES.includes(duplicateFrom.customer.vehicleMake)),
  )
  const [vehicleOpen, setVehicleOpen] = useState(() =>
    Boolean(duplicateFrom && (duplicateFrom.customer.vehicleYear || duplicateFrom.customer.vehicleMake || duplicateFrom.customer.vehicleModel)),
  )

  const mainPriceValue = useWatch({ control, name: 'main.price' })
  const addonFieldValues = useWatch({ control, name: 'addons' })
  const mainPriceCentsLive = parseDollarsToCents(mainPriceValue) ?? 0
  const fullTotalCentsLive = mainPriceCentsLive + (addonFieldValues ?? []).reduce((sum, a) => sum + (parseDollarsToCents(a.price) ?? 0), 0)

  const onSubmit = async (values: FormValues) => {
    const mainPriceCents = parseDollarsToCents(values.main.price) ?? 0
    const resolvedMethod: PaymentMethod | null = values.main.depositOverride
      ? values.main.depositMethod === 'none'
        ? null
        : values.main.depositMethod
      : (shop?.defaultPaymentMethod ?? null)
    const resolvedHandle: string | null = values.main.depositOverride
      ? values.main.depositMethod === 'none'
        ? null
        : values.main.depositHandle.trim()
      : (shop?.defaultPaymentHandle ?? null)
    const resolvedAmount =
      resolvedMethod === null
        ? null
        : values.main.depositAmount.trim()
          ? parseDollarsToCents(values.main.depositAmount)
          : computeDefaultDepositCents(mainPriceCents)

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
        windowTints: values.windowTints.map(windowTintFormValuesToConfig),
        showFullAddonTotal: values.showFullAddonTotal,
      },
      options: [
        {
          optionKind: 'main',
          name: values.main.name.trim(),
          description: values.main.description.trim(),
          priceCents: mainPriceCents,
          laborIncluded: values.main.laborIncluded,
          depositPaymentMethod: resolvedMethod,
          depositPaymentHandle: resolvedHandle,
          depositAmountCents: resolvedAmount,
          configId: values.main.configId,
          items: values.main.items.map((item) => ({
            brand: item.brand.trim() || null,
            model: item.model.trim() || null,
            name: item.name.trim(),
            quantity: item.quantity,
            description: null,
            category: item.category as ProductCategory | null,
            imageUrl: item.imageUrl,
          })),
        },
        ...values.addons.map((addon) => ({
          optionKind: 'addon' as const,
          name: addon.name.trim(),
          description: addon.description.trim(),
          priceCents: parseDollarsToCents(addon.price) ?? 0,
          laborIncluded: true,
          depositPaymentMethod: null,
          depositPaymentHandle: null,
          depositAmountCents: null,
          configId: null,
          items: addon.items.map((item) => ({
            brand: item.brand.trim() || null,
            model: item.model.trim() || null,
            name: item.name.trim(),
            quantity: item.quantity,
            description: null,
            category: item.category as ProductCategory | null,
            imageUrl: item.imageUrl,
          })),
        })),
      ],
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

      {fromScan ? (
        <div className="rounded-xl bg-blue-50 p-4 text-base font-medium text-ink">
          Brought over {fromScan.items.length} scanned item{fromScan.items.length === 1 ? '' : 's'} into the main package
          below — add the customer's info to finish.
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
          <Field label="Email" htmlFor="q-email" error={errors.email?.message}>
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
          <div className="flex items-center gap-2">
            <Star className="h-5 w-5 text-brand" aria-hidden="true" />
            <h2 className="text-xl font-bold text-ink">Main package</h2>
          </div>
          <MainOptionEditor
            control={control}
            register={register}
            setValue={setValue}
            errors={errors}
            catalogItems={catalogItems}
            itemHistory={itemHistory}
          />
        </Card>

        <Card className="space-y-5 lg:col-span-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-brand" aria-hidden="true" />
              <h2 className="text-xl font-bold text-ink">Add-ons</h2>
              <span className="text-sm font-normal text-zinc-500">optional upgrades, priced on top of the main package</span>
            </div>
            {addonFields.length < 8 ? (
              <Button variant="secondary" onClick={() => appendAddon(emptyAddon())}>
                <Plus className="h-5 w-5" aria-hidden="true" /> Add add-on
              </Button>
            ) : null}
          </div>
          {addonFields.length === 0 ? (
            <p className="text-sm text-zinc-500">No add-ons yet — add one for an optional upgrade like ceramic tint or a backup camera.</p>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2">
              {addonFields.map((field, index) => (
                <AddonOptionEditor
                  key={field.id}
                  index={index}
                  control={control}
                  register={register}
                  errors={errors}
                  mainPriceCents={mainPriceCentsLive}
                  onRemove={() => removeAddon(index)}
                  catalogItems={catalogItems}
                  itemHistory={itemHistory}
                />
              ))}
            </div>
          )}
          {typeof errors.addons?.message === 'string' ? (
            <p role="alert" className="text-sm font-medium text-red-700">
              {errors.addons.message}
            </p>
          ) : null}
          {addonFields.length > 0 ? (
            <label className="flex items-center justify-between gap-3 rounded-xl bg-zinc-50 p-3 text-base font-medium text-ink">
              <span className="flex items-center gap-2.5">
                <input type="checkbox" className="h-5 w-5 accent-[#1d4ed8]" {...register('showFullAddonTotal')} />
                Show a total with everything included
              </span>
              <span className="shrink-0 text-sm font-semibold text-zinc-500">{formatCurrency(fullTotalCentsLive)}</span>
            </label>
          ) : null}
        </Card>

        <Card className="space-y-5 lg:col-span-2">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-bold text-ink">Window Tint</h2>
            {tintFields.length < 3 ? (
              <Button
                variant="secondary"
                onClick={() => appendTint(createDefaultWindowTintFormValues('sedan', `Tint option ${tintFields.length + 1}`))}
              >
                <Plus className="h-5 w-5" aria-hidden="true" /> Add tint option
              </Button>
            ) : null}
          </div>
          <p className="-mt-3 text-sm text-zinc-500">
            Optional — describe any window tint work to include on the quote. Add more than one if you&apos;re pricing a
            few different scenarios.
          </p>
          {tintFields.length === 0 ? (
            <p className="text-sm text-zinc-500">No window tint options yet — add one if this quote includes tint.</p>
          ) : null}
          <div className="flex flex-col gap-4 lg:flex-row lg:flex-nowrap lg:items-start">
            {tintFields.map((field, index) => (
              <div key={field.id} className="lg:min-w-0 lg:flex-1 lg:basis-72">
                <TintOptionEditor
                  index={index}
                  control={control}
                  setValue={setValue}
                  errors={errors}
                  onRemove={() => removeTint(index)}
                />
              </div>
            ))}
          </div>
          {typeof errors.windowTints?.message === 'string' ? (
            <p role="alert" className="text-sm font-medium text-red-700">
              {errors.windowTints.message}
            </p>
          ) : null}
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

/** Shared item-rows editor — the brand/model/name/qty grid, "Add product"/"From catalog" controls, and the catalog-insert modal. Used by both the main option (full treatment) and each add-on (same items UI, just without the drag-and-drop builder around it). `basePath` is the field-array's dotted path, e.g. "main.items" or `addons.${index}.items`. */
function ItemRows({
  basePath,
  control,
  register,
  itemHistory,
  catalogItems,
  listIdPrefix,
}: {
  basePath: 'main.items' | `addons.${number}.items`
  control: Control<FormValues>
  register: UseFormRegister<FormValues>
  itemHistory: { brands: string[]; models: string[]; names: string[] }
  catalogItems: CatalogItem[]
  listIdPrefix: string
}) {
  const { fields, append, remove } = useFieldArray({ control, name: basePath })
  const [catalogOpen, setCatalogOpen] = useState(false)
  const items = useWatch({ control, name: basePath })
  const brandListId = `${listIdPrefix}-brand`
  const modelListId = `${listIdPrefix}-model`
  const nameListId = `${listIdPrefix}-name`

  return (
    <>
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
        {fields.map((item, j) => (
          <div key={item.id} className="grid grid-cols-[auto_1fr_1fr_auto] gap-2 sm:grid-cols-[auto_1fr_1fr_2fr_4.5rem_auto]">
            <span className="flex h-12 w-8 shrink-0 items-center justify-center text-zinc-400" title="Product category">
              <CategoryIcon category={(items?.[j]?.category as ProductCategory | null) ?? null} className="h-4.5 w-4.5" />
            </span>
            <Input aria-label="Brand" placeholder="Brand" list={brandListId} {...register(`${basePath}.${j}.brand`)} />
            <Input aria-label="Model" placeholder="Model #" list={modelListId} {...register(`${basePath}.${j}.model`)} />
            <Input
              aria-label="Item name"
              placeholder="What is it? (e.g. 12-inch subwoofer)"
              list={nameListId}
              className="col-span-2 sm:col-span-1"
              {...register(`${basePath}.${j}.name`)}
            />
            <Input aria-label="Quantity" type="number" min={1} inputMode="numeric" {...register(`${basePath}.${j}.quantity`)} />
            <button
              type="button"
              aria-label="Remove item"
              onClick={() => remove(j)}
              className="flex h-12 w-12 items-center justify-center rounded-xl text-zinc-400 hover:bg-red-50 hover:text-red-600 disabled:opacity-30"
            >
              <Trash2 className="h-5 w-5" aria-hidden="true" />
            </button>
          </div>
        ))}
        {fields.length === 0 ? <p className="text-sm text-zinc-500">No products yet — add one, or skip if this is a flat-fee/labor-only line.</p> : null}
      </div>
      <div className="mt-2 flex flex-wrap gap-2">
        <Button variant="ghost" onClick={() => append(emptyItem())}>
          <Plus className="h-5 w-5" aria-hidden="true" /> Add product
        </Button>
        {catalogItems.length > 0 ? (
          <Button variant="ghost" onClick={() => setCatalogOpen(true)}>
            <Package className="h-5 w-5" aria-hidden="true" /> From catalog
          </Button>
        ) : null}
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
                    category: catalogItem.category,
                    imageUrl: catalogItem.imageUrl,
                  })
                  setCatalogOpen(false)
                }}
                className="flex min-h-14 w-full items-center gap-3 py-2.5 text-left hover:bg-zinc-50"
              >
                <span className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-blue-50 text-brand">
                  {catalogItem.imageUrl ? (
                    <img src={catalogItem.imageUrl} alt="" className="h-full w-full object-contain" />
                  ) : (
                    <CategoryIcon category={catalogItem.category} className="h-5 w-5" />
                  )}
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
    </>
  )
}

function MainOptionEditor({
  control,
  register,
  setValue,
  errors,
  catalogItems,
  itemHistory,
}: {
  control: Control<FormValues>
  register: UseFormRegister<FormValues>
  setValue: UseFormSetValue<FormValues>
  errors: FieldErrors<FormValues>
  catalogItems: CatalogItem[]
  itemHistory: { brands: string[]; models: string[]; names: string[] }
}) {
  const { replace } = useFieldArray({ control, name: 'main.items' })
  const mainErrors = errors.main
  const repo = useRepo()
  const toast = useToast()

  // The fast visual (drag-and-drop) package builder is a separate draft — it only
  // touches this option's real items/price/configId once staff explicitly applies it,
  // so an abandoned or half-filled builder session never silently changes the quote.
  const [builderOpen, setBuilderOpen] = useState(false)
  const [builderValue, setBuilderValue] = useState<PackageBuilderValue>(createEmptyPackageBuilderValue)
  const [packageName, setPackageName] = useState('')
  const [savingPackage, setSavingPackage] = useState(false)

  const builderConfig = builderValue.configId ? getConfiguration(builderValue.configId) : null
  const builderNamedCustomItemCount = builderValue.customItems.filter((i) => i.name.trim()).length
  const builderItemCount =
    Object.values(builderValue.assignments).reduce((n, list) => n + list.length, 0) + builderNamedCustomItemCount
  const builderComplete = builderConfig ? isBuilderComplete(builderConfig, builderValue.assignments, catalogItems) : false
  const canApplyBuilder = builderValue.confirmed && builderConfig !== null && builderItemCount > 0

  function resolveBuilderOutput() {
    const laborCents = builderValue.laborPrice.trim() ? parseDollarsToCents(builderValue.laborPrice) : null
    const { catalog: resolvedCatalog, assignments: resolvedAssignments } = resolveBuilderCatalog(
      builderConfig,
      catalogItems,
      builderValue.assignments,
      laborCents,
    )
    const subtotalCents =
      computeComponentSubtotalCents(resolvedAssignments, resolvedCatalog) + customItemsSubtotalCents(builderValue.customItems)
    const overrideCents = builderValue.priceOverride.trim() ? parseDollarsToCents(builderValue.priceOverride) : null
    return { resolvedCatalog, resolvedAssignments, priceCents: overrideCents ?? subtotalCents }
  }

  function applyBuilder() {
    if (!canApplyBuilder || !builderConfig) return
    const { resolvedAssignments, resolvedCatalog, priceCents } = resolveBuilderOutput()
    const items = [...assignmentsToQuoteItems(resolvedAssignments, resolvedCatalog), ...customItemsToQuoteItems(builderValue.customItems)]
    if (items.length === 0) {
      toast('error', 'Add at least one product before applying.')
      return
    }
    replace(
      items.map((item) => ({
        brand: item.brand ?? '',
        model: item.model ?? '',
        name: item.name,
        quantity: item.quantity,
        category: item.category,
        imageUrl: null,
      })),
    )
    setValue('main.price', (priceCents / 100).toFixed(2), { shouldValidate: true, shouldDirty: true })
    setValue('main.configId', builderConfig.id, { shouldValidate: true, shouldDirty: true })
    setBuilderOpen(false)
  }

  async function saveAsPackageTemplate() {
    if (!builderConfig) return
    const trimmedName = packageName.trim()
    if (!trimmedName) {
      toast('error', 'Name this package before saving it.')
      return
    }
    const { resolvedAssignments, resolvedCatalog, priceCents } = resolveBuilderOutput()
    const items = [...assignmentsToPackageItems(resolvedAssignments, resolvedCatalog), ...customItemsToPackageItems(builderValue.customItems)]
    if (items.length === 0) {
      toast('error', 'Add at least one product before saving a package.')
      return
    }
    setSavingPackage(true)
    try {
      await repo.createPackageTemplate({
        name: trimmedName,
        description: '',
        configId: builderConfig.id,
        vehicleTypes: builderConfig.vehicleTypes,
        installedPriceCents: priceCents,
        laborIncluded: builderValue.laborPrice.trim() !== '' && (parseDollarsToCents(builderValue.laborPrice) ?? 0) > 0,
        source: 'staff_saved',
        items,
      })
      toast('success', `Saved "${trimmedName}" — pending manager approval before other staff can use it.`)
      setPackageName('')
    } catch {
      toast('error', 'Could not save this package. Please try again.')
    } finally {
      setSavingPackage(false)
    }
  }

  // Deposit amount auto-fills at 15% of the price above, live, unless the
  // staff has manually edited it — tracked by comparing against the last
  // value this effect itself wrote, so a later price tweak never clobbers a
  // manual override.
  const priceValue = useWatch({ control, name: 'main.price' })
  const depositAmountValue = useWatch({ control, name: 'main.depositAmount' })
  const lastAutoDepositRef = useRef<string | null>(null)

  useEffect(() => {
    const cents = parseDollarsToCents(priceValue)
    if (cents === null) return
    const suggested = (computeDefaultDepositCents(cents) / 100).toFixed(2)
    if (depositAmountValue === '' || depositAmountValue === lastAutoDepositRef.current) {
      setValue('main.depositAmount', suggested)
      lastAutoDepositRef.current = suggested
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only recompute when price changes, not on every depositAmount keystroke
  }, [priceValue])

  const depositOverride = useWatch({ control, name: 'main.depositOverride' })
  const depositMethod = useWatch({ control, name: 'main.depositMethod' })

  return (
    <div className="space-y-4">
      <Field label="Package name" htmlFor="main-name" error={mainErrors?.name?.message}>
        <Input id="main-name" {...register('main.name')} />
      </Field>
      <Field label="One-line description" htmlFor="main-desc" hint="What does the customer get?">
        <Input id="main-desc" {...register('main.description')} />
      </Field>

      <div>
        <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
          <p className="text-base font-semibold text-ink">Products</p>
          {catalogItems.length > 0 ? (
            <Button variant="ghost" onClick={() => setBuilderOpen(true)}>
              <LayoutGrid className="h-5 w-5" aria-hidden="true" /> Build with drag & drop
            </Button>
          ) : null}
        </div>

        <Modal open={builderOpen} onClose={() => setBuilderOpen(false)} title="Build with drag & drop" size="xl">
          <div className="space-y-3">
            <PackageBuilder catalogItems={catalogItems} value={builderValue} onChange={setBuilderValue} />
            {builderConfig && !builderComplete ? (
              <p className="flex items-center gap-1.5 text-sm font-medium text-amber-700">
                <TriangleAlert className="h-4 w-4 shrink-0" aria-hidden="true" /> Some required slots are empty
              </p>
            ) : null}
            <div className="flex flex-wrap items-center gap-2 border-t border-zinc-100 pt-3">
              <Button type="button" onClick={applyBuilder} disabled={!canApplyBuilder}>
                <Check className="h-5 w-5" aria-hidden="true" /> Apply
              </Button>
              <Button type="button" variant="ghost" onClick={() => setBuilderOpen(false)}>
                Cancel
              </Button>
            </div>
            {builderConfig ? (
              <div className="flex flex-wrap items-end gap-2 border-t border-zinc-100 pt-3">
                <Field label="Package name" htmlFor="main-pkg-name">
                  <Input
                    id="main-pkg-name"
                    placeholder="e.g. Daily Bass 1×12"
                    value={packageName}
                    onChange={(e) => setPackageName(e.target.value)}
                  />
                </Field>
                <Button type="button" variant="secondary" disabled={savingPackage || builderItemCount === 0} onClick={() => void saveAsPackageTemplate()}>
                  {savingPackage ? 'Saving…' : 'Save as package'}
                </Button>
              </div>
            ) : null}
          </div>
        </Modal>

        <ItemRows basePath="main.items" control={control} register={register} itemHistory={itemHistory} catalogItems={catalogItems} listIdPrefix="main-items" />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Price (installed)" htmlFor="main-price" error={mainErrors?.price?.message}>
          <Input id="main-price" inputMode="decimal" placeholder="$2,899" {...register('main.price')} />
        </Field>
        <Field
          label="Deposit amount"
          htmlFor="main-deposit-amount"
          error={mainErrors?.depositAmount?.message}
          hint={`Auto-filled at ${DEFAULT_DEPOSIT_PERCENT}% of the price above — change it if you want a different amount.`}
        >
          <Input id="main-deposit-amount" inputMode="decimal" placeholder="$435" {...register('main.depositAmount')} />
        </Field>
      </div>
      <label className="flex items-center gap-2.5 text-base font-medium text-ink">
        <input type="checkbox" className="h-5 w-5 accent-[#1d4ed8]" {...register('main.depositOverride')} />
        Use a different payment method for this deposit
      </label>
      {depositOverride ? (
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Payment method" htmlFor="main-deposit-method">
            <Select id="main-deposit-method" {...register('main.depositMethod')}>
              <option value="none">No deposit</option>
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
              htmlFor="main-deposit-handle"
              error={mainErrors?.depositHandle?.message}
              hint={PAYMENT_METHOD_INFO[depositMethod].hint}
            >
              <Input id="main-deposit-handle" placeholder={PAYMENT_METHOD_INFO[depositMethod].placeholder} {...register('main.depositHandle')} />
            </Field>
          ) : null}
        </div>
      ) : null}
      <label className="flex items-center gap-2.5 text-base font-medium text-ink">
        <input type="checkbox" className="h-5 w-5 accent-[#1d4ed8]" {...register('main.laborIncluded')} />
        Labor included
      </label>
    </div>
  )
}

function AddonOptionEditor({
  index,
  control,
  register,
  errors,
  mainPriceCents,
  onRemove,
  catalogItems,
  itemHistory,
}: {
  index: number
  control: Control<FormValues>
  register: UseFormRegister<FormValues>
  errors: FieldErrors<FormValues>
  mainPriceCents: number
  onRemove: () => void
  catalogItems: CatalogItem[]
  itemHistory: { brands: string[]; models: string[]; names: string[] }
}) {
  const addonErrors = errors.addons?.[index]
  const priceValue = useWatch({ control, name: `addons.${index}.price` })
  const addonPriceCents = parseDollarsToCents(priceValue) ?? 0

  return (
    <fieldset className="rounded-xl border border-zinc-200 p-4">
      <legend className="flex items-center gap-1.5 px-1 text-base font-bold text-charcoal">
        <Sparkles className="h-4 w-4 text-brand" aria-hidden="true" /> Add-on {index + 1}
      </legend>
      <div className="space-y-3">
        <Field label="Name" htmlFor={`addon-${index}-name`} error={addonErrors?.name?.message}>
          <Input id={`addon-${index}-name`} placeholder="e.g. Ceramic tint upgrade" {...register(`addons.${index}.name`)} />
        </Field>
        <Field label="One-line description" htmlFor={`addon-${index}-desc`}>
          <Input id={`addon-${index}-desc`} {...register(`addons.${index}.description`)} />
        </Field>
        <ItemRows
          basePath={`addons.${index}.items`}
          control={control}
          register={register}
          itemHistory={itemHistory}
          catalogItems={catalogItems}
          listIdPrefix={`addon-${index}-items`}
        />
        <Field label="Extra price" htmlFor={`addon-${index}-price`} error={addonErrors?.price?.message} hint="Added on top of the main package price.">
          <Input id={`addon-${index}-price`} inputMode="decimal" placeholder="$300" {...register(`addons.${index}.price`)} />
        </Field>
        {addonPriceCents > 0 ? (
          <p className="text-sm font-semibold text-zinc-600">
            +{formatCurrency(addonPriceCents)} → total {formatCurrency(mainPriceCents + addonPriceCents)}
          </p>
        ) : null}
        <Button variant="danger" onClick={onRemove}>
          <Trash2 className="h-5 w-5" aria-hidden="true" /> Remove add-on
        </Button>
      </div>
    </fieldset>
  )
}

function TintOptionEditor({
  index,
  control,
  setValue,
  errors,
  onRemove,
}: {
  index: number
  control: Control<FormValues>
  setValue: UseFormSetValue<FormValues>
  errors: FieldErrors<FormValues>
  onRemove: () => void
}) {
  const value = useWatch({ control, name: `windowTints.${index}` })
  const tintErrors = errors.windowTints?.[index]

  return (
    <fieldset className="rounded-xl border border-zinc-200 p-4">
      <legend className="px-1 text-base font-bold text-charcoal">Tint option {index + 1}</legend>
      <div className="space-y-4">
        <Field label="Tint option name" htmlFor={`tint-${index}-name`} error={tintErrors?.name?.message}>
          <Input
            id={`tint-${index}-name`}
            value={value.name}
            onChange={(e) => setValue(`windowTints.${index}.name`, e.target.value, { shouldValidate: true, shouldDirty: true })}
          />
        </Field>
        <WindowTintEditor
          index={index}
          value={value}
          onChange={(next) => setValue(`windowTints.${index}`, next, { shouldValidate: true, shouldDirty: true })}
        />
        {tintErrors ? (
          <p role="alert" className="text-sm font-medium text-red-700">
            Check the tint details above — a % or price is missing or invalid.
          </p>
        ) : null}
        <Button variant="danger" onClick={onRemove}>
          <Trash2 className="h-5 w-5" aria-hidden="true" /> Remove tint option
        </Button>
      </div>
    </fieldset>
  )
}
