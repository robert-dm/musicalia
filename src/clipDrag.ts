import { pxFromTimeDelta, pxPerSecond, timeDeltaFromPx } from './timelineZoom'
import { clampGroupTimeDelta } from './clipSelection'
import { snapActiveDuringDrag } from './playheadSeek'

export { pxPerSecond, timeDeltaFromPx, pxFromTimeDelta }

let clipInteractLock = 0

export function beginClipInteract(): void {
  clipInteractLock += 1
  if (typeof document !== 'undefined') {
    document.documentElement.dataset.clipInteract = '1'
  }
}

export function endClipInteract(): void {
  clipInteractLock = Math.max(0, clipInteractLock - 1)
  if (clipInteractLock === 0 && typeof document !== 'undefined') {
    delete document.documentElement.dataset.clipInteract
  }
}

export function isClipInteractLocked(): boolean {
  return clipInteractLock > 0
}

export function measurePxPerSec(laneWidthPx: number, layoutMax: number): number {
  return pxPerSecond(laneWidthPx, layoutMax)
}

/** Visual follow: raw pointer pixels unless snap supplied a time delta. */
export function dragPreviewDx(
  clientX: number,
  startX: number,
  pxPerSec: number,
  snappedTimeDelta: number | null
): number {
  if (snappedTimeDelta != null) return pxFromTimeDelta(snappedTimeDelta, pxPerSec)
  return clientX - startX
}

export function proposedTimeDelta(input: {
  clientX: number
  startX: number
  pxPerSec: number
  startOffset: number
  snapEnabled: boolean
  shiftKey: boolean
  snapToGrid: (t: number) => number
}): number {
  const raw = timeDeltaFromPx(input.clientX - input.startX, input.pxPerSec)
  if (snapActiveDuringDrag(input.snapEnabled, input.shiftKey)) {
    return input.snapToGrid(input.startOffset + raw) - input.startOffset
  }
  return raw
}

export function commitTimeDelta(input: {
  clientX: number
  startX: number
  pxPerSec: number
  startOffset: number
  minOffset: number
  snapEnabled: boolean
  shiftKey: boolean
  snapToGrid: (t: number) => number
}): number {
  return clampGroupTimeDelta(input.minOffset, proposedTimeDelta(input))
}

export function snappedDragTimeDelta(input: {
  clientX: number
  startX: number
  pxPerSec: number
  startOffset: number
  minOffset: number
  snapEnabled: boolean
  shiftKey: boolean
  snapToGrid: (t: number) => number
}): number | null {
  if (!snapActiveDuringDrag(input.snapEnabled, input.shiftKey)) return null
  return commitTimeDelta(input)
}
