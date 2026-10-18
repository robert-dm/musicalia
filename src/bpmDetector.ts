import { computeOnsetEnvelope, convertToMono } from './onsetEnvelope'
import { clampBpm, roundBpm } from './tempoMath'

export interface BPMDetectionResult {
  bpm: number | null
  confidence: number
  candidates?: Array<{ bpm: number; strength: number }>
}

const ANALYSIS_SECONDS = 90
const BPM_SEARCH_MIN = 50
const BPM_SEARCH_MAX = 220
const OCTAVE_STRENGTH = 0.5

export function detectTempoFromEnvelope(
  flux: Float32Array,
  envSr: number
): BPMDetectionResult {
  if (flux.length < 16 || !(envSr > 0)) return { bpm: null, confidence: 0 }

  const minLag = Math.max(2, Math.floor(envSr * 60 / BPM_SEARCH_MAX))
  const maxLag = Math.min(flux.length - 2, Math.ceil(envSr * 60 / BPM_SEARCH_MIN))
  if (maxLag <= minLag + 2) return { bpm: null, confidence: 0 }

  const corr = new Float64Array(maxLag + 2)
  let energy = 0
  for (let i = 0; i < flux.length; i++) energy += flux[i] * flux[i]
  if (energy <= 1e-12) return { bpm: null, confidence: 0 }

  for (let lag = minLag - 1; lag <= maxLag + 1; lag++) {
    if (lag < 1) continue
    let sum = 0
    const n = flux.length - lag
    for (let i = 0; i < n; i++) sum += flux[i] * flux[i + lag]
    corr[lag] = sum / energy
  }

  const peaks = localPeaks(corr, minLag, maxLag, envSr)
  const chosen = pickOctave(peaks)
  if (!chosen) return { bpm: null, confidence: 0, candidates: peaks }
  const onsets = onsetTimes(flux, envSr)
  const refined = refineBpmFromOnsets(onsets, chosen.bpm)

  return {
    bpm: clampBpm(refined),
    confidence: Math.max(0, Math.min(1, chosen.strength / (corrPeak(corr, minLag, maxLag) || 1))),
    candidates: peaks
  }
}

export function detectTempoFromMono(samples: Float32Array, sampleRate: number): BPMDetectionResult {
  const env = computeOnsetEnvelope(samples, sampleRate, { maxSeconds: ANALYSIS_SECONDS })
  if (!env) return { bpm: null, confidence: 0 }
  return detectTempoFromEnvelope(env.flux, env.envSr)
}

export async function detectBPM(audioBuffer: AudioBuffer): Promise<BPMDetectionResult> {
  try {
    const mono = convertToMono(audioBuffer)
    return detectTempoFromMono(mono, audioBuffer.sampleRate)
  } catch (error) {
    console.error('BPM detection error:', error)
    return { bpm: null, confidence: 0 }
  }
}

/** Fold only extreme half/double guesses; keep 152 instead of collapsing it to 76. */
export function normalizeDetectedBpm(raw: unknown): number | null {
  let bpm = Number(raw)
  if (!Number.isFinite(bpm) || bpm <= 0) return null
  while (bpm < 60) bpm *= 2
  while (bpm > 200) bpm /= 2
  if (bpm < 50 || bpm > 240) return null
  return roundBpm(bpm)
}

function parabolicLag(corr: Float64Array, i: number): number {
  const a = corr[i - 1] ?? corr[i]
  const b = corr[i]
  const c = corr[i + 1] ?? corr[i]
  const denom = a - 2 * b + c
  if (Math.abs(denom) < 1e-12) return i
  const delta = 0.5 * (a - c) / denom
  return i + Math.max(-1, Math.min(1, delta))
}

function localPeaks(
  corr: Float64Array,
  minLag: number,
  maxLag: number,
  envSr: number
): Array<{ bpm: number; strength: number }> {
  const peaks: Array<{ bpm: number; strength: number }> = []
  for (let i = minLag; i <= maxLag; i++) {
    if (corr[i] <= corr[i - 1] || corr[i] < corr[i + 1]) continue
    if (corr[i] < 0.08) continue
    const lag = parabolicLag(corr, i)
    if (!(lag > 0)) continue
    const bpm = roundBpm(60 * envSr / lag)
    if (bpm < BPM_SEARCH_MIN - 1 || bpm > BPM_SEARCH_MAX + 1) continue
    peaks.push({ bpm, strength: corr[i] })
  }
  peaks.sort((a, b) => b.strength - a.strength)
  return peaks.slice(0, 12)
}

function pickOctave(peaks: Array<{ bpm: number; strength: number }>): { bpm: number; strength: number } | null {
  if (peaks.length === 0) return null
  const best = peaks[0].strength
  const strong = peaks.filter((p) => p.strength >= best * OCTAVE_STRENGTH)
  strong.sort((a, b) => b.bpm - a.bpm)
  return strong[0] ?? peaks[0]
}

function onsetTimes(flux: Float32Array, envSr: number): number[] {
  const times: number[] = []
  let max = 0
  for (let i = 0; i < flux.length; i++) {
    if (flux[i] > max) max = flux[i]
  }
  const thresh = max * 0.25
  for (let i = 1; i < flux.length - 1; i++) {
    if (flux[i] < thresh) continue
    if (flux[i] >= flux[i - 1] && flux[i] > flux[i + 1]) {
      times.push(i / envSr)
    }
  }
  return times
}

function gridError(times: number[], bpm: number): number {
  const period = 60 / bpm
  if (!(period > 0) || times.length === 0) return Number.POSITIVE_INFINITY
  let err = 0
  for (const t of times) {
    const k = Math.round(t / period)
    const d = t - k * period
    err += d * d
  }
  return err / times.length
}

function refineBpmFromOnsets(times: number[], seed: number): number {
  if (times.length < 4) return roundBpm(seed)
  let bestBpm = seed
  let best = gridError(times, seed)
  for (let bpm = seed - 2; bpm <= seed + 2 + 1e-9; bpm += 0.1) {
    if (bpm < BPM_SEARCH_MIN - 2 || bpm > BPM_SEARCH_MAX + 2) continue
    const err = gridError(times, bpm)
    if (err < best - 1e-12 || (Math.abs(err - best) <= 1e-12 && Math.abs(bpm - seed) < Math.abs(bestBpm - seed))) {
      best = err
      bestBpm = bpm
    }
  }
  return roundBpm(bestBpm)
}

function corrPeak(corr: Float64Array, minLag: number, maxLag: number): number {
  let best = 0
  for (let i = minLag; i <= maxLag; i++) {
    if (corr[i] > best) best = corr[i]
  }
  return best
}
