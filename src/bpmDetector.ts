/**
 * BPM detection using autocorrelation and onset detection
 */

export interface BPMDetectionResult {
  bpm: number | null
  confidence: number
}

/**
 * Detect BPM from an AudioBuffer
 */
export async function detectBPM(audioBuffer: AudioBuffer): Promise<BPMDetectionResult> {
  try {
    const sampleRate = audioBuffer.sampleRate
    const mono = convertToMono(audioBuffer)
    
    const energyEnvelope = computeEnergyEnvelope(mono, sampleRate)
    const autocorr = computeAutocorrelation(energyEnvelope)
    
    const bpm = findBPMFromAutocorrelation(autocorr, sampleRate, energyEnvelope.length)
    
    if (bpm && bpm >= 60 && bpm <= 200) {
      return { bpm: Math.round(bpm), confidence: 0.8 }
    }
    
    return { bpm: null, confidence: 0 }
  } catch (error) {
    console.error('BPM detection error:', error)
    return { bpm: null, confidence: 0 }
  }
}

function convertToMono(audioBuffer: AudioBuffer): Float32Array {
  const left = audioBuffer.getChannelData(0)
  const right = audioBuffer.numberOfChannels > 1 ? audioBuffer.getChannelData(1) : left
  const mono = new Float32Array(audioBuffer.length)
  
  for (let i = 0; i < mono.length; i++) {
    mono[i] = (left[i] + right[i]) / 2
  }
  
  return mono
}

function computeEnergyEnvelope(audio: Float32Array, sampleRate: number): Float32Array {
  const windowSize = Math.floor(sampleRate * 0.05)
  const hopSize = Math.floor(windowSize / 2)
  const numFrames = Math.floor((audio.length - windowSize) / hopSize)
  const envelope = new Float32Array(numFrames)
  
  for (let i = 0; i < numFrames; i++) {
    const start = i * hopSize
    let energy = 0
    
    for (let j = 0; j < windowSize; j++) {
      const sample = audio[start + j]
      energy += sample * sample
    }
    
    envelope[i] = Math.sqrt(energy / windowSize)
  }
  
  return envelope
}

function computeAutocorrelation(signal: Float32Array): Float32Array {
  const maxLag = Math.min(signal.length, Math.floor(signal.length / 2))
  const autocorr = new Float32Array(maxLag)
  
  const mean = signal.reduce((sum, val) => sum + val, 0) / signal.length
  
  for (let lag = 0; lag < maxLag; lag++) {
    let sum = 0
    let count = 0
    
    for (let i = 0; i < signal.length - lag; i++) {
      sum += (signal[i] - mean) * (signal[i + lag] - mean)
      count++
    }
    
    autocorr[lag] = count > 0 ? sum / count : 0
  }
  
  if (autocorr[0] > 0) {
    for (let i = 0; i < autocorr.length; i++) {
      autocorr[i] /= autocorr[0]
    }
  }
  
  return autocorr
}

export function findBPMFromAutocorrelation(autocorr: Float32Array, sampleRate: number, _envelopeLength: number): number | null {
  const minBPM = 60
  const maxBPM = 200
  
  const hopSize = Math.floor(sampleRate * 0.05) / 2
  const minLag = Math.floor((60 / maxBPM) * sampleRate / hopSize)
  const maxLag = Math.floor((60 / minBPM) * sampleRate / hopSize)
  
  let maxValue = -Infinity
  let maxIndex = -1
  
  for (let i = minLag; i < Math.min(maxLag, autocorr.length); i++) {
    if (autocorr[i] > maxValue) {
      maxValue = autocorr[i]
      maxIndex = i
    }
  }
  
  if (maxIndex > 0 && maxValue > 0.3) {
    const lagInSeconds = (maxIndex * hopSize) / sampleRate
    const bpm = 60 / lagInSeconds
    return bpm
  }
  
  return null
}
