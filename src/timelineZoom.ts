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

export function tickIntervalSeconds(pxPerSec: number, minPx = 52, bpm = 120): number {
  if (pxPerSec <= 0) return 1
  const beat = 60 / Math.max(1, bpm)
  const candidates = [
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

export interface TimelineTick {
  t: number
  kind: 'bar' | 'beat' | 'sub'
  label?: string
}

export function timelineTicks(input: {
  layoutMax: number
  pxPerSec: number
  viewStart: number
  viewEnd: number
  bpm: number
}): TimelineTick[] {
  const layoutMax = Math.max(0, input.layoutMax)
  if (layoutMax <= 0 || input.pxPerSec <= 0) return []
  const start = Math.max(0, input.viewStart)
  const end = Math.min(layoutMax, input.viewEnd)
  if (end <= start) return []
  const beat = 60 / Math.max(1, input.bpm)
  const bar = beat * 4
  const step = tickIntervalSeconds(input.pxPerSec, 52, input.bpm)
  const first = Math.floor(start / step) * step
  const ticks: TimelineTick[] = []
  const maxTicks = 240
  for (let t = first, i = 0; t <= end + 1e-9 && i < maxTicks; t += step, i++) {
    const clamped = Math.max(0, Math.min(layoutMax, t))
    if (clamped < start - 1e-9) continue
    const nearBar = Math.abs(clamped / bar - Math.round(clamped / bar)) < 1e-6
    const nearBeat = Math.abs(clamped / beat - Math.round(clamped / beat)) < 1e-6
    const kind: TimelineTick['kind'] = nearBar ? 'bar' : nearBeat ? 'beat' : 'sub'
    const barNumber = nearBar ? String(Math.round(clamped / bar) + 1) : undefined
    ticks.push({ t: clamped, kind, label: barNumber })
  }
  return ticks
}
