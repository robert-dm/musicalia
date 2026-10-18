import { computeOnsetEnvelope, convertToMono, type OnsetEnvelope } from './onsetEnvelope'
import { detectTempoFromEnvelope } from './bpmDetector'
import {
  normalizeMetronomeMeter,
  pulsesPerBar,
  type MeterClick,
  type MetronomeMeter
} from './metronomeMeter'
import { clampBpm } from './tempoMath'
import {
  isTempoMapUsable,
  openingMedianPeriod,
  prependTimesToOrigin,
  sanitizeBeatTimes,
  sanitizeTempoMap,
  smoothedLocalBpm
} from './tempoMapSanitize'

export type TempoFollowMode = 'fixed' | 'follow'

export interface BeatMarker {
  id: string
  time: number
  pinned: boolean
}

export interface TempoMap {
  beats: BeatMarker[]
  downbeatIndex: number
  globalBpm: number
  sourceDuration: number
}

const TIGHTNESS = 80
const MIN_BEATS = 2
export { ORIGIN_SNAP_SECONDS } from './tempoMapSanitize'

export interface RulerMapBeat {
  t: number
  downbeat?: boolean
  bar?: number
}

export function newBeatId(time: number, index: number): string {
  return `beat-${index}-${Math.round(time * 10000)}`
}

export function hasTempoMap(map: TempoMap | null | undefined): map is TempoMap {
  return !!map && Array.isArray(map.beats) && map.beats.length >= MIN_BEATS
}

export function isFollowEnabled(
  meter: { followMode?: TempoFollowMode } | null | undefined,
  map: TempoMap | null | undefined
): boolean {
  return meter?.followMode !== 'fixed' && hasTempoMap(map) && isTempoMapUsable(map)
}

/** Opening inter-beat interval, preferring the first gap when it matches the BPM. */
export function openingBeatPeriod(times: number[], bpm: number): number {
  return openingMedianPeriod(times, bpm)
}

/**
 * Walk the opening period backwards so the grid always includes t=0.
 * Detected times stay put; only missing origin beats are inserted.
 * A first beat within a few milliseconds of 0 is snapped to 0 so the
 * first click is exactly at the clip start — no empty pre-roll gap.
 */
export function prependBeatTimesToOrigin(times: number[], period: number): number[] {
  return prependTimesToOrigin(times, period)
}

/**
 * Guarantee a beat at t=0. Tracker-default maps (downbeatIndex 0) re-home
 * bar/beat 1 there. A user-moved 1 (downbeatIndex > 0) is preserved for
 * accents; clicks and ruler bars still fill back to the origin.
 */
export function alignTempoMapToOrigin(map: TempoMap): TempoMap {
  if (!hasTempoMap(map)) return map
  return sanitizeTempoMap(map)
}

/** Bar/beat ticks for the ruler when Seguir la canción is on. */
export function rulerMapBeats(
  map: TempoMap | null | undefined,
  meter: Partial<MetronomeMeter> | null | undefined,
  bpm?: number
): RulerMapBeat[] | undefined {
  if (!isFollowEnabled(meter, map) || !map) return undefined
  const aligned = sanitizeTempoMap(map)
  const pulses = pulsesPerBar(normalizeMetronomeMeter(meter), bpm)
  return aligned.beats.map((beat, index) => {
    const downbeat = index % pulses === 0
    return {
      t: beat.time,
      downbeat,
      bar: downbeat ? Math.floor(index / pulses) + 1 : undefined
    }
  })
}

export function buildTempoMap(times: number[], bpm: number, duration: number): TempoMap {
  const aligned = sanitizeBeatTimes(times, bpm)
  return {
    beats: aligned.map((time, index) => ({
      id: newBeatId(time, index),
      time,
      pinned: false
    })),
    downbeatIndex: 0,
    globalBpm: clampBpm(bpm),
    sourceDuration: Math.max(0, duration)
  }
}

