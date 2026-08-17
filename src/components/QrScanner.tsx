// Camera QR reader for capturing a financing provider's application link off
// the counter card they give the shop.
//
// Deliberately separate from BarcodeScanner.tsx even though both wrap
// @zxing/browser: that one is built for the inventory workflow and carries a
// "no barcode? take a photo of the product instead" fallback that makes no
// sense here — a QR code either decodes or it doesn't. Keeping them apart also
// means changing the financing flow can't regress the scan workspace.

import { useEffect, useRef, useState } from 'react'
import { BrowserMultiFormatReader } from '@zxing/browser'
import type { IScannerControls } from '@zxing/browser'

export interface QrScannerProps {
  /** Fires once with the raw decoded text; the parent is expected to close the scanner. */
  onDecoded: (text: string) => void
  onCameraError: (message: string) => void
}

export function QrScanner({ onDecoded, onCameraError }: QrScannerProps) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const controlsRef = useRef<IScannerControls | null>(null)
  // A ref, not state — zxing's callback fires per frame and must not fire the
  // handler twice while a parent re-render is still pending.
  const decodedRef = useRef(false)
  const [ready, setReady] = useState(false)

  // The callbacks are held in refs so this effect can depend on nothing and
  // run exactly once. Depending on the props directly would tear down and
  // restart the camera on every parent render.
  const onDecodedRef = useRef(onDecoded)
  const onCameraErrorRef = useRef(onCameraError)
  useEffect(() => {
    onDecodedRef.current = onDecoded
    onCameraErrorRef.current = onCameraError
  })

  useEffect(() => {
    const reader = new BrowserMultiFormatReader()
    let cancelled = false

    reader
      .decodeFromVideoDevice(undefined, videoRef.current ?? undefined, (result) => {
        if (result && !decodedRef.current) {
          decodedRef.current = true
          controlsRef.current?.stop()
          onDecodedRef.current(result.getText())
        }
      })
      .then((controls) => {
        if (cancelled) {
          controls.stop()
          return
        }
        controlsRef.current = controls
        setReady(true)
      })
      .catch((err) => {
        onCameraErrorRef.current(
          err instanceof Error
            ? `Camera unavailable: ${err.message}`
            : 'Camera unavailable. Paste the application link instead.',
        )
      })

    return () => {
      cancelled = true
      controlsRef.current?.stop()
    }
  }, [])

  return (
    <div className="flex flex-col gap-3">
      <div className="relative overflow-hidden rounded-xl bg-black">
        <video ref={videoRef} playsInline muted className="aspect-square w-full object-cover" />
        {!ready ? (
          <div className="absolute inset-0 flex items-center justify-center text-sm text-white/70">Starting camera…</div>
        ) : (
          <div className="pointer-events-none absolute inset-8 rounded-2xl border-2 border-white/70" />
        )}
      </div>
      <p className="text-center text-base text-zinc-600">Point the camera at the QR code on your financing card.</p>
    </div>
  )
}
