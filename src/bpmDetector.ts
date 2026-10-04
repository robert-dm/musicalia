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
    
    console.log(`[BPM] Analyzing ${mono.length} samples at ${sampleRate}Hz (${(mono.length/sampleRate).toFixed(1)}s)`)
    
    const maxAnalysisSamples = sampleRate * 90
    const audioToAnalyze = mono.length > maxAnalysisSamples 
      ? mono.slice(0, maxAnalysisSamples) 
      : mono
    
    const energyEnvelope = computeEnergyEnvelope(audioToAnalyze, sampleRate)
    console.log(`[BPM] Energy envelope: ${energyEnvelope.length} frames, max=${Math.max(...energyEnvelope).toFixed(4)}`)
    
    const diffEnvelope = computeDifferenceEnvelope(energyEnvelope)
    const diffMax = Math.max(...diffEnvelope)
    const diffMean = diffEnvelope.reduce((a, b) => a + b, 0) / diffEnvelope.length
    console.log(`[BPM] Difference envelope: max=${diffMax.toFixed(4)}, mean=${diffMean.toFixed(6)}`)
    
    const autocorr = computeAutocorrelation(diffEnvelope)
    console.log(`[BPM] Autocorrelation: ${autocorr.length} lags`)
    
    const result = findBPMFromAutocorrelation(autocorr, sampleRate)
    
    if (result.bpm && result.bpm >= 60 && result.bpm <= 200) {
      console.log(`[BPM] ✓ Detected BPM: ${result.bpm} (${result.peakCount} peaks found)`)
      return { bpm: Math.round(result.bpm), confidence: 0.8 }
    }
    
    console.log(`[BPM] ✗ No valid BPM found (${result.peakCount} peaks, best=${result.bpm})`)
    return { bpm: null, confidence: 0 }
  } catch (error) {
    console.error('[BPM] Detection error:', error)
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

function findBPMFromAutocorrelation(
  autocorr: Float32Array, 
  sampleRate: number
): { bpm: number | null, peakCount: number } {
  const minBPM = 60
  const maxBPM = 200
  
  const hopSize = Math.floor(sampleRate * 0.01)
  const minLag = Math.floor((60 / maxBPM) * sampleRate / hopSize)
  const maxLag = Math.floor((60 / minBPM) * sampleRate / hopSize)
  
  // Find the maximum value in the search range to set adaptive threshold
  let maxInRange = 0
  for (let i = minLag; i < Math.min(maxLag, autocorr.length); i++) {
    if (autocorr[i] > maxInRange) {
      maxInRange = autocorr[i]
    }
  }
  
  // Use adaptive threshold: 5% of max or 0.01, whichever is higher
  const threshold = Math.max(maxInRange * 0.05, 0.01)
  console.log(`[BPM] Peak search: lag range [${minLag}, ${maxLag}], max=${maxInRange.toFixed(4)}, threshold=${threshold.toFixed(4)}`)
  
  const peaks: Array<{ index: number, value: number, bpm: number }> = []
  
  for (let i = minLag + 1; i < Math.min(maxLag - 1, autocorr.length - 1); i++) {
    if (autocorr[i] > autocorr[i - 1] && autocorr[i] > autocorr[i + 1] && autocorr[i] > threshold) {
      const lagInSeconds = (i * hopSize) / sampleRate
      const bpm = 60 / lagInSeconds
      
      if (bpm >= minBPM && bpm <= maxBPM) {
        peaks.push({ index: i, value: autocorr[i], bpm })
      }
    }
  }
  
  console.log(`[BPM] Found ${peaks.length} peaks above threshold`)
  
  if (peaks.length === 0) {
    return { bpm: null, peakCount: 0 }
  }
  
  peaks.sort((a, b) => b.value - a.value)
  
  // Log top peaks
  const topPeaks = peaks.slice(0, 5).map(p => `${p.bpm.toFixed(1)} (${p.value.toFixed(3)})`).join(', ')
  console.log(`[BPM] Top peaks: ${topPeaks}`)
  
  const bestBPM = peaks[0].bpm
  
  // Check for half/double time
  for (const candidate of peaks.slice(1, 5)) {
    if (Math.abs(candidate.bpm - bestBPM * 2) < 5) {
      return { bpm: candidate.bpm, peakCount: peaks.length }
    }
    if (Math.abs(candidate.bpm - bestBPM / 2) < 5) {
      return { bpm: candidate.bpm, peakCount: peaks.length }
    }
  }
  
  return { bpm: bestBPM, peakCount: peaks.length }
}
