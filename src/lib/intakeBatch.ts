// Scan first, identify later.
//
// Rapid intake used to stop dead on every scan: fire the trigger, wait for a
// lookup, name the thing, save, then scan the next one. A pallet of forty
// boxes meant forty pauses, and the pauses are the slow part — the scanning
// itself takes a second.
//
// So this splits the two. Scanning only ever records a code and a quantity,
// which is instant and never blocks. Identification runs behind it at its own
// pace, filling rows in as answers arrive. When the pallet is done the operator
// reviews a list that has mostly identified itself.
//
// Everything here is pure. The page owns the timers and the network; this owns
// what the batch *is*, which is the part with the sharp edges — chiefly that
// resolutions come back out of order, and can come back for a line that has
// since been edited or deleted.

/** Where a line is in its journey from "a number" to "a product". */
export type IntakeLineStatus =
  /** Scanned, nothing attempted yet. */
  | 'pending'
  /** A lookup is in flight. */
  | 'resolving'
  /** Identified — has a name worth showing. */
  | 'resolved'
  /** Looked, found nothing. Still keepable: the operator can name it by hand. */
  | 'unidentified'

/** Where an identification came from, so review can show how much to trust it. */
export type IntakeLineSource = 'catalog' | 'shared' | 'web'

/**
 * How the line entered the batch. Not every product has a barcode — smaller
 * manufacturers ship boxes with nothing scannable on them — so intake accepts
 * a typed name/SKU as a first-class line, resolved through text search
 * instead of barcode lookup. The distinction matters again at commit time:
 * a scanned code is saved as the item's UPC, typed text must never be.
 */
export type IntakeLineEntry = 'scan' | 'typed'

export interface IntakeBatchLine {
  /** The scanned code, or the typed text. Unique within a batch — it is the identity of the line. */
  code: string
  entry: IntakeLineEntry
  quantity: number
  status: IntakeLineStatus
  brand: string | null
  model: string | null
  /** Descriptor half only, matching the naming contract in productNaming.ts. */
  name: string
  imageUrl: string | null
  /** Manufacturer/web list price, never a shop's own price. */
  referencePriceCents: number | null
  source: IntakeLineSource | null
  /** Set when the code already maps to a row in this shop's catalog. */
  catalogItemId: string | null
  /**
   * Bumped whenever a person changes the line. A resolution carrying an older
   * revision is discarded — see applyResolution.
   */
  revision: number
}

/** What a finished lookup contributes. Never touches quantity: that is the operator's. */
export interface IntakeResolution {
  status: 'resolved' | 'unidentified'
  brand?: string | null
  model?: string | null
  name?: string
  imageUrl?: string | null
  referencePriceCents?: number | null
  source?: IntakeLineSource | null
  catalogItemId?: string | null
}

function blankLine(code: string, entry: IntakeLineEntry): IntakeBatchLine {
  return {
    code,
    entry,
    quantity: 1,
    status: 'pending',
    brand: null,
    model: null,
    name: '',
    imageUrl: null,
    referencePriceCents: null,
    source: null,
    catalogItemId: null,
    revision: 0,
  }
}

/**
 * Record a scan.
 *
 * A repeat scan of the same code adds one to the quantity rather than making a
 * second row — that is the whole speed win on a case of six: six beeps, no
 * typing, one line. Newest line goes first so the operator sees what they just
 * scanned without scrolling.
 */
export function addScan(lines: IntakeBatchLine[], rawCode: string): IntakeBatchLine[] {
  const code = rawCode.trim()
  if (!code) return lines

  const existing = lines.find((l) => l.code === code)
  if (existing) {
    return lines.map((l) => (l.code === code ? { ...l, quantity: l.quantity + 1 } : l))
  }
  return [blankLine(code, 'scan'), ...lines]
}

/**
 * Record a product typed by hand — the intake path for boxes with no barcode.
 *
 * Same merge rule as scanning: entering the same text again is another unit
 * of the same product, not a duplicate row. The text needs at least two real
 * characters; a single letter is a slip of the finger, not a product.
 */
