import { clampBpm, roundBpm } from './tempoMath'
import type { BeatMarker, TempoMap } from './beatTracker'

const sanitizeCache = new WeakMap<TempoMap, TempoMap>()
const qualityCache = new WeakMap<TempoMap, { ok: boolean; cv: number; reason?: string }>()

export const MIN_BEAT_INTERVAL = 60 / 300
export const MAX_BEAT_INTERVAL = 60 / 30
export const BPM_TOLERANCE = 0.3
export const QUALITY_CV_MAX = 0.35
export const ORIGIN_SNAP_SECONDS = 0.02

export function medianNumber(values: number[]): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid]
}

export function beatIndexAtOrAfter(beats: Array<{ time: number }> | number[], time: number): number {
  let lo = 0
  let hi = beats.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    const t = typeof beats[mid] === 'number' ? (beats[mid] as number) : (beats[mid] as { time: number }).time
    if (t < time) lo = mid + 1
    else hi = mid
  }
  return lo
}

export function uniqueSortedTimes(times: number[]): number[] {
  const out: number[] = []
  for (const raw of times) {
    if (!Number.isFinite(raw) || raw < 0) continue
    const t = raw < 1e-9 ? 0 : raw
    if (out.length === 0 || Math.abs(out[out.length - 1] - t) > 1e-6) out.push(t)
  }
  return out.sort((a, b) => a - b)
}

/** Median of the first 8 intervals, folded toward the global BPM and clamped. */
export function openingMedianPeriod(times: number[], bpm: number): number {
  const fromBpm = 60 / clampBpm(bpm)
  const intervals: number[] = []
  const n = Math.min(Math.max(0, times.length - 1), 8)
  for (let i = 0; i < n; i++) {
    const dt = times[i + 1] - times[i]
    if (dt > 1e-4) intervals.push(dt)
  }
  let period = fromBpm
  if (intervals.length > 0) {
    const med = medianNumber(intervals)
    const ratio = med / fromBpm
    if (ratio > 1.7 && ratio < 2.4) period = med / 2
    else if (ratio > 0.4 && ratio < 0.6) period = med * 2
    else period = med
  }
  const lo = Math.max(MIN_BEAT_INTERVAL, fromBpm * (1 - BPM_TOLERANCE))
  const hi = Math.min(MAX_BEAT_INTERVAL, fromBpm * (1 + BPM_TOLERANCE))
  return Math.min(hi, Math.max(lo, period))
}

export function prependTimesToOrigin(times: number[], period: number): number[] {
  if (!(period >= MIN_BEAT_INTERVAL) || times.length === 0) return times
  const first = times[0]
  const snap = Math.min(ORIGIN_SNAP_SECONDS, period * 0.15)
  if (first <= 1e-6) return times
  if (first <= snap) return [0, ...times.slice(1)]
  const extra: number[] = []
  let t = first - period
  const guard = Math.min(4000, Math.ceil(first / period) + 2)
  for (let i = 0; i < guard && t > snap; i++) {
    extra.push(t)
    t -= period
  }
  extra.push(0)
  extra.reverse()
  return uniqueSortedTimes([...extra, ...times])
}

/**
 * Sort, dedupe, drop sub-min intervals, interpolate long gaps, then
 * walk back to t=0 with the median opening period.
 */
export function sanitizeBeatTimes(times: number[], bpm: number, pinnedTimes: number[] = []): number[] {
  const unique = uniqueSortedTimes(times)
  if (unique.length === 0) return []
  const period = openingMedianPeriod(unique, bpm)
  const minI = Math.max(MIN_BEAT_INTERVAL, period * (1 - BPM_TOLERANCE))
  const maxI = Math.min(MAX_BEAT_INTERVAL, period * (1 + BPM_TOLERANCE))
  const pinned = uniqueSortedTimes(pinnedTimes)
  const isPinned = (t: number) => pinned.some((p) => Math.abs(p - t) < 1e-4)
  const kept: number[] = []
  for (const t of unique) {
    if (kept.length === 0 || t - kept[kept.length - 1] >= minI - 1e-9) kept.push(t)
    else if (isPinned(t) && t - kept[kept.length - 1] >= MIN_BEAT_INTERVAL - 1e-9) kept.push(t)
  }
  const filled: number[] = []
  for (let i = 0; i < kept.length; i++) {
    if (filled.length > 0) {
      const prev = filled[filled.length - 1]
      const gap = kept[i] - prev
      if (gap > maxI) {
        const n = Math.max(1, Math.round(gap / period))
        const step = gap / n
        if (step >= minI && step <= maxI) {
          for (let k = 1; k < n; k++) filled.push(prev + k * step)
        } else {
          let t = prev + period
          while (t < kept[i] - minI * 0.5) {
            filled.push(t)
            t += period
          }
        }
      }
    }
    filled.push(kept[i])
  }
  const withOrigin = prependTimesToOrigin(filled, period)
  const spaced: number[] = []
  for (const t of withOrigin) {
    if (spaced.length === 0 || t - spaced[spaced.length - 1] >= minI - 1e-9) spaced.push(t)
    else if (isPinned(t) && t - spaced[spaced.length - 1] >= MIN_BEAT_INTERVAL - 1e-9) spaced.push(t)
  }
  return spaced
}

