import {
  DEFAULT_STEP_COUNT,
  LONG_STEP_COUNT,
  asStepVelocity,
  clampSwing,
  type StepVelocity
} from './drumTiming'

export const DRUM_PAD_MIN = 8
export const DRUM_PAD_MAX = 16
export const PATTERN_IDS = ['A', 'B', 'C', 'D'] as const
export type PatternId = (typeof PATTERN_IDS)[number]

export const STARTER_PAD_NAMES = [
  'Bombo',
  'Caja',
  'Palmas',
  'Charles cerrado',
  'Charles abierto',
  'Tom',
  'Rim',
  'Perc'
] as const

export const PAD_KEYS = ['q', 'w', 'e', 'r', 'a', 's', 'd', 'f'] as const

export interface DrumPad {
  id: string
  name: string
  volume: number
  pan: number
  pitchSemitones: number
  decay: number
  reverse: boolean
  chokeGroup: number | null
  buffer: AudioBuffer | null
}

export interface DrumPattern {
  id: PatternId
  stepCount: 16 | 32
  rows: StepVelocity[][]
}

export interface DrumKit {
  padCount: number
  pads: DrumPad[]
  patterns: Record<PatternId, DrumPattern>
  activePattern: PatternId
  swing: number
}

export function isPatternId(value: unknown): value is PatternId {
  return PATTERN_IDS.includes(value as PatternId)
}

export function emptyRows(padCount: number, stepCount: number): StepVelocity[][] {
  return Array.from({ length: padCount }, () => Array.from({ length: stepCount }, () => 0 as StepVelocity))
}

export function createPad(index: number, name?: string): DrumPad {
  return {
    id: `pad-${index + 1}`,
    name: name ?? STARTER_PAD_NAMES[index] ?? `Pad ${index + 1}`,
    volume: 0.9,
    pan: 0,
    pitchSemitones: 0,
    decay: index === 4 ? 0.55 : 0.28,
    reverse: false,
    chokeGroup: index === 3 || index === 4 ? 1 : null,
    buffer: null
  }
}

export function createPattern(id: PatternId, padCount = DRUM_PAD_MIN, stepCount: 16 | 32 = DEFAULT_STEP_COUNT): DrumPattern {
  return {
    id,
    stepCount,
    rows: emptyRows(padCount, stepCount)
  }
}

export function createEmptyDrumKit(): DrumKit {
  const pads = Array.from({ length: DRUM_PAD_MIN }, (_, i) => createPad(i))
  const patterns = {
    A: createPattern('A'),
    B: createPattern('B'),
    C: createPattern('C'),
    D: createPattern('D')
  }
  return {
    padCount: DRUM_PAD_MIN,
    pads,
    patterns,
    activePattern: 'A',
    swing: 0
  }
}

export function expandDrumKit(kit: DrumKit): DrumKit {
  if (kit.padCount >= DRUM_PAD_MAX) return kit
  const pads = kit.pads.slice()
  while (pads.length < DRUM_PAD_MAX) {
    pads.push(createPad(pads.length))
  }
  const patterns = { ...kit.patterns }
  for (const id of PATTERN_IDS) {
    const pattern = patterns[id]
    const rows = pattern.rows.slice()
    while (rows.length < DRUM_PAD_MAX) {
      rows.push(Array.from({ length: pattern.stepCount }, () => 0 as StepVelocity))
    }
    patterns[id] = { ...pattern, rows }
  }
  return { ...kit, padCount: DRUM_PAD_MAX, pads, patterns }
}

export function setPatternStepCount(kit: DrumKit, stepCount: 16 | 32): DrumKit {
  const count = stepCount === LONG_STEP_COUNT ? LONG_STEP_COUNT : DEFAULT_STEP_COUNT
  const patterns = { ...kit.patterns }
  for (const id of PATTERN_IDS) {
    const pattern = patterns[id]
    const rows = pattern.rows.map((row) => {
      const next = row.slice(0, count)
      while (next.length < count) next.push(0)
      return next
    })
    patterns[id] = { ...pattern, stepCount: count, rows }
  }
  return { ...kit, patterns }
}

export function togglePatternStep(kit: DrumKit, padIndex: number, step: number): DrumKit {
  const pattern = kit.patterns[kit.activePattern]
  const rows = pattern.rows.map((row, i) => {
    if (i !== padIndex) return row
    const next = row.slice()
    next[step] = cycleFrom(next[step] ?? 0)
    return next
  })
  return {
    ...kit,
    patterns: { ...kit.patterns, [kit.activePattern]: { ...pattern, rows } }
  }
}

export function setPatternStep(kit: DrumKit, padIndex: number, step: number, velocity: StepVelocity): DrumKit {
  const pattern = kit.patterns[kit.activePattern]
  const rows = pattern.rows.map((row, i) => {
    if (i !== padIndex) return row
    const next = row.slice()
    next[step] = asStepVelocity(velocity)
    return next
  })
  return {
    ...kit,
    patterns: { ...kit.patterns, [kit.activePattern]: { ...pattern, rows } }
  }
}

function cycleFrom(current: number): StepVelocity {
  if (current <= 0) return 2
  if (current === 2) return 3
  if (current === 3) return 1
  return 0
}

export function updatePad(kit: DrumKit, padIndex: number, patch: Partial<DrumPad>): DrumKit {
  const pads = kit.pads.map((pad, i) => (i === padIndex ? { ...pad, ...patch } : pad))
  return { ...kit, pads }
}

export function activePatternOf(kit: DrumKit): DrumPattern {
  return kit.patterns[kit.activePattern] ?? kit.patterns.A
}

export function padKeyIndex(key: string): number {
  const k = key.length === 1 ? key.toLowerCase() : key
  return PAD_KEYS.indexOf(k as (typeof PAD_KEYS)[number])
}

export function nextDrumTrackName(existing: Array<string | undefined | null>): string {
  const base = 'Batería (pads)'
  const used = new Set(
    existing
      .filter((n): n is string => typeof n === 'string')
      .map((n) => n.trim().toLowerCase())
  )
  if (!used.has(base.toLowerCase())) return base
  for (let n = 2; n < 99; n++) {
    const name = `${base} ${n}`
    if (!used.has(name.toLowerCase())) return name
  }
  return `${base} ${Date.now()}`
}

export function clampPadCount(n: number): number {
  if (!Number.isFinite(n)) return DRUM_PAD_MIN
  return Math.max(DRUM_PAD_MIN, Math.min(DRUM_PAD_MAX, Math.round(n)))
}

export function withSwing(kit: DrumKit, swing: number): DrumKit {
  return { ...kit, swing: clampSwing(swing) }
}
