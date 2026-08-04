// Wires ScanBuffer (see hardwareScan.ts) to real keydown events, document-
// wide. This is the *fallback* path for hardware scanning — the primary
// path is the dedicated, normally-focused "Scan" input in
// ScanWorkspacePage.tsx, which a scanner's keystrokes land in directly
// like any other typing. This hook only matters once focus has drifted
// off that field (a button, the page background) so a scan still works
// without staff needing to click back into a specific box first. It never
// fires while a real text field has focus, so normal typing anywhere else
// on the page (search, custom-item name, payment amount, ...) is
// completely unaffected.

import { useEffect, useRef } from 'react'
import { ScanBuffer } from './hardwareScan'

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  return target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable
}

export function useHardwareScanner(onScan: (code: string) => void, enabled = true): void {
  const bufferRef = useRef<ScanBuffer | null>(null)
  const onScanRef = useRef(onScan)
  onScanRef.current = onScan

  useEffect(() => {
    if (!enabled) return
    const buffer = new ScanBuffer()
    bufferRef.current = buffer

    function handleKeyDown(e: KeyboardEvent) {
      if (isEditableTarget(e.target)) return
      const code = buffer.push(e.key, Date.now())
      if (code) {
        e.preventDefault() // stop Enter from also clicking whatever non-input element happens to have focus
        onScanRef.current(code)
      } else if (e.key === 'Enter') {
        e.preventDefault()
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      bufferRef.current = null
    }
  }, [enabled])
}
