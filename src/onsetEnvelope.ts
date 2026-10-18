export const ONSET_HOP_SECONDS = 0.01
export const SILENCE_RMS = 0.001

export interface OnsetEnvelope {
  flux: Float32Array
  envSr: number
  hop: number
  offsetSeconds: number
  durationSeconds: number
}

export function convertToMono(audioBuffer: AudioBuffer): Float32Array {
  const left = audioBuffer.getChannelData(0)
  const right = audioBuffer.numberOfChannels > 1 ? audioBuffer.getChannelData(1) : left
  const mono = new Float32Array(audioBuffer.length)
  for (let i = 0; i < mono.length; i++) {
    mono[i] = (left[i] + right[i]) / 2
  }
  return mono
}

export function skipLeadingSilence(samples: Float32Array, sampleRate: number): number {
  const win = Math.max(64, Math.floor(sampleRate * 0.05))
  for (let i = 0; i + win < samples.length; i += win) {
    let sum = 0
    for (let j = 0; j < win; j++) sum += samples[i + j] * samples[i + j]
    if (Math.sqrt(sum / win) >= SILENCE_RMS) return i
  }
  return 0
}

export function onsetFlux(samples: Float32Array, hop: number): Float32Array {
  const n = Math.floor(samples.length / hop)
  const energy = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    let sum = 0
    const start = i * hop
    for (let j = 0; j < hop; j++) {
      const s = samples[start + j]
      const prev = start + j > 0 ? samples[start + j - 1] : 0
      const hp = s - prev
      sum += hp * hp
    }
    energy[i] = Math.sqrt(sum / hop)
  }
  const flux = new Float32Array(n)
  flux[0] = energy[0]
  for (let i = 1; i < n; i++) {
    const d = energy[i] - energy[i - 1]
    flux[i] = d > 0 ? d : 0
  }
  return flux
}

export function computeOnsetEnvelope(
  samples: Float32Array,
  sampleRate: number,
  opts?: { maxSeconds?: number }
): OnsetEnvelope | null {
  if (!samples || samples.length < 16 || !(sampleRate > 0)) return null
  const start = skipLeadingSilence(samples, sampleRate)
  const hop = Math.max(32, Math.round(sampleRate * ONSET_HOP_SECONDS))
  const maxSamples = opts?.maxSeconds != null
    ? Math.min(samples.length - start, Math.floor(sampleRate * opts.maxSeconds))
    : samples.length - start
  if (maxSamples < sampleRate * 0.8) return null
  const window = samples.subarray(start, start + maxSamples)
  const rms = Math.sqrt(window.reduce((sum, val) => sum + val * val, 0) / window.length)
  if (rms < SILENCE_RMS) return null
  const flux = onsetFlux(window, hop)
  if (flux.length < 16) return null
  return {
    flux,
    envSr: sampleRate / hop,
    hop,
    offsetSeconds: start / sampleRate,
    durationSeconds: window.length / sampleRate
  }
}
