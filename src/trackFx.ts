import {
  evalAutomation,
  hydrateAutomation,
  laneForParam,
  serializeAutomation,
  type AutomationLane
} from './automation'

export type FilterType = 'lowpass' | 'highpass'

export interface TrackFxState {
  eq: { bypass: boolean; low: number; mid: number; high: number }
  compressor: {
    bypass: boolean
    threshold: number
    ratio: number
    attack: number
    release: number
    makeup: number
  }
  filter: { bypass: boolean; cutoff: number; resonance: number; type: FilterType }
  delay: { bypass: boolean; time: number; feedback: number; mix: number }
  reverb: { bypass: boolean; mix: number; size: number }
}

export interface AutomatableParam {
  id: string
  label: string
  min: number
  max: number
  step: number
  unit?: string
}

export const DEFAULT_PAN = 0
export const FX_RACK_HEIGHT = 138
export const AUTO_LANE_HEIGHT = 56

export function defaultTrackFx(): TrackFxState {
  return {
    eq: { bypass: false, low: 0, mid: 0, high: 0 },
    compressor: { bypass: true, threshold: -18, ratio: 4, attack: 0.01, release: 0.12, makeup: 0 },
    filter: { bypass: true, cutoff: 18000, resonance: 0.7, type: 'lowpass' },
    delay: { bypass: true, time: 0.25, feedback: 0.25, mix: 0.2 },
    reverb: { bypass: true, mix: 0.18, size: 0.7 }
  }
}

function num(value: unknown, fallback: number, min: number, max: number): number {
  const n = Number(value)
  if (!Number.isFinite(n)) return fallback
  return Math.max(min, Math.min(max, n))
}

function bool(value: unknown, fallback: boolean): boolean {
  if (typeof value === 'boolean') return value
  return fallback
}

export function hydrateTrackFx(raw: unknown): TrackFxState {
  const base = defaultTrackFx()
  if (!raw || typeof raw !== 'object') return base
  const r = raw as Record<string, Record<string, unknown>>
  const eq = r.eq ?? {}
  const compressor = r.compressor ?? r.comp ?? {}
  const filter = r.filter ?? {}
  const delay = r.delay ?? {}
  const reverb = r.reverb ?? {}
  const type = filter.type === 'highpass' ? 'highpass' : 'lowpass'
  return {
    eq: {
      bypass: bool(eq.bypass, base.eq.bypass),
      low: num(eq.low, base.eq.low, -12, 12),
      mid: num(eq.mid, base.eq.mid, -12, 12),
      high: num(eq.high, base.eq.high, -12, 12)
    },
    compressor: {
      bypass: bool(compressor.bypass, base.compressor.bypass),
      threshold: num(compressor.threshold, base.compressor.threshold, -60, 0),
      ratio: num(compressor.ratio, base.compressor.ratio, 1, 20),
      attack: num(compressor.attack, base.compressor.attack, 0.001, 1),
      release: num(compressor.release, base.compressor.release, 0.01, 1),
      makeup: num(compressor.makeup, base.compressor.makeup, 0, 12)
    },
    filter: {
      bypass: bool(filter.bypass, base.filter.bypass),
      cutoff: num(filter.cutoff, base.filter.cutoff, 20, 20000),
      resonance: num(filter.resonance, base.filter.resonance, 0.1, 18),
      type
    },
    delay: {
      bypass: bool(delay.bypass, base.delay.bypass),
      time: num(delay.time, base.delay.time, 0.01, 1),
      feedback: num(delay.feedback, base.delay.feedback, 0, 0.95),
      mix: num(delay.mix, base.delay.mix, 0, 1)
    },
    reverb: {
      bypass: bool(reverb.bypass, base.reverb.bypass),
      mix: num(reverb.mix, base.reverb.mix, 0, 1),
      size: num(reverb.size, base.reverb.size, 0.05, 0.98)
    }
  }
}

