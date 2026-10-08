export const CLICK_DRAG_THRESHOLD_PX = 4

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
