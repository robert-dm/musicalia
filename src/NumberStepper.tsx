import { useCallback, useEffect, useRef, useState } from 'react'
import {
  STEPPER_HOLD_DELAY_MS,
  STEPPER_HOLD_INTERVAL_MS,
  STEPPER_VALUE_WIDTH_CH
} from './numberStepper'

interface NumberStepperProps {
  value: number
  min: number
  max: number
  step: number
  resetValue: number
  format: (n: number) => string
  parse: (raw: string) => number | null
  clamp: (n: number) => number
  onChange: (n: number) => void
  ariaLabel: string
  testId: string
}

export function NumberStepper({
  value,
  min,
  max,
  step,
  resetValue,
  format,
  parse,
  clamp,
  onChange,
  ariaLabel,
  testId
}: NumberStepperProps) {
  const [draft, setDraft] = useState<string | null>(null)
  const draftRef = useRef<string | null>(null)
  const valueRef = useRef(value)
  const onChangeRef = useRef(onChange)
  const holdRef = useRef<{ delay: number | null; interval: number | null }>({
    delay: null,
    interval: null
  })

  valueRef.current = value
  onChangeRef.current = onChange

  const setDraftValue = (next: string | null) => {
    draftRef.current = next
    setDraft(next)
  }

  const stopHold = useCallback(() => {
    if (holdRef.current.delay != null) {
      window.clearTimeout(holdRef.current.delay)
      holdRef.current.delay = null
    }
    if (holdRef.current.interval != null) {
      window.clearInterval(holdRef.current.interval)
      holdRef.current.interval = null
    }
  }, [])

  useEffect(() => stopHold, [stopHold])

  const applyStep = useCallback(
    (dir: 1 | -1) => {
      const next = clamp(valueRef.current + dir * step)
      if (next === valueRef.current) {
        stopHold()
        return
      }
      onChangeRef.current(next)
    },
    [clamp, step, stopHold]
  )

  const startHold = (dir: 1 | -1, pointerId: number, target: HTMLElement) => {
    stopHold()
    applyStep(dir)
    try {
      target.setPointerCapture(pointerId)
    } catch {
      /* capture can fail if the pointer already ended */
    }
    holdRef.current.delay = window.setTimeout(() => {
      holdRef.current.delay = null
      holdRef.current.interval = window.setInterval(
        () => applyStep(dir),
        STEPPER_HOLD_INTERVAL_MS
      )
    }, STEPPER_HOLD_DELAY_MS)
  }

  const commitDraft = () => {
    const current = draftRef.current
    if (current == null) return
    setDraftValue(null)
    const parsed = parse(current)
    if (parsed == null) return
    onChangeRef.current(clamp(parsed))
  }

  const resetToDefault = () => {
    setDraftValue(null)
    onChangeRef.current(clamp(resetValue))
  }

  const atMin = value <= min + 1e-9
  const atMax = value >= max - 1e-9

  return (
    <div className="number-stepper" data-testid={testId} role="group" aria-label={ariaLabel}>
      <button
        type="button"
        className="number-stepper-btn"
        data-testid={`${testId}-dec`}
        aria-label="Disminuir"
        disabled={atMin}
        tabIndex={-1}
        onPointerDown={(e) => {
          if (e.button !== 0 || atMin) return
          e.preventDefault()
          startHold(-1, e.pointerId, e.currentTarget)
        }}
        onPointerUp={stopHold}
        onPointerCancel={stopHold}
        onLostPointerCapture={stopHold}
      >
        -
      </button>
      <input
        className="number-stepper-value"
        data-testid={`${testId}-value`}
        style={{
          width: `${STEPPER_VALUE_WIDTH_CH}ch`,
          minWidth: `${STEPPER_VALUE_WIDTH_CH}ch`,
          maxWidth: `${STEPPER_VALUE_WIDTH_CH}ch`
        }}
        aria-label={ariaLabel}
        value={draft ?? format(value)}
        spellCheck={false}
        autoComplete="off"
        onChange={(e) => setDraftValue(e.target.value)}
        onFocus={(e) => {
          setDraftValue(format(valueRef.current))
          e.currentTarget.select()
        }}
        onBlur={commitDraft}
        onMouseDown={(e) => {
          if (e.button !== 0 || e.detail < 2) return
          e.preventDefault()
          e.stopPropagation()
          resetToDefault()
        }}
        onDoubleClick={(e) => {
          e.preventDefault()
          e.stopPropagation()
          resetToDefault()
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            commitDraft()
            e.currentTarget.blur()
          } else if (e.key === 'Escape') {
            e.preventDefault()
            setDraftValue(null)
            e.currentTarget.blur()
          }
        }}
      />
      <button
        type="button"
        className="number-stepper-btn"
        data-testid={`${testId}-inc`}
        aria-label="Aumentar"
        disabled={atMax}
        tabIndex={-1}
        onPointerDown={(e) => {
          if (e.button !== 0 || atMax) return
          e.preventDefault()
          startHold(1, e.pointerId, e.currentTarget)
        }}
        onPointerUp={stopHold}
        onPointerCancel={stopHold}
        onLostPointerCapture={stopHold}
      >
        +
      </button>
    </div>
  )
}