export function serializeTrackFx(fx: TrackFxState): TrackFxState {
  return hydrateTrackFx(fx)
}

export const AUTOMATION_PARAMS: AutomatableParam[] = [
  { id: 'volume', label: 'Volumen', min: 0, max: 1, step: 0.01 },
  { id: 'pan', label: 'Pan', min: -1, max: 1, step: 0.01 },
  { id: 'eq.low', label: 'EQ Low', min: -12, max: 12, step: 0.1, unit: 'dB' },
  { id: 'eq.mid', label: 'EQ Mid', min: -12, max: 12, step: 0.1, unit: 'dB' },
  { id: 'eq.high', label: 'EQ High', min: -12, max: 12, step: 0.1, unit: 'dB' },
  { id: 'comp.threshold', label: 'Comp Thresh', min: -60, max: 0, step: 0.5, unit: 'dB' },
  { id: 'comp.ratio', label: 'Comp Ratio', min: 1, max: 20, step: 0.1 },
  { id: 'comp.attack', label: 'Comp Attack', min: 0.001, max: 1, step: 0.001, unit: 's' },
  { id: 'comp.release', label: 'Comp Release', min: 0.01, max: 1, step: 0.01, unit: 's' },
  { id: 'comp.makeup', label: 'Comp Makeup', min: 0, max: 12, step: 0.1, unit: 'dB' },
  { id: 'filter.cutoff', label: 'Filtro Cutoff', min: 20, max: 20000, step: 1, unit: 'Hz' },
  { id: 'filter.resonance', label: 'Filtro Res', min: 0.1, max: 18, step: 0.1 },
  { id: 'delay.time', label: 'Delay Time', min: 0.01, max: 1, step: 0.01, unit: 's' },
  { id: 'delay.feedback', label: 'Delay FB', min: 0, max: 0.95, step: 0.01 },
  { id: 'delay.mix', label: 'Delay Mix', min: 0, max: 1, step: 0.01 },
  { id: 'reverb.mix', label: 'Reverb Mix', min: 0, max: 1, step: 0.01 },
  { id: 'reverb.size', label: 'Reverb Size', min: 0.05, max: 0.98, step: 0.01 }
]

export function paramMeta(id: string): AutomatableParam {
  return AUTOMATION_PARAMS.find((p) => p.id === id) ?? AUTOMATION_PARAMS[0]
}

export function getTrackParam(
  track: { volume: number; pan?: number; fx?: TrackFxState },
  paramId: string
): number {
  const fx = track.fx ?? defaultTrackFx()
  const pan = typeof track.pan === 'number' ? track.pan : DEFAULT_PAN
  switch (paramId) {
    case 'volume': return track.volume
    case 'pan': return pan
    case 'eq.low': return fx.eq.low
    case 'eq.mid': return fx.eq.mid
    case 'eq.high': return fx.eq.high
    case 'comp.threshold': return fx.compressor.threshold
    case 'comp.ratio': return fx.compressor.ratio
    case 'comp.attack': return fx.compressor.attack
    case 'comp.release': return fx.compressor.release
    case 'comp.makeup': return fx.compressor.makeup
    case 'filter.cutoff': return fx.filter.cutoff
    case 'filter.resonance': return fx.filter.resonance
    case 'delay.time': return fx.delay.time
    case 'delay.feedback': return fx.delay.feedback
    case 'delay.mix': return fx.delay.mix
    case 'reverb.mix': return fx.reverb.mix
    case 'reverb.size': return fx.reverb.size
    default: return 0
  }
}

