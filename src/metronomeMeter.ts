import { clampBpm, secondsPerBeatSafe } from './tempoMath'

export type CompoundPulse = 'dotted-quarter' | 'eighth'
export type MetronomeSubdivision = 'none' | 'eighths' | 'triplets' | 'sixteenths'
export type ClickSound = 'wood' | 'beep' | 'rim'

export interface MetronomeMeter {
  numerator: number
  denominator: number
  compoundPulse: CompoundPulse
  phaseSeconds: number
  accentDownbeat: boolean
  subdivision: MetronomeSubdivision
  clickSound: ClickSound
}

export const TIME_SIGNATURE_PRESETS: ReadonlyArray<{ numerator: number; denominator: number; label: string }> = [
  { numerator: 4, denominator: 4, label: '4/4' },
  { numerator: 3, denominator: 4, label: '3/4' },
  { numerator: 2, denominator: 4, label: '2/4' },
  { numerator: 6, denominator: 8, label: '6/8' },
  { numerator: 5, denominator: 4, label: '5/4' },
  { numerator: 7, denominator: 8, label: '7/8' },
  { numerator: 12, denominator: 8, label: '12/8' }
]

export const CLICK_SOUNDS: readonly ClickSound[] = ['wood', 'beep', 'rim']
export const SUBDIVISIONS: readonly MetronomeSubdivision[] = ['none', 'eighths', 'triplets', 'sixteenths']

export const DEFAULT_METRONOME_METER: MetronomeMeter = {
  numerator: 4,
  denominator: 4,
  compoundPulse: 'dotted-quarter',
  phaseSeconds: 0,
  accentDownbeat: true,
  subdivision: 'none',
  clickSound: 'beep'
}

const DENOMS = new Set([1, 2, 4, 8, 16])

export function clampMeterInt(n: unknown, min: number, max: number, fallback: number): number {
  const v = Math.floor(Number(n))
  if (!Number.isFinite(v)) return fallback
  return Math.min(max, Math.max(min, v))
}

export function isCompoundMeter(numerator: number, denominator: number): boolean {
  return denominator === 8 && numerator >= 6 && numerator % 3 === 0
}

export function formatTimeSignature(meter: Pick<MetronomeMeter, 'numerator' | 'denominator'>): string {
  return `${meter.numerator}/${meter.denominator}`
}

export function normalizeMetronomeMeter(raw?: Partial<MetronomeMeter> | null): MetronomeMeter {
  const numerator = clampMeterInt(raw?.numerator, 1, 16, 4)
  const denomIn = Math.floor(Number(raw?.denominator))
  const denominator = DENOMS.has(denomIn) ? denomIn : 4
  const compoundPulse: CompoundPulse = raw?.compoundPulse === 'eighth' ? 'eighth' : 'dotted-quarter'
  const phaseSeconds = Number.isFinite(Number(raw?.phaseSeconds)) ? Number(raw?.phaseSeconds) : 0
  const accentDownbeat = raw?.accentDownbeat !== false
  const subdivision: MetronomeSubdivision = SUBDIVISIONS.includes(raw?.subdivision as MetronomeSubdivision)
    ? (raw!.subdivision as MetronomeSubdivision)
    : 'none'
  const clickSound: ClickSound = CLICK_SOUNDS.includes(raw?.clickSound as ClickSound)
    ? (raw!.clickSound as ClickSound)
    : 'beep'
  return {
    numerator,
    denominator,
    compoundPulse,
    phaseSeconds,
    accentDownbeat,
    subdivision,
    clickSound
  }
}

export function meterFromBeatsPerBar(beatsPerBar?: number): MetronomeMeter {
  return normalizeMetronomeMeter({
    ...DEFAULT_METRONOME_METER,
    numerator: clampMeterInt(beatsPerBar, 1, 16, 4),
    denominator: 4
  })
}

export function wrapPhase(seconds: number, barDuration: number): number {
  if (!(barDuration > 0) || !Number.isFinite(seconds)) return 0
  return ((seconds % barDuration) + barDuration) % barDuration
}

export function barDurationSeconds(bpm: number, meter: MetronomeMeter): number {
  const m = normalizeMetronomeMeter(meter)
  const quarter = secondsPerBeatSafe(bpm)
  return m.numerator * (4 / m.denominator) * quarter
}

export function pulseDurationSeconds(bpm: number, meter: MetronomeMeter): number {
  const m = normalizeMetronomeMeter(meter)
  const quarter = secondsPerBeatSafe(bpm)
  if (isCompoundMeter(m.numerator, m.denominator) && m.compoundPulse === 'dotted-quarter') {
    return quarter * 1.5
  }
  return quarter * (4 / m.denominator)
}

