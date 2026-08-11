// Maps ProductCategory -> a representative lucide icon, purely for visual
// scanning (quote option item rows, catalog lists). Kept out of
// audioConfigs.ts deliberately — that module is framework-agnostic pure
// data, and this is presentation (a React icon component per category).

import {
  BatteryCharging,
  Box,
  Cable,
  Camera,
  CircuitBoard,
  Layers,
  Package,
  Plug,
  Radio,
  Sparkles,
  SlidersHorizontal,
  Speaker,
  Wrench,
  Zap,
  type LucideIcon,
} from 'lucide-react'
import type { ProductCategory } from '../types'

export const CATEGORY_ICONS: Record<ProductCategory, LucideIcon> = {
  subwoofer: Speaker,
  enclosure: Box,
  mono_amp: Zap,
  multi_amp: Zap,
  four_five_channel_amp: Zap,
  wiring_kit: Cable,
  integration: Plug,
  bass_control: SlidersHorizontal,
  battery: BatteryCharging,
  big_three: Cable,
  epicenter: Sparkles,
  integration_module: CircuitBoard,
  sound_treatment: Layers,
  ofc_wiring: Cable,
  door_speaker: Speaker,
  tweeter: Speaker,
  radio: Radio,
  dsp: SlidersHorizontal,
  camera: Camera,
  fabrication: Wrench,
  labor: Wrench,
  accessory: Package,
  other: Package,
}

/** A small rounded icon badge — the compact, self-explanatory stand-in for a category label on an item row. */
export function CategoryIcon({ category, className = 'h-4 w-4' }: { category: ProductCategory | null; className?: string }) {
  const Icon = category ? CATEGORY_ICONS[category] : Package
  return <Icon className={className} aria-hidden="true" />
}
