/** Session tempo: quarter-note BPM, one decimal, 20–300. */

export const BPM_MIN = 20
export const BPM_MAX = 300
export const TAP_MIN_INTERVAL_MS = 200
export const TAP_MAX_INTERVAL_MS = 2000
export const TAP_RESET_GAP_MS = 2500
export const TAP_HISTORY = 8

export function secondsPerBeatSafe(bpm: number): number {
  const safe = Number.isFinite(bpm) && bpm > 0 ? bpm : 120
  return 60 / safe
}

export function roundBpm(n: number): number {
  return Math.round(n * 10) / 10
}

export function clampBpm(n: number): number {
  if (!Number.isFinite(n)) return 120
  return roundBpm(Math.min(BPM_MAX, Math.max(BPM_MIN, n)))
}

export function parseBpmInput(raw: string): number {
  const n = Number.parseFloat(String(raw ?? '').trim().replace(',', '.'))
  if (!Number.isFinite(n)) return 120
  return clampBpm(n)
}

export function formatBpm(n: number): string {
  const bpm = clampBpm(n)
  return Number.isInteger(bpm) ? String(bpm) : bpm.toFixed(1)
}

export function doubleBpm(n: number): number {
  return clampBpm(n * 2)
}

export function halfBpm(n: number): number {
  return clampBpm(n / 2)
}

export function appendTap(prev: readonly number[], nowMs: number): number[] {
  const now = Number(nowMs)
  if (!Number.isFinite(now)) return prev.slice()
  if (prev.length > 0 && now - prev[prev.length - 1] > TAP_RESET_GAP_MS) return [now]
  return [...prev.slice(-(TAP_HISTORY - 1)), now]
}

export function tapTempoFromTimestamps(timesMs: readonly number[]): number | null {
  if (timesMs.length < 2) return null
  const recent = timesMs.slice(-TAP_HISTORY)
  const intervals: number[] = []
  for (let i = 1; i < recent.length; i++) {
    const dt = recent[i] - recent[i - 1]
    if (dt < TAP_MIN_INTERVAL_MS || dt > TAP_MAX_INTERVAL_MS) continue
    intervals.push(dt)
  }
  if (intervals.length === 0) return null
  intervals.sort((a, b) => a - b)
  const mid = intervals[Math.floor(intervals.length / 2)]
  return clampBpm(60_000 / mid)
}
