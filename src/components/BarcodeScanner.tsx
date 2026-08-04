// Live camera barcode scanner with a photo-capture fallback for products
// with no readable barcode. Ported from car-audio-inventory's
// CameraCapture.tsx (this app's sister inventory-scanning app — see
// docs/INVENTORY_AND_SCANNING.md) — same @zxing/browser approach, adapted
// to this app's UI kit and no-dark-mode styling.

import { useEffect, useRef, useState } from 'react'
import { BrowserMultiFormatReader } from '@zxing/browser'
import type { IScannerControls } from '@zxing/browser'
import { Camera } from 'lucide-react'
import { Button } from './ui'

export interface BarcodeScannerProps {
  onBarcodeDetected: (code: string) => void
  onPhotoCaptured: (base64Jpeg: string) => void
  onCameraError: (message: string) => void
}

// Resize/compress a captured frame before sending it anywhere (phone
// cameras produce multi-MB frames; a vision lookup only needs ~1280px).
function captureFrameAsJpeg(video: HTMLVideoElement, maxEdge = 1280): string {
  const scale = Math.min(1, maxEdge / Math.max(video.videoWidth, video.videoHeight))
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(video.videoWidth * scale)
  canvas.height = Math.round(video.videoHeight * scale)
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas not supported')
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
  return canvas.toDataURL('image/jpeg', 0.85).split(',')[1]
}

export function BarcodeScanner({ onBarcodeDetected, onPhotoCaptured, onCameraError }: BarcodeScannerProps) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const controlsRef = useRef<IScannerControls | null>(null)
  // A ref, not state — the zxing decode callback fires repeatedly and must
  // not act twice on the same frame while a parent re-render is pending.
  const detectedRef = useRef(false)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    const reader = new BrowserMultiFormatReader()
    let cancelled = false

    reader
      .decodeFromVideoDevice(undefined, videoRef.current ?? undefined, (result) => {
        if (result && !detectedRef.current) {
          detectedRef.current = true
          onBarcodeDetected(result.getText())
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
        onCameraError(err instanceof Error ? `Camera unavailable: ${err.message}` : 'Camera unavailable. Search or add the item manually below.')
      })

    return () => {
      cancelled = true
      controlsRef.current?.stop()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function handleTakePhoto() {
    if (!videoRef.current) return
    try {
      const jpeg = captureFrameAsJpeg(videoRef.current)
      controlsRef.current?.stop()
      onPhotoCaptured(jpeg)
    } catch {
      onCameraError("Couldn't capture photo. Search or add the item manually below.")
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="relative overflow-hidden rounded-xl bg-black">
        <video ref={videoRef} playsInline muted className="aspect-[4/3] w-full object-cover" />
        {!ready ? (
          <div className="absolute inset-0 flex items-center justify-center text-sm text-white/70">Starting camera…</div>
        ) : null}
        {ready ? (
          <div className="pointer-events-none absolute inset-x-8 top-1/2 h-16 -translate-y-1/2 rounded-lg border-2 border-white/70" />
        ) : null}
      </div>
      <p className="text-center text-xs text-zinc-500">Point the camera at the barcode. No barcode? Take a photo of the product instead.</p>
      <Button type="button" variant="secondary" onClick={handleTakePhoto} disabled={!ready}>
        <Camera className="h-4 w-4" aria-hidden="true" />
        Take photo instead
      </Button>
    </div>
  )
}
