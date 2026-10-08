export const MIN_CLIP_DURATION = 0.1

export type ClipTrimEdge = 'left' | 'right'

export interface ClipTrimState {
  sourceStart: number
  duration: number
  offsetSeconds: number
}

export function deltaTimeFromLanePx(
  deltaX: number,
  laneWidth: number,
  layoutMax: number
): number {
  if (laneWidth <= 0 || layoutMax <= 0) return 0
  return (deltaX / laneWidth) * layoutMax
}

export function applyClipTrim(
  edge: ClipTrimEdge,
  deltaTime: number,
  orig: ClipTrimState & { bufferDuration: number }
): ClipTrimState {
  const minDur = MIN_CLIP_DURATION
  const buf = Math.max(minDur, orig.bufferDuration)

  if (edge === 'left') {
    const maxStart = Math.max(0, buf - minDur)
    const sourceStart = Math.max(0, Math.min(maxStart, orig.sourceStart + deltaTime))
    const sourceDelta = sourceStart - orig.sourceStart
    const duration = Math.max(minDur, Math.min(buf - sourceStart, orig.duration - sourceDelta))
    return {
      sourceStart,
      duration,
      offsetSeconds: Math.max(0, orig.offsetSeconds + sourceDelta)
    }
  }

  const duration = Math.max(
    minDur,
    Math.min(buf - orig.sourceStart, orig.duration + deltaTime)
  )
  return {
    sourceStart: orig.sourceStart,
    duration,
    offsetSeconds: orig.offsetSeconds
  }
}

export function waveformCropStyle(
  sourceStart: number,
  duration: number,
  bufferDuration: number
): { widthPct: number; translatePct: number } {
  const buf = Math.max(1e-6, bufferDuration)
  const dur = Math.max(1e-6, duration)
  return {
    widthPct: (buf / dur) * 100,
    translatePct: -(sourceStart / buf) * 100
  }
}

export function applyTrimPreviewStyles(
  wrapper: { style: { left: string; width: string } },
  waveform: { style: { width: string; transform: string } } | null,
  next: ClipTrimState,
  bufferDuration: number,
  layoutMax: number
): void {
  const max = Math.max(1e-6, layoutMax)
  wrapper.style.left = `${(next.offsetSeconds / max) * 100}%`
  wrapper.style.width = `${(next.duration / max) * 100}%`
  if (!waveform) return
  const crop = waveformCropStyle(next.sourceStart, next.duration, bufferDuration)
  waveform.style.width = `${crop.widthPct}%`
  waveform.style.transform = `translateX(${crop.translatePct}%)`
}

export function trimStatesEqual(a: ClipTrimState, b: ClipTrimState, eps = 1e-6): boolean {
  return (
    Math.abs(a.sourceStart - b.sourceStart) < eps &&
    Math.abs(a.duration - b.duration) < eps &&
    Math.abs(a.offsetSeconds - b.offsetSeconds) < eps
  )
}
