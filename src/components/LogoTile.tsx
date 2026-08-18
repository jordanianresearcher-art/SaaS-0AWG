// A tappable tile for something people recognize by sight — a product brand or
// a car make.
//
// The design decision that makes this shippable: **the fallback is the design,
// not a degraded state.** A brand with no logo file renders as a bold wordmark
// tile that looks deliberate next to the ones that do have art. That means the
// logo library can grow one file at a time without the grid ever looking
// half-finished, and a brand nobody has gotten to yet is never embarrassing.
//
// Assets are self-hosted under public/brand-logos/ and public/car-logos/. They
// are deliberately not hotlinked from manufacturer sites: those URLs rot, and
// hotlinking someone's asset server is rude at best. Using a brand's mark to
// refer to that brand inside a tool is nominative use; note that automaker
// marks stay inside the app and never go on a customer-facing quote or email.

import { useState } from 'react'

/** Filename-safe key: "JL Audio" -> "jl-audio", "Mercedes-Benz" -> "mercedes-benz". */
export function logoSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

/** Initials for the wordmark fallback: at most two, so the tile never crowds. */
function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean)
  if (words.length === 0) return '?'
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase()
  return (words[0][0] + words[1][0]).toUpperCase()
}

export interface LogoTileProps {
  name: string
  /** Which folder under /public to look in. */
  kind: 'brand' | 'car'
  selected?: boolean
  onClick?: () => void
  className?: string
}

export function LogoTile({ name, kind, selected = false, onClick, className = '' }: LogoTileProps) {
  // Start optimistic and fall back on error, rather than probing first — a
  // HEAD request per tile would be far more expensive than one broken <img>
  // that never paints.
  const [hasImage, setHasImage] = useState(true)
  const src = `/${kind === 'brand' ? 'brand-logos' : 'car-logos'}/${logoSlug(name)}.png`

  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={onClick ? selected : undefined}
      title={name}
      className={`flex min-h-20 flex-col items-center justify-center gap-1.5 rounded-xl border-2 px-2 py-2 transition-colors ${
        selected ? 'border-brand bg-blue-50' : 'border-zinc-200 bg-white hover:border-zinc-300'
      } ${className}`}
    >
      {hasImage ? (
        <img
          src={src}
          alt={name}
          loading="lazy"
          className="h-8 max-w-full object-contain"
          onError={() => setHasImage(false)}
        />
      ) : (
        <span
          aria-hidden="true"
          className={`flex h-8 w-8 items-center justify-center rounded-lg text-xs font-black ${
            selected ? 'bg-brand text-white' : 'bg-zinc-100 text-zinc-600'
          }`}
        >
          {initials(name)}
        </span>
      )}
      <span className={`line-clamp-1 text-xs font-semibold ${selected ? 'text-ink' : 'text-zinc-600'}`}>{name}</span>
    </button>
  )
}
