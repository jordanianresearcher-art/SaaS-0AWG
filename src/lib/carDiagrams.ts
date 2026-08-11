// Generic, unbranded vehicle silhouettes for the window-tint diagram — a
// single diagonal (3/4 front) line-art view per body style, in the same
// spirit as the classic vehicle-condition inspection diagram (simple
// outline, no shading, no brand marks — just body, window, and headlight
// shapes). Built parametrically off a shared coordinate grid so all 7
// styles read as one consistent "family" rather than 7 unrelated
// drawings — proportions (hood length, roof height, cabin length, rear
// shape) are the only things that vary per style; the drawing technique
// (silhouette + separate front-face plane for the headlight, arcs over
// each wheel, evenly-split window bays) is identical everywhere.
//
// This is deliberately a generic *body-style* illustration, not a
// specific make/model — no logo, no badge, no brand-specific proportions
// copied from a real car's protected design. Picking "the most iconic
// example of each body style" (per the request this was built for)
// informed the *proportions* used below (a fastback 2-door for "coupe", a
// 3-row boxy SUV for "suv_6_window", a sliding-door minivan, etc.) without
// tracing or reproducing any one manufacturer's actual silhouette.
//
// Used two places: TintDiagram.tsx (interactive, React) renders this data
// as JSX <polygon>/<path> elements; renderTintDiagramSvg() below stringifies
// the exact same data into a standalone <svg> markup for the customer
// email (embedded as a base64 data: URI <img> — most modern email clients
// render inline SVG that way; see docs/QUOTE_TRACKING.md's email section).
// One data source, two renderers, so the web view and the email never
// drift apart.

import type { TintBodyStyle, TintWindowPosition, WindowTintWindow } from '../types'

export const CAR_DIAGRAM_VIEWBOX = '0 0 480 220'

interface WheelSpec {
  cx: number
  cy: number
  r: number
}

interface HeadlightSpec {
  cx: number
  cy: number
  rx: number
  ry: number
}

/**
 * The two physical windows at a given front-to-back position (driver side
 * + passenger side) collapse onto ONE visual slot here — a single 3/4
 * silhouette can only show one side of the car, so front_left/front_right
 * (etc.) are drawn as the same polygon. See visualSlotOpacity below for
 * how a left/right pair with different settings still renders sensibly.
 */
export type TintVisualSlot = 'front' | 'rear' | 'quarter' | 'back_glass'

/** Exported so the interactive editor can toggle every position in a slot together (see TintDiagram.tsx). */
export const TINT_VISUAL_SLOT_POSITIONS: Record<TintVisualSlot, TintWindowPosition[]> = {
  front: ['front_left', 'front_right'],
  rear: ['rear_left', 'rear_right'],
  quarter: ['rear_quarter_left', 'rear_quarter_right'],
  back_glass: ['back_glass'],
}

interface BodyStyleDiagram {
  bodyPath: string
  frontFacePath: string
  wheels: WheelSpec[]
  headlight: HeadlightSpec
  /** Which visual slots this body style actually has, and their polygon points (SVG <polygon points="…">). */
  windows: Partial<Record<TintVisualSlot, string>>
}

// ---------------------------------------------------------------------------
// Shared coordinate grid
// ---------------------------------------------------------------------------

const ROCKER_Y = 179
const ROCKER_DIP_Y = 189 // small arcs over each wheel dip down to here
const BELT_Y = 123 // window sill
const FRONT_BUMPER_X = 16
const REAR_BUMPER_X = 464
const FRONT_WHEEL_X = 94
const REAR_WHEEL_X = 392

interface StyleParams {
  cowlX: number // where the hood meets the windshield base
  deckX: number // where the greenhouse ends and the trunk/tailgate/bed begins
  roofY: number // roof top (lower number = taller car)
  hoodY: number // top of the front fender/hood, where the headlight sits
  wheelR: number
  rear: 'fastback' | 'trunk' | 'boxy' | 'bed'
  bays: Array<'front' | 'rear' | 'quarter'>
}

