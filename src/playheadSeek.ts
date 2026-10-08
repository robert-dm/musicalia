export const CLICK_DRAG_THRESHOLD_PX = 4
export const SNAP_STORAGE_KEY = 'musicalia-snap-enabled'

export function readStoredSnapEnabled(): boolean {
  try {
    if (typeof localStorage === 'undefined') return false
    const value = localStorage.getItem(SNAP_STORAGE_KEY)
    if (value === '1' || value === 'true') return true
    if (value === '0' || value === 'false') return false
  } catch {
    // private mode / unavailable storage
  }
  return false
}

export function persistSnapEnabled(enabled: boolean): void {
  try {
    if (typeof localStorage === 'undefined') return
    localStorage.setItem(SNAP_STORAGE_KEY, enabled ? '1' : '0')
  } catch {
    // ignore quota / private mode
  }
}

/** Shift inverts the current Snap setting while dragging. */
export function snapActiveDuringDrag(snapEnabled: boolean, shiftKey: boolean): boolean {
  return Boolean(snapEnabled) !== Boolean(shiftKey)
}

export function isClickGesture(distancePx: number): boolean {
  return distancePx < CLICK_DRAG_THRESHOLD_PX
}

export function clickTimeFromX(
  clientX: number,
  rectLeft: number,
  rectWidth: number,
  layoutMax: number
): number {
  if (rectWidth <= 0 || layoutMax <= 0) return 0
  const percentage = Math.max(0, Math.min(1, (clientX - rectLeft) / rectWidth))
  return percentage * layoutMax
}

export function applySeekSnap(
  time: number,
  layoutMax: number,
  snapEnabled: boolean,
  shiftKey: boolean,
  snapToGrid: (t: number) => number
): number {
  const max = layoutMax > 0 ? layoutMax : time
  let t = Math.max(0, Math.min(time, max))
  if (snapEnabled && !shiftKey) t = snapToGrid(t)
  return Math.max(0, t)
}
