import { clampGroupTimeDelta } from './clipSelection'

export const MAGNET_THRESHOLD_PX = 8

export type MagnetClip = {
  id: string
  offsetSeconds: number
  duration: number
}

export function magnetThresholdSeconds(pxPerSec: number): number {
  if (!(pxPerSec > 0) || !Number.isFinite(pxPerSec)) return 0
  return MAGNET_THRESHOLD_PX / pxPerSec
}

export function collectMagnetTargets(
  clips: MagnetClip[],
  excludeIds: Iterable<string> = []
): number[] {
  const skip = new Set(excludeIds)
  const targets = new Set<number>([0])
  for (const clip of clips) {
    if (skip.has(clip.id)) continue
    const start = clip.offsetSeconds
    const end = clip.offsetSeconds + clip.duration
    if (Number.isFinite(start)) targets.add(start)
    if (Number.isFinite(end)) targets.add(end)
  }
  return Array.from(targets)
}

export function collectMovingEdges(
  clips: MagnetClip[],
  includeIds: Iterable<string>
): { starts: number[]; ends: number[] } {
  const include = new Set(includeIds)
  const starts: number[] = []
  const ends: number[] = []
  for (const clip of clips) {
    if (!include.has(clip.id)) continue
    if (Number.isFinite(clip.offsetSeconds)) starts.push(clip.offsetSeconds)
    const end = clip.offsetSeconds + clip.duration
    if (Number.isFinite(end)) ends.push(end)
  }
  return { starts, ends }
}

export function magnetTimeDelta(input: {
  movingStarts: number[]
  movingEnds: number[]
  targets: number[]
  rawDelta: number
  pxPerSec: number
  magnetEnabled: boolean
  altHeld: boolean
}): { delta: number; snapTime: number | null } {
  const rawDelta = Number.isFinite(input.rawDelta) ? input.rawDelta : 0
  if (!input.magnetEnabled || input.altHeld) {
    return { delta: rawDelta, snapTime: null }
  }
  const window = magnetThresholdSeconds(input.pxPerSec)
  if (!(window > 0)) return { delta: rawDelta, snapTime: null }

  const edges = [...input.movingStarts, ...input.movingEnds].filter(Number.isFinite)
  const targets = input.targets.filter(Number.isFinite)
  let bestDist = window
  let bestDelta = rawDelta
  let snapTime: number | null = null

  for (const edge of edges) {
    const proposed = edge + rawDelta
    for (const target of targets) {
      const dist = Math.abs(proposed - target)
      if (dist > window + 1e-12) continue
      const closer = snapTime == null || dist < bestDist - 1e-12
      const tiedEarlier = snapTime != null && Math.abs(dist - bestDist) <= 1e-12 && target < snapTime
      if (closer || tiedEarlier) {
        bestDist = dist
        bestDelta = target - edge
        snapTime = target
      }
    }
  }

  return { delta: bestDelta, snapTime }
}

export function resolveMagnetDrag(input: {
  movingStarts: number[]
  movingEnds: number[]
  targets: number[]
  rawDelta: number
  pxPerSec: number
  magnetEnabled: boolean
  altHeld: boolean
  minOffset: number
}): { delta: number; snapTime: number | null } {
  const magnet = magnetTimeDelta(input)
  const delta = clampGroupTimeDelta(input.minOffset, magnet.delta)
  if (magnet.snapTime == null) return { delta, snapTime: null }
  const edges = [...input.movingStarts, ...input.movingEnds].filter(Number.isFinite)
  const stillHits = edges.some((edge) => Math.abs(edge + delta - magnet.snapTime!) <= 1e-9)
  return { delta, snapTime: stillHits ? magnet.snapTime : null }
}

export function alignClipStarts(offsets: number[]): number[] {
  const finite = offsets.filter(Number.isFinite)
  if (finite.length === 0) return offsets.slice()
  const earliest = Math.min(...finite)
  return offsets.map((offset) => (Number.isFinite(offset) ? earliest : offset))
}

export function earliestStart(offsets: number[]): number | null {
  const finite = offsets.filter(Number.isFinite)
  if (finite.length === 0) return null
  return Math.min(...finite)
}