const STYLE_PARAMS: Record<TintBodyStyle, StyleParams> = {
  coupe: { cowlX: 150, deckX: 300, roofY: 55, hoodY: 148, wheelR: 30, rear: 'fastback', bays: ['front', 'quarter'] },
  sedan: { cowlX: 155, deckX: 305, roofY: 58, hoodY: 148, wheelR: 30, rear: 'trunk', bays: ['front', 'rear'] },
  truck_single_cab: { cowlX: 176, deckX: 236, roofY: 52, hoodY: 138, wheelR: 33, rear: 'bed', bays: ['front'] },
  truck_crew_cab: { cowlX: 164, deckX: 300, roofY: 52, hoodY: 138, wheelR: 33, rear: 'bed', bays: ['front', 'rear'] },
  suv_4_window: { cowlX: 116, deckX: 360, roofY: 46, hoodY: 136, wheelR: 31, rear: 'boxy', bays: ['front', 'rear'] },
  suv_6_window: {
    cowlX: 104,
    deckX: 392,
    roofY: 43,
    hoodY: 134,
    wheelR: 31,
    rear: 'boxy',
    bays: ['front', 'rear', 'quarter'],
  },
  minivan: {
    cowlX: 84,
    deckX: 402,
    roofY: 41,
    hoodY: 132,
    wheelR: 31,
    rear: 'boxy',
    bays: ['front', 'rear', 'quarter'],
  },
}

function fmt(n: number): string {
  return Number(n.toFixed(1)).toString()
}

/** Body silhouette: front bumper face -> hood -> windshield -> roof -> rear (shape depends on `rear`) -> rear bumper -> rocker (arcing up over each wheel) back to start. One closed path per style. */
function buildBodyPath(p: StyleParams): string {
  const { cowlX, deckX, roofY, hoodY, rear } = p
  const roofFrontX = cowlX + 14 // A-pillar rake
  const roofRearX = deckX - 6 // C/D-pillar rake

  const rearSegments: string[] =
    rear === 'fastback'
      ? [`Q ${fmt(roofRearX + 60)} ${fmt(roofY + 4)} ${fmt(REAR_BUMPER_X - 10)} ${fmt(ROCKER_Y - 24)}`, `L ${fmt(REAR_BUMPER_X)} ${fmt(ROCKER_Y - 6)}`]
      : rear === 'trunk'
        ? [
            `L ${fmt(deckX + 30)} ${fmt(roofY + 26)}`,
            `L ${fmt(REAR_BUMPER_X - 8)} ${fmt(roofY + 30)}`,
            `L ${fmt(REAR_BUMPER_X)} ${fmt(ROCKER_Y - 6)}`,
          ]
        : rear === 'bed'
          ? [
              `L ${fmt(deckX + 8)} ${fmt(hoodY + 6)}`,
              `L ${fmt(REAR_BUMPER_X)} ${fmt(hoodY + 6)}`,
              `L ${fmt(REAR_BUMPER_X)} ${fmt(ROCKER_Y - 6)}`,
            ]
          : [
              // boxy: near-vertical tailgate straight down from the roofline
              `L ${fmt(REAR_BUMPER_X - 4)} ${fmt(roofY + 2)}`,
              `L ${fmt(REAR_BUMPER_X)} ${fmt(ROCKER_Y - 10)}`,
            ]

  return [
    `M ${fmt(FRONT_BUMPER_X)} ${fmt(ROCKER_Y - 4)}`,
    `L ${fmt(FRONT_BUMPER_X + 2)} ${fmt(hoodY + 10)}`,
    `Q ${fmt(FRONT_BUMPER_X + 4)} ${fmt(hoodY - 6)} ${fmt(FRONT_BUMPER_X + 26)} ${fmt(hoodY - 4)}`,
    `L ${fmt(cowlX - 6)} ${fmt(hoodY - 2)}`,
    `Q ${fmt(cowlX + 4)} ${fmt(hoodY - 10)} ${fmt(roofFrontX)} ${fmt(roofY + 6)}`,
    `Q ${fmt(roofFrontX + 6)} ${fmt(roofY)} ${fmt(roofFrontX + 18)} ${fmt(roofY)}`,
    `L ${fmt(roofRearX)} ${fmt(roofY)}`,
    ...rearSegments,
    `L ${fmt(REAR_WHEEL_X + p.wheelR + 14)} ${fmt(ROCKER_Y)}`,
    `Q ${fmt(REAR_WHEEL_X)} ${fmt(ROCKER_DIP_Y)} ${fmt(REAR_WHEEL_X - p.wheelR - 14)} ${fmt(ROCKER_Y)}`,
    `L ${fmt(FRONT_WHEEL_X + p.wheelR + 14)} ${fmt(ROCKER_Y)}`,
    `Q ${fmt(FRONT_WHEEL_X)} ${fmt(ROCKER_DIP_Y)} ${fmt(FRONT_WHEEL_X - p.wheelR - 14)} ${fmt(ROCKER_Y)}`,
    `L ${fmt(FRONT_BUMPER_X)} ${fmt(ROCKER_Y - 4)}`,
    'Z',
  ].join(' ')
}