export function pulsesPerBar(meter: MetronomeMeter, bpm = 120): number {
  const bar = barDurationSeconds(bpm, meter)
  const pulse = pulseDurationSeconds(bpm, meter)
  if (!(pulse > 0)) return 4
  return Math.max(1, Math.round(bar / pulse))
}

export function subdivisionDurationSeconds(
  bpm: number,
  meter: MetronomeMeter
): number | null {
  const m = normalizeMetronomeMeter(meter)
  if (m.subdivision === 'none') return null
  const quarter = secondsPerBeatSafe(bpm)
  if (m.subdivision === 'eighths') return quarter / 2
  if (m.subdivision === 'sixteenths') return quarter / 4
  return pulseDurationSeconds(bpm, m) / 3
}

export function phaseFromDownbeat(timeSeconds: number, bpm: number, meter: MetronomeMeter): number {
  return wrapPhase(timeSeconds, barDurationSeconds(bpm, meter))
}

export function nudgePhaseSeconds(
  phaseSeconds: number,
  deltaMs: number,
  bpm: number,
  meter: MetronomeMeter
): number {
  const bar = barDurationSeconds(bpm, meter)
  return wrapPhase(phaseSeconds + deltaMs / 1000, bar)
}

export function phaseMs(phaseSeconds: number, bpm: number, meter: MetronomeMeter): number {
  const wrapped = wrapPhase(phaseSeconds, barDurationSeconds(bpm, meter))
  return Math.round(wrapped * 1000)
}

export function meterOf(track: { metronome?: Partial<MetronomeMeter> | null } | null | undefined): MetronomeMeter {
  return normalizeMetronomeMeter(track?.metronome)
}

export function serializeMetronomeMeter(meter?: Partial<MetronomeMeter> | null): MetronomeMeter {
  return normalizeMetronomeMeter(meter)
}

export function hydrateMetronomeMeter(raw: unknown): MetronomeMeter {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_METRONOME_METER }
  return normalizeMetronomeMeter(raw as Partial<MetronomeMeter>)
}

export function serializeTrackMetronome(track: {
  kind?: string
  metronome?: Partial<MetronomeMeter> | null
}): { metronome?: MetronomeMeter } {
  if (track.kind !== 'metronome') return {}
  return { metronome: serializeMetronomeMeter(track.metronome) }
}

export function hydrateTrackMetronome(raw: unknown, kind?: string): { metronome?: MetronomeMeter } {
  if (kind !== 'metronome') return {}
  const rec = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  return { metronome: hydrateMetronomeMeter(rec.metronome) }
}

export function beatsPerBarFromMeter(meter: MetronomeMeter): number {
  return pulsesPerBar(meter)
}

export function safeSessionBpm(bpm: number): number {
  return clampBpm(bpm)
}

export interface MeterClick {
  songTime: number
  beatIndex: number
  beatInBar: number
  accent: boolean
  sub: boolean
}

function firstGridIndex(start: number, phase: number, step: number): number {
  return Math.ceil((start - phase) / step - 1e-9)
}

export function metronomeClicksInRange(args: {
  bpm: number
  meter?: Partial<MetronomeMeter> | null
  start?: number
  end: number
}): MeterClick[] {
  const meter = normalizeMetronomeMeter(args.meter)
  const pulse = pulseDurationSeconds(args.bpm, meter)
  const bar = barDurationSeconds(args.bpm, meter)
  const phase = wrapPhase(meter.phaseSeconds, bar)
  const start = Math.max(0, args.start ?? 0)
  const end = args.end
  if (!(end > start) || !(pulse > 0) || !(bar > 0)) return []

  const subStep = subdivisionDurationSeconds(args.bpm, meter)
  const step = subStep && subStep > 1e-9 ? Math.min(subStep, pulse) : pulse
  const pulsesInBar = Math.max(1, Math.round(bar / pulse))
  const clicks: MeterClick[] = []
  const first = firstGridIndex(start, phase, step)
  for (let i = first; ; i++) {
    const songTime = phase + i * step
    if (songTime >= end - 1e-12) break
    if (songTime < start) continue
    const sinceDownbeat = wrapPhase(songTime - phase, bar)
    const nearPulse = Math.abs(sinceDownbeat / pulse - Math.round(sinceDownbeat / pulse)) < 1e-6
    const beatInBar = nearPulse
      ? ((Math.round(sinceDownbeat / pulse) % pulsesInBar) + pulsesInBar) % pulsesInBar
      : -1
    const isDownbeat = nearPulse && beatInBar === 0
    clicks.push({
      songTime,
      beatIndex: i,
      beatInBar: beatInBar < 0 ? 0 : beatInBar,
      accent: meter.accentDownbeat && isDownbeat,
      sub: !nearPulse
    })
  }
  return clicks
}
