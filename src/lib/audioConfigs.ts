// Universal car-audio configuration engine.
//
// A "configuration" is a *package shell*, not a finished package — e.g.
// "Truck 2×8" says a truck bass build normally needs two 8" subs, an
// enclosure, a mono amp, a wiring kit, integration when required, a bass
// control when applicable, and labor. It does NOT hard-code any brand,
// model, or price. Each shop fills these slots with the products it
// actually carries (see catalog + package templates).
//
// This file is intentionally pure, framework-agnostic data + functions so
// slot rules live in ONE place rather than scattered across UI components.
// New shells (door speakers, full systems, radios, cameras, marine, tint)
// can be added here without touching component code.

import type { ConfigShell, ProductCategory, VehicleType } from '../types'

export type { ConfigShell, ProductCategory, VehicleType }

// ---------------------------------------------------------------------------
// Product categories — the shared taxonomy used by both catalog products
// and configuration slots. A product's category is what lets it fill a slot.
// The bare union lives in types.ts (it's embedded in the persisted
// CatalogItem type); labels live here since they're presentation, not data.
// ---------------------------------------------------------------------------

export const PRODUCT_CATEGORY_INFO: Record<ProductCategory, { label: string }> = {
  subwoofer: { label: 'Subwoofer' },
  enclosure: { label: 'Enclosure / box' },
  mono_amp: { label: 'Mono amplifier' },
  multi_amp: { label: 'Multi-channel amplifier' },
  wiring_kit: { label: 'Amp wiring kit' },
  integration: { label: 'Signal integration / LOC' },
  bass_control: { label: 'Bass control' },
  battery: { label: 'Battery / electrical' },
  big_three: { label: 'Big-three electrical upgrade' },
  epicenter: { label: 'Bass restoration (Epicenter)' },
  integration_module: { label: 'Factory integration module' },
  sound_treatment: { label: 'Sound treatment' },
  ofc_wiring: { label: 'Upgraded OFC wiring' },
  door_speaker: { label: 'Door speakers' },
  tweeter: { label: 'Tweeters' },
  radio: { label: 'Radio / head unit' },
  dsp: { label: 'DSP' },
  camera: { label: 'Camera' },
  fabrication: { label: 'Custom fabrication' },
  labor: { label: 'Installation labor' },
  accessory: { label: 'Accessory' },
  other: { label: 'Other' },
}

export const PRODUCT_CATEGORIES = Object.keys(PRODUCT_CATEGORY_INFO) as ProductCategory[]

// ---------------------------------------------------------------------------
// Vehicle types and shells
// ---------------------------------------------------------------------------

export const VEHICLE_TYPE_INFO: Record<VehicleType, { label: string }> = {
  truck: { label: 'Truck' },
  car: { label: 'Car' },
  sedan: { label: 'Sedan' },
  hatchback: { label: 'Hatchback' },
  suv: { label: 'SUV' },
}

export const VEHICLE_TYPES = Object.keys(VEHICLE_TYPE_INFO) as VehicleType[]

/** A shell is a whole *category* of package. Only 'bass' ships populated
 *  today; the rest are declared so the architecture supports them and the UI
 *  can list "coming soon" without new code. Window tint keeps its own
 *  dedicated system (see windowTint.ts) — it's declared here only for a
 *  complete taxonomy. */
export const SHELL_INFO: Record<ConfigShell, { label: string; active: boolean; hint: string }> = {
  bass: { label: 'Bass systems', active: true, hint: 'Subwoofers, enclosure, amp, wiring, labor' },
  door_speakers: { label: 'Voice / speakers', active: true, hint: 'Door speakers, tweeters, amp, DSP, integration' },
  full_system: { label: 'Complete systems', active: true, hint: 'Bass + voice + processing in one build' },
  radio: { label: 'Radios', active: false, hint: 'Head units and integration' },
  camera: { label: 'Cameras', active: false, hint: 'Backup / dash cameras' },
  marine: { label: 'Marine / powersports', active: false, hint: 'Weatherproof audio' },
  tint: { label: 'Window tint', active: false, hint: 'Handled by the window-tint configurator' },
}

