import { describe, expect, it } from 'vitest'
import {
  barcodeAdvice,
  barcodeLookupForms,
  classifyBarcode,
  gs1CheckDigit,
  normalizeBarcodeInput,
} from './barcodeIdentity'

// The three codes below are real. A shop scanned them, got nothing, and
// reported product lookup as broken. Each one is a different fault, and they
// are the reason this module exists — so they are the spine of its tests.
const DOWN4SOUND_INTERNAL = '200001188725' // valid UPC-A, GS1 prefix 2
const DOWN4SOUND_ITEM_NO = '26040308' // 8 digits, not a valid EAN-8
const TARAMPS_EAN = '7908706600230' // valid EAN-13, prefix 790 = Brazil

describe('gs1CheckDigit', () => {
  it('computes the digit that makes a real EAN-13 valid', () => {
    expect(gs1CheckDigit('790870660023')).toBe(0)
  })

  it('computes the digit that makes a real UPC-A valid', () => {
    expect(gs1CheckDigit('20000118872')).toBe(5)
  })

  it('anchors its 3-1 alternation to the right, so it works at every length', () => {
    // Same algorithm, three lengths. If the weighting were anchored left
    // instead, UPC-A and EAN-13 would disagree about the same product.
    expect(gs1CheckDigit('03600029145')).toBe(2) // UPC-A, 11-digit payload
    expect(gs1CheckDigit('400638133393')).toBe(1) // EAN-13, 12-digit payload
    expect(gs1CheckDigit('9638507')).toBe(4) // EAN-8, 7-digit payload
  })
})

describe('classifyBarcode', () => {
  it('recognises a store-assigned code that no database can ever hold', () => {
    const id = classifyBarcode(DOWN4SOUND_INTERNAL)
    expect(id.kind).toBe('internal')
    // It is a perfectly valid barcode — that is the point. Validity is not
    // the same as findability, and conflating the two is what made this look
    // like a broken feature rather than an unlisted product.
    expect(id.checkDigitValid).toBe(true)
    expect(id.gs1Prefix).toBe('020')
    expect(id.storeAssigned).toBe(true)
    expect(id.likelyMisread).toBe(false)
  })

  it('reads a valid foreign EAN-13 as an ordinary, findable retail code', () => {
    const id = classifyBarcode(TARAMPS_EAN)
    expect(id.kind).toBe('ean_13')
    expect(id.checkDigitValid).toBe(true)
    expect(id.gs1Prefix).toBe('790')
    expect(id.origin).toBe('Brazil')
    expect(id.storeAssigned).toBe(false)
  })

  it('calls eight digits that fail EAN-8 an item number, not a misread', () => {
    // This label scans perfectly. Telling staff to rescan it would send them
    // in circles — it simply is not a retail barcode.
    const id = classifyBarcode(DOWN4SOUND_ITEM_NO)
    expect(id.kind).toBe('item_number')
    expect(id.checkDigitValid).toBe(false)
    expect(id.likelyMisread).toBe(false)
  })

  it('calls a 12- or 13-digit code with a bad check digit a misread', () => {
    // These formats always carry a check digit, so a mismatch means the
    // scanner dropped or transposed a bar — a real, actionable difference.
    const id = classifyBarcode('200001188726')
    expect(id.checkDigitValid).toBe(false)
    expect(id.likelyMisread).toBe(true)
  })

  it('treats a manufacturer part number as an identifier, not a bad scan', () => {
    const id = classifyBarcode('EZY-RCA110-GX')
    expect(id.kind).toBe('alphanumeric')
    expect(id.checkDigitValid).toBeNull()
    expect(id.likelyMisread).toBe(false)
    expect(id.storeAssigned).toBe(false)
  })

  it('classifies a UPC-A and its EAN-13 twin identically', () => {
    const upc = classifyBarcode('036000291452')
    const ean = classifyBarcode('0036000291452')
    expect(upc.gs1Prefix).toBe(ean.gs1Prefix)
    expect(upc.origin).toBe(ean.origin)
    expect(upc.checkDigitValid).toBe(true)
    expect(ean.checkDigitValid).toBe(true)
  })

  it('strips the separators scanners add', () => {
    expect(normalizeBarcodeInput('  790-870 660023 0 ')).toBe(TARAMPS_EAN)
    expect(classifyBarcode(' 790-8706600230 ').kind).toBe('ean_13')
  })
})

describe('barcodeLookupForms', () => {
  it('tries both the UPC-A and EAN-13 spellings of one product', () => {
    // The Brazilian amp came back empty partly because only one form was ever
    // queried. A database may hold either.
    expect(barcodeLookupForms('036000291452')).toEqual(['036000291452', '0036000291452'])
    expect(barcodeLookupForms('0036000291452')).toEqual(['0036000291452', '036000291452'])
  })

  it('leaves a non-zero-prefixed EAN-13 alone — it has no UPC-A form', () => {
    expect(barcodeLookupForms(TARAMPS_EAN)).toEqual([TARAMPS_EAN])
  })

  it('returns nothing at all for codes no database can hold', () => {
    // The caller skips the network entirely rather than waiting out a
    // guaranteed miss and then blaming the AI for it.
    expect(barcodeLookupForms(DOWN4SOUND_INTERNAL)).toEqual([])
    expect(barcodeLookupForms(DOWN4SOUND_ITEM_NO)).toEqual([])
    expect(barcodeLookupForms('EZY-RCA110-GX')).toEqual([])
  })
})

describe('barcodeAdvice', () => {
  it('points a store code straight at the thing that actually works', () => {
    const advice = barcodeAdvice(classifyBarcode(DOWN4SOUND_INTERNAL))
    expect(advice).toMatch(/store's own barcode/i)
    expect(advice).toMatch(/remembered for next time/i)
  })

  it('asks for a rescan only when the check digit says the scan misread', () => {
    expect(barcodeAdvice(classifyBarcode('200001188726'))).toMatch(/scanning it again/i)
    expect(barcodeAdvice(classifyBarcode(DOWN4SOUND_ITEM_NO))).not.toMatch(/scanning it again/i)
  })

  it('stays quiet for an ordinary retail code so the normal lookup just runs', () => {
    expect(barcodeAdvice(classifyBarcode(TARAMPS_EAN))).toBeNull()
    expect(barcodeAdvice(classifyBarcode('036000291452'))).toBeNull()
  })
})
