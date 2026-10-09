export const STEPPER_HOLD_DELAY_MS = 400
export const STEPPER_HOLD_INTERVAL_MS = 80
export const STEPPER_VALUE_WIDTH_CH = 6

export function formatTempoRate(n: number): string {
  return `${n.toFixed(2)}x`
}

export function formatPitchSemitones(n: number): string {
  if (n > 0) return `+${n.toFixed(1)}`
  if (n < 0) return n.toFixed(1)
  return '+0.0'
}

export function parseTempoRate(raw: string): number | null {
  const n = Number.parseFloat(raw.trim().replace(/x$/i, ''))
  return Number.isFinite(n) ? n : null
}

export function parsePitchSemitones(raw: string): number | null {
  const n = Number.parseFloat(raw.trim())
  return Number.isFinite(n) ? n : null
}

export function stepClamped(
  value: number,
  direction: 1 | -1,
  step: number,
  clamp: (n: number) => number
): number {
  return clamp(value + direction * step)
}
