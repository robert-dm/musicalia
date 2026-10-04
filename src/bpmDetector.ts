/**
 * BPM detection using onset detection and inter-onset interval analysis
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
    
    // Analyze first 30 seconds for performance
    const maxAnalysisSamples = sampleRate * 30
    const audioToAnalyze = mono.length > maxAnalysisSamples 
      ? mono.slice(0, maxAnalysisSamples) 
      : mono
    
    console.log(`[BPM] Analyzing ${audioToAnalyze.length} samples at ${sampleRate}Hz (${(audioToAnalyze.length / sampleRate).toFixed(1)}s)`)
    
    // Compute onset strength envelope
    const onsetEnvelope = computeOnsetEnvelope(audioToAnalyze, sampleRate)
    
    // Find peaks (potential beats)
    const peaks = findPeaks(onsetEnvelope, sampleRate)
    
    console.log(`[BPM] Found ${peaks.length} onset peaks`)
    
    if (peaks.length < 4) {
      console.log('[BPM] Too few peaks detected for reliable BPM estimation')
      return { bpm: null, confidence: 0 }
    }
    
    // Analyze inter-onset intervals to find tempo
    const bpm = estimateBPMFromPeaks(peaks, sampleRate)
    
    if (bpm && bpm >= 60 && bpm <= 200) {
      console.log(`[BPM] Estimated tempo: ${Math.round(bpm)} BPM`)
      return { bpm: Math.round(bpm), confidence: 0.8 }
    }
    
    console.log(`[BPM] Invalid tempo estimate: ${bpm}`)
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

/**
 * Compute onset strength envelope using spectral flux approximation
 */
function computeOnsetEnvelope(audio: Float32Array, sampleRate: number): Float32Array {
  // Use smaller hop size for better temporal resolution
  const hopSize = Math.floor(sampleRate * 0.005) // 5ms
  const windowSize = Math.floor(sampleRate * 0.04) // 40ms
  const numFrames = Math.floor((audio.length - windowSize) / hopSize)
  
  const envelope = new Float32Array(numFrames)
  let prevEnergy = 0
  
  for (let i = 0; i < numFrames; i++) {
    const start = i * hopSize
    let energy = 0
    
    // Compute RMS energy with emphasis on higher frequencies (simple spectral flux approximation)
    for (let j = 0; j < windowSize; j++) {
      const sample = audio[start + j]
      // Emphasize transients by using absolute value and power
      energy += Math.abs(sample) ** 1.5
    }
    
    energy = energy / windowSize
    
    // Positive difference = onset strength
    const onset = Math.max(0, energy - prevEnergy * 0.9)
    envelope[i] = onset
    prevEnergy = energy
  }
  
  // Normalize
  const maxVal = Math.max(...Array.from(envelope))
  if (maxVal > 0) {
    for (let i = 0; i < envelope.length; i++) {
      envelope[i] /= maxVal
    }
  }
  
  return envelope
}

/**
 * Find peaks in onset envelope using adaptive thresholding
 */
function findPeaks(envelope: Float32Array, sampleRate: number): number[] {
  const hopSize = Math.floor(sampleRate * 0.005)
  const peaks: number[] = []
  
  // Compute adaptive threshold (median + factor)
  const sorted = Array.from(envelope).sort((a, b) => a - b)
  const median = sorted[Math.floor(sorted.length / 2)]
  // Use lower threshold for better detection in quieter music
  const threshold = Math.max(0.03, median * 1.2)
  
  // Minimum distance between peaks (prevents double-detections)
  const minPeakDistance = Math.floor(sampleRate * 0.15 / hopSize) // 150ms minimum
  let lastPeakIdx = -minPeakDistance
  
  for (let i = 1; i < envelope.length - 1; i++) {
    if (envelope[i] > threshold && 
        envelope[i] >= envelope[i - 1] && 
        envelope[i] >= envelope[i + 1] &&
        i - lastPeakIdx >= minPeakDistance) {
      peaks.push(i)
      lastPeakIdx = i
    }
  }
  
  return peaks
}

/**
 * Estimate BPM from peak positions using inter-onset interval analysis
 */
function estimateBPMFromPeaks(peaks: number[], sampleRate: number): number | null {
  if (peaks.length < 2) return null
  
  const hopSize = Math.floor(sampleRate * 0.005)
  
  // Compute all inter-onset intervals (in seconds)
  const intervals: number[] = []
  for (let i = 1; i < peaks.length; i++) {
    const interval = (peaks[i] - peaks[i - 1]) * hopSize / sampleRate
    // Only consider reasonable intervals (60-200 BPM range, including half/double time)
    if (interval >= 0.3 && interval <= 2.0) {
      intervals.push(interval)
    }
  }
  
  if (intervals.length < 2) return null
  
  // Build histogram of intervals (rounded to nearest 0.01s)
  const histogram = new Map<number, number>()
  for (const interval of intervals) {
    const rounded = Math.round(interval * 100) / 100
    histogram.set(rounded, (histogram.get(rounded) || 0) + 1)
  }
  
  // Find most common interval
  let bestInterval = 0
  let bestCount = 0
  
  for (const [interval, count] of histogram.entries()) {
    if (count > bestCount) {
      bestCount = count
      bestInterval = interval
    }
  }
  
  // Convert interval to BPM
  let bpm = 60 / bestInterval
  
  // Handle half-time/double-time ambiguity
  // Prefer tempo in the 80-160 range
  while (bpm < 70 && bpm > 0) {
    bpm *= 2
  }
  while (bpm > 180) {
    bpm /= 2
  }
  
  return bpm
}
