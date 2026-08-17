// Logo picker used by both onboarding and Settings.
//
// Replaces what used to be a bare "Logo image URL" text input. A shop owner
// has a logo file, not a hosted URL, so asking for a URL meant most shops
// simply had no logo on their quotes. Pasting a URL still works as a fallback
// for owners whose logo already lives on their website.

import { useRef, useState } from 'react'
import { ImageIcon, Trash2, Upload } from 'lucide-react'
import { Button, Input } from './ui'
import { useAppData } from '../data/AppDataContext'
import { getSupabase } from '../data/supabaseClient'
import { LOGO_ACCEPT_ATTRIBUTE, readFileAsDataUrl, uploadShopLogo, validateLogoFile } from '../lib/logoUpload'
import { errorMessage } from '../lib/errors'

export interface LogoUploadFieldProps {
  value: string | null
  onChange: (url: string | null) => void
  /** Rendered behind the logo in the preview, so the owner sees it the way a customer will. */
  previewBackground?: string
}

export function LogoUploadField({ value, onChange, previewBackground = '#ffffff' }: LogoUploadFieldProps) {
  const { mode, session } = useAppData()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showUrlInput, setShowUrlInput] = useState(false)

  const handleFile = async (file: File) => {
    setError(null)
    const invalid = validateLogoFile(file)
    if (invalid) {
      setError(invalid)
      return
    }
    setBusy(true)
    try {
      if (mode === 'demo' || !session) {
        // No Storage bucket to write to in demo mode — inline the image so the
        // preview still works. Demo mode never sends a real email, which is the
        // only place a data: URI would actually fail.
        onChange(await readFileAsDataUrl(file))
      } else {
        onChange(await uploadShopLogo(getSupabase(), session.user.id, file))
      }
    } catch (err) {
      console.error('logo upload failed', err)
      const detail = errorMessage(err)
      setError(detail ? `Could not upload that image: ${detail}` : 'Could not upload that image. Please try again.')
    } finally {
      setBusy(false)
      // Clear the input so picking the same file again still fires onChange.
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-4">
        <div
          className="flex h-20 w-32 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-zinc-200"
          style={{ background: previewBackground }}
        >
          {value ? (
            <img src={value} alt="Your shop logo" className="max-h-16 max-w-28 object-contain" />
          ) : (
            <ImageIcon className="h-6 w-6 text-zinc-300" aria-hidden="true" />
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          <input
            ref={fileInputRef}
            type="file"
            accept={LOGO_ACCEPT_ATTRIBUTE}
            className="sr-only"
            aria-label="Upload a logo image"
            onChange={(e) => {
              const file = e.target.files?.[0]
              if (file) void handleFile(file)
            }}
          />
          <Button type="button" variant="secondary" disabled={busy} onClick={() => fileInputRef.current?.click()}>
            <Upload className="h-5 w-5" aria-hidden="true" />
            {busy ? 'Uploading…' : value ? 'Replace logo' : 'Upload logo'}
          </Button>
          {value ? (
            <Button type="button" variant="secondary" disabled={busy} onClick={() => onChange(null)}>
              <Trash2 className="h-5 w-5" aria-hidden="true" /> Remove
            </Button>
          ) : null}
        </div>
      </div>

      {error ? (
        <p role="alert" className="text-base font-medium text-red-700">
          {error}
        </p>
      ) : null}

      {showUrlInput ? (
        <Input
          type="url"
          aria-label="Logo image URL"
          placeholder="https://yourshop.com/logo.png"
          defaultValue={value ?? ''}
          onBlur={(e) => onChange(e.target.value.trim() || null)}
        />
      ) : (
        <button
          type="button"
          onClick={() => setShowUrlInput(true)}
          className="text-sm font-medium text-brand underline underline-offset-2"
        >
          Or paste an image link
        </button>
      )}
    </div>
  )
}