/**
 * Ellis 2007 dynamic-programming beat tracker on an onset envelope.
 * Uses a global period prior from BPM, then snaps to nearby onset peaks.
 */
export function trackBeatsFromOnset(
  env: OnsetEnvelope,
  bpm: number,
  tightness = TIGHTNESS
): number[] {
  const period = env.envSr * (60 / Math.max(1, bpm))
  if (!(period > 1) || env.flux.length < 8) return []
  const peaks = onsetPeakFrames(env.flux)
  const frames = peaks.length >= 4
    ? ellsDynamicProgrammingOnPeaks(peaks, env.flux, period, tightness)
    : ellsDynamicProgramming(env.flux, period, tightness)
  const snapped = snapBeatsToOnsets(frames, env.flux, period)
  const filled = extendAndFillBeats(snapped, env.flux, period)
  return filled.map((i) => env.offsetSeconds + i / env.envSr)
}

export function trackBeatsFromMono(
  samples: Float32Array,
  sampleRate: number,
  bpmHint?: number
): TempoMap | null {
  const env = computeOnsetEnvelope(samples, sampleRate)
  if (!env) return null
  const detected = bpmHint && bpmHint > 0
    ? { bpm: bpmHint }
    : detectTempoFromEnvelope(env.flux, env.envSr)
  if (detected.bpm == null) return null
  const times = trackBeatsFromOnset(env, detected.bpm)
  if (times.length < MIN_BEATS) return null
  return buildTempoMap(times, detected.bpm, env.offsetSeconds + env.durationSeconds)
}

export async function trackBeatsFromBuffer(
  audioBuffer: AudioBuffer,
  bpmHint?: number
): Promise<TempoMap | null> {
  const mono = convertToMono(audioBuffer)
  return trackBeatsFromMono(mono, audioBuffer.sampleRate, bpmHint)
}

function onsetPeakFrames(onset: Float32Array): number[] {
  let max = 0
  for (let i = 0; i < onset.length; i++) {
    if (onset[i] > max) max = onset[i]
  }
  const thresh = max * 0.2
  const peaks: number[] = []
  for (let i = 1; i < onset.length - 1; i++) {
    if (onset[i] < thresh) continue
    if (onset[i] >= onset[i - 1] && onset[i] > onset[i + 1]) peaks.push(i)
  }
  return peaks
}

function ellsDynamicProgrammingOnPeaks(
  peaks: number[],
  onset: Float32Array,
  period: number,
  tightness: number
): number[] {
  const n = peaks.length
  const minPeriod = period * 0.5
  const maxPeriod = period * 2
  const cum = new Float64Array(n)
  const back = new Int32Array(n)
  back.fill(-1)
  for (let j = 0; j < n; j++) {
    let best = onset[peaks[j]]
    let bestPrev = -1
    for (let i = j - 1; i >= 0; i--) {
      const ibi = peaks[j] - peaks[i]
      if (ibi > maxPeriod) break
      if (ibi < minPeriod) continue
      const logRatio = Math.log(ibi / period)
      const score = cum[i] + onset[peaks[j]] - tightness * logRatio * logRatio
      if (bestPrev < 0 || score > best) {
        best = score
        bestPrev = i
      }
    }
    cum[j] = best
    back[j] = bestPrev
  }
  let end = n - 1
  let bestEnd = cum[end]
  for (let j = 0; j < n; j++) {
    if (cum[j] >= bestEnd) {
      bestEnd = cum[j]
      end = j
    }
  }
  const picked: number[] = []
  for (let j = end; j >= 0; j = back[j]) {
    picked.push(peaks[j])
    if (back[j] < 0) break
  }
  picked.reverse()
  return picked
}

