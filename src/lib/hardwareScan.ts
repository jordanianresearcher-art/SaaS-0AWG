// Detects a hardware barcode scanner's "keyboard wedge" output. Most
// laser/CCD scanners (USB on a PC, Bluetooth on a phone/tablet) don't need
// any special driver or API — to the OS and browser they're just a
// keyboard that happens to type extremely fast: they emit a barcode's
// characters a few milliseconds apart, then send Enter. This is
// indistinguishable from real typing except for that speed, so a scan is
// detected by buffering keystrokes and watching the gaps between them
// rather than by any dedicated scanner API. Pure/timestamp-driven (no DOM)
// so it's unit-testable — src/lib/useHardwareScanner.ts wires it to real
// keydown events.

export interface ScanBufferOptions {
  /** Above this gap (ms) between characters, treat it as human typing and reset instead of accumulating. Real scanners are usually well under 20ms/char; this is deliberately generous to tolerate slower scanner models without ever mistaking fast typing for one. */
  maxIntervalMs?: number
  /** Minimum accumulated length before a completed buffer counts as a real scan — filters out a stray Enter press. Real barcodes/SKUs are always several characters. */
  minLength?: number
}

const DEFAULT_MAX_INTERVAL_MS = 80
const DEFAULT_MIN_LENGTH = 4

export class ScanBuffer {
  private buffer = ''
  private lastAt = 0
  private readonly maxIntervalMs: number
  private readonly minLength: number

  constructor(options: ScanBufferOptions = {}) {
    this.maxIntervalMs = options.maxIntervalMs ?? DEFAULT_MAX_INTERVAL_MS
    this.minLength = options.minLength ?? DEFAULT_MIN_LENGTH
  }

  /**
   * Feed one keystroke — a single character, or the literal string
   * 'Enter' — at a timestamp in milliseconds. Returns the completed code
   * once Enter closes a long-enough fast-typed burst; null otherwise
   * (still accumulating, or the burst didn't qualify as a scan).
   */
  push(key: string, atMs: number): string | null {
    const gap = atMs - this.lastAt
    this.lastAt = atMs

    if (key === 'Enter') {
      const code = this.buffer
      this.buffer = ''
      return code.length >= this.minLength ? code : null
    }

    if (gap > this.maxIntervalMs) {
      this.buffer = '' // too slow to be a scanner — a stray character, not the start of a real burst
    }

    if (key.length === 1) {
      // Only literal characters (digits/letters/symbols) — key names like
      // 'Shift'/'Tab'/'CapsLock' are always longer than 1 and never appear
      // in a real barcode.
      this.buffer += key
    }
    return null
  }

  reset(): void {
    this.buffer = ''
  }
}
