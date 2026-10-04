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
    
    const maxAnalysisSamples = sampleRate * 90
    const audioToAnalyze = mono.length > maxAnalysisSamples 
      ? mono.slice(0, maxAnalysisSamples) 
      : mono
    
    const energyEnvelope = computeEnergyEnvelope(audioToAnalyze, sampleRate)
    const diffEnvelope = computeDifferenceEnvelope(energyEnvelope)
    const autocorr = computeAutocorrelation(diffEnvelope)
    
    const bpm = findBPMFromAutocorrelation(autocorr, sampleRate)
    
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
  const windowSize = Math.floor(sampleRate * 0.01)
  const hopSize = Math.floor(sampleRate * 0.01)
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

function computeDifferenceEnvelope(envelope: Float32Array): Float32Array {
  const diff = new Float32Array(envelope.length)
  diff[0] = 0
  
  for (let i = 1; i < envelope.length; i++) {
    const delta = envelope[i] - envelope[i - 1]
    diff[i] = delta > 0 ? delta : 0
  }
  
  return diff
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

function findBPMFromAutocorrelation(autocorr: Float32Array, sampleRate: number): number | null {
  const minBPM = 60
  const maxBPM = 200
  
  const hopSize = Math.floor(sampleRate * 0.01)
  const minLag = Math.floor((60 / maxBPM) * sampleRate / hopSize)
  const maxLag = Math.floor((60 / minBPM) * sampleRate / hopSize)
  
  const peaks: Array<{ index: number, value: number, bpm: number }> = []
  
  for (let i = minLag + 1; i < Math.min(maxLag - 1, autocorr.length - 1); i++) {
    if (autocorr[i] > autocorr[i - 1] && autocorr[i] > autocorr[i + 1] && autocorr[i] > 0.1) {
      const lagInSeconds = (i * hopSize) / sampleRate
      const bpm = 60 / lagInSeconds
      
      if (bpm >= minBPM && bpm <= maxBPM) {
        peaks.push({ index: i, value: autocorr[i], bpm })
      }
    }
  }
  
  if (peaks.length === 0) {
    return null
  }
  
  peaks.sort((a, b) => b.value - a.value)
  
  const bestBPM = peaks[0].bpm
  
  for (const candidate of peaks.slice(1, 5)) {
    if (Math.abs(candidate.bpm - bestBPM * 2) < 5) {
      return candidate.bpm
    }
    if (Math.abs(candidate.bpm - bestBPM / 2) < 5) {
      return candidate.bpm
    }
  }
  
  return bestBPM
}