// ---------------------------------------------------------------------------
// Slots + configurations
// ---------------------------------------------------------------------------

export type SlotRequirement = 'required' | 'recommended' | 'optional'

export interface ConfigSlot {
  /** Stable within a configuration; used as a React key and fill target. */
  key: string
  category: ProductCategory
  label: string
  requirement: SlotRequirement
  /** Minimum total quantity (across products in this category) to count as filled. */
  minQuantity: number
  note?: string
}

export interface AudioConfiguration {
  id: string
  shell: ConfigShell
  label: string
  vehicleTypes: VehicleType[]
  /** Number of subwoofers the label implies (e.g. 2 for "2×8"). Bass-shell configs only. */
  subCount?: number
  /** Subwoofer size in inches the label implies (e.g. 8 for "2×8"). Bass-shell configs only. */
  subSizeInches?: number
  slots: ConfigSlot[]
  /** Plain-language outcome for staff/customers, no jargon. */
  description: string
}

/** The shared bass slot ruleset. Every bass configuration uses this — the
 *  only thing that changes between configs is how many subs of what size. */
function bassSlots(subCount: number, subSizeInches: number): ConfigSlot[] {
  return [
    {
      key: 'subwoofer',
      category: 'subwoofer',
      label: `${subCount}× ${subSizeInches}" subwoofer${subCount > 1 ? 's' : ''}`,
      requirement: 'required',
      minQuantity: subCount,
    },
    { key: 'enclosure', category: 'enclosure', label: 'Compatible enclosure', requirement: 'required', minQuantity: 1 },
    { key: 'mono_amp', category: 'mono_amp', label: 'Mono amplifier', requirement: 'required', minQuantity: 1 },
    { key: 'wiring_kit', category: 'wiring_kit', label: 'Amp wiring kit', requirement: 'required', minQuantity: 1 },
    { key: 'labor', category: 'labor', label: 'Installation labor', requirement: 'required', minQuantity: 1 },
    {
      key: 'integration',
      category: 'integration',
      label: 'Signal integration / line-output',
      requirement: 'recommended',
      minQuantity: 1,
      note: 'Add when integrating with a factory radio.',
    },
    {
      key: 'bass_control',
      category: 'bass_control',
      label: 'Bass control',
      requirement: 'recommended',
      minQuantity: 1,
      note: 'When the customer wants an in-dash bass knob.',
    },
    { key: 'battery', category: 'battery', label: 'Battery / electrical support', requirement: 'optional', minQuantity: 1 },
    { key: 'epicenter', category: 'epicenter', label: 'Bass restoration', requirement: 'optional', minQuantity: 1 },
    {
      key: 'integration_module',
      category: 'integration_module',
      label: 'Factory-system integration module',
      requirement: 'optional',
      minQuantity: 1,
    },
    { key: 'sound_treatment', category: 'sound_treatment', label: 'Sound treatment', requirement: 'optional', minQuantity: 1 },
    { key: 'ofc_wiring', category: 'ofc_wiring', label: 'Upgraded OFC wiring', requirement: 'optional', minQuantity: 1 },
    { key: 'door_speaker', category: 'door_speaker', label: 'Door-speaker upgrade', requirement: 'optional', minQuantity: 1 },
    { key: 'fabrication', category: 'fabrication', label: 'Custom fabrication', requirement: 'optional', minQuantity: 1 },
  ]
}

function bassConfig(
  id: string,
  label: string,
  vehicleTypes: VehicleType[],
  subCount: number,
  subSizeInches: number,
): AudioConfiguration {
  const count = subCount > 1 ? `${subCount} ${subSizeInches}-inch subs` : `a single ${subSizeInches}-inch sub`
  return {
    id,
    shell: 'bass',
    label,
    vehicleTypes,
    subCount,
    subSizeInches,
    slots: bassSlots(subCount, subSizeInches),
    description: `Adds punchier, deeper bass with ${count} on a matched amp — a clean, reliable upgrade.`,
  }
}

