import { memo, useEffect, useRef, useState } from 'react'
import { VOLUME_COMMIT_MS } from './trackGain'

interface ParamKnobProps {
  label: string
  value: number
  min: number
  max: number
  step?: number
  unit?: string
  disabled?: boolean
  onLive: (value: number) => void
  onCommit: (value: number) => void
}

function formatKnobValue(value: number, unit?: string): string {
  if (unit === 'Hz') return `${Math.round(value)}`
  if (unit === 'dB') return value.toFixed(1)
  if (unit === 's') return value.toFixed(2)
  if (Math.abs(value) >= 100) return value.toFixed(0)
  return value.toFixed(2)
}

function clampToStep(value: number, min: number, max: number, step: number): number {
  const clamped = Math.max(min, Math.min(max, value))
  if (step <= 0) return clamped
  const stepped = min + Math.round((clamped - min) / step) * step
  return Math.max(min, Math.min(max, stepped))
}

export const ParamKnob = memo(function ParamKnob({
  label,
  value,
  min,
  max,
  step = 0.01,
  unit,
  disabled = false,
  onLive,
  onCommit
}: ParamKnobProps) {
  const [local, setLocal] = useState(value)
  const localRef = useRef(value)
  const draggingRef = useRef(false)
  const startYRef = useRef(0)
  const startValRef = useRef(value)
  const debounceRef = useRef<number | null>(null)

  useEffect(() => {
    if (draggingRef.current) return
    setLocal(value)
    localRef.current = value
  }, [value])

  const span = max - min || 1
  const norm = Math.max(0, Math.min(1, (local - min) / span))
  const angle = -135 + norm * 270

  const clearDebounce = () => {
    if (debounceRef.current != null) {
      window.clearTimeout(debounceRef.current)
      debounceRef.current = null
    }
  }

  const emit = (next: number, commit: boolean) => {
    const v = clampToStep(next, min, max, step)
    localRef.current = v
    setLocal(v)
    onLive(v)
    clearDebounce()
    if (commit) {
      draggingRef.current = false
      onCommit(v)
      return
    }
    debounceRef.current = window.setTimeout(() => {
      debounceRef.current = null
      draggingRef.current = false
      onCommit(localRef.current)
    }, VOLUME_COMMIT_MS)
  }

  return (
    <div className={`param-knob${disabled ? ' disabled' : ''}`} title={`${label}: ${formatKnobValue(local, unit)}${unit ? ` ${unit}` : ''}`}>
      <button
        type="button"
        className="param-knob-dial"
        disabled={disabled}
        aria-label={label}
        onPointerDown={(e) => {
          if (disabled) return
          e.preventDefault()
          e.stopPropagation()
          draggingRef.current = true
          startYRef.current = e.clientY
          startValRef.current = localRef.current
          e.currentTarget.setPointerCapture(e.pointerId)
        }}
        onPointerMove={(e) => {
          if (!draggingRef.current) return
          const fine = e.shiftKey ? 0.15 : 1
          const delta = (startYRef.current - e.clientY) * fine
          emit(startValRef.current + (delta / 90) * span, false)
        }}
        onPointerUp={(e) => {
          if (!draggingRef.current) return
          draggingRef.current = false
          e.currentTarget.releasePointerCapture(e.pointerId)
          emit(localRef.current, true)
        }}
        onPointerCancel={() => emit(localRef.current, true)}
        onDoubleClick={(e) => {
          e.preventDefault()
          e.stopPropagation()
          emit((min + max) / 2, true)
        }}
      >
        <span className="param-knob-tick" style={{ transform: `rotate(${angle}deg)` }} />
      </button>
      <span className="param-knob-value">{formatKnobValue(local, unit)}{unit === 'Hz' ? '' : unit ? ` ${unit}` : ''}</span>
      <span className="param-knob-label">{label}</span>
    </div>
  )
})
