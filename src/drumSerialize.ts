import {
  DRUM_PAD_MAX,
  DRUM_PAD_MIN,
  clampPadCount,
  createEmptyDrumKit,
  createPad,
  createPattern,
  isPatternId,
  type DrumKit,
  type DrumPad,
  type DrumPattern,
  type PatternId
} from './drumKit'
import { asStepVelocity, clampSwing, DEFAULT_STEP_COUNT, LONG_STEP_COUNT } from './drumTiming'

export interface SerializedDrumPad {
  id: string
  name: string
  volume: number
  pan: number
  pitchSemitones: number
  decay: number
  reverse: boolean
  chokeGroup: number | null
  audioFile?: string
  audioBufferKey?: string
}

export interface SerializedDrumPattern {
  id: PatternId
  stepCount: 16 | 32
  rows: number[][]
}

export interface SerializedDrumKit {
  padCount: number
  pads: SerializedDrumPad[]
  patterns: Record<PatternId, SerializedDrumPattern>
  activePattern: PatternId
  swing: number
}

export interface SerializedPatternClip {
  kind: 'pattern'
  id: string
  patternId: PatternId
  offsetSeconds: number
  duration: number
  fileName?: string
}

export function serializePad(pad: DrumPad, refs?: { audioFile?: string; audioBufferKey?: string }): SerializedDrumPad {
  return {
    id: pad.id,
    name: pad.name,
    volume: pad.volume,
    pan: pad.pan,
    pitchSemitones: pad.pitchSemitones,
    decay: pad.decay,
    reverse: pad.reverse,
    chokeGroup: pad.chokeGroup,
    ...refs
  }
}

export function serializeDrumKit(kit: DrumKit, padRefs?: Array<{ audioFile?: string; audioBufferKey?: string }>): SerializedDrumKit {
  return {
    padCount: clampPadCount(kit.padCount),
    pads: kit.pads.map((pad, i) => serializePad(pad, padRefs?.[i])),
    patterns: {
      A: serializePattern(kit.patterns.A),
      B: serializePattern(kit.patterns.B),
      C: serializePattern(kit.patterns.C),
      D: serializePattern(kit.patterns.D)
    } as SerializedDrumKit['patterns'],
    activePattern: isPatternId(kit.activePattern) ? kit.activePattern : 'A',
    swing: clampSwing(kit.swing)
  }
}

function serializePattern(pattern: DrumPattern): SerializedDrumPattern {
  return {
    id: pattern.id,
    stepCount: pattern.stepCount === LONG_STEP_COUNT ? LONG_STEP_COUNT : DEFAULT_STEP_COUNT,
    rows: pattern.rows.map((row) => row.map((cell) => asStepVelocity(cell)))
  }
}

export function hydrateDrumKit(raw: unknown, buffers?: Array<AudioBuffer | null>): DrumKit {
  const fallback = createEmptyDrumKit()
  if (!raw || typeof raw !== 'object') return fallback
  const data = raw as Partial<SerializedDrumKit>
  const padCount = clampPadCount(Number(data.padCount) || (Array.isArray(data.pads) ? data.pads.length : DRUM_PAD_MIN))
  const rawPads = Array.isArray(data.pads) ? data.pads : []
  const pads = Array.from({ length: padCount }, (_, i) => {
    const src = rawPads[i]
    const base = createPad(i)
    if (!src || typeof src !== 'object') return { ...base, buffer: buffers?.[i] ?? null }
    return {
      id: typeof src.id === 'string' ? src.id : base.id,
      name: typeof src.name === 'string' && src.name.trim() ? src.name : base.name,
      volume: clamp01(src.volume, base.volume),
      pan: clampPan(src.pan),
      pitchSemitones: clampPitch(src.pitchSemitones),
      decay: clampDecay(src.decay, base.decay),
      reverse: !!src.reverse,
      chokeGroup: parseChoke(src.chokeGroup),
      buffer: buffers?.[i] ?? null
    }
  })

  const patterns = {
    A: hydratePattern('A', data.patterns?.A, padCount),
    B: hydratePattern('B', data.patterns?.B, padCount),
    C: hydratePattern('C', data.patterns?.C, padCount),
    D: hydratePattern('D', data.patterns?.D, padCount)
  }

  return {
    padCount,
    pads,
    patterns,
    activePattern: isPatternId(data.activePattern) ? data.activePattern : 'A',
    swing: clampSwing(Number(data.swing) || 0)
  }
}

function hydratePattern(id: PatternId, raw: unknown, padCount: number): DrumPattern {
  const fallback = createPattern(id, padCount)
  if (!raw || typeof raw !== 'object') return fallback
  const data = raw as Partial<SerializedDrumPattern>
  const stepCount = data.stepCount === LONG_STEP_COUNT ? LONG_STEP_COUNT : DEFAULT_STEP_COUNT
  const srcRows = Array.isArray(data.rows) ? data.rows : []
  const rows = Array.from({ length: padCount }, (_, i) => {
    const row = Array.isArray(srcRows[i]) ? srcRows[i] : []
    return Array.from({ length: stepCount }, (_, s) => asStepVelocity(row[s]))
  })
  return { id, stepCount, rows }
}

export function serializePatternClip(clip: {
  id: string
  patternId?: PatternId | string
  offsetSeconds: number
  duration: number
  fileName?: string
}): SerializedPatternClip {
  const patternId = isPatternId(clip.patternId) ? clip.patternId : 'A'
  return {
    kind: 'pattern',
    id: clip.id,
    patternId,
    offsetSeconds: Number(clip.offsetSeconds) || 0,
    duration: Math.max(0.05, Number(clip.duration) || 0.05),
    fileName: clip.fileName || `Patrón ${patternId}`
  }
}

export function hydratePatternClips(raw: unknown): SerializedPatternClip[] {
  if (!Array.isArray(raw)) return []
  return raw
    .filter((c) => c && (c.kind === 'pattern' || c.patternId))
    .map((c) => serializePatternClip(c))
}

function clamp01(n: unknown, fallback = 0.9): number {
  const v = Number(n)
  if (!Number.isFinite(v)) return fallback
  return Math.max(0, Math.min(1, v))
}

function clampPan(n: unknown): number {
  const v = Number(n)
  if (!Number.isFinite(v)) return 0
  return Math.max(-1, Math.min(1, v))
}

function clampPitch(n: unknown): number {
  const v = Number(n)
  if (!Number.isFinite(v)) return 0
  return Math.max(-12, Math.min(12, v))
}

function clampDecay(n: unknown, fallback: number): number {
  const v = Number(n)
  if (!Number.isFinite(v)) return fallback
  return Math.max(0.04, Math.min(2, v))
}

function parseChoke(n: unknown): number | null {
  const v = Number(n)
  if (!Number.isFinite(v) || v <= 0) return null
  return Math.max(1, Math.min(4, Math.round(v)))
}

export function isDrumTrackKind(kind: unknown): boolean {
  return kind === 'drum' || kind === 'pads'
}

export { DRUM_PAD_MAX, DRUM_PAD_MIN }
