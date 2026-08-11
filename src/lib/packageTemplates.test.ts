import { describe, expect, it } from 'vitest'
import { canSaveAsPackage, quoteOptionToPackageTemplateDraft } from './packageTemplates'
import { validatePackageSlots, getConfiguration } from './audioConfigs'
import type { QuoteOption } from '../types'

function makeOption(overrides: Partial<QuoteOption> = {}): QuoteOption {
  return {
    id: 'opt-1',
    quoteId: 'quote-1',
    optionKind: 'main',
    name: 'Good',
    description: 'Punchier bass, clean install.',
    configId: 'bass_2x8',
    priceCents: 89900,
    laborIncluded: true,
    depositPaymentMethod: null,
    depositPaymentHandle: null,
    depositAmountCents: null,
    position: 0,
    items: [
      { id: 'i1', quoteOptionId: 'opt-1', brand: 'Kicker', model: 'CompR', name: '8" sub', quantity: 2, description: null, category: 'subwoofer', imageUrl: null, position: 0 },
      { id: 'i2', quoteOptionId: 'opt-1', brand: 'Q-Power', model: 'QBOMB', name: 'Ported box', quantity: 1, description: null, category: 'enclosure', imageUrl: null, position: 1 },
      { id: 'i3', quoteOptionId: 'opt-1', brand: 'Rockford', model: 'R500X1D', name: 'Mono amp', quantity: 1, description: null, category: 'mono_amp', imageUrl: null, position: 2 },
      { id: 'i4', quoteOptionId: 'opt-1', brand: 'Rockford', model: 'RFK4X', name: 'Wiring kit', quantity: 1, description: null, category: 'wiring_kit', imageUrl: null, position: 3 },
      { id: 'i5', quoteOptionId: 'opt-1', brand: null, model: null, name: 'Install labor', quantity: 1, description: null, category: 'labor', imageUrl: null, position: 4 },
    ],
    ...overrides,
  }
}

describe('canSaveAsPackage', () => {
  it('requires at least one item', () => {
    expect(canSaveAsPackage(makeOption())).toBe(true)
    expect(canSaveAsPackage(makeOption({ items: [] }))).toBe(false)
  })
})

describe('quoteOptionToPackageTemplateDraft', () => {
  it('copies every value — a pure snapshot, not a live reference', () => {
    const option = makeOption()
    const draft = quoteOptionToPackageTemplateDraft(option, { name: '  Truck 2x8 Starter  ', vehicleTypes: ['truck'] })

    expect(draft.name).toBe('Truck 2x8 Starter') // trimmed
    expect(draft.description).toBe(option.description)
    expect(draft.configId).toBe('bass_2x8')
    expect(draft.vehicleTypes).toEqual(['truck'])
    expect(draft.installedPriceCents).toBe(89900)
    expect(draft.laborIncluded).toBe(true)
    expect(draft.source).toBe('staff_saved')
    expect(draft.sourceQuoteId).toBe('quote-1')
    expect(draft.sourceQuoteOptionId).toBe('opt-1')
    expect(draft.items).toHaveLength(5)
    expect(draft.items[0]).toEqual({
      brand: 'Kicker', model: 'CompR', name: '8" sub', quantity: 2, description: null, category: 'subwoofer', imageUrl: null,
    })

    // Mutating the source option afterwards must never affect the draft
    // already produced — proves this isn't holding a live reference.
    option.name = 'Renamed after the fact'
    option.items[0].quantity = 999
    expect(draft.items[0].quantity).toBe(2)
  })

  it('carries a quote item image through to the package draft — a real snapshot, not discarded', () => {
    const option = makeOption()
    option.items[0].imageUrl = 'https://example.com/sub.jpg'
    const draft = quoteOptionToPackageTemplateDraft(option, { name: 'Truck 2x8 Starter' })
    expect(draft.items[0].imageUrl).toBe('https://example.com/sub.jpg')
    expect(draft.items[1].imageUrl).toBeNull()
  })

  it('defaults vehicleTypes to empty when not given', () => {
    const draft = quoteOptionToPackageTemplateDraft(makeOption(), { name: 'Any vehicle' })
    expect(draft.vehicleTypes).toEqual([])
  })

  it('carries a null configId through untouched when the option had none', () => {
    const draft = quoteOptionToPackageTemplateDraft(makeOption({ configId: null }), { name: 'Custom build' })
    expect(draft.configId).toBeNull()
  })

  it('produces a draft whose items satisfy validatePackageSlots for the matching configuration', () => {
    const option = makeOption()
    const draft = quoteOptionToPackageTemplateDraft(option, { name: 'Truck 2x8 Starter' })
    const config = getConfiguration(draft.configId!)!
    const result = validatePackageSlots(
      config,
      draft.items.map((i) => ({ category: i.category, quantity: i.quantity })),
    )
    expect(result.complete).toBe(true)
  })
})