function ellsDynamicProgramming(onset: Float32Array, period: number, tightness: number): number[] {
  const n = onset.length
  const minPeriod = Math.max(1, Math.round(period * 0.5))
  const maxPeriod = Math.max(minPeriod + 1, Math.round(period * 2))
  const cum = new Float64Array(n)
  const back = new Int32Array(n)
  back.fill(-1)

  for (let t = 0; t < n; t++) {
    let best = onset[t]
    let bestPrev = -1
    const from = Math.max(0, t - maxPeriod)
    const to = t - minPeriod
    for (let prev = from; prev <= to; prev++) {
      const ibi = t - prev
      const logRatio = Math.log(ibi / period)
      const score = cum[prev] + onset[t] - tightness * logRatio * logRatio
      if (bestPrev < 0 || score > best) {
        best = score
        bestPrev = prev
      }
    }
    cum[t] = best
    back[t] = bestPrev
  }

  let end = n - 1
  let bestEnd = cum[end]
  const searchFrom = Math.max(0, n - maxPeriod * 2)
  for (let t = searchFrom; t < n; t++) {
    if (cum[t] >= bestEnd) {
      bestEnd = cum[t]
      end = t
    }
  }

  const frames: number[] = []
  for (let t = end; t >= 0; t = back[t]) {
    frames.push(t)
    if (back[t] < 0) break
  }
  frames.reverse()
  return frames
}

function strongestNear(onset: Float32Array, center: number, radius: number): number | null {
  const from = Math.max(0, Math.round(center - radius))
  const to = Math.min(onset.length - 1, Math.round(center + radius))
  let best = from
  let bestVal = -1
  for (let i = from; i <= to; i++) {
    if (onset[i] > bestVal) {
      bestVal = onset[i]
      best = i
    }
  }
  return bestVal > 0 ? best : null
}

function extendAndFillBeats(frames: number[], onset: Float32Array, period: number): number[] {
  const radius = Math.max(1, Math.round(period * 0.3))
  const beats = frames.slice()
  if (beats.length === 0) {
    const first = strongestNear(onset, period, period)
    if (first != null) beats.push(first)
  }
  while (beats.length > 0 && beats[0] > period * 0.7) {
    const prev = strongestNear(onset, beats[0] - period, radius)
    if (prev == null || prev >= beats[0]) break
    beats.unshift(prev)
  }
  while (beats.length > 0 && beats[beats.length - 1] < onset.length - period * 0.7) {
    const next = strongestNear(onset, beats[beats.length - 1] + period, radius)
    if (next == null || next <= beats[beats.length - 1]) break
    beats.push(next)
  }
  const filled: number[] = []
  for (let i = 0; i < beats.length; i++) {
    if (filled.length === 0 || beats[i] > filled[filled.length - 1]) filled.push(beats[i])
    const nxt = beats[i + 1]
    if (nxt == null) continue
    const gap = nxt - beats[i]
    if (gap <= period * 1.45) continue
    const missing = Math.round(gap / period) - 1
    for (let k = 1; k <= missing; k++) {
      const guess = strongestNear(onset, beats[i] + k * (gap / (missing + 1)), radius)
      if (guess != null && guess > filled[filled.length - 1] && guess < nxt) filled.push(guess)
    }
  }
  return filled
}

function snapBeatsToOnsets(frames: number[], onset: Float32Array, period: number): number[] {
  const radius = Math.max(1, Math.round(period * 0.25))
  const snapped: number[] = []
  for (const frame of frames) {
    let best = frame
    let bestVal = onset[frame] ?? 0
    const from = Math.max(0, frame - radius)
    const to = Math.min(onset.length - 1, frame + radius)
    for (let i = from; i <= to; i++) {
      if (onset[i] > bestVal) {
        bestVal = onset[i]
        best = i
      }
    }
    if (snapped.length === 0 || best > snapped[snapped.length - 1]) snapped.push(best)
  }
  return snapped
}

export function localBpmAt(map: TempoMap, time: number): number {
  return smoothedLocalBpm(sanitizeTempoMap(map), time)
}