// Truck bass shells.
const TRUCK_BASS: AudioConfiguration[] = [
  bassConfig('truck_2x8', 'Truck 2×8', ['truck'], 2, 8),
  bassConfig('truck_4x8', 'Truck 4×8', ['truck'], 4, 8),
  bassConfig('truck_2x10', 'Truck 2×10', ['truck'], 2, 10),
  bassConfig('truck_2x12', 'Truck 2×12', ['truck'], 2, 12),
]

// Car / sedan / hatchback / SUV bass shells.
const CAR_VEHICLE_TYPES: VehicleType[] = ['car', 'sedan', 'hatchback', 'suv']
const CAR_BASS: AudioConfiguration[] = [
  bassConfig('car_1x8', 'Car 1×8', CAR_VEHICLE_TYPES, 1, 8),
  bassConfig('car_2x8', 'Car 2×8', CAR_VEHICLE_TYPES, 2, 8),
  bassConfig('car_1x10', 'Car 1×10', CAR_VEHICLE_TYPES, 1, 10),
  bassConfig('car_2x10', 'Car 2×10', CAR_VEHICLE_TYPES, 2, 10),
  bassConfig('car_1x12', 'Car 1×12', CAR_VEHICLE_TYPES, 1, 12),
  bassConfig('car_2x12', 'Car 2×12', CAR_VEHICLE_TYPES, 2, 12),
  bassConfig('car_1x15', 'Car 1×15', CAR_VEHICLE_TYPES, 1, 15),
  bassConfig('car_2x15', 'Car 2×15', CAR_VEHICLE_TYPES, 2, 15),
]

// ---------------------------------------------------------------------------
// Door-speaker ("voice") shells — front stage upgrades, independent of bass.
// Applies to every vehicle type equally, unlike bass sizing.
// ---------------------------------------------------------------------------

/** The shared voice-system slot ruleset. `includeTweeter` bumps tweeters from optional
 *  to required (a 3-way front stage); `frontOnly` halves the door-speaker/tweeter counts. */
function speakerSlots(includeTweeter: boolean, frontOnly: boolean): ConfigSlot[] {
  const speakerCount = frontOnly ? 2 : 4
  return [
    {
      key: 'door_speaker',
      category: 'door_speaker',
      label: `${speakerCount}× door / component speaker${speakerCount > 1 ? 's' : ''}`,
      requirement: 'required',
      minQuantity: speakerCount,
    },
    {
      key: 'tweeter',
      category: 'tweeter',
      label: 'Tweeters',
      requirement: includeTweeter ? 'required' : 'optional',
      minQuantity: 2,
      note: includeTweeter ? undefined : 'Add for a 3-way front stage.',
    },
    {
      key: 'multi_amp',
      category: 'multi_amp',
      label: '4/5-channel amplifier',
      requirement: 'recommended',
      minQuantity: 1,
      note: 'Powers the speakers — skip if running off the head unit.',
    },
    { key: 'wiring_kit', category: 'wiring_kit', label: 'Amp wiring kit', requirement: 'recommended', minQuantity: 1 },
    {
      key: 'integration_module',
      category: 'integration_module',
      label: 'Factory integration (T-harness / amp bypass)',
      requirement: 'recommended',
      minQuantity: 1,
      note: 'Retains factory radio controls and wiring.',
    },
    { key: 'dsp', category: 'dsp', label: 'DSP', requirement: 'optional', minQuantity: 1, note: 'Time alignment and EQ tuning.' },
    {
      key: 'radio',
      category: 'radio',
      label: 'Head unit',
      requirement: 'optional',
      minQuantity: 1,
      note: 'Only if replacing the factory radio.',
    },
    { key: 'labor', category: 'labor', label: 'Installation labor', requirement: 'required', minQuantity: 1 },
  ]
}

function speakerConfig(id: string, label: string, includeTweeter: boolean, frontOnly: boolean): AudioConfiguration {
  const stage = includeTweeter ? '3-way' : '2-way'
  const coverage = frontOnly ? 'front speakers' : 'front and rear speakers'
  return {
    id,
    shell: 'door_speakers',
    label,
    vehicleTypes: VEHICLE_TYPES,
    slots: speakerSlots(includeTweeter, frontOnly),
    description: `Upgrades the ${coverage} to a ${stage} setup for clearer mids and highs.`,
  }
}

