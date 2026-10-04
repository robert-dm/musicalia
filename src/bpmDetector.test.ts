/**
 * Test suite for BPM detector
 * Run with: node --loader tsx src/bpmDetector.test.ts
 */

import { detectBPM } from './bpmDetector'

function createClickTrack(bpm: number, durationSeconds: number = 10, sampleRate: number = 44100): AudioBuffer {
  const length = Math.floor(sampleRate * durationSeconds)
  const audioContext = new AudioContext({ sampleRate })
  const buffer = audioContext.createBuffer(2, length, sampleRate)
  
  const secondsPerBeat = 60 / bpm
  const samplesPerBeat = Math.floor(sampleRate * secondsPerBeat)
  
  for (let channel = 0; channel < 2; channel++) {
    const data = buffer.getChannelData(channel)
    
    for (let beat = 0; beat < Math.floor(durationSeconds / secondsPerBeat); beat++) {
      const beatStart = beat * samplesPerBeat
      const clickDuration = Math.floor(sampleRate * 0.01)
      
      for (let i = 0; i < clickDuration && beatStart + i < length; i++) {
        const t = i / sampleRate
        const envelope = Math.exp(-t * 100)
        data[beatStart + i] = Math.sin(2 * Math.PI * 1000 * t) * envelope * 0.5
      }
    }
  }
  
  return buffer
}

function createMusicLikeAudio(bpm: number, durationSeconds: number = 10, sampleRate: number = 44100): AudioBuffer {
  const length = Math.floor(sampleRate * durationSeconds)
  const audioContext = new AudioContext({ sampleRate })
  const buffer = audioContext.createBuffer(2, length, sampleRate)
  
  const secondsPerBeat = 60 / bpm
  const samplesPerBeat = Math.floor(sampleRate * secondsPerBeat)
  
  for (let channel = 0; channel < 2; channel++) {
    const data = buffer.getChannelData(channel)
    
    for (let beat = 0; beat < Math.floor(durationSeconds / secondsPerBeat); beat++) {
      const beatStart = beat * samplesPerBeat
      const kickDuration = Math.floor(sampleRate * 0.15)
      
      for (let i = 0; i < kickDuration && beatStart + i < length; i++) {
        const t = i / sampleRate
        const freq = 60 * (1 - t * 4)
        const envelope = Math.exp(-t * 15)
        data[beatStart + i] += Math.sin(2 * Math.PI * freq * t) * envelope * 0.6
      }
    }
    
    for (let i = 0; i < length; i++) {
      data[i] += (Math.random() - 0.5) * 0.02
    }
  }
  
  return buffer
}

async function runTests() {
  console.log('BPM Detector Test Suite\n')
  console.log('=' .repeat(50))
  
  const testCases = [
    { bpm: 120, name: 'Click track 120 BPM', generator: createClickTrack },
    { bpm: 90, name: 'Click track 90 BPM', generator: createClickTrack },
    { bpm: 140, name: 'Click track 140 BPM', generator: createClickTrack },
    { bpm: 120, name: 'Music-like 120 BPM', generator: createMusicLikeAudio },
    { bpm: 90, name: 'Music-like 90 BPM', generator: createMusicLikeAudio },
  ]
  
  for (const testCase of testCases) {
    const buffer = testCase.generator(testCase.bpm, 10)
    console.log(`\nTest: ${testCase.name}`)
    console.log(`Expected: ${testCase.bpm} BPM`)
    
    const result = await detectBPM(buffer)
    
    if (result.bpm) {
      const error = Math.abs(result.bpm - testCase.bpm)
      const errorPercent = (error / testCase.bpm) * 100
      console.log(`Detected: ${result.bpm} BPM`)
      console.log(`Error: ${error.toFixed(1)} BPM (${errorPercent.toFixed(1)}%)`)
      console.log(`Confidence: ${result.confidence}`)
      
      if (error <= 3) {
        console.log('✓ PASS')
      } else {
        console.log('✗ FAIL (error > 3 BPM)')
      }
    } else {
      console.log('Detected: NULL')
      console.log('✗ FAIL (no BPM detected)')
    }
  }
  
  console.log('\n' + '='.repeat(50))
}

if (typeof AudioContext === 'undefined') {
  (global as any).AudioContext = class {
    sampleRate: number
    constructor(options?: { sampleRate?: number }) {
      this.sampleRate = options?.sampleRate || 44100
    }
    createBuffer(channels: number, length: number, sampleRate: number) {
      return new AudioBuffer({ numberOfChannels: channels, length, sampleRate })
    }
  }
}

runTests().catch(console.error)
