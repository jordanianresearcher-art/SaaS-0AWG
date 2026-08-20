// What a scanned barcode actually IS, before anyone tries to look it up.
//
// This file exists because of three real codes a shop scanned and got nothing
// back from:
//
//   200001188725  a valid UPC-A whose GS1 prefix is 2
//   26040308      eight digits that are not a valid EAN-8
//   7908706600230 a valid EAN-13 with prefix 790 (Brazil)
//
// Only the third is a code any public database could ever hold. The first two
// were assigned by whoever printed the label — GS1 reserves prefix 2 for
// "restricted distribution", meaning a retailer's own internal numbering — and
// no lookup service will ever know them. The app used to treat all three
// identically: query the barcode database, miss, run a full AI web search on a
// meaningless number, miss again, and after ten-odd seconds report "couldn't
// identify that product", which reads as "this feature is broken".
//
// Knowing the answer up front is both faster and more honest. A store-assigned
// code goes straight to "type the model and I'll remember this barcode", which
// is the only thing that can possibly work — and which then makes the code
// scannable forever, because binding it to the product is exactly what rapid
// intake already does with a code it couldn't resolve.
//
// The other half of the job is that a 12-digit UPC-A and the 13-digit EAN with
// a leading zero are the same product. Querying only the form that was scanned
// misses hits that the other form would have found.

/** Digits only. A scanner may emit spaces or dashes; neither is part of the code. */
export function normalizeBarcodeInput(raw: string): string {
  return raw.trim().replace(/[\s-]/g, '')
}

export type BarcodeKind =
  /** 12-digit GS1 retail code, the North American default. */
  | 'upc_a'
  /** 13-digit GS1 retail code. */
  | 'ean_13'
  /** 8-digit GS1 retail code, used on packages too small for a full EAN. */
  | 'ean_8'
  /** A real GS1 form, but with prefix 2 — assigned in-store, not by GS1. */
  | 'internal'
  /** Numeric, but not a valid GS1 form. Almost always a shop's own item number. */
  | 'item_number'
  /** Not numeric at all — a manufacturer's alphanumeric part code on a Code 128 label. */
  | 'alphanumeric'

export interface BarcodeIdentity {
  /** The cleaned code. */
  code: string
  kind: BarcodeKind
  /** Whether the GS1 check digit validates. Null when the format carries none. */
  checkDigitValid: boolean | null
  /** The GS1 prefix (first three digits of the EAN-13 form), when meaningful. */
  gs1Prefix: string | null
  /** Where that prefix says the code was assigned. */
  origin: string | null
  /**
   * True when no public barcode database can resolve this code, ever — so
   * searching for it is guaranteed waste and the shop should be told to
   * identify the product by model instead.
   */
  storeAssigned: boolean
  /**
   * True when the code has the shape of a retail barcode but its check digit
   * disagrees — which means the scan misread, not that the product is unknown.
   * Worth a "scan it again" rather than a search.
   */
  likelyMisread: boolean
}

/**
 * GS1 prefix ranges, keyed by the first three digits of the EAN-13 form.
 *
 * Not the full list — it covers the origins that actually turn up on a
 * car-audio shop's shelves, plus the two ranges that mean "this is not a
 * retail product at all". An unlisted prefix simply reports no origin, which
 * costs nothing.
 */
const GS1_RANGES: Array<{ from: number; to: number; origin: string }> = [
  { from: 0, to: 19, origin: 'US or Canada' },
  { from: 20, to: 29, origin: 'Store-assigned (restricted distribution)' },
  { from: 30, to: 39, origin: 'US (drugs)' },
  { from: 40, to: 49, origin: 'Store-assigned (restricted distribution)' },
  { from: 50, to: 59, origin: 'Coupon' },
  { from: 60, to: 139, origin: 'US or Canada' },
  { from: 200, to: 299, origin: 'Store-assigned (restricted distribution)' },
  { from: 300, to: 379, origin: 'France' },
  { from: 400, to: 440, origin: 'Germany' },
  { from: 450, to: 459, origin: 'Japan' },
  { from: 460, to: 469, origin: 'Russia' },
  { from: 471, to: 471, origin: 'Taiwan' },
  { from: 480, to: 480, origin: 'Philippines' },
  { from: 490, to: 499, origin: 'Japan' },
  { from: 500, to: 509, origin: 'United Kingdom' },
  { from: 690, to: 699, origin: 'China' },
  { from: 700, to: 709, origin: 'Norway' },
  { from: 729, to: 729, origin: 'Israel' },
  { from: 750, to: 750, origin: 'Mexico' },
  { from: 754, to: 755, origin: 'Canada' },
  { from: 759, to: 759, origin: 'Venezuela' },
  { from: 770, to: 771, origin: 'Colombia' },
  { from: 773, to: 773, origin: 'Uruguay' },
  { from: 779, to: 779, origin: 'Argentina' },
  { from: 780, to: 780, origin: 'Chile' },
  { from: 789, to: 790, origin: 'Brazil' },
  { from: 840, to: 849, origin: 'Spain' },
  { from: 880, to: 880, origin: 'South Korea' },
  { from: 885, to: 885, origin: 'Thailand' },
  { from: 890, to: 890, origin: 'India' },
  { from: 893, to: 893, origin: 'Vietnam' },
  { from: 955, to: 955, origin: 'Malaysia' },
  { from: 977, to: 977, origin: 'Periodical (ISSN)' },
  { from: 978, to: 979, origin: 'Book (ISBN)' },
]