function rememberQuality(
  map: TempoMap,
  result: { ok: boolean; cv: number; reason?: string }
): { ok: boolean; cv: number; reason?: string } {
  qualityCache.set(map, result)
  return result
}

export function tempoMapQuality(map: TempoMap): { ok: boolean; cv: number; reason?: string } {
  const cached = qualityCache.get(map)
  if (cached) return cached
  const times = uniqueSortedTimes(map.beats.map((b) => b.time))
  if (times.length < 2) return rememberQuality(map, { ok: false, cv: 1, reason: 'short' })
  const period = 60 / clampBpm(map.globalBpm)
  const intervals: number[] = []
  for (let i = 1; i < times.length; i++) intervals.push(times[i] - times[i - 1])
  const tooShort = intervals.filter((dt) => dt < MIN_BEAT_INTERVAL - 1e-6).length
  if (tooShort > 0) return rememberQuality(map, { ok: false, cv: 1, reason: 'short-interval' })
  const mean = intervals.reduce((s, v) => s + v, 0) / intervals.length
  let varSum = 0
  for (const dt of intervals) varSum += (dt - mean) * (dt - mean)
  const std = Math.sqrt(varSum / intervals.length)
  const cv = std / Math.max(period, 1e-6)
  if (cv > QUALITY_CV_MAX) return rememberQuality(map, { ok: false, cv, reason: 'variance' })
  const span = times[times.length - 1] - times[0]
  if (span > 8) {
    const expected = span / period
    if (times.length < expected * 0.45 || times.length > expected * 1.7) {
      return rememberQuality(map, { ok: false, cv, reason: 'count' })
    }
  }
  const density = times.length / Math.max(span, 1e-6)
  return rememberQuality(
    map,
    density > 1 / MIN_BEAT_INTERVAL + 0.25 ? { ok: false, cv, reason: 'dense' } : { ok: true, cv }
  )
}

export function isTempoMapUsable(map: TempoMap | null | undefined): boolean {
  return !!map && Array.isArray(map.beats) && map.beats.length >= 2 && tempoMapQuality(map).ok
}

function rememberSanitized(source: TempoMap, result: TempoMap): TempoMap {
  sanitizeCache.set(source, result)
  sanitizeCache.set(result, result)
  return result
}

export function sanitizeTempoMap(map: TempoMap): TempoMap {
  const hit = sanitizeCache.get(map)
  if (hit) return hit
  const times = sanitizeBeatTimes(
    map.beats.map((b) => b.time),
    map.globalBpm,
    map.beats.filter((b) => b.pinned).map((b) => b.time)
  )
  if (times.length < 2) {
    const period = 60 / clampBpm(map.globalBpm)
    const duration = Math.max(map.sourceDuration, period * 2)
    const fallback = prependTimesToOrigin([duration], period)
    return rememberSanitized(map, {
      ...map,
      beats: fallback.map((time, index) => ({
        id: `grid-${index}-${Math.round(time * 10000)}`,
        time,
        pinned: false
      })),
      downbeatIndex: 0,
      globalBpm: clampBpm(map.globalBpm)
    })
  }
  const byTime = new Map<number, BeatMarker>()
  for (const beat of map.beats) byTime.set(Math.round(beat.time * 10000), beat)
  const beats: BeatMarker[] = times.map((time, index) => {
    const existing = byTime.get(Math.round(time * 10000))
    if (existing) return { ...existing, time }
    return { id: `grid-${index}-${Math.round(time * 10000)}`, time, pinned: false }
  })
  let downbeatIndex = 0
  if (map.downbeatIndex > 0) {
    const target = map.beats[Math.min(map.beats.length - 1, map.downbeatIndex)]
    if (target) {
      const i = beatIndexAtOrAfter(beats, target.time)
      const prev = Math.max(0, i - 1)
      const next = Math.min(beats.length - 1, i)
      downbeatIndex = Math.abs(beats[prev].time - target.time) <= Math.abs(beats[next].time - target.time)
        ? prev
        : next
    }
  }
  return rememberSanitized(map, {
    ...map,
    beats,
    downbeatIndex,
    globalBpm: clampBpm(map.globalBpm)
  })
}

export function smoothedLocalBpm(map: TempoMap, time: number): number {
  const beats = map.beats
  if (beats.length < 2) return clampBpm(map.globalBpm)
  const i = Math.max(1, beatIndexAtOrAfter(beats, time))
  const intervals: number[] = []
  for (let k = Math.max(1, i - 2); k <= Math.min(beats.length - 1, i + 1); k++) {
    const dt = beats[k].time - beats[k - 1].time
    if (dt >= MIN_BEAT_INTERVAL) intervals.push(dt)
  }
  if (intervals.length === 0) return clampBpm(map.globalBpm)
  return clampBpm(roundBpm(60 / medianNumber(intervals)))
}
