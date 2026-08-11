import { describe, expect, it } from 'vitest'
import {
  addOrIncrementCartItem,
  cartSubtotalCents,
  cartToInvoiceItemInputs,
  cartToQuoteItemInputs,
  removeCartItem,
  setCartItemQuantity,
  updateCartItem,
  type ScannedCartItem,
} from './scanCart'

function makeItem(overrides: Partial<ScannedCartItem> = {}): ScannedCartItem {
  return {
    id: 'row-1',
    catalogItemId: 'cat-1',
    name: '12" subwoofer',
    brand: 'Kicker',
    model: 'CompR 12',
    imageUrl: null,
    unitPriceCents: 14900,
    quantity: 1,
    category: 'subwoofer',
    ...overrides,
  }
}

describe('addOrIncrementCartItem', () => {
  it('adds a new row for the first scan of a catalog item', () => {
    const cart = addOrIncrementCartItem([], makeItem())
    expect(cart).toHaveLength(1)
    expect(cart[0].quantity).toBe(1)
  })

  it('bumps quantity instead of duplicating when the same catalog item is scanned again', () => {
    let cart = addOrIncrementCartItem([], makeItem())
    cart = addOrIncrementCartItem(cart, makeItem({ id: 'row-2' }))
    expect(cart).toHaveLength(1)
    expect(cart[0].quantity).toBe(2)
  })

  it('adds a separate row for a different catalog item', () => {
    let cart = addOrIncrementCartItem([], makeItem())
    cart = addOrIncrementCartItem(cart, makeItem({ id: 'row-2', catalogItemId: 'cat-2', name: 'Mono amp' }))
    expect(cart).toHaveLength(2)
  })

  it('never merges custom (catalogItemId null) items — each is its own row', () => {
    let cart = addOrIncrementCartItem([], makeItem({ catalogItemId: null, name: 'Misc hardware' }))
    cart = addOrIncrementCartItem(cart, makeItem({ id: 'row-2', catalogItemId: null, name: 'Misc hardware' }))
    expect(cart).toHaveLength(2)
  })
})

describe('setCartItemQuantity', () => {
  it('sets the quantity on the matching row', () => {
    const cart = setCartItemQuantity([makeItem()], 'row-1', 5)
    expect(cart[0].quantity).toBe(5)
  })

  it('removes the row entirely at zero or below', () => {
    expect(setCartItemQuantity([makeItem()], 'row-1', 0)).toHaveLength(0)
    expect(setCartItemQuantity([makeItem()], 'row-1', -3)).toHaveLength(0)
  })
})

describe('updateCartItem', () => {
  it('patches only the matching row, leaving others untouched', () => {
    const cart = [makeItem(), makeItem({ id: 'row-2', catalogItemId: 'cat-2' })]
    const updated = updateCartItem(cart, 'row-1', { unitPriceCents: 12900, name: 'Renamed sub' })
    expect(updated[0].unitPriceCents).toBe(12900)
    expect(updated[0].name).toBe('Renamed sub')
    expect(updated[1].unitPriceCents).toBe(14900) // untouched
  })
})

describe('removeCartItem', () => {
  it('removes the matching row', () => {
    const cart = [makeItem(), makeItem({ id: 'row-2', catalogItemId: 'cat-2' })]
    expect(removeCartItem(cart, 'row-1')).toEqual([cart[1]])
  })
})

describe('cartSubtotalCents', () => {
  it('sums price * quantity across all rows', () => {
    const cart = [makeItem({ unitPriceCents: 10000, quantity: 2 }), makeItem({ id: 'row-2', catalogItemId: 'cat-2', unitPriceCents: 5000, quantity: 3 })]
    expect(cartSubtotalCents(cart)).toBe(10000 * 2 + 5000 * 3)
  })

  it('returns 0 for an empty cart', () => {
    expect(cartSubtotalCents([])).toBe(0)
  })
})

describe('cartToInvoiceItemInputs', () => {
  it('drops the local row id and keeps the rest of the fields', () => {
    const [input] = cartToInvoiceItemInputs([makeItem()])
    expect(input).toEqual({
      catalogItemId: 'cat-1',
      brand: 'Kicker',
      model: 'CompR 12',
      name: '12" subwoofer',
      quantity: 1,
      unitPriceCents: 14900,
      category: 'subwoofer',
    })
    expect(input).not.toHaveProperty('id')
  })
})

describe('cartToQuoteItemInputs', () => {
  it('drops id, catalogItemId, and per-item price — a quote option prices as one lump sum', () => {
    const [input] = cartToQuoteItemInputs([makeItem()])
    expect(input).toEqual({
      brand: 'Kicker',
      model: 'CompR 12',
      name: '12" subwoofer',
      quantity: 1,
      category: 'subwoofer',
      imageUrl: null,
    })
    expect(input).not.toHaveProperty('id')
    expect(input).not.toHaveProperty('catalogItemId')
    expect(input).not.toHaveProperty('unitPriceCents')
  })

  it('preserves item order and every row, including custom (catalogItemId null) lines', () => {
    const cart = [makeItem(), makeItem({ id: 'row-2', catalogItemId: null, name: 'Shop supplies fee', brand: null, model: null, category: null })]
    const inputs = cartToQuoteItemInputs(cart)
    expect(inputs).toHaveLength(2)
    expect(inputs[1].name).toBe('Shop supplies fee')
  })
})
