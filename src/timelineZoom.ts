/** Old horizontal zoom range (0.0087b and earlier): 0.5–4, linear. */
export const HORIZONTAL_ZOOM_MIN_LEGACY = 0.5
export const HORIZONTAL_ZOOM_MAX_LEGACY = 4

/** Wider Ableton-like range. Inner width = viewport * zoom. */
export const HORIZONTAL_ZOOM_MIN = 0.05
export const HORIZONTAL_ZOOM_MAX = 512
export const HORIZONTAL_ZOOM_DEFAULT = 1

export const MAX_WAVEFORM_CANVAS_PX = 8192
export const ZOOM_SLIDER_MAX = 1000

export function clampHorizontalZoom(zoom: number): number {
  if (!Number.isFinite(zoom)) return HORIZONTAL_ZOOM_DEFAULT
  return Math.min(HORIZONTAL_ZOOM_MAX, Math.max(HORIZONTAL_ZOOM_MIN, zoom))
}

export function pxPerSecond(laneWidthPx: number, layoutMax: number): number {
  if (laneWidthPx <= 0 || layoutMax <= 0) return 0
  return laneWidthPx / layoutMax
}

export function timeDeltaFromPx(deltaX: number, pxPerSec: number): number {
  if (pxPerSec <= 0) return 0
  return deltaX / pxPerSec
}

export function pxFromTimeDelta(deltaTime: number, pxPerSec: number): number {
  return deltaTime * pxPerSec
}

export function zoomToSlider(zoom: number): number {
  const z = clampHorizontalZoom(zoom)
  const t = Math.log(z / HORIZONTAL_ZOOM_MIN) / Math.log(HORIZONTAL_ZOOM_MAX / HORIZONTAL_ZOOM_MIN)
  return Math.round(Math.max(0, Math.min(1, t)) * ZOOM_SLIDER_MAX)
}

export function sliderToZoom(slider: number): number {
  const t = Math.max(0, Math.min(1, slider / ZOOM_SLIDER_MAX))
  return HORIZONTAL_ZOOM_MIN * (HORIZONTAL_ZOOM_MAX / HORIZONTAL_ZOOM_MIN) ** t
}

export function wheelZoom(current: number, deltaY: number): number {
  const factor = Math.exp(-deltaY * 0.0025)
  return clampHorizontalZoom(current * factor)
}

export function anchoredScrollLeft(input: {
  scrollLeft: number
  mouseX: number
  oldZoom: number
  newZoom: number
  viewportWidth: number
}): number {
  const { scrollLeft, mouseX, oldZoom, newZoom, viewportWidth } = input
  if (viewportWidth <= 0 || oldZoom <= 0) return 0
  const contentX = scrollLeft + mouseX
  const ratio = contentX / (viewportWidth * oldZoom)
  return ratio * viewportWidth * newZoom - mouseX
}

export function viewTimeWindow(input: {
  scrollLeft: number
  viewportWidth: number
  zoom: number
  layoutMax: number
  padPx?: number
}): { start: number; end: number } {
  const { scrollLeft, viewportWidth, zoom, layoutMax } = input
  const padPx = input.padPx ?? 64
  const inner = Math.max(1e-6, viewportWidth * zoom)
  const pps = pxPerSecond(inner, layoutMax)
  if (pps <= 0) return { start: 0, end: layoutMax }
  const start = Math.max(0, (scrollLeft - padPx) / pps)
  const end = Math.min(layoutMax, (scrollLeft + viewportWidth + padPx) / pps)
  return { start, end }
}

export function waveformBitmapWidth(cssWidthPx: number, dpr = 2): number {
  const w = Math.max(1, Math.floor(cssWidthPx * Math.max(1, dpr)))
  return Math.min(MAX_WAVEFORM_CANVAS_PX, w)
}

