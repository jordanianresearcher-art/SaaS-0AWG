// Renders the diagonal (3/4-view) vehicle silhouette from src/lib/carDiagrams.ts
// as real SVG — interactive (click a window to toggle it) when onToggleSlot
// is given, read-only otherwise. Used in the tint editor, the quote detail
// page, the public quote page, and the email preview (the actual email
// itself uses renderTintDiagramSvg's string form instead, same geometry).

import type { TintBodyStyle, WindowTintWindow } from '../types'
import { CAR_DIAGRAM_VIEWBOX, carDiagramFor, visualSlotsWithOpacity, type TintVisualSlot } from '../lib/carDiagrams'

export const TINT_SLOT_LABEL: Record<TintVisualSlot, string> = {
  front: 'Front windows',
  rear: 'Rear windows',
  quarter: 'Rear quarter windows',
  back_glass: 'Back glass',
}

export function TintDiagram({
  bodyStyle,
  windows,
  onToggleSlot,
  className,
}: {
  bodyStyle: TintBodyStyle
  windows: WindowTintWindow[]
  /** Omit for a read-only display (quote detail, public page, email preview). */
  onToggleSlot?: (slot: TintVisualSlot) => void
  className?: string
}) {
  const diagram = carDiagramFor(bodyStyle)
  const slots = visualSlotsWithOpacity(bodyStyle, windows)

  return (
    <svg
      viewBox={CAR_DIAGRAM_VIEWBOX}
      className={className ?? 'w-full'}
      role="img"
      aria-label={`${bodyStyle.replace(/_/g, ' ')} tint diagram`}
    >
      {diagram.wheels.map((w, i) => (
        <g key={i}>
          <circle cx={w.cx} cy={w.cy} r={w.r} fill="#ffffff" stroke="#111827" strokeWidth={3.5} />
          <circle cx={w.cx} cy={w.cy} r={w.r * 0.42} fill="#111827" />
        </g>
      ))}
      <path d={diagram.bodyPath} fill="#ffffff" stroke="#111827" strokeWidth={3.5} strokeLinejoin="round" />
      {slots.map(({ slot, points, opacity }) => (
        <polygon
          key={slot}
          points={points}
          fill="#111827"
          fillOpacity={opacity}
          stroke="#111827"
          strokeWidth={1}
          className={onToggleSlot ? 'cursor-pointer transition-opacity hover:opacity-80' : undefined}
          onClick={onToggleSlot ? () => onToggleSlot(slot) : undefined}
        >
          <title>{TINT_SLOT_LABEL[slot]}</title>
        </polygon>
      ))}
      <path d={diagram.frontFacePath} fill="none" stroke="#111827" strokeWidth={3.5} strokeLinejoin="round" />
      <ellipse
        cx={diagram.headlight.cx}
        cy={diagram.headlight.cy}
        rx={diagram.headlight.rx}
        ry={diagram.headlight.ry}
        fill="#ffffff"
        stroke="#111827"
        strokeWidth={2}
      />
    </svg>
  )
}
