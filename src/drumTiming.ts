export const SIXTEENTHS_PER_BEAT = 4
export const BEATS_PER_BAR = 4
export const DEFAULT_STEP_COUNT = 16
export const LONG_STEP_COUNT = 32
export const MAX_SWING = 0.75

export type StepVelocity = 0 | 1 | 2 | 3

export const VELOCITY_GAIN: Record<1 | 2 | 3, number> = {
  1: 0.4,
  2: 0.75,
  3: 1
}

export function sixteenthSeconds(bpm: number): number {
  const safe = Number.isFinite(bpm) && bpm > 0 ? bpm : 120
  return 60 / safe / SIXTEENTHS_PER_BEAT
}

export function patternPeriodSeconds(stepCount: number, bpm: number): number {
  const steps = stepCount > 0 ? stepCount : DEFAULT_STEP_COUNT
  return steps * sixteenthSeconds(bpm)
}

export function clampSwing(swing: number): number {
  if (!Number.isFinite(swing)) return 0
  return Math.max(0, Math.min(MAX_SWING, swing))
}

/** Even 16ths (0-based odd indices) are delayed by swing × one 16th. */
export function stepSongTime(step: number, bpm: number, swing: number): number {
  const six = sixteenthSeconds(bpm)
  const delay = step % 2 === 1 ? clampSwing(swing) * six : 0
  return step * six + delay
}

export function cycleStepVelocity(current: number): StepVelocity {
  if (current <= 0) return 2
  if (current === 2) return 3
  if (current === 3) return 1
  return 0
}

export function asStepVelocity(n: unknown): StepVelocity {
  const v = Number(n)
  if (v === 1 || v === 2 || v === 3) return v
  return 0
}

export interface DrumHit {
  padIndex: number
  songTime: number
  velocity: 1 | 2 | 3
  step: number
  cycle: number
}

export function hitsInWindow(args: {
  rows: number[][]
  stepCount: number
  bpm: number
  swing: number
  clipStart: number
  clipDuration: number
  windowStart: number
  windowEnd: number
}): DrumHit[] {
  const stepCount = Math.max(1, Math.floor(args.stepCount) || DEFAULT_STEP_COUNT)
  const period = patternPeriodSeconds(stepCount, args.bpm)
  const clipStart = args.clipStart
  const clipEnd = clipStart + Math.max(0, args.clipDuration)
  const winStart = Math.max(args.windowStart, clipStart)
  const winEnd = Math.min(args.windowEnd, clipEnd)
  if (!(period > 0) || winEnd <= winStart) return []

  const hits: DrumHit[] = []
  const firstCycle = Math.max(0, Math.floor((winStart - clipStart) / period) - 1)
  const lastCycle = Math.ceil((winEnd - clipStart) / period) + 1

  for (let cycle = firstCycle; cycle <= lastCycle; cycle++) {
    const cycleOrigin = clipStart + cycle * period
    if (cycleOrigin >= clipEnd) break
    args.rows.forEach((row, padIndex) => {
      if (!row) return
      const limit = Math.min(stepCount, row.length)
      for (let step = 0; step < limit; step++) {
        const velocity = asStepVelocity(row[step])
        if (velocity === 0) continue
        const songTime = cycleOrigin + stepSongTime(step, args.bpm, args.swing)
        if (songTime < winStart || songTime >= winEnd || songTime >= clipEnd) continue
        hits.push({ padIndex, songTime, velocity, step, cycle })
      }
    })
  }

  hits.sort((a, b) => a.songTime - b.songTime || a.padIndex - b.padIndex)
  return hits
}

/** Transport.seconds is seeded with song time and then advances with wall clock. */
export function transportTimeForHit(
  songTime: number,
  playOriginSong: number,
  tempoRate: number
): number {
  const rate = Number.isFinite(tempoRate) && tempoRate > 0 ? tempoRate : 1
  return playOriginSong + (songTime - playOriginSong) / rate
}
