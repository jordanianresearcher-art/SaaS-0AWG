import { Trophy } from 'lucide-react'
import type { RecoveryTier } from '../lib/metrics'
import { TIER_CONFIG } from '../lib/metrics'
import { useCountUp } from '../lib/useCountUp'

const TIER_COLOR: Record<RecoveryTier, string> = {
  none: '#a1a1aa',
  bronze: '#b45309',
  silver: '#71717a',
  gold: '#eab308',
  platinum: '#7c3aed',
}

const SIZE = 168
const STROKE = 14
const RADIUS = (SIZE - STROKE) / 2
const CIRCUMFERENCE = 2 * Math.PI * RADIUS

export function RecoveryScoreGauge({ score, tier }: { score: number | null; tier: RecoveryTier }) {
  const animated = useCountUp(score ?? 0)
  const color = TIER_COLOR[tier]
  const offset = CIRCUMFERENCE * (1 - (score ?? 0) / 100)

  return (
    <div className="flex flex-col items-center gap-3">
      <div className="relative" style={{ width: SIZE, height: SIZE }}>
        <svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`} className="-rotate-90">
          <circle cx={SIZE / 2} cy={SIZE / 2} r={RADIUS} fill="none" stroke="#f4f4f5" strokeWidth={STROKE} />
          {score !== null ? (
            <circle
              cx={SIZE / 2}
              cy={SIZE / 2}
              r={RADIUS}
              fill="none"
              stroke={color}
              strokeWidth={STROKE}
              strokeLinecap="round"
              strokeDasharray={CIRCUMFERENCE}
              strokeDashoffset={offset}
              style={{ transition: 'stroke-dashoffset 900ms ease-out' }}
            />
          ) : null}
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          {score !== null ? (
            <>
              <span className="text-4xl font-black text-ink">{animated}</span>
              <span className="text-sm font-semibold text-zinc-500">/ 100</span>
            </>
          ) : (
            <Trophy className="h-10 w-10 text-zinc-300" aria-hidden="true" />
          )}
        </div>
      </div>
      <span
        className="rounded-full px-4 py-1.5 text-base font-black tracking-wide text-white"
        style={{ backgroundColor: color }}
      >
        {TIER_CONFIG[tier].label}
      </span>
    </div>
  )
}