export function isDownbeat(map: TempoMap, index: number, pulsesPerBar: number): boolean {
  const n = Math.max(1, pulsesPerBar)
  return ((index - map.downbeatIndex) % n + n) % n === 0
}

export function followClicksInRange(args: {
  map: TempoMap
  meter?: Partial<MetronomeMeter> | null
  start?: number
  end: number
}): MeterClick[] {
  const meter = normalizeMetronomeMeter(args.meter)
  const pulses = pulsesPerBar(meter)
  const start = Math.max(0, args.start ?? 0)
  const end = args.end
  if (!(end > start)) return []
  const clicks: MeterClick[] = []
  const map = sanitizeTempoMap(args.map)
  const beats = map.beats.slice()
  for (let i = 0; i < beats.length; i++) {
    const time = beats[i].time
    if (time >= end - 1e-12) break
    if (time < start) continue
    const beatInBar = ((i - map.downbeatIndex) % pulses + pulses) % pulses
    clicks.push({
      songTime: time,
      beatIndex: i,
      beatInBar,
      accent: meter.accentDownbeat && beatInBar === 0,
      sub: false
    })
    if (meter.subdivision === 'none' || i + 1 >= beats.length) continue
    const next = beats[i + 1].time
    const span = next - time
    if (!(span > 1e-6)) continue
    const parts = meter.subdivision === 'sixteenths' ? 4 : meter.subdivision === 'triplets' ? 3 : 2
    for (let p = 1; p < parts; p++) {
      const subTime = time + (span * p) / parts
      if (subTime < start || subTime >= end - 1e-12) continue
      clicks.push({
        songTime: subTime,
        beatIndex: i,
        beatInBar,
        accent: false,
        sub: true
      })
    }
  }
  clicks.sort((a, b) => a.songTime - b.songTime)
  return clicks
}

function prevPinnedIndex(beats: BeatMarker[], index: number): number {
  for (let i = index - 1; i >= 0; i--) {
    if (beats[i].pinned) return i
  }
  return 0
}

function nextPinnedIndex(beats: BeatMarker[], index: number): number {
  for (let i = index + 1; i < beats.length; i++) {
    if (beats[i].pinned) return i
  }
  return beats.length - 1
}

export function moveBeatTime(map: TempoMap, id: string, newTime: number): TempoMap {
  const beats = map.beats.map((b) => ({ ...b }))
  const index = beats.findIndex((b) => b.id === id)
  if (index < 0) return map
  const leftBound = index > 0 ? beats[index - 1].time + 0.02 : 0
  const rightBound = index + 1 < beats.length ? beats[index + 1].time - 0.02 : Number.POSITIVE_INFINITY
  const clamped = Math.max(leftBound, Math.min(rightBound, newTime))
  const oldTime = beats[index].time
  const left = prevPinnedIndex(beats, index)
  const right = nextPinnedIndex(beats, index)
  const leftOrigin = beats[left].time
  const oldLeftSpan = oldTime - leftOrigin
  const newLeftSpan = clamped - leftOrigin
  if (oldLeftSpan > 1e-9) {
    for (let i = left + 1; i < index; i++) {
      const u = (beats[i].time - leftOrigin) / oldLeftSpan
      beats[i] = { ...beats[i], time: leftOrigin + u * newLeftSpan }
    }
  }
  const rightEnd = beats[right].time
  const oldRightSpan = rightEnd - oldTime
  const newRightSpan = rightEnd - clamped
  if (oldRightSpan > 1e-9) {
    for (let i = index + 1; i < right; i++) {
      const u = (beats[i].time - oldTime) / oldRightSpan
      beats[i] = { ...beats[i], time: clamped + u * newRightSpan }
    }
  }
  beats[index] = { ...beats[index], time: clamped, pinned: true }
  return { ...map, beats }
}

