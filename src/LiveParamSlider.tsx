import { memo, useEffect, useRef, useState } from 'react'
import { VOLUME_COMMIT_MS } from './trackGain'

interface LiveParamSliderProps {
  value: number
  min?: number
  max?: number
  step?: number
  className?: string
  title?: string
  ariaLabel?: string
  onLive: (value: number) => void
  onCommit: (value: number) => void
  commitDelayMs?: number
}

export const LiveParamSlider = memo(function LiveParamSlider({
  value,
  min = 0,
  max = 1,
  step = 0.01,
  className,
  title,
  ariaLabel,
  onLive,
  onCommit,
  commitDelayMs = VOLUME_COMMIT_MS
}: LiveParamSliderProps) {
  const [local, setLocal] = useState(value)
  const localRef = useRef(value)
  const debounceRef = useRef<number | null>(null)
  const draggingRef = useRef(false)

  useEffect(() => {
    if (draggingRef.current) return
    setLocal(value)
    localRef.current = value
  }, [value])

  const clearDebounce = () => {
    if (debounceRef.current != null) {
      window.clearTimeout(debounceRef.current)
      debounceRef.current = null
    }
  }

  const emitLive = (next: number) => {
    draggingRef.current = true
    localRef.current = next
    setLocal(next)
    onLive(next)
    clearDebounce()
    debounceRef.current = window.setTimeout(() => {
      debounceRef.current = null
      draggingRef.current = false
      onCommit(localRef.current)
    }, commitDelayMs)
  }

  const commitNow = () => {
    clearDebounce()
    draggingRef.current = false
    onCommit(localRef.current)
  }

  return (
    <input
      type="range"
      className={className}
      min={min}
      max={max}
      step={step}
      value={local}
      data-testid="track-volume-slider"
      aria-label={ariaLabel ?? title ?? 'Volumen'}
      title={title ?? `Volumen: ${Math.round(local * 100)}%`}
      onPointerDown={(e) => {
        draggingRef.current = true
        e.currentTarget.setPointerCapture(e.pointerId)
      }}
      onChange={(e) => emitLive(parseFloat(e.target.value))}
      onPointerUp={commitNow}
      onPointerCancel={commitNow}
      onBlur={commitNow}
    />
  )
})
