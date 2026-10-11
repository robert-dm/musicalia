import { songTimeFromWall } from './clipPlayer'

export const RECORD_LATENCY_STORAGE_KEY = 'musicalia-record-latency'
export const MANUAL_LATENCY_MIN_MS = -200
export const MANUAL_LATENCY_MAX_MS = 200
export const MANUAL_LATENCY_STEP_MS = 1
export const MANUAL_LATENCY_RESET_MS = 0

export interface RecordLatencyDevice {
  calibratedMs: number
  updatedAt: number
}

export interface RecordLatencySettings {
  manualMs: number
  devices: Record<string, RecordLatencyDevice>
}

function trackSettings(track: unknown): { latency?: number; deviceId?: string } | null {
  if (!track || typeof track !== 'object' || !('getSettings' in track)) return null
  const getSettings = (track as { getSettings?: () => unknown }).getSettings
  if (typeof getSettings !== 'function') return null
  const settings = getSettings.call(track)
  return settings && typeof settings === 'object' ? settings as { latency?: number; deviceId?: string } : null
}

export function inputLatencySeconds(track?: unknown): number {
  const latency = trackSettings(track)?.latency
  if (typeof latency !== 'number' || !Number.isFinite(latency) || latency <= 0) return 0
  return latency
}

export function autoRecordLatencySeconds(
  ctx: { baseLatency?: number; outputLatency?: number },
  track?: unknown
): number {
  const base = typeof ctx.baseLatency === 'number' && Number.isFinite(ctx.baseLatency) ? ctx.baseLatency : 0
  const output = typeof ctx.outputLatency === 'number' && Number.isFinite(ctx.outputLatency) ? ctx.outputLatency : 0
  return Math.max(0, base + output + inputLatencySeconds(track))
}

/** Calibrated loopback replaces the auto estimate; manual offset is always added. */
export function effectiveRecordLatencySeconds(input: {
  autoSeconds: number
  calibratedSeconds?: number | null
  manualSeconds?: number
}): number {
  const auto = Number.isFinite(input.autoSeconds) ? Math.max(0, input.autoSeconds) : 0
  const calibrated =
    input.calibratedSeconds != null && Number.isFinite(input.calibratedSeconds)
      ? Math.max(0, input.calibratedSeconds)
      : null
  const manual = Number.isFinite(input.manualSeconds) ? input.manualSeconds! : 0
  return Math.max(0, (calibrated ?? auto) + manual)
}

export function emptyRecordLatencySettings(): RecordLatencySettings {
  return { manualMs: 0, devices: {} }
}

export function hydrateRecordLatencySettings(raw: unknown): RecordLatencySettings {
  const empty = emptyRecordLatencySettings()
  if (!raw || typeof raw !== 'object') return empty
  const data = raw as Partial<RecordLatencySettings>
  const manualMs = clampLatencyMs(Number(data.manualMs) || 0)
  const devices: Record<string, RecordLatencyDevice> = {}
  if (data.devices && typeof data.devices === 'object') {
    for (const [id, device] of Object.entries(data.devices)) {
      const ms = Number(device?.calibratedMs)
      if (!id || !Number.isFinite(ms) || ms < 0) continue
      devices[id] = { calibratedMs: ms, updatedAt: Number(device?.updatedAt) || 0 }
    }
  }
  return { manualMs, devices }
}

export function loadRecordLatencySettings(): RecordLatencySettings {
  try {
    if (typeof localStorage === 'undefined') return emptyRecordLatencySettings()
    const raw = localStorage.getItem(RECORD_LATENCY_STORAGE_KEY)
    return raw ? hydrateRecordLatencySettings(JSON.parse(raw)) : emptyRecordLatencySettings()
  } catch {
    return emptyRecordLatencySettings()
  }
}

export function persistRecordLatencySettings(settings: RecordLatencySettings): void {
  try {
    if (typeof localStorage === 'undefined') return
    localStorage.setItem(RECORD_LATENCY_STORAGE_KEY, JSON.stringify(settings))
  } catch {
    /* private mode */
  }
}

export function calibratedSecondsForDevice(
  settings: RecordLatencySettings,
  deviceId?: string | null
): number | null {
  const id = deviceId && deviceId.length > 0 ? deviceId : 'default'
  const ms = settings.devices[id]?.calibratedMs
  return typeof ms === 'number' && Number.isFinite(ms) ? ms / 1000 : null
}

export function formatLatencyMs(n: number): string {
  const v = Math.round(n)
  if (v > 0) return `+${v} ms`
  return `${v} ms`
}

