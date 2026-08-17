// Shop logo uploads.
//
// The logo ends up in an <img src> inside a quote email, which constrains the
// design: email clients fetch images anonymously and Gmail strips data: URIs,
// so the stored value has to be a plain public URL. In production that means
// Supabase Storage (bucket 'shop-logos', migration 0018). In demo mode there is
// no Storage to write to, so the preview falls back to a data URL — fine on
// screen, and demo mode never sends a real email.
//
// Path convention is <userId>/<random>.<ext>, matching the bucket's RLS
// policies. It is keyed on the *user* rather than the shop because onboarding
// uploads a logo before the shop row exists.

import type { SupabaseClient } from '@supabase/supabase-js'
import { newId } from './ids'

export const LOGO_BUCKET = 'shop-logos'

/** Matches the bucket's file_size_limit in migration 0018. */
export const LOGO_MAX_BYTES = 2 * 1024 * 1024

/** Matches the bucket's allowed_mime_types in migration 0018. */
export const ALLOWED_LOGO_MIME_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml'] as const

export const LOGO_ACCEPT_ATTRIBUTE = ALLOWED_LOGO_MIME_TYPES.join(',')

const EXTENSION_BY_MIME: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/svg+xml': 'svg',
}

/**
 * Reject a file up front rather than letting Storage return an opaque 400.
 * Returns a message to show the owner, or null when the file is fine.
 */
export function validateLogoFile(file: { type: string; size: number }): string | null {
  if (!(ALLOWED_LOGO_MIME_TYPES as readonly string[]).includes(file.type)) {
    return 'Use a PNG, JPG, WEBP, or SVG image.'
  }
  if (file.size > LOGO_MAX_BYTES) {
    return 'That image is larger than 2MB. Try a smaller one.'
  }
  return null
}

/** Storage object path for a logo. The first segment must be the user id — the bucket's RLS policy checks it. */
export function logoObjectPath(userId: string, mimeType: string): string {
  const ext = EXTENSION_BY_MIME[mimeType] ?? 'png'
  return `${userId}/${newId()}.${ext}`
}

/**
 * Shrink a raster logo to `maxEdge` before upload. Phone cameras and design
 * exports routinely produce 3000px PNGs; the logo renders at ~48px in an
 * email, so shipping the original is pure waste on a customer's mobile data.
 *
 * SVGs pass through untouched — they're already small, and rasterizing a
 * vector logo to fit an email would throw away the reason to use one.
 */
export async function downscaleLogo(file: File, maxEdge = 512): Promise<Blob> {
  if (file.type === 'image/svg+xml') return file

  const bitmap = await createImageBitmap(file)
  try {
    const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height))
    if (scale === 1) return file

    const canvas = document.createElement('canvas')
    canvas.width = Math.round(bitmap.width * scale)
    canvas.height = Math.round(bitmap.height * scale)
    const ctx = canvas.getContext('2d')
    if (!ctx) return file
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height)

    // PNG throughout: logos are usually flat art with hard edges, and JPEG
    // would both blur them and drop the transparency most shop logos rely on.
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
    return blob ?? file
  } finally {
    bitmap.close()
  }
}

/**
 * Upload a logo and return its public URL. Uses upsert so a retry after a
 * flaky network doesn't strand half-written objects.
 */
export async function uploadShopLogo(supabase: SupabaseClient, userId: string, file: File): Promise<string> {
  const blob = await downscaleLogo(file)
  // downscaleLogo re-encodes rasters as PNG; the path extension has to follow.
  const mimeType = blob.type || file.type
  const path = logoObjectPath(userId, mimeType)

  const { error } = await supabase.storage.from(LOGO_BUCKET).upload(path, blob, {
    contentType: mimeType,
    upsert: true,
  })
  if (error) throw error

  const { data } = supabase.storage.from(LOGO_BUCKET).getPublicUrl(path)
  return data.publicUrl
}

/** Demo-mode stand-in: no Storage to write to, so keep the image inline for the on-screen preview. */
export function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(new Error('Could not read that file.'))
    reader.readAsDataURL(file)
  })
}
