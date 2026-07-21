import { useEffect, useRef, useState } from 'react'

/** Animates a number from its previous value to `target` over `durationMs`. */
export function useCountUp(target: number, durationMs = 900): number {
  const [value, setValue] = useState(target)
  const fromRef = useRef(target)

  useEffect(() => {
    const from = fromRef.current
    if (from === target) return
    const start = performance.now()
    let frame: number

    const tick = (now: number) => {
      const progress = Math.min(1, (now - start) / durationMs)
      const eased = 1 - (1 - progress) * (1 - progress) // ease-out
      setValue(Math.round(from + (target - from) * eased))
      if (progress < 1) {
        frame = requestAnimationFrame(tick)
      } else {
        fromRef.current = target
      }
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [target, durationMs])

  return value
}
