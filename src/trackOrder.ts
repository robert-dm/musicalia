export const TRACK_REORDER_THRESHOLD_PX = 4
export const FILE_DROP_GAP_PX = 12

export function moveItem<T>(items: T[], from: number, to: number): T[] {
  if (items.length === 0) return items.slice()
  if (from < 0 || from >= items.length) return items.slice()
  const dest = Math.max(0, Math.min(items.length - 1, to))
  if (from === dest) return items.slice()
  const next = items.slice()
  const [item] = next.splice(from, 1)
  next.splice(dest, 0, item)
  return next
}

export function destIndexFromInsertBefore(from: number, insertBefore: number): number {
  if (insertBefore > from) return insertBefore - 1
  return insertBefore
}

export function sameReorderSlot(from: number, insertBefore: number): boolean {
  return insertBefore === from || insertBefore === from + 1
}

export function remapIndexAfterMove(index: number, from: number, to: number): number {
  if (index === from) return to
  if (from < to && index > from && index <= to) return index - 1
  if (from > to && index >= to && index < from) return index + 1
  return index
}

export function remapNullableIndexAfterMove(
  index: number | null | undefined,
  from: number,
  to: number
): number | null {
  if (index == null) return null
  return remapIndexAfterMove(index, from, to)
}

export function remapIndexAfterInsert(index: number, insertAt: number): number {
  return index >= insertAt ? index + 1 : index
}

export function remapNullableIndexAfterInsert(
  index: number | null | undefined,
  insertAt: number
): number | null {
  if (index == null) return null
  return remapIndexAfterInsert(index, insertAt)
}

export function remapOpenIndicesAfterMove(open: number[], from: number, to: number): number[] {
  return open.map((i) => remapIndexAfterMove(i, from, to))
}

export function remapOpenIndicesAfterInsert(open: number[], insertAt: number): number[] {
  return open.map((i) => remapIndexAfterInsert(i, insertAt))
}

export function remapKeyedRecordAfterMove<V>(
  record: Record<number, V>,
  from: number,
  to: number
): Record<number, V> {
  const next: Record<number, V> = {}
  for (const [key, value] of Object.entries(record)) {
    next[remapIndexAfterMove(Number(key), from, to)] = value
  }
  return next
}

export function remapKeyedRecordAfterInsert<V>(
  record: Record<number, V>,
  insertAt: number
): Record<number, V> {
  const next: Record<number, V> = {}
  for (const [key, value] of Object.entries(record)) {
    next[remapIndexAfterInsert(Number(key), insertAt)] = value
  }
  return next
}

export function remapHarmonySourceAfterMove(
  source: 'mix' | number,
  from: number,
  to: number
): 'mix' | number {
  return source === 'mix' ? source : remapIndexAfterMove(source, from, to)
}

export function remapHarmonySourceAfterInsert(
  source: 'mix' | number,
  insertAt: number
): 'mix' | number {
  return source === 'mix' ? source : remapIndexAfterInsert(source, insertAt)
}

/** insertBefore is 0..n in the current list (n = after last). */
export function liveShiftOffsets(
  from: number,
  insertBefore: number,
  heights: number[]
): number[] {
  const n = heights.length
  const offsets = Array.from({ length: n }, () => 0)
  if (n === 0 || from < 0 || from >= n) return offsets
  if (sameReorderSlot(from, insertBefore)) return offsets
  const h = heights[from] ?? 0
  if (insertBefore > from + 1) {
    for (let i = from + 1; i < insertBefore && i < n; i++) offsets[i] = -h
  } else if (insertBefore < from) {
    for (let i = insertBefore; i < from; i++) offsets[i] = h
  }
  return offsets
}

export function insertIndexFromY(clientY: number, tops: number[], bottoms: number[]): number {
  const n = tops.length
  if (n === 0) return 0
  if (clientY < tops[0]) return 0
  for (let i = 0; i < n; i++) {
    const mid = (tops[i] + bottoms[i]) / 2
    if (clientY < mid) return i
  }
  return n
}

export function fileDropInsertIndex(
  clientY: number,
  tops: number[],
  bottoms: number[],
  gapPx = FILE_DROP_GAP_PX
): number | null {
  const n = tops.length
  if (n === 0) return 0
  if (Math.abs(clientY - tops[0]) <= gapPx) return 0
  for (let i = 1; i < n; i++) {
    const boundary = (bottoms[i - 1] + tops[i]) / 2
    if (Math.abs(clientY - boundary) <= gapPx) return i
  }
  if (Math.abs(clientY - bottoms[n - 1]) <= gapPx) return n
  return null
}

export function insertionLineY(
  insertBefore: number,
  tops: number[],
  bottoms: number[],
  offsets: number[]
): number {
  const n = tops.length
  if (n === 0) return 0
  if (insertBefore <= 0) return tops[0]
  if (insertBefore >= n) return bottoms[n - 1] + (offsets[n - 1] ?? 0)
  return tops[insertBefore] + (offsets[insertBefore] ?? 0)
}
