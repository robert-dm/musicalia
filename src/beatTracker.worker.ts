import { trackBeatsFromOnset } from './beatTracker'
import { detectTempoFromEnvelope } from './bpmDetector'

export type BeatWorkerRequest = {
  flux: Float32Array
  envSr: number
  offsetSeconds: number
  durationSeconds: number
  bpm?: number | null
}

export type BeatWorkerResponse =
  | { type: 'done'; times: number[]; bpm: number; duration: number }
  | { type: 'error'; message: string }

self.onmessage = (event: MessageEvent<BeatWorkerRequest>) => {
  try {
    const { flux, envSr, offsetSeconds, durationSeconds, bpm } = event.data
    const detected = bpm && bpm > 0 ? bpm : detectTempoFromEnvelope(flux, envSr).bpm
    if (detected == null) {
      const msg: BeatWorkerResponse = { type: 'error', message: 'No BPM' }
      self.postMessage(msg)
      return
    }
    const env = { flux, envSr, hop: 0, offsetSeconds, durationSeconds }
    const times = trackBeatsFromOnset(env, detected)
    const msg: BeatWorkerResponse = {
      type: 'done',
      times,
      bpm: detected,
      duration: offsetSeconds + durationSeconds
    }
    self.postMessage(msg)
  } catch (error) {
    const msg: BeatWorkerResponse = {
      type: 'error',
      message: error instanceof Error ? error.message : String(error)
    }
    self.postMessage(msg)
  }
}