export function addBeatAt(map: TempoMap, time: number): TempoMap {
  const t = Math.max(0, time)
  if (map.beats.some((b) => Math.abs(b.time - t) < 0.01)) return map
  const beats = [
    ...map.beats,
    { id: newBeatId(t, map.beats.length), time: t, pinned: true }
  ].sort((a, b) => a.time - b.time)
  return { ...map, beats }
}

export function removeBeat(map: TempoMap, id: string): TempoMap {
  if (map.beats.length <= MIN_BEATS) return map
  const index = map.beats.findIndex((b) => b.id === id)
  if (index < 0) return map
  const beats = map.beats.filter((b) => b.id !== id)
  let downbeatIndex = map.downbeatIndex
  if (index === downbeatIndex) downbeatIndex = 0
  else if (index < downbeatIndex) downbeatIndex -= 1
  return { ...map, beats, downbeatIndex: Math.max(0, Math.min(beats.length - 1, downbeatIndex)) }
}

export function setDownbeatAt(map: TempoMap, id: string): TempoMap {
  const index = map.beats.findIndex((b) => b.id === id)
  if (index < 0) return map
  return { ...map, downbeatIndex: index }
}

export function setDownbeatAtTime(map: TempoMap, time: number): TempoMap {
  if (map.beats.length === 0) return map
  let best = 0
  let bestDist = Infinity
  for (let i = 0; i < map.beats.length; i++) {
    const d = Math.abs(map.beats[i].time - time)
    if (d < bestDist) {
      bestDist = d
      best = i
    }
  }
  return { ...map, downbeatIndex: best }
}

export function serializeTempoMap(map?: TempoMap | null): TempoMap | undefined {
  if (!hasTempoMap(map)) return undefined
  return {
    beats: map.beats.map((b) => ({
      id: String(b.id),
      time: Number(b.time),
      pinned: !!b.pinned
    })),
    downbeatIndex: Math.max(0, Math.floor(Number(map.downbeatIndex) || 0)),
    globalBpm: clampBpm(map.globalBpm),
    sourceDuration: Math.max(0, Number(map.sourceDuration) || 0)
  }
}

export function hydrateTempoMap(raw: unknown): TempoMap | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const rec = raw as Record<string, unknown>
  const rows = Array.isArray(rec.beats) ? rec.beats : []
  const beats: BeatMarker[] = []
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue
    const item = row as Record<string, unknown>
    const time = Number(item.time)
    if (!Number.isFinite(time) || time < 0) continue
    beats.push({
      id: typeof item.id === 'string' ? item.id : newBeatId(time, beats.length),
      time,
      pinned: item.pinned === true
    })
  }
  if (beats.length < MIN_BEATS) return undefined
  beats.sort((a, b) => a.time - b.time)
  return sanitizeTempoMap({
    beats,
    downbeatIndex: Math.max(0, Math.min(beats.length - 1, Math.floor(Number(rec.downbeatIndex) || 0))),
    globalBpm: clampBpm(Number(rec.globalBpm) || 120),
    sourceDuration: Math.max(0, Number(rec.sourceDuration) || 0)
  })
}

export function serializeTrackTempoMap(track: {
  kind?: string
  tempoMap?: TempoMap | null
}): { tempoMap?: TempoMap } {
  if (track.kind !== 'metronome') return {}
  const tempoMap = serializeTempoMap(track.tempoMap)
  return tempoMap ? { tempoMap } : {}
}

export function hydrateTrackTempoMap(raw: unknown, kind?: string): { tempoMap?: TempoMap } {
  if (kind !== 'metronome') return {}
  const rec = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  const tempoMap = hydrateTempoMap(rec.tempoMap)
  return tempoMap ? { tempoMap } : {}
}

export function trueBeatTimesForLinearDrift(
  startBpm: number,
  endBpm: number,
  duration: number
): number[] {
  const times: number[] = []
  let t = 0
  while (t < duration - 1e-9) {
    times.push(t)
    const bpm = startBpm + (endBpm - startBpm) * (t / duration)
    t += 60 / Math.max(1, bpm)
  }
  return times
}
