// @ts-ignore - music-tempo has no type definitions
import MusicTempo from 'music-tempo'

export interface BPMDetectionResult {
  bpm: number | null
  confidence: number
}

export async function detectBPM(audioBuffer: AudioBuffer): Promise<BPMDetectionResult> {
  try {
    const sampleRate = audioBuffer.sampleRate
    const mono = convertToMono(audioBuffer)
    
    const maxAnalysisSamples = sampleRate * 30
    const audioToAnalyze = mono.length > maxAnalysisSamples 
      ? mono.slice(0, maxAnalysisSamples) 
      : mono
    
    const rms = Math.sqrt(audioToAnalyze.reduce((sum, val) => sum + val * val, 0) / audioToAnalyze.length)
    if (rms < 0.001) {
      return { bpm: null, confidence: 0 }
    }
    
    const mt = new MusicTempo(audioToAnalyze)
    const bpm = mt.tempo
    
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