const NICE_SECONDS = [
  32, 16, 8, 4, 2, 1,
  0.5, 0.25, 0.125, 0.0625, 0.03125,
  0.01, 0.005, 0.002, 0.001, 0.0005, 0.0002, 0.0001
]

export function tickIntervalSeconds(
  pxPerSec: number,
  minPx = 52,
  bpm = 120,
  beatsPerBar = 4
): number {
  if (pxPerSec <= 0) return 1
  const beat = 60 / Math.max(1, bpm)
  const bar = beat * Math.max(1, beatsPerBar)
  const candidates = [
    bar * 8, bar * 4, bar * 2, bar,
    beat * 16, beat * 8, beat * 4, beat * 2, beat,
    beat / 2, beat / 4, beat / 8, beat / 16, beat / 32,
    ...NICE_SECONDS
  ].sort((a, b) => a - b)
  const target = minPx / pxPerSec
  for (const step of candidates) {
    if (step >= target) return step
  }
  return candidates[candidates.length - 1]
}

export interface MapBeatTick {
  t: number
  downbeat?: boolean
  bar?: number
}

export interface TimelineTick {
  t: number
  kind: 'bar' | 'beat' | 'sub'
  label?: string
}

const ORIGIN_SNAP_SECONDS = 0.02

function mapBeatPeriodHint(
  beats: MapBeatTick[],
  bpm: number,
  pulseSeconds?: number
): number {
  const fromBpm = pulseSeconds && pulseSeconds > 0 ? pulseSeconds : 60 / Math.max(1, bpm)
  if (beats.length >= 2) {
    const dt = beats[1].t - beats[0].t
    if (dt > 1e-6) {
      const n = Math.max(1, Math.round(dt / fromBpm))
      const period = dt / n
      if (period > fromBpm * 0.45 && period < fromBpm * 1.8) return period
    }
  }
  return fromBpm
}

/**
 * Fill the grid back to t=0. The first bar line is always at the origin
 * and labeled 1 — no empty pre-roll before the first click.
 */
export function expandMapBeatsToOrigin(
  beats: MapBeatTick[],
  periodHint: number,
  pulsesPerBar = 4
): MapBeatTick[] {
  if (beats.length < 2) return beats
  const sorted = [...beats].sort((a, b) => a.t - b.t)
  const period = mapBeatPeriodHint(sorted, 60 / Math.max(1e-6, periodHint), periodHint)
  if (!(period > 1e-6)) return sorted
  const snap = Math.min(ORIGIN_SNAP_SECONDS, period * 0.15)
  const pulses = Math.max(1, pulsesPerBar)
  if (sorted[0].t <= 1e-6) {
    const shift = sorted[0].bar != null && sorted[0].bar !== 1 ? 1 - sorted[0].bar : 0
    let nextBar = 2
    return sorted.map((b, i) => {
      if (i === 0) return { t: 0, downbeat: true, bar: 1 }
      if (shift && b.bar != null) return { ...b, bar: b.bar + shift }
      if (b.downbeat && b.bar == null) return { ...b, bar: nextBar++ }
      return b
    })
  }
  const times: number[] = []
  if (sorted[0].t <= snap) {
    times.push(0, ...sorted.slice(1).map((b) => b.t))
  } else {
    let t = sorted[0].t - period
    const extra: number[] = []
    const guard = Math.ceil(sorted[0].t / period) + 3
    for (let i = 0; i < guard && t > snap; i++) {
      extra.push(t)
      t -= period
    }
    extra.push(0)
    extra.reverse()
    times.push(...extra, ...sorted.map((b) => b.t))
  }
  return times.map((t, i) => ({
    t,
    downbeat: i % pulses === 0,
    bar: i % pulses === 0 ? Math.floor(i / pulses) + 1 : undefined
  }))
}

