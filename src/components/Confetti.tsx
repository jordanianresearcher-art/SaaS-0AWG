import { useEffect, useState } from 'react'

const COLORS = ['#1d4ed8', '#eab308', '#16a34a', '#dc2626', '#7c3aed', '#ea580c']

interface Piece {
  id: number
  left: number
  color: string
  delay: number
  duration: number
  rotate: number
}

function makePieces(count: number): Piece[] {
  return Array.from({ length: count }, (_, i) => ({
    id: i,
    left: Math.random() * 100,
    color: COLORS[i % COLORS.length],
    delay: Math.random() * 150,
    duration: 700 + Math.random() * 500,
    rotate: Math.random() * 360,
  }))
}

/** Fires a short confetti burst whenever `trigger` changes to a truthy value. Skips entirely under prefers-reduced-motion. */
export function Confetti({ trigger }: { trigger: number }) {
  const [pieces, setPieces] = useState<Piece[]>([])

  useEffect(() => {
    if (!trigger) return
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    setPieces(makePieces(24))
    const timeout = setTimeout(() => setPieces([]), 1500)
    return () => clearTimeout(timeout)
  }, [trigger])

  if (pieces.length === 0) return null

  return (
    <div className="pointer-events-none absolute inset-x-0 top-0 h-40 overflow-hidden" aria-hidden="true">
      {pieces.map((p) => (
        <span
          key={p.id}
          className="confetti-piece absolute top-0 block h-2.5 w-1.5 rounded-sm"
          style={{
            left: `${p.left}%`,
            backgroundColor: p.color,
            animationDelay: `${p.delay}ms`,
            animationDuration: `${p.duration}ms`,
            transform: `rotate(${p.rotate}deg)`,
          }}
        />
      ))}
    </div>
  )
}
