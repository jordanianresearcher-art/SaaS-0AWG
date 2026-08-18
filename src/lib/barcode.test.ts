import { describe, it, expect } from 'vitest'
import { code128ModuleCount, code128SvgMarkup, encodeCode128B } from './barcode'

describe('encodeCode128B', () => {
  it('wraps the data in a start code and a stop code', () => {
    const symbols = encodeCode128B('A')!
    expect(symbols[0]).toBe(104) // Start B
    expect(symbols[symbols.length - 1]).toBe(106) // Stop
  })

  it('encodes each character as its ASCII value minus 32', () => {
    const symbols = encodeCode128B('AB')!
    expect(symbols[1]).toBe('A'.charCodeAt(0) - 32)
    expect(symbols[2]).toBe('B'.charCodeAt(0) - 32)
  })

  it('appends a correct mod-103 check character', () => {
    // start(104) + 'A'(33)x1 + 'B'(34)x2 = 104 + 33 + 68 = 205; 205 % 103 = 102
    expect(encodeCode128B('AB')![3]).toBe(102)
    // start(104) + 'H'(40)x1 + 'I'(41)x2 = 104 + 40 + 82 = 226; 226 % 103 = 20
    expect(encodeCode128B('HI')![3]).toBe(20)
  })

  it('weights each character by its position, so transposition changes the check digit', () => {
    const ab = encodeCode128B('AB')!
    const ba = encodeCode128B('BA')!
    expect(ab[ab.length - 2]).not.toBe(ba[ba.length - 2])
  })

  it('encodes a real generated SKU', () => {
    const symbols = encodeCode128B('DS18-770DSP')
    expect(symbols).not.toBeNull()
    // start + 11 data + check + stop
    expect(symbols!.length).toBe(1 + 11 + 1 + 1)
  })

  it('refuses input Code 128-B cannot represent, rather than emitting a bad symbol', () => {
    expect(encodeCode128B('café')).toBeNull()
    expect(encodeCode128B('emoji 🎵')).toBeNull()
    expect(encodeCode128B('tab\there')).toBeNull()
    expect(encodeCode128B('')).toBeNull()
  })

  it('accepts the printable ASCII range end to end', () => {
    const printable = Array.from({ length: 95 }, (_, i) => String.fromCharCode(32 + i)).join('')
    expect(encodeCode128B(printable)).not.toBeNull()
  })
})

describe('code128SvgMarkup', () => {
  it('produces a standalone svg element', () => {
    const svg = code128SvgMarkup('DS18-770DSP')!
    expect(svg.startsWith('<svg')).toBe(true)
    expect(svg.endsWith('</svg>')).toBe(true)
    expect(svg).toContain('xmlns="http://www.w3.org/2000/svg"')
  })

  it('draws bars', () => {
    const svg = code128SvgMarkup('ABC')!
    expect(svg).toContain('<rect')
    expect(svg).toContain('fill="#000000"')
  })

  it('paints a white background so it stays scannable on a dark page', () => {
    expect(code128SvgMarkup('ABC')).toContain('fill="#ffffff"')
  })

  it('uses crispEdges — anti-aliased bars are what break cheap scanners', () => {
    expect(code128SvgMarkup('ABC')).toContain('shape-rendering="crispEdges"')
  })

  it('scales with moduleWidth', () => {
    const narrow = code128SvgMarkup('ABC', { moduleWidth: 1 })!
    const wide = code128SvgMarkup('ABC', { moduleWidth: 3 })!
    const widthOf = (svg: string) => Number(svg.match(/width="(\d+)"/)![1])
    expect(widthOf(wide)).toBe(widthOf(narrow) * 3)
  })

  it('honours the requested height', () => {
    expect(code128SvgMarkup('ABC', { height: 120 })).toContain('height="120"')
  })

  it('escapes the value in the accessible label', () => {
    const svg = code128SvgMarkup('A"B')!
    expect(svg).toContain('&quot;')
    expect(svg).not.toContain('aria-label="Barcode A"B"')
  })

  it('returns null for unencodable input so callers can print text only', () => {
    expect(code128SvgMarkup('café')).toBeNull()
  })
})

describe('code128ModuleCount', () => {
  it('counts start + data + check + stop plus both quiet zones', () => {
    // 'A' -> start(11) + data(11) + check(11) + stop(13) = 46, plus 2x10 quiet
    expect(code128ModuleCount('A')).toBe(46 + 20)
  })

  it('grows by 11 modules per added character', () => {
    const one = code128ModuleCount('A')!
    const two = code128ModuleCount('AB')!
    expect(two - one).toBe(11)
  })

  it('returns null for unencodable input', () => {
    expect(code128ModuleCount('café')).toBeNull()
  })
})