const DOOR_SPEAKER_CONFIGS: AudioConfiguration[] = [
  speakerConfig('speakers_2way_front', '2-Way Front Speakers', false, true),
  speakerConfig('speakers_2way_front_rear', '2-Way Front + Rear Speakers', false, false),
  speakerConfig('speakers_3way_front', '3-Way Front Speakers', true, true),
  speakerConfig('speakers_3way_front_rear', '3-Way Front + Rear Speakers', true, false),
]

// ---------------------------------------------------------------------------
// Full-system shells — bass + voice + processing combined into one build.
// A deliberately small starter set (one per broad vehicle group), not every
// possible sub/speaker combination — staff can still add/swap components
// freely once in the builder; this is a starting shape, not a hard limit.
// ---------------------------------------------------------------------------

function fullSystemSlots(subCount: number, subSizeInches: number, includeTweeter: boolean): ConfigSlot[] {
  return [
    {
      key: 'subwoofer',
      category: 'subwoofer',
      label: `${subCount}× ${subSizeInches}" subwoofer${subCount > 1 ? 's' : ''}`,
      requirement: 'required',
      minQuantity: subCount,
    },
    { key: 'enclosure', category: 'enclosure', label: 'Compatible enclosure', requirement: 'required', minQuantity: 1 },
    { key: 'mono_amp', category: 'mono_amp', label: 'Mono amplifier (bass)', requirement: 'required', minQuantity: 1 },
    { key: 'door_speaker', category: 'door_speaker', label: '2× door / component speakers', requirement: 'required', minQuantity: 2 },
    {
      key: 'tweeter',
      category: 'tweeter',
      label: 'Tweeters',
      requirement: includeTweeter ? 'required' : 'optional',
      minQuantity: 2,
      note: includeTweeter ? undefined : 'Add for a 3-way front stage.',
    },
    {
      key: 'multi_amp',
      category: 'multi_amp',
      label: '4/5-channel amplifier (speakers)',
      requirement: 'recommended',
      minQuantity: 1,
    },
    {
      key: 'wiring_kit',
      category: 'wiring_kit',
      label: 'Amp wiring kit(s)',
      requirement: 'required',
      minQuantity: 1,
      note: 'One kit per amp — add quantity, or a couple of different wiring-kit products, as needed.',
    },
    {
      key: 'integration',
      category: 'integration',
      label: 'Signal integration / line-output',
      requirement: 'recommended',
      minQuantity: 1,
    },
    {
      key: 'integration_module',
      category: 'integration_module',
      label: 'Factory integration (T-harness / amp bypass)',
      requirement: 'recommended',
      minQuantity: 1,
    },
    {
      key: 'bass_control',
      category: 'bass_control',
      label: 'Bass control',
      requirement: 'recommended',
      minQuantity: 1,
      note: 'When the customer wants an in-dash bass knob.',
    },
    { key: 'dsp', category: 'dsp', label: 'DSP', requirement: 'optional', minQuantity: 1, note: 'Time alignment and EQ tuning.' },
    {
      key: 'radio',
      category: 'radio',
      label: 'Head unit',
      requirement: 'optional',
      minQuantity: 1,
      note: 'Only if replacing the factory radio.',
    },
    { key: 'epicenter', category: 'epicenter', label: 'Bass restoration', requirement: 'optional', minQuantity: 1 },
    { key: 'battery', category: 'battery', label: 'Battery / electrical support', requirement: 'optional', minQuantity: 1 },
    { key: 'sound_treatment', category: 'sound_treatment', label: 'Sound treatment', requirement: 'optional', minQuantity: 1 },
    { key: 'labor', category: 'labor', label: 'Installation labor', requirement: 'required', minQuantity: 1 },
  ]
}

function fullSystemConfig(
  id: string,
  label: string,
  vehicleTypes: VehicleType[],
  subCount: number,
  subSizeInches: number,
  includeTweeter: boolean,
): AudioConfiguration {
  const subText = subCount > 1 ? `${subCount} ${subSizeInches}-inch subs` : `a ${subSizeInches}-inch sub`
  const stage = includeTweeter ? '3-way front speakers' : '2-way front speakers'
  return {
    id,
    shell: 'full_system',
    label,
    vehicleTypes,
    subCount,
    subSizeInches,
    slots: fullSystemSlots(subCount, subSizeInches, includeTweeter),
    description: `A complete build: ${subText} for real bass, plus ${stage} for clean mids and highs.`,
  }
}