export function setTrackParam<T extends { volume: number; pan?: number; fx?: TrackFxState }>(
  track: T,
  paramId: string,
  value: number
): T {
  const fx = hydrateTrackFx(track.fx)
  const meta = paramMeta(paramId)
  const v = Math.max(meta.min, Math.min(meta.max, value))
  if (paramId === 'volume') return { ...track, volume: v }
  if (paramId === 'pan') return { ...track, pan: v }
  const nextFx: TrackFxState = {
    ...fx,
    eq: { ...fx.eq },
    compressor: { ...fx.compressor },
    filter: { ...fx.filter },
    delay: { ...fx.delay },
    reverb: { ...fx.reverb }
  }
  switch (paramId) {
    case 'eq.low': nextFx.eq.low = v; break
    case 'eq.mid': nextFx.eq.mid = v; break
    case 'eq.high': nextFx.eq.high = v; break
    case 'comp.threshold': nextFx.compressor.threshold = v; break
    case 'comp.ratio': nextFx.compressor.ratio = v; break
    case 'comp.attack': nextFx.compressor.attack = v; break
    case 'comp.release': nextFx.compressor.release = v; break
    case 'comp.makeup': nextFx.compressor.makeup = v; break
    case 'filter.cutoff': nextFx.filter.cutoff = v; break
    case 'filter.resonance': nextFx.filter.resonance = v; break
    case 'delay.time': nextFx.delay.time = v; break
    case 'delay.feedback': nextFx.delay.feedback = v; break
    case 'delay.mix': nextFx.delay.mix = v; break
    case 'reverb.mix': nextFx.reverb.mix = v; break
    case 'reverb.size': nextFx.reverb.size = v; break
    default: return track
  }
  return { ...track, fx: nextFx }
}

export function dbToGain(db: number): number {
  return Math.pow(10, db / 20)
}

export function resolvedParamValue(
  track: { volume: number; pan?: number; fx?: TrackFxState; automation?: AutomationLane[] },
  paramId: string,
  time: number
): number {
  const lane = laneForParam(track.automation, paramId)
  if (lane && lane.points.length > 0) {
    const ev = evalAutomation(lane.points, time)
    if (ev != null) {
      const meta = paramMeta(paramId)
      return Math.max(meta.min, Math.min(meta.max, ev))
    }
  }
  return getTrackParam(track, paramId)
}

export function hydrateTrackAudio(raw: unknown): {
  pan: number
  fx: TrackFxState
  automation: AutomationLane[]
} {
  const rec = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  return {
    pan: num(rec.pan, DEFAULT_PAN, -1, 1),
    fx: hydrateTrackFx(rec.fx),
    automation: hydrateAutomation(rec.automation)
  }
}

export function shiftOpenIndices(open: number[], deleted: number): number[] {
  return open.filter((i) => i !== deleted).map((i) => (i > deleted ? i - 1 : i))
}

export function effectiveEq(eq: TrackFxState['eq']): { low: number; mid: number; high: number } {
  if (eq.bypass) return { low: 0, mid: 0, high: 0 }
  return { low: eq.low, mid: eq.mid, high: eq.high }
}

export function effectiveCompressor(comp: TrackFxState['compressor']): TrackFxState['compressor'] {
  if (comp.bypass) {
    return { ...comp, threshold: 0, ratio: 1, makeup: 0 }
  }
  return comp
}

export function effectiveFilter(filter: TrackFxState['filter']): TrackFxState['filter'] {
  if (filter.bypass) {
    return {
      ...filter,
      cutoff: filter.type === 'highpass' ? 20 : 20000,
      resonance: 0.1
    }
  }
  return filter
}

export function effectiveDelayMix(delay: TrackFxState['delay']): number {
  return delay.bypass ? 0 : delay.mix
}

export function effectiveReverbMix(reverb: TrackFxState['reverb']): number {
  return reverb.bypass ? 0 : reverb.mix
}

export function serializeTrackAudio(track: {
  pan?: number
  fx?: TrackFxState
  automation?: AutomationLane[]
}): { pan: number; fx: TrackFxState; automation: AutomationLane[] } {
  return {
    pan: typeof track.pan === 'number' ? Math.max(-1, Math.min(1, track.pan)) : DEFAULT_PAN,
    fx: serializeTrackFx(track.fx ?? defaultTrackFx()),
    automation: serializeAutomation(track.automation)
  }
}
