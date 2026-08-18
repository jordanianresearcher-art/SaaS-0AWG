// Side-profile silhouettes for the seven tint body styles.
//
// The tint flow lost its car diagrams (they're parked pending a top-down
// redesign), which left the body-style picker as seven text labels — and
// "SUV (4 window)" vs "SUV (6 window)" is genuinely hard to tell apart as
// words while a customer is standing at the counter. A shape is instant.
//
// Hand-drawn generic outlines on purpose: no licensing question the way real
// car photography or manufacturer art would carry, no asset pipeline, and they
// stay crisp at any size. They are meant to read as "a truck" or "a van", not
// as any specific vehicle.

import type { TintBodyStyle } from '../types'

/** Path data in a shared 120x48 viewBox so every silhouette sits on the same baseline. */
const PATHS: Record<TintBodyStyle, string> = {
  // Low roofline, long doors, short rear deck.
  coupe:
    'M8 36 L12 28 Q14 24 20 22 L38 14 Q46 11 58 11 L74 11 Q84 12 92 18 L104 24 Q112 26 113 30 L113 36 Z',
  // Three-box: hood, cabin, trunk.
  sedan:
    'M6 36 L10 27 Q12 23 18 22 L34 14 Q42 11 56 11 L78 11 Q88 12 96 18 L108 23 Q114 25 114 30 L114 36 Z',
  // One row of glass, then an open bed.
  truck_single_cab:
    'M6 36 L9 26 Q10 22 16 21 L30 12 Q36 9 48 9 L62 9 Q66 9 67 13 L67 21 L114 21 L114 36 Z',
  // Two rows of glass, then a shorter bed.
  truck_crew_cab:
    'M6 36 L9 26 Q10 22 16 21 L30 12 Q36 9 48 9 L76 9 Q80 9 81 13 L81 21 L114 21 L114 36 Z',
  // Tall body, two side windows behind the windshield.
  suv_4_window:
    'M7 36 L10 25 Q11 20 18 19 L32 10 Q39 7 52 7 L86 7 Q96 8 102 14 L110 20 Q114 22 114 27 L114 36 Z',
  // Same tall body with an extra quarter window at the rear.
  suv_6_window:
    'M7 36 L10 25 Q11 20 18 19 L30 10 Q37 7 50 7 L92 7 Q102 8 107 14 L112 20 Q115 22 115 27 L115 36 Z',
  // Long sloped nose into a tall single-volume body.
  minivan:
    'M7 36 L9 26 Q10 21 16 19 L28 11 Q36 6 52 6 L88 6 Q100 7 106 14 L112 21 Q115 23 115 28 L115 36 Z',
}

/** Where the side glass sits, so the shape reads as a cabin rather than a blob. */
const WINDOWS: Record<TintBodyStyle, Array<[number, number, number, number]>> = {
  coupe: [
    [34, 15, 20, 7],
    [58, 15, 22, 7],
  ],
  sedan: [
    [32, 15, 16, 7],
    [52, 15, 16, 7],
    [72, 15, 14, 7],
  ],
  truck_single_cab: [
    [30, 13, 14, 7],
    [48, 13, 14, 7],
  ],
  truck_crew_cab: [
    [30, 13, 12, 7],
    [45, 13, 12, 7],
    [60, 13, 12, 7],
  ],
  suv_4_window: [
    [32, 11, 16, 8],
    [52, 11, 16, 8],
    [72, 11, 16, 8],
  ],
  suv_6_window: [
    [30, 11, 14, 8],
    [48, 11, 14, 8],
    [66, 11, 14, 8],
    [84, 11, 10, 8],
  ],
  minivan: [
    [30, 10, 14, 8],
    [48, 10, 16, 8],
    [68, 10, 16, 8],
    [88, 10, 12, 8],
  ],
}

export interface BodyStyleSilhouetteProps {
  bodyStyle: TintBodyStyle
  className?: string
  /** Drawn in currentColor so the tile can tint the whole shape on selection. */
  title?: string
}

export function BodyStyleSilhouette({ bodyStyle, className = '', title }: BodyStyleSilhouetteProps) {
  return (
    <svg
      viewBox="0 0 120 48"
      className={className}
      fill="none"
      role={title ? 'img' : 'presentation'}
      aria-label={title}
      aria-hidden={title ? undefined : true}
    >
      <path d={PATHS[bodyStyle]} fill="currentColor" opacity="0.18" />
      <path d={PATHS[bodyStyle]} stroke="currentColor" strokeWidth="2.5" strokeLinejoin="round" />
      {WINDOWS[bodyStyle].map(([x, y, w, h], i) => (
        <rect key={i} x={x} y={y} width={w} height={h} rx="1.5" fill="currentColor" opacity="0.45" />
      ))}
      {/* Wheels last so they sit on top of the body outline. */}
      <circle cx="32" cy="36" r="7" fill="currentColor" opacity="0.9" />
      <circle cx="92" cy="36" r="7" fill="currentColor" opacity="0.9" />
      <circle cx="32" cy="36" r="3" fill="#ffffff" />
      <circle cx="92" cy="36" r="3" fill="#ffffff" />
    </svg>
  )
}