function originForPrefix(prefix3: string): string | null {
  const n = Number(prefix3)
  if (!Number.isFinite(n)) return null
  // Ranges are expressed against the numeric value of the first three digits,
  // so "007" and "7" both land in the 0-19 US/Canada band.
  for (const range of GS1_RANGES) {
    if (n >= range.from && n <= range.to) return range.origin
  }
  return null
}

/**
 * The GS1 check digit for a payload (the code without its final digit).
 *
 * One algorithm covers UPC-A, EAN-13 and EAN-8: weight the payload 3,1,3,1…
 * from the right, then take whatever makes the total a multiple of ten. The
 * alternation is anchored to the RIGHT end, not the left, which is why it
 * works unchanged across all three lengths.
 */
export function gs1CheckDigit(payload: string): number {
  let sum = 0
  let weight = 3
  for (let i = payload.length - 1; i >= 0; i--) {
    sum += Number(payload[i]) * weight
    weight = weight === 3 ? 1 : 3
  }
  return (10 - (sum % 10)) % 10
}

function hasValidCheckDigit(code: string): boolean {
  const payload = code.slice(0, -1)
  const given = Number(code[code.length - 1])
  return gs1CheckDigit(payload) === given
}

/** Everything worth knowing about a scanned code before a single request goes out. */
export function classifyBarcode(raw: string): BarcodeIdentity {
  const code = normalizeBarcodeInput(raw)

  if (!/^\d+$/.test(code)) {
    // A Code 128 label carrying a manufacturer part number ("EZY-RCA110-GX").
    // Not a retail barcode and not store-assigned — it is a real identifier,
    // just not one a barcode database indexes.
    return {
      code,
      kind: 'alphanumeric',
      checkDigitValid: null,
      gs1Prefix: null,
      origin: null,
      storeAssigned: false,
      likelyMisread: false,
    }
  }

  const isRetailLength = code.length === 8 || code.length === 12 || code.length === 13
  const checkDigitValid = isRetailLength ? hasValidCheckDigit(code) : null

  // Prefix is read off the EAN-13 form so a UPC-A and its EAN twin classify
  // identically — a 12-digit code is a 13-digit code with an implied 0.
  const ean13Form = code.length === 12 ? `0${code}` : code
  const gs1Prefix = isRetailLength && code.length !== 8 ? ean13Form.slice(0, 3) : null
  const origin = gs1Prefix ? originForPrefix(gs1Prefix) : null

  // GS1 prefix 2 (and the 02x/04x bands) is reserved for restricted
  // distribution: codes a retailer assigns for its own shelves. Real, valid,
  // and permanently absent from every public database.
  const storeAssigned = Boolean(gs1Prefix && originForPrefix(gs1Prefix)?.startsWith('Store-assigned'))

  if (!isRetailLength || checkDigitValid === false) {
    // Eight digits that fail EAN-8, or any other length, is a shop's own item
    // number printed as a barcode. Calling that a "misread" would send staff
    // rescanning a label that scanned perfectly well — so only the formats
    // that always carry a check digit get that verdict.
    const likelyMisread = (code.length === 12 || code.length === 13) && checkDigitValid === false
    return {
      code,
      kind: 'item_number',
      checkDigitValid,
      gs1Prefix,
      origin,
      storeAssigned,
      likelyMisread,
    }
  }

  const kind: BarcodeKind = storeAssigned
    ? 'internal'
    : code.length === 8
      ? 'ean_8'
      : code.length === 12
        ? 'upc_a'
        : 'ean_13'

  return { code, kind, checkDigitValid, gs1Prefix, origin, storeAssigned, likelyMisread: false }
}

/**
 * Every form of this code worth querying a barcode database with.
 *
 * A 12-digit UPC-A and the 13-digit EAN carrying a leading zero identify the
 * same product; a database may hold either. Trying only the scanned form is
 * how a real, findable product comes back empty — which is what happened to a
 * Brazilian EAN-13 that was never retried the other way round.
 *
 * Returns an empty list when nothing could possibly match, so callers can skip
 * the network entirely rather than waiting out a guaranteed miss.
 */
export function barcodeLookupForms(raw: string): string[] {
  const identity = classifyBarcode(raw)
  if (identity.storeAssigned || identity.kind === 'item_number' || identity.kind === 'alphanumeric') {
    return []
  }

  const code = identity.code
  const forms = [code]
  if (code.length === 12) forms.push(`0${code}`)
  else if (code.length === 13 && code.startsWith('0')) forms.push(code.slice(1))
  return forms
}

/**
 * One sentence a person at the counter can act on. Null when the code is
 * ordinary and the normal lookup should just run.
 */
export function barcodeAdvice(identity: BarcodeIdentity): string | null {
  if (identity.likelyMisread) {
    return "That barcode didn't scan cleanly — the check digit doesn't match. Try scanning it again."
  }
  if (identity.storeAssigned) {
    return "That's a store's own barcode, so no product database has it. Type the model below and this code will be remembered for next time."
  }
  if (identity.kind === 'item_number') {
    return "That looks like an internal item number rather than a retail barcode. Type the model below and this code will be remembered for next time."
  }
  if (identity.kind === 'alphanumeric') {
    return "That's a part number rather than a retail barcode. Type the model below and this code will be remembered for next time."
  }
  return null
}
