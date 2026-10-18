import {
  buildTempoMap,
  trackBeatsFromOnset,
  type TempoMap
} from './beatTracker'
import { detectTempoFromEnvelope } from './bpmDetector'
import { computeOnsetEnvelope, convertToMono, type OnsetEnvelope } from './onsetEnvelope'
import type { BeatWorkerRequest, BeatWorkerResponse } from './beatTracker.worker'

const BPM_WINDOW_SECONDS = 90

export function envelopeForMix(buffer: AudioBuffer): OnsetEnvelope | null {
  return computeOnsetEnvelope(convertToMono(buffer), buffer.sampleRate)
}

export function bpmFromEnvelope(env: OnsetEnvelope): number | null {
  const maxFrames = Math.max(16, Math.floor(env.envSr * BPM_WINDOW_SECONDS))
  const flux = env.flux.length > maxFrames ? env.flux.subarray(0, maxFrames) : env.flux
  return detectTempoFromEnvelope(flux, env.envSr).bpm
}

export function trackBeatsSync(env: OnsetEnvelope, bpm: number): TempoMap | null {
  const times = trackBeatsFromOnset(env, bpm)
  if (times.length < 2) return null
  return buildTempoMap(times, bpm, env.offsetSeconds + env.durationSeconds)
}

export async function trackBeatsInWorker(env: OnsetEnvelope, bpm: number): Promise<TempoMap | null> {
  if (typeof Worker === 'undefined') return trackBeatsSync(env, bpm)
  try {
    const worker = new Worker(new URL('./beatTracker.worker.ts', import.meta.url), { type: 'module' })
    const request: BeatWorkerRequest = {
      flux: env.flux,
      envSr: env.envSr,
      offsetSeconds: env.offsetSeconds,
      durationSeconds: env.durationSeconds,
      bpm
    }
    const result = await new Promise<BeatWorkerResponse>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('beat worker timeout')), 60_000)
      worker.onmessage = (event: MessageEvent<BeatWorkerResponse>) => {
        clearTimeout(timer)
        resolve(event.data)
      }
      worker.onerror = (event) => {
        clearTimeout(timer)
        reject(event.error || new Error(event.message))
      }
      worker.postMessage(request)
    })
    worker.terminate()
    if (result.type !== 'done' || result.times.length < 2) return trackBeatsSync(env, bpm)
    return buildTempoMap(result.times, result.bpm, result.duration)
  } catch (error) {
    console.warn('[Tempo map] worker failed, using main thread', error)
    return trackBeatsSync(env, bpm)
  }
}

export async function analyzeMixTempoMap(
  buffer: AudioBuffer,
  bpmHint?: number
): Promise<{
  bpm: number | null
  map: TempoMap | null
}> {
  const env = envelopeForMix(buffer)
  if (!env) return { bpm: null, map: null }
  const detected = bpmFromEnvelope(env)
  const bpm = detected ?? (bpmHint && bpmHint > 0 ? bpmHint : null)
  if (bpm == null) return { bpm: detected, map: null }
  const map = await trackBeatsInWorker(env, bpm)
  return { bpm: detected, map }
}