/** A small extra plane at the very nose — the one thing that reads as "looking at this from a 3/4 angle" rather than a flat side elevation. Purely decorative (the headlight sits on it); never affects the tint diagram's logic. */
function buildFrontFacePath(p: StyleParams): string {
  const x = FRONT_BUMPER_X
  return [
    `M ${fmt(x)} ${fmt(ROCKER_Y - 4)}`,
    `L ${fmt(x + 2)} ${fmt(p.hoodY + 10)}`,
    `Q ${fmt(x + 4)} ${fmt(p.hoodY - 6)} ${fmt(x + 26)} ${fmt(p.hoodY - 4)}`,
    `L ${fmt(x + 22)} ${fmt(ROCKER_Y - 4)}`,
    'Z',
  ].join(' ')
}

function sideWindowBays(p: StyleParams): Partial<Record<'front' | 'rear' | 'quarter', string>> {
  const top = p.roofY + 9
  const left = p.cowlX + 16
  const right = p.deckX - 8
  const span = right - left
  const gap = 6
  const n = p.bays.length
  const bayWidth = (span - gap * (n - 1)) / n
  const out: Partial<Record<'front' | 'rear' | 'quarter', string>> = {}
  p.bays.forEach((slot, i) => {
    const x0 = left + i * (bayWidth + gap)
    const x1 = x0 + bayWidth
    // A quarter window is the small pillar-side glass — trimmed to a
    // trapezoid (narrower along the top) rather than a plain rectangle so
    // it visually reads as the smaller, oddly-shaped piece it really is.
    const topInset = slot === 'quarter' ? bayWidth * 0.28 : 4
    out[slot] = [
      `${fmt(x0 + topInset)},${fmt(top)}`,
      `${fmt(x1 - 4)},${fmt(top)}`,
      `${fmt(x1)},${fmt(BELT_Y)}`,
      `${fmt(x0)},${fmt(BELT_Y)}`,
    ].join(' ')
  })
  return out
}

function backGlassPolygon(p: StyleParams): string {
  const top = p.roofY + 9
  const left = p.deckX + 4
  switch (p.rear) {
    case 'fastback':
      return [`${fmt(left)},${fmt(top)}`, `${fmt(REAR_BUMPER_X - 20)},${fmt(ROCKER_Y - 30)}`, `${fmt(left + 6)},${fmt(ROCKER_Y - 30)}`].join(' ')
    case 'trunk':
      return [`${fmt(left)},${fmt(top)}`, `${fmt(left + 40)},${fmt(top + 18)}`, `${fmt(left + 12)},${fmt(top + 18)}`].join(' ')
    case 'bed':
      return [`${fmt(left)},${fmt(top + 4)}`, `${fmt(left + 14)},${fmt(top + 4)}`, `${fmt(left + 14)},${fmt(p.hoodY - 2)}`, `${fmt(left)},${fmt(p.hoodY - 2)}`].join(' ')
    case 'boxy':
    default:
      return [
        `${fmt(left)},${fmt(top + 2)}`,
        `${fmt(REAR_BUMPER_X - 10)},${fmt(top + 2)}`,
        `${fmt(REAR_BUMPER_X - 14)},${fmt(BELT_Y)}`,
        `${fmt(left + 4)},${fmt(BELT_Y)}`,
      ].join(' ')
  }
}

function buildDiagram(style: TintBodyStyle): BodyStyleDiagram {
  const p = STYLE_PARAMS[style]
  const bays = sideWindowBays(p)
  const windows: Partial<Record<TintVisualSlot, string>> = { ...bays, back_glass: backGlassPolygon(p) }
  return {
    bodyPath: buildBodyPath(p),
    frontFacePath: buildFrontFacePath(p),
    wheels: [
      { cx: FRONT_WHEEL_X, cy: ROCKER_Y + 8, r: p.wheelR },
      { cx: REAR_WHEEL_X, cy: ROCKER_Y + 8, r: p.wheelR },
    ],
    headlight: { cx: FRONT_BUMPER_X + 13, cy: p.hoodY + 1, rx: 8, ry: 5 },
    windows,
  }
}

const DIAGRAMS: Record<TintBodyStyle, BodyStyleDiagram> = {
  coupe: buildDiagram('coupe'),
  sedan: buildDiagram('sedan'),
  truck_single_cab: buildDiagram('truck_single_cab'),
  truck_crew_cab: buildDiagram('truck_crew_cab'),
  suv_4_window: buildDiagram('suv_4_window'),
  suv_6_window: buildDiagram('suv_6_window'),
  minivan: buildDiagram('minivan'),
}