export function addTypedEntry(lines: IntakeBatchLine[], rawText: string): IntakeBatchLine[] {
  const text = rawText.trim()
  if (text.length < 2) return lines

  const existing = lines.find((l) => l.code === text)
  if (existing) {
    return lines.map((l) => (l.code === text ? { ...l, quantity: l.quantity + 1 } : l))
  }
  return [blankLine(text, 'typed'), ...lines]
}

/** Set an exact quantity. Zero or less removes the line — a miscount undone. */
export function setQuantity(lines: IntakeBatchLine[], code: string, quantity: number): IntakeBatchLine[] {
  if (!Number.isFinite(quantity) || quantity <= 0) return removeLine(lines, code)
  return lines.map((l) =>
    l.code === code ? { ...l, quantity: Math.floor(quantity), revision: l.revision + 1 } : l,
  )
}

export function removeLine(lines: IntakeBatchLine[], code: string): IntakeBatchLine[] {
  return lines.filter((l) => l.code !== code)
}

/** Mark a line as having a lookup in flight, and capture the revision it started from. */
export function markResolving(lines: IntakeBatchLine[], code: string): IntakeBatchLine[] {
  return lines.map((l) => (l.code === code ? { ...l, status: 'resolving' } : l))
}

/**
 * Fold a finished lookup into the batch.
 *
 * `startedAtRevision` is what makes this safe. Lookups take seconds and finish
 * out of order, and in that window the operator may have deleted the line or
 * corrected it by hand. Applying a stale answer would overwrite a person's
 * correction with a machine's guess — the one outcome that would make staff
 * stop trusting the whole screen. A resolution for a line that has moved on,
 * or that no longer exists, is dropped.
 */
export function applyResolution(
  lines: IntakeBatchLine[],
  code: string,
  resolution: IntakeResolution,
  startedAtRevision: number,
): IntakeBatchLine[] {
  return lines.map((line) => {
    if (line.code !== code) return line
    if (line.revision !== startedAtRevision) return line
    return {
      ...line,
      status: resolution.status,
      brand: resolution.brand ?? line.brand,
      model: resolution.model ?? line.model,
      name: resolution.name ?? line.name,
      imageUrl: resolution.imageUrl ?? line.imageUrl,
      referencePriceCents: resolution.referencePriceCents ?? line.referencePriceCents,
      source: resolution.source ?? line.source,
      catalogItemId: resolution.catalogItemId ?? line.catalogItemId,
    }
  })
}

/** Apply an operator's own edit, bumping the revision so in-flight lookups yield to it. */
export function editLine(
  lines: IntakeBatchLine[],
  code: string,
  patch: Partial<Pick<IntakeBatchLine, 'brand' | 'model' | 'name' | 'referencePriceCents'>>,
): IntakeBatchLine[] {
  return lines.map((l) =>
    l.code === code
      ? { ...l, ...patch, status: 'resolved' as const, source: null, revision: l.revision + 1 }
      : l,
  )
}

/**
 * The next code worth looking up: oldest first, so a long batch resolves in
 * the order it was scanned rather than newest-first like the display.
 */
export function nextPending(lines: IntakeBatchLine[]): IntakeBatchLine | null {
  for (let i = lines.length - 1; i >= 0; i--) {
    if (lines[i].status === 'pending') return lines[i]
  }
  return null
}

export interface IntakeBatchSummary {
  /** Distinct products. */
  lines: number
  /** Total pieces — what actually goes into stock. */
  units: number
  identified: number
  unidentified: number
  /** Still queued or in flight. */
  working: number
  /** True when every line has had its turn, so review is worth offering. */
  settled: boolean
}

export function summarize(lines: IntakeBatchLine[]): IntakeBatchSummary {
  const summary: IntakeBatchSummary = {
    lines: lines.length,
    units: lines.reduce((sum, l) => sum + l.quantity, 0),
    identified: 0,
    unidentified: 0,
    working: 0,
    settled: false,
  }
  for (const line of lines) {
    if (line.status === 'resolved') summary.identified += 1
    else if (line.status === 'unidentified') summary.unidentified += 1
    else summary.working += 1
  }
  summary.settled = lines.length > 0 && summary.working === 0
  return summary
}
