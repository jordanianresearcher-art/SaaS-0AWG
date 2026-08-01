import { describe, expect, it } from 'vitest'
import {
  AUDIO_CONFIGURATIONS,
  configurationsForShell,
  configurationsForVehicleType,
  getConfiguration,
  validatePackageSlots,
  type SlottableItem,
} from './audioConfigs'

describe('configuration catalog', () => {
  it('has every listed truck and car bass configuration with unique ids', () => {
    const ids = AUDIO_CONFIGURATIONS.map((c) => c.id)
    expect(new Set(ids).size).toBe(ids.length) // no duplicates
    for (const id of ['truck_2x8', 'truck_4x8', 'truck_2x10', 'truck_2x12']) {
      expect(ids).toContain(id)
    }
    for (const id of ['car_1x8', 'car_2x8', 'car_1x10', 'car_2x10', 'car_1x12', 'car_2x12', 'car_1x15', 'car_2x15']) {
      expect(ids).toContain(id)
    }
  })

  it('encodes sub count and size from the label', () => {
    const c = getConfiguration('truck_2x8')!
    expect(c.subCount).toBe(2)
    expect(c.subSizeInches).toBe(8)
    const c2 = getConfiguration('car_1x15')!
    expect(c2.subCount).toBe(1)
    expect(c2.subSizeInches).toBe(15)
  })

  it('sizes the subwoofer slot minimum to the sub count', () => {
    const sub = getConfiguration('truck_4x8')!.slots.find((s) => s.category === 'subwoofer')!
    expect(sub.minQuantity).toBe(4)
    expect(sub.requirement).toBe('required')
  })

  it('marks sub, enclosure, mono amp, wiring, and labor as required on every bass config', () => {
    for (const config of AUDIO_CONFIGURATIONS.filter((c) => c.shell === 'bass')) {
      const required = new Set(config.slots.filter((s) => s.requirement === 'required').map((s) => s.category))
      expect(required).toEqual(new Set(['subwoofer', 'enclosure', 'mono_amp', 'wiring_kit', 'labor']))
    }
  })

  it('treats integration and bass control as recommended, not required', () => {
    const config = getConfiguration('truck_2x8')!
    const integration = config.slots.find((s) => s.category === 'integration')!
    const bassControl = config.slots.find((s) => s.category === 'bass_control')!
    expect(integration.requirement).toBe('recommended')
    expect(bassControl.requirement).toBe('recommended')
  })

  it('offers the documented optional upgrade slots', () => {
    const config = getConfiguration('truck_2x8')!
    const optional = new Set(config.slots.filter((s) => s.requirement === 'optional').map((s) => s.category))
    for (const cat of ['battery', 'epicenter', 'integration_module', 'sound_treatment', 'ofc_wiring', 'door_speaker', 'fabrication']) {
      expect(optional).toContain(cat)
    }
  })
})

describe('lookups', () => {
  it('returns truck bass configs for trucks and car bass configs for those bodies', () => {
    const truckBass = configurationsForVehicleType('truck').filter((c) => c.shell === 'bass')
    expect(truckBass.every((c) => c.id.startsWith('truck_'))).toBe(true)
    const suvBass = configurationsForVehicleType('suv').filter((c) => c.shell === 'bass')
    expect(suvBass.length).toBeGreaterThan(0)
    expect(suvBass.every((c) => c.id.startsWith('car_'))).toBe(true)
  })

  it('offers door-speaker and full-system configs across every vehicle type, unlike bass sizing', () => {
    for (const vt of ['truck', 'car', 'sedan', 'hatchback', 'suv'] as const) {
      const forType = configurationsForVehicleType(vt)
      expect(forType.some((c) => c.shell === 'door_speakers')).toBe(true)
      expect(forType.some((c) => c.shell === 'full_system')).toBe(true)
    }
  })

  it('groups configurations by shell — bass, door_speakers, and full_system are populated; the rest are not yet', () => {
    expect(configurationsForShell('bass').length).toBeGreaterThan(0)
    expect(configurationsForShell('door_speakers').length).toBeGreaterThan(0)
    expect(configurationsForShell('full_system').length).toBeGreaterThan(0)
    const populated = configurationsForShell('bass').length + configurationsForShell('door_speakers').length + configurationsForShell('full_system').length
    expect(populated).toBe(AUDIO_CONFIGURATIONS.length)
    for (const shell of ['radio', 'camera', 'marine', 'tint'] as const) {
      expect(configurationsForShell(shell)).toHaveLength(0)
    }
  })

  it('returns null for an unknown configuration id', () => {
    expect(getConfiguration('nope')).toBeNull()
  })
})

describe('door_speakers shell', () => {
  it('offers 2-way and 3-way, front-only and front+rear variants', () => {
    const configs = configurationsForShell('door_speakers')
    const ids = configs.map((c) => c.id)
    expect(ids).toEqual(
      expect.arrayContaining(['speakers_2way_front', 'speakers_2way_front_rear', 'speakers_3way_front', 'speakers_3way_front_rear']),
    )
  })

  it('requires tweeters only on the 3-way variants', () => {
    const twoWay = getConfiguration('speakers_2way_front')!
    const threeWay = getConfiguration('speakers_3way_front')!
    expect(twoWay.slots.find((s) => s.category === 'tweeter')!.requirement).toBe('optional')
    expect(threeWay.slots.find((s) => s.category === 'tweeter')!.requirement).toBe('required')
  })

  it('doubles the door-speaker minimum quantity for front+rear vs front-only', () => {
    const frontOnly = getConfiguration('speakers_2way_front')!
    const frontRear = getConfiguration('speakers_2way_front_rear')!
    expect(frontOnly.slots.find((s) => s.category === 'door_speaker')!.minQuantity).toBe(2)
    expect(frontRear.slots.find((s) => s.category === 'door_speaker')!.minQuantity).toBe(4)
  })

  it('never requires a subwoofer, enclosure, or mono amp — this is a voice-only shell', () => {
    for (const config of configurationsForShell('door_speakers')) {
      const required = new Set(config.slots.filter((s) => s.requirement === 'required').map((s) => s.category))
      expect(required.has('subwoofer')).toBe(false)
      expect(required.has('enclosure')).toBe(false)
      expect(required.has('mono_amp')).toBe(false)
    }
  })
})