export function carDiagramFor(style: TintBodyStyle): BodyStyleDiagram {
  return DIAGRAMS[style]
}

/**
 * Darkness of the overlay drawn over a tinted window — NOT the real-world
 * VLT-to-visible-light relationship, just a display convenience: a lower
 * % (a darker film) should look like a darker swatch on the diagram. 5%
 * (very dark) reads as nearly solid; 70% (barely tinted) reads as a
 * faint wash. Monotonic across every TINT_VLT_PERCENTS value, not just
 * the 5/20/35 the shop called out explicitly.
 */
export function tintOpacityForPercent(vltPercent: number | null): number {
  if (vltPercent === null) return 0
  const clamped = Math.min(100, Math.max(0, vltPercent))
  return Math.max(0.12, 0.9 - clamped * 0.008)
}

/** A left/right pair (e.g. front_left + front_right) collapses onto one visual slot — average their opacity so a symmetric job (the common case) shows full-strength, and an asymmetric one still shows *something* rather than picking one side arbitrarily. */
export function visualSlotOpacity(windows: WindowTintWindow[], slot: TintVisualSlot): number {
  const positions = TINT_VISUAL_SLOT_POSITIONS[slot]
  const relevant = windows.filter((w) => positions.includes(w.position))
  if (relevant.length === 0) return 0
  const total = relevant.reduce((sum, w) => sum + (w.included ? tintOpacityForPercent(w.vltPercent) : 0), 0)
  return total / relevant.length
}

/** Every visual slot this body style has, each carrying the (possibly averaged) opacity to render it at right now — the one function both TintDiagram.tsx and the email string-renderer below actually loop over. */
export function visualSlotsWithOpacity(
  style: TintBodyStyle,
  windows: WindowTintWindow[],
): Array<{ slot: TintVisualSlot; points: string; opacity: number }> {
  const diagram = carDiagramFor(style)
  return (Object.keys(diagram.windows) as TintVisualSlot[]).map((slot) => ({
    slot,
    points: diagram.windows[slot]!,
    opacity: visualSlotOpacity(windows, slot),
  }))
}

// ---------------------------------------------------------------------------
// Standalone SVG string — for the customer email (embedded as a base64
// data: URI <img>). Same geometry as TintDiagram.tsx, just serialized to a
// self-contained markup string instead of JSX.
// ---------------------------------------------------------------------------

export function renderTintDiagramSvg(
  style: TintBodyStyle,
  windows: WindowTintWindow[],
  options: { widthPx?: number } = {},
): string {
  const diagram = carDiagramFor(style)
  const slots = visualSlotsWithOpacity(style, windows)
  const width = options.widthPx ?? 420
  const windowShapes = slots
    .map((s) => `<polygon points="${s.points}" fill="#111827" fill-opacity="${s.opacity.toFixed(2)}" stroke="#111827" stroke-width="1" />`)
    .join('')
  const wheelShapes = diagram.wheels
    .map(
      (w) =>
        `<circle cx="${w.cx}" cy="${w.cy}" r="${w.r}" fill="#ffffff" stroke="#111827" stroke-width="3.5" /><circle cx="${w.cx}" cy="${w.cy}" r="${Math.round(w.r * 0.42)}" fill="#111827" />`,
    )
    .join('')
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${CAR_DIAGRAM_VIEWBOX}" width="${width}" height="${Math.round((width * 220) / 480)}">` +
    `<rect x="0" y="0" width="480" height="220" fill="#ffffff" />` +
    wheelShapes +
    `<path d="${diagram.bodyPath}" fill="#ffffff" stroke="#111827" stroke-width="3.5" stroke-linejoin="round" />` +
    windowShapes +
    `<path d="${diagram.frontFacePath}" fill="none" stroke="#111827" stroke-width="3.5" stroke-linejoin="round" />` +
    `<ellipse cx="${diagram.headlight.cx}" cy="${diagram.headlight.cy}" rx="${diagram.headlight.rx}" ry="${diagram.headlight.ry}" fill="#ffffff" stroke="#111827" stroke-width="2" />` +
    `</svg>`
  )
}

/**
 * `renderTintDiagramSvg` wrapped as a base64 data: URI, ready for an
 * <img src>. Browser-only (btoa) — this module is bundled for the Vite
 * client; the Edge Function's own copy (see send-quote-email/index.ts)
 * uses Deno's btoa the same way, not this file directly.
 */
export function tintDiagramDataUri(style: TintBodyStyle, windows: WindowTintWindow[]): string {
  const svg = renderTintDiagramSvg(style, windows)
  return `data:image/svg+xml;base64,${btoa(svg)}`
}