export function parseLatencyMs(raw: string): number | null {
  const n = Number.parseFloat(raw.replace(/ms/i, '').trim())
  return Number.isFinite(n) ? n : null
}

export function clampLatencyMs(n: number): number {
  if (!Number.isFinite(n)) return MANUAL_LATENCY_RESET_MS
  return Math.max(MANUAL_LATENCY_MIN_MS, Math.min(MANUAL_LATENCY_MAX_MS, Math.round(n)))
}

export function nudgeClipOffsetSeconds(offsetSeconds: number, latencyMs: number): number {
  const next = offsetSeconds - clampLatencyMs(latencyMs) / 1000
  return Math.max(0, Number.isFinite(next) ? next : 0)
}

/**
 * Lag in samples that best aligns `recorded` to `reference`.
 * Positive means the recorded signal is late (the usual speaker→mic path).
 */
export function findDelaySamples(
  reference: Float32Array,
  recorded: Float32Array,
  maxLag?: number
): number {
  if (!reference.length || !recorded.length) return 0
  const limit = Math.max(1, Math.min(maxLag ?? recorded.length, recorded.length))
  let bestLag = 0
  let best = -Infinity
  const refEnergy = Math.sqrt(reference.reduce((s, v) => s + v * v, 0)) || 1
  for (let lag = 0; lag < limit; lag++) {
    let sum = 0
    let recEnergy = 0
    const n = Math.min(reference.length, recorded.length - lag)
    if (n < 8) break
    for (let i = 0; i < n; i++) {
      const r = recorded[i + lag]
      sum += reference[i] * r
      recEnergy += r * r
    }
    const score = sum / (refEnergy * Math.sqrt(recEnergy || 1))
    if (score > best) {
      best = score
      bestLag = lag
    }
  }
  return bestLag
}

export function findDelaySeconds(
  reference: Float32Array,
  recorded: Float32Array,
  sampleRate: number,
  maxLagSeconds = 0.6
): number {
  if (!(sampleRate > 0)) return 0
  const lag = findDelaySamples(reference, recorded, Math.floor(maxLagSeconds * sampleRate))
  return lag / sampleRate
}

export function makeClickTrain(
  sampleRate: number,
  opts?: { count?: number; interval?: number; clickMs?: number }
): Float32Array {
  const count = opts?.count ?? 8
  const interval = opts?.interval ?? 0.35
  const clickMs = opts?.clickMs ?? 2
  const total = Math.max(1, Math.ceil((count * interval + 0.15) * sampleRate))
  const out = new Float32Array(total)
  const clickLen = Math.max(2, Math.round((clickMs / 1000) * sampleRate))
  for (let n = 0; n < count; n++) {
    const start = Math.round(n * interval * sampleRate)
    for (let i = 0; i < clickLen && start + i < out.length; i++) {
      const t = i / sampleRate
      out[start + i] = Math.sin(2 * Math.PI * 1000 * t) * Math.exp(-t * 400)
    }
  }
  return out
}

export function mixToMono(channels: ArrayLike<Float32Array>): Float32Array {
  if (!channels.length) return new Float32Array(0)
  const length = channels[0]?.length ?? 0
  const out = new Float32Array(length)
  const n = channels.length
  for (let i = 0; i < length; i++) {
    let s = 0
    for (let ch = 0; ch < n; ch++) s += channels[ch][i] || 0
    out[i] = s / n
  }
  return out
}

export function peakTimeSeconds(buffer: {
  numberOfChannels: number
  length: number
  sampleRate: number
  getChannelData: (ch: number) => Float32Array
}): number {
  let best = 0
  let at = 0
  for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
    const data = buffer.getChannelData(ch)
    for (let i = 0; i < data.length; i++) {
      const a = Math.abs(data[i])
      if (a > best) {
        best = a
        at = i
      }
    }
  }
  return buffer.sampleRate > 0 ? at / buffer.sampleRate : 0
}

export function songTimeOfContextTime(
  contextTime: number,
  playOriginSong: number,
  playOriginContext: number,
  tempoRate: number
): number {
  return songTimeFromWall(playOriginSong, playOriginContext, contextTime, tempoRate)
}

export function placeRecordedClip(input: {
  firstContextTime: number | null | undefined
  fallbackSong: number
  playOriginSong: number
  playOriginContext: number
  tempoRate: number
  latencySeconds: number
}): number {
  const firstSong =
    input.firstContextTime != null && Number.isFinite(input.firstContextTime)
      ? songTimeOfContextTime(
          input.firstContextTime,
          input.playOriginSong,
          input.playOriginContext,
          input.tempoRate
        )
      : input.fallbackSong
  return Math.max(0, firstSong - Math.max(0, input.latencySeconds || 0))
}