describe('full_system shell', () => {
  it('combines bass and voice required slots in one configuration, with no duplicate slot keys', () => {
    const config = getConfiguration('full_system_truck')!
    const required = new Set(config.slots.filter((s) => s.requirement === 'required').map((s) => s.category))
    expect(required).toEqual(new Set(['subwoofer', 'enclosure', 'mono_amp', 'door_speaker', 'wiring_kit', 'labor']))
    const keys = config.slots.map((s) => s.key)
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('is complete only once both the bass and voice sides are filled', () => {
    const config = getConfiguration('full_system_truck')!
    const bassOnly: SlottableItem[] = [
      { category: 'subwoofer', quantity: 2 },
      { category: 'enclosure', quantity: 1 },
      { category: 'mono_amp', quantity: 1 },
      { category: 'wiring_kit', quantity: 1 },
      { category: 'labor', quantity: 1 },
    ]
    expect(validatePackageSlots(config, bassOnly).complete).toBe(false) // no door speakers yet
    const both = [...bassOnly, { category: 'door_speaker' as const, quantity: 2 }]
    expect(validatePackageSlots(config, both).complete).toBe(true)
  })

  it('offers one config per broad vehicle group', () => {
    expect(getConfiguration('full_system_truck')!.vehicleTypes).toEqual(['truck'])
    expect(getConfiguration('full_system_car')!.vehicleTypes).toEqual(['car', 'sedan', 'hatchback', 'suv'])
  })
})

describe('validatePackageSlots', () => {
  const config = getConfiguration('truck_2x8')! // needs 2 subs + enclosure + mono amp + wiring + labor

  it('reports complete once every required slot is filled to its minimum', () => {
    const items: SlottableItem[] = [
      { category: 'subwoofer', quantity: 2 },
      { category: 'enclosure', quantity: 1 },
      { category: 'mono_amp', quantity: 1 },
      { category: 'wiring_kit', quantity: 1 },
      { category: 'labor', quantity: 1 },
    ]
    const result = validatePackageSlots(config, items)
    expect(result.complete).toBe(true)
    expect(result.missingRequired).toHaveLength(0)
  })

  it('flags a required slot that is under-filled (only 1 of 2 subs)', () => {
    const items: SlottableItem[] = [
      { category: 'subwoofer', quantity: 1 },
      { category: 'enclosure', quantity: 1 },
      { category: 'mono_amp', quantity: 1 },
      { category: 'wiring_kit', quantity: 1 },
      { category: 'labor', quantity: 1 },
    ]
    const result = validatePackageSlots(config, items)
    expect(result.complete).toBe(false)
    const sub = result.slots.find((s) => s.slot.category === 'subwoofer')!
    expect(sub.status).toBe('under')
    expect(result.missingRequired.map((s) => s.category)).toContain('subwoofer')
  })

  it('sums quantities across multiple items of the same category', () => {
    const items: SlottableItem[] = [
      { category: 'subwoofer', quantity: 1 },
      { category: 'subwoofer', quantity: 1 }, // two single subs = 2 total
      { category: 'enclosure', quantity: 1 },
      { category: 'mono_amp', quantity: 1 },
      { category: 'wiring_kit', quantity: 1 },
      { category: 'labor', quantity: 1 },
    ]
    const result = validatePackageSlots(config, items)
    expect(result.slots.find((s) => s.slot.category === 'subwoofer')!.status).toBe('filled')
    expect(result.complete).toBe(true)
  })

  it('lists recommended slots that are unfilled without blocking completion', () => {
    const items: SlottableItem[] = [
      { category: 'subwoofer', quantity: 2 },
      { category: 'enclosure', quantity: 1 },
      { category: 'mono_amp', quantity: 1 },
      { category: 'wiring_kit', quantity: 1 },
      { category: 'labor', quantity: 1 },
    ]
    const result = validatePackageSlots(config, items)
    expect(result.complete).toBe(true) // recommended gaps never block
    expect(result.missingRecommended.map((s) => s.category)).toEqual(expect.arrayContaining(['integration', 'bass_control']))
  })

  it('surfaces filled optional upgrades', () => {
    const items: SlottableItem[] = [
      { category: 'subwoofer', quantity: 2 },
      { category: 'enclosure', quantity: 1 },
      { category: 'mono_amp', quantity: 1 },
      { category: 'wiring_kit', quantity: 1 },
      { category: 'labor', quantity: 1 },
      { category: 'battery', quantity: 1 },
    ]
    const result = validatePackageSlots(config, items)
    expect(result.filledOptional.map((s) => s.category)).toContain('battery')
  })

  it('does not let items with a null category fill any slot', () => {
    const items: SlottableItem[] = [
      { category: null, quantity: 5 }, // legacy quote items with no category
    ]
    const result = validatePackageSlots(config, items)
    expect(result.complete).toBe(false)
    expect(result.missingRequired.length).toBeGreaterThan(0)
    expect(result.slots.every((s) => s.filledQuantity === 0)).toBe(true)
  })
})