export function timelineTicks(input: {
  layoutMax: number
  pxPerSec: number
  viewStart: number
  viewEnd: number
  bpm: number
  beatsPerBar?: number
  pulseSeconds?: number
  barSeconds?: number
  phaseSeconds?: number
  mapBeats?: MapBeatTick[]
}): TimelineTick[] {
  const layoutMax = Math.max(0, input.layoutMax)
  if (layoutMax <= 0 || input.pxPerSec <= 0) return []
  const start = Math.max(0, input.viewStart)
  const end = Math.min(layoutMax, input.viewEnd)
  if (end <= start) return []
  if (input.mapBeats && input.mapBeats.length >= 2) {
    const span = input.mapBeats[input.mapBeats.length - 1].t - input.mapBeats[0].t
    const density = input.mapBeats.length / Math.max(span, 1e-6)
    const tooDense = density > 5.5 || span > 1e-6 && (end - start) > 0 &&
      input.mapBeats.filter((b) => b.downbeat && b.t >= start && b.t <= end).length > 80
    if (!tooDense) {
    const pulses = Math.max(1, input.beatsPerBar ?? 4)
    const period = mapBeatPeriodHint(input.mapBeats, input.bpm, input.pulseSeconds)
    const mapped = expandMapBeatsToOrigin(input.mapBeats, period, pulses)
    const ticks: TimelineTick[] = []
    let fallbackBar = 0
    for (const beat of mapped) {
      if (beat.t < start - 1e-9 || beat.t > end + 1e-9) {
        if (beat.downbeat && beat.t < start && beat.bar == null) fallbackBar++
        continue
      }
      if (beat.downbeat) {
        const label = beat.bar != null ? String(beat.bar) : String(++fallbackBar)
        ticks.push({ t: beat.t, kind: 'bar', label })
      } else {
        ticks.push({ t: beat.t, kind: 'beat' })
      }
      if (ticks.length >= 240) break
    }
    return ticks
    }
  }
  const beat = input.pulseSeconds && input.pulseSeconds > 0
    ? input.pulseSeconds
    : 60 / Math.max(1, input.bpm)
  const bar = input.barSeconds && input.barSeconds > 0
    ? input.barSeconds
    : beat * Math.max(1, input.beatsPerBar ?? 4)
  const phase = Number.isFinite(input.phaseSeconds) ? (input.phaseSeconds as number) : 0
  const wrappedPhase = ((phase % bar) + bar) % bar
  const pulsesPerBar = Math.max(1, Math.round(bar / beat))
  const step = tickIntervalSeconds(input.pxPerSec, 52, input.bpm, pulsesPerBar)
  const ticks: TimelineTick[] = []
  const seen = new Set<string>()
  const pushTick = (t: number, kind: TimelineTick['kind'], label?: string) => {
    const clamped = Math.max(0, Math.min(layoutMax, t))
    if (clamped < start - 1e-9 || clamped > end + 1e-9) return
    const key = `${clamped.toFixed(6)}:${kind}`
    if (seen.has(key)) return
    seen.add(key)
    ticks.push({ t: clamped, kind, label })
  }

  const firstBar = Math.floor((start - wrappedPhase) / bar)
  for (let k = firstBar, i = 0; i < 80; k++, i++) {
    const t = wrappedPhase + k * bar
    if (t > end + 1e-9) break
    pushTick(t, 'bar', String(k + 1))
  }

  const relStart = start - wrappedPhase
  const firstRel = Math.floor(relStart / step) * step
  const maxTicks = 240
  for (let rel = firstRel, i = 0; rel + wrappedPhase <= end + 1e-9 && i < maxTicks; rel += step, i++) {
    const t = rel + wrappedPhase
    const since = ((t - wrappedPhase) % bar + bar) % bar
    const nearBar = Math.abs(since) < 1e-6 || Math.abs(since - bar) < 1e-6
    if (nearBar) continue
    const nearBeat = Math.abs(since / beat - Math.round(since / beat)) < 1e-6
    pushTick(t, nearBeat ? 'beat' : 'sub')
  }
  ticks.sort((a, b) => a.t - b.t)
  return ticks
}
