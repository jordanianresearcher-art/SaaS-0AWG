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
    for (const config of AUDIO_CONFIGURATIONS) {
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
  it('returns truck configs for trucks and car/suv configs for those bodies', () => {
    expect(configurationsForVehicleType('truck').every((c) => c.id.startsWith('truck_'))).toBe(true)
    const suv = configurationsForVehicleType('suv')
    expect(suv.length).toBeGreaterThan(0)
    expect(suv.every((c) => c.id.startsWith('car_'))).toBe(true)
  })

  it('groups configurations by shell, with only the bass shell populated today', () => {
    expect(configurationsForShell('bass').length).toBe(AUDIO_CONFIGURATIONS.length)
    expect(configurationsForShell('radio')).toHaveLength(0)
  })

  it('returns null for an unknown configuration id', () => {
    expect(getConfiguration('nope')).toBeNull()
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
