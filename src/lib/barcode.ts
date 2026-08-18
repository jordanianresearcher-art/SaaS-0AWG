// Code 128-B barcode rendering, as pure SVG.
//
// Pairs with src/lib/sku.ts, which generates the human-readable codes
// (DS18-770DSP) for products with no findable manufacturer barcode. That file
// deliberately chose Code 128 over a generated UPC-A — no GS1 company prefix to
// invent, alphanumeric, and the printed code still means something to a person
// who reads it without scanning. This is the rendering half it left deferred.
//
// No library and no canvas: an SVG of plain rects is a handful of lines, scales
// to any printer DPI without blurring (the thing that actually breaks cheap
// thermal-printer scans), and adds nothing to the bundle.

/**
 * Width patterns for Code 128 symbol values 0-106. Each string is the widths
 * of alternating bar/space runs, starting with a bar — six runs (11 modules)
 * for every symbol, seven for the stop pattern.
 */
const PATTERNS = [
  '212222', '222122', '222221', '121223', '121322', '131222', '122213', '122312', '132212', '221213',
  '221312', '231212', '112232', '122132', '122231', '113222', '123122', '123221', '223211', '221132',
  '221231', '213212', '223112', '312131', '311222', '321122', '321221', '312212', '322112', '322211',
  '212123', '212321', '232121', '111323', '131123', '131321', '112313', '132113', '132311', '211313',
  '231113', '231311', '112133', '112331', '132131', '113123', '113321', '133121', '313121', '211331',
  '231131', '213113', '213311', '213131', '311123', '311321', '331121', '312113', '312311', '332111',
  '314111', '221411', '431111', '111224', '111422', '121124', '121421', '141122', '141221', '112214',
  '112412', '122114', '122411', '142112', '142211', '241211', '221114', '413111', '241112', '134111',
  '111242', '121142', '121241', '114212', '124112', '124211', '411212', '421112', '421211', '212141',
  '214121', '412121', '111143', '111341', '131141', '114113', '114311', '411113', '411311', '113141',
  '114131', '311141', '411131', '211412', '211214', '211232', '2331112',
]

const START_B = 104
const STOP = 106

/** Code 128-B encodes ASCII 32..126 as symbol value (charCode - 32). */
function isEncodable(char: string): boolean {
  const code = char.charCodeAt(0)
  return code >= 32 && code <= 126
}

/**
 * Symbol values for `value`, including the start code and the mod-103
 * check character. Returns null when the string contains anything Code 128-B
 * can't represent — callers should fall back to printing the text alone
 * rather than emitting a barcode that scans as garbage.
 */
export function encodeCode128B(value: string): number[] | null {
  if (!value || ![...value].every(isEncodable)) return null

  const symbols = [START_B]
  for (const char of value) {
    symbols.push(char.charCodeAt(0) - 32)
  }

  // Checksum: start value + each data value weighted by its 1-based position.
  let sum = START_B
  for (let i = 1; i < symbols.length; i += 1) {
    sum += symbols[i] * i
  }
  symbols.push(sum % 103)
  symbols.push(STOP)
  return symbols
}

export interface BarcodeSvgOptions {
  /** Width of one module in user units. 2+ keeps cheap thermal scanners reliable. */
  moduleWidth?: number
  height?: number
  /** Quiet zone in modules. The spec calls for 10; less is a common cause of "it won't scan". */
  quietZoneModules?: number
}

/**
 * Render `value` as a self-contained `<svg>` string, or null when it cannot be
 * encoded.
 *
 * Returns markup rather than JSX so the same function can serve a React page,
 * a print sheet, and (later) a server-rendered PDF.
 */
export function code128SvgMarkup(value: string, options: BarcodeSvgOptions = {}): string | null {
  const symbols = encodeCode128B(value)
  if (!symbols) return null

  const moduleWidth = options.moduleWidth ?? 2
  const height = options.height ?? 60
  const quiet = options.quietZoneModules ?? 10

  const rects: string[] = []
  let x = quiet
  for (const symbol of symbols) {
    const pattern = PATTERNS[symbol]
    let isBar = true
    for (const widthChar of pattern) {
      const width = Number(widthChar)
      // Only bars are drawn; spaces are the gaps between them.
      if (isBar) {
        rects.push(`<rect x="${x * moduleWidth}" y="0" width="${width * moduleWidth}" height="${height}" />`)
      }
      x += width
      isBar = !isBar
    }
  }

  const totalModules = x + quiet
  const width = totalModules * moduleWidth
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" ` +
    `viewBox="0 0 ${width} ${height}" shape-rendering="crispEdges" role="img" aria-label="Barcode ${escapeAttr(value)}">` +
    `<rect x="0" y="0" width="${width}" height="${height}" fill="#ffffff" />` +
    `<g fill="#000000">${rects.join('')}</g>` +
    `</svg>`
  )
}

function escapeAttr(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

/** Total module count for a value — useful for checking a code will fit a label width. */
export function code128ModuleCount(value: string, quietZoneModules = 10): number | null {
  const symbols = encodeCode128B(value)
  if (!symbols) return null
  const dataModules = symbols.reduce((sum, symbol) => {
    return sum + [...PATTERNS[symbol]].reduce((n, c) => n + Number(c), 0)
  }, 0)
  return dataModules + quietZoneModules * 2
}
