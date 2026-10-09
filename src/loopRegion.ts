export const LOOP_MIN_DURATION = 0.05
export const LOOP_HANDLE_PX = 10
export const RULER_HEIGHT_PX = 44

export type LoopHit = 'start' | 'end' | 'body' | 'empty'

export function displayLoop(
  start: number | null,
  end: number | null,
  tempStart: number | null,
  tempEnd: number | null
): { start: number; end: number } | null {
  const a = tempStart ?? start
  const b = tempEnd ?? end
  if (a == null || b == null) return null
  return normalizeLoop(a, b, Number.POSITIVE_INFINITY)
}

export function normalizeLoop(start: number, end: number, layoutMax: number): { start: number; end: number } {
  const max = layoutMax > 0 ? layoutMax : 0
  let a = Math.min(start, end)
  let b = Math.max(start, end)
  a = Math.max(0, Math.min(a, max))
  b = Math.max(0, Math.min(b, max))
  if (b - a < LOOP_MIN_DURATION) {
    b = Math.min(max, a + LOOP_MIN_DURATION)
    if (b - a < LOOP_MIN_DURATION) {
      a = Math.max(0, b - LOOP_MIN_DURATION)
    }
  }
  return { start: a, end: b }
}

export function applyLoopSnap(
  time: number,
  layoutMax: number,
  snapEnabled: boolean,
  snapToGrid: (t: number) => number
): number {
  const max = layoutMax > 0 ? layoutMax : time
  let t = Math.max(0, Math.min(time, max))
  if (snapEnabled) t = snapToGrid(t)
  return Math.max(0, Math.min(t, max))
}

export function loopFromDrag(origin: number, current: number, layoutMax: number): { start: number; end: number } {
  return normalizeLoop(origin, current, layoutMax)
}

export function resizeLoop(
  edge: 'start' | 'end',
  time: number,
  start: number,
  end: number,
  layoutMax: number
): { start: number; end: number } {
  if (edge === 'start') return normalizeLoop(time, end, layoutMax)
  return normalizeLoop(start, time, layoutMax)
}

export function moveLoop(
  start0: number,
  end0: number,
  delta: number,
  layoutMax: number
): { start: number; end: number } {
  const span = Math.max(LOOP_MIN_DURATION, end0 - start0)
  const max = layoutMax > 0 ? layoutMax : span
  let start = start0 + delta
  if (start < 0) start = 0
  if (start + span > max) start = Math.max(0, max - span)
  return { start, end: start + span }
}

export function loopFromClip(offset: number, duration: number, layoutMax: number): { start: number; end: number } {
  return normalizeLoop(offset, offset + Math.max(duration, LOOP_MIN_DURATION), layoutMax)
}

export function hitTestLoop(
  clientX: number,
  rectLeft: number,
  rectWidth: number,
  layoutMax: number,
  start: number | null,
  end: number | null,
  handlePx = LOOP_HANDLE_PX
): LoopHit {
  if (rectWidth <= 0 || layoutMax <= 0 || start == null || end == null) return 'empty'
  const { start: a, end: b } = normalizeLoop(start, end, layoutMax)
  const x = clientX - rectLeft
  const xStart = (a / layoutMax) * rectWidth
  const xEnd = (b / layoutMax) * rectWidth
  const distStart = Math.abs(x - xStart)
  const distEnd = Math.abs(x - xEnd)
  if (distStart <= handlePx && distStart <= distEnd) return 'start'
  if (distEnd <= handlePx) return 'end'
  if (x > xStart && x < xEnd) return 'body'
  return 'empty'
}

export function rulerCursor(hit: LoopHit): string {
  if (hit === 'start' || hit === 'end') return 'ew-resize'
  if (hit === 'body') return 'grab'
  return 'crosshair'
}
