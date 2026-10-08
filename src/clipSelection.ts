export function clientRectsIntersect(
  a: { left: number; top: number; right: number; bottom: number },
  b: { left: number; top: number; right: number; bottom: number }
): boolean {
  return a.left <= b.right && a.right >= b.left && a.top <= b.bottom && a.bottom >= b.top
}

export function marqueeClientRect(
  x0: number,
  y0: number,
  x1: number,
  y1: number
): { left: number; top: number; right: number; bottom: number } {
  return {
    left: Math.min(x0, x1),
    top: Math.min(y0, y1),
    right: Math.max(x0, x1),
    bottom: Math.max(y0, y1)
  }
}

export function clampGroupTimeDelta(minOffset: number, timeDelta: number): number {
  return Math.max(timeDelta, -Math.max(0, minOffset))
}

export function clampGroupTrackDelta(
  minTrack: number,
  maxTrack: number,
  trackDelta: number,
  trackCount: number
): number {
  if (trackCount <= 0) return 0
  const lo = -minTrack
  const hi = trackCount - 1 - maxTrack
  return Math.max(lo, Math.min(hi, trackDelta))
}

export function packClipboard<T extends { offsetSeconds: number; trackIndex: number }>(
  items: T[]
): Array<T & { relTime: number; relTrack: number }> {
  if (items.length === 0) return []
  const originTime = Math.min(...items.map(i => i.offsetSeconds))
  const originTrack = Math.min(...items.map(i => i.trackIndex))
  return items.map(i => ({
    ...i,
    relTime: i.offsetSeconds - originTime,
    relTrack: i.trackIndex - originTrack
  }))
}

export function pastePlacement(
  relTime: number,
  relTrack: number,
  originTime: number,
  originTrack: number,
  trackCount: number
): { offsetSeconds: number; trackIndex: number } {
  return {
    offsetSeconds: Math.max(0, originTime + relTime),
    trackIndex: Math.max(0, Math.min(trackCount - 1, originTrack + relTrack))
  }
}

export function resolveTrackName(name: string | undefined | null, index: number): string {
  const trimmed = typeof name === 'string' ? name.trim() : ''
  return trimmed || `Track ${index + 1}`
}

export function commitEditedTrackName(draft: string, previous: string): string {
  const trimmed = draft.trim()
  return trimmed.length > 0 ? trimmed : previous
}

export function deleteTrackFromList<T extends { clips: { id: string }[] }>(
  tracks: T[],
  index: number,
  selectedIds: Set<string>
): { tracks: T[]; selectedIds: Set<string> } | null {
  if (tracks.length <= 1 || index < 0 || index >= tracks.length) return null
  const removedIds = new Set(tracks[index].clips.map(c => c.id))
  const nextSelected = new Set(selectedIds)
  removedIds.forEach(id => nextSelected.delete(id))
  return {
    tracks: tracks.filter((_, i) => i !== index),
    selectedIds: nextSelected
  }
}

export function mergeSelection(
  current: Set<string>,
  incoming: string[],
  mode: 'replace' | 'add' | 'toggle'
): Set<string> {
  if (mode === 'replace') return new Set(incoming)
  const next = new Set(current)
  if (mode === 'add') {
    incoming.forEach(id => next.add(id))
    return next
  }
  incoming.forEach(id => {
    if (next.has(id)) next.delete(id)
    else next.add(id)
  })
  return next
}