const FULL_SYSTEM_CONFIGS: AudioConfiguration[] = [
  fullSystemConfig('full_system_truck', 'Complete System — Truck', ['truck'], 2, 8, false),
  fullSystemConfig('full_system_car', 'Complete System — Car', CAR_VEHICLE_TYPES, 1, 10, false),
]

export const AUDIO_CONFIGURATIONS: AudioConfiguration[] = [
  ...TRUCK_BASS,
  ...CAR_BASS,
  ...DOOR_SPEAKER_CONFIGS,
  ...FULL_SYSTEM_CONFIGS,
]

// ---------------------------------------------------------------------------
// Lookups
// ---------------------------------------------------------------------------

export function getConfiguration(id: string): AudioConfiguration | null {
  return AUDIO_CONFIGURATIONS.find((c) => c.id === id) ?? null
}

export function configurationsForVehicleType(vehicleType: VehicleType): AudioConfiguration[] {
  return AUDIO_CONFIGURATIONS.filter((c) => c.vehicleTypes.includes(vehicleType))
}

export function configurationsForShell(shell: ConfigShell): AudioConfiguration[] {
  return AUDIO_CONFIGURATIONS.filter((c) => c.shell === shell)
}

// ---------------------------------------------------------------------------
// Slot validation — the reusable "is this package complete?" logic.
// ---------------------------------------------------------------------------

/** A line item as far as slot-filling cares: just its category + quantity.
 *  Deliberately decoupled from the catalog/quote types so this stays pure. */
export interface SlottableItem {
  category: ProductCategory | null
  quantity: number
}

export type SlotFillStatus = 'filled' | 'under' | 'missing'

export interface SlotFillResult {
  slot: ConfigSlot
  filledQuantity: number
  status: SlotFillStatus
}

export interface PackageValidation {
  configId: string
  slots: SlotFillResult[]
  /** Required slots that are missing or under-filled — these block "complete". */
  missingRequired: ConfigSlot[]
  /** Recommended slots not yet filled — surfaced to staff, never blocking. */
  missingRecommended: ConfigSlot[]
  /** Optional slots that ARE filled — nice-to-know for the summary. */
  filledOptional: ConfigSlot[]
  /** True when every required slot is filled to its minimum quantity. */
  complete: boolean
}

/**
 * Compares a configuration's slots against a set of line items and reports
 * which required/recommended/optional slots are filled. Items with a null
 * category (e.g. legacy quote items with no category yet) simply don't fill
 * any slot — staff still see what's missing rather than a false "complete".
 */
export function validatePackageSlots(config: AudioConfiguration, items: SlottableItem[]): PackageValidation {
  const quantityByCategory = new Map<ProductCategory, number>()
  for (const item of items) {
    if (!item.category) continue
    quantityByCategory.set(item.category, (quantityByCategory.get(item.category) ?? 0) + item.quantity)
  }

  const slots: SlotFillResult[] = config.slots.map((slot) => {
    const filledQuantity = quantityByCategory.get(slot.category) ?? 0
    let status: SlotFillStatus
    if (filledQuantity === 0) status = 'missing'
    else if (filledQuantity < slot.minQuantity) status = 'under'
    else status = 'filled'
    return { slot, filledQuantity, status }
  })

  const missingRequired = slots
    .filter((s) => s.slot.requirement === 'required' && s.status !== 'filled')
    .map((s) => s.slot)
  const missingRecommended = slots
    .filter((s) => s.slot.requirement === 'recommended' && s.status !== 'filled')
    .map((s) => s.slot)
  const filledOptional = slots
    .filter((s) => s.slot.requirement === 'optional' && s.status === 'filled')
    .map((s) => s.slot)

  return {
    configId: config.id,
    slots,
    missingRequired,
    missingRecommended,
    filledOptional,
    complete: missingRequired.length === 0,
  }
}
