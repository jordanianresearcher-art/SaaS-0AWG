import { describe, expect, it } from 'vitest'
import { ScanBuffer } from './hardwareScan'

/** Feeds a string's characters at a fixed gap (ms), then Enter — simulates one scanner burst. */
function feedBurst(buf: ScanBuffer, code: string, startAt: number, gapMs: number): string | null {
  let t = startAt
  for (const ch of code) {
    buf.push(ch, t)
    t += gapMs
  }
  return buf.push('Enter', t)
}

describe('ScanBuffer', () => {
  it('recognizes a fast burst (typical scanner speed) terminated by Enter as a scan', () => {
    const buf = new ScanBuffer()
    const result = feedBurst(buf, '012345678905', 1000, 5) // 5ms/char — fast
    expect(result).toBe('012345678905')
  })

  it('tolerates a slower but still scanner-plausible speed just under the threshold', () => {
    const buf = new ScanBuffer({ maxIntervalMs: 80 })
    const result = feedBurst(buf, 'SKU-1234', 1000, 70)
    expect(result).toBe('SKU-1234')
  })

  it('resets and does not report a scan for human-speed typing', () => {
    const buf = new ScanBuffer()
    const result = feedBurst(buf, '012345678905', 1000, 200) // 200ms/char — a human
    expect(result).toBeNull()
  })

  it('ignores a bare Enter with nothing accumulated', () => {
    const buf = new ScanBuffer()
    expect(buf.push('Enter', 1000)).toBeNull()
  })

  it('ignores a too-short burst (below minLength) even if fast', () => {
    const buf = new ScanBuffer({ minLength: 6 })
    const result = feedBurst(buf, '123', 1000, 5)
    expect(result).toBeNull()
  })

  it('filters out multi-character key names (Shift, Tab, etc.) from the buffer', () => {
    const buf = new ScanBuffer({ minLength: 2 })
    buf.push('0', 1000)
    buf.push('Shift', 1005) // a scanner-adjacent modifier keydown some models emit — must not corrupt the buffer
    buf.push('1', 1010)
    const result = buf.push('Enter', 1015)
    expect(result).toBe('01')
  })

  it('a slow stray character before a fast burst does not get glued onto it', () => {
    const buf = new ScanBuffer()
    buf.push('x', 1000) // an idle stray keystroke long before...
    const result = feedBurst(buf, '99988877', 5000, 5) // ...a real fast scan much later
    expect(result).toBe('99988877') // the stray 'x' was reset out, not prefixed
  })

  it('recovers cleanly for a second scan after a completed one', () => {
    const buf = new ScanBuffer()
    expect(feedBurst(buf, '1111', 1000, 5)).toBe('1111')
    expect(feedBurst(buf, '2222', 2000, 5)).toBe('2222')
  })
})
