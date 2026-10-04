import { detectBPM } from './bpmDetector'

class MockAudioBuffer {
  numberOfChannels: number
  length: number
  sampleRate: number
  private channels: Float32Array[]

  constructor(options: { numberOfChannels: number; length: number; sampleRate: number }) {
    this.numberOfChannels = options.numberOfChannels
    this.length = options.length
    this.sampleRate = options.sampleRate
    this.channels = []
    for (let i = 0; i < options.numberOfChannels; i++) {
      this.channels.push(new Float32Array(options.length))
    }
  }

  getChannelData(channel: number): Float32Array {
    return this.channels[channel]
  }

  copyToChannel(source: Float32Array, channelNumber: number): void {
    this.channels[channelNumber].set(source)
  }
}

global.AudioBuffer = MockAudioBuffer as any

function createClickTrack(bpm: number, durationSeconds: number, sampleRate: number): Float32Array[] {
  const length = Math.floor(sampleRate * durationSeconds)
  const left = new Float32Array(length)
  const right = new Float32Array(length)
  
  const secondsPerBeat = 60 / bpm
  const samplesPerBeat = Math.floor(sampleRate * secondsPerBeat)
  
  for (let beat = 0; beat < Math.floor(durationSeconds / secondsPerBeat); beat++) {
    const beatStart = beat * samplesPerBeat
    const clickDuration = Math.floor(sampleRate * 0.01)
    
    for (let i = 0; i < clickDuration && beatStart + i < length; i++) {
      const t = i / sampleRate
      const envelope = Math.exp(-t * 100)
      const sample = Math.sin(2 * Math.PI * 1000 * t) * envelope * 0.5
      left[beatStart + i] = sample
      right[beatStart + i] = sample
    }
  }
  
  return [left, right]
}

function createAudioBuffer(channels: Float32Array[], sampleRate: number): AudioBuffer {
  const length = channels[0].length
  const buffer = new AudioBuffer({
    numberOfChannels: channels.length,
    length,
    sampleRate
  }) as any
  
  for (let i = 0; i < channels.length; i++) {
    buffer.copyToChannel(channels[i], i)
  }
  
  return buffer
}

async function runTest() {
  const bpm = 120
  const sampleRate = 44100
  const duration = 10
  
  console.log(`Creating synthetic click track: ${bpm} BPM, ${duration}s, ${sampleRate}Hz`)
  
  const channels = createClickTrack(bpm, duration, sampleRate)
  const audioBuffer = createAudioBuffer(channels, sampleRate)
  
  console.log(`Testing detectBPM...`)
  const result = await detectBPM(audioBuffer)
  
  console.log(`Expected: ${bpm} BPM`)
  console.log(`Detected: ${result.bpm} BPM`)
  
  if (result.bpm) {
    const error = Math.abs(result.bpm - bpm)
    console.log(`Error: ${error} BPM`)
    
    if (error <= 5) {
      console.log('✓ Test PASSED')
      process.exit(0)
    } else {
      console.log('✗ Test FAILED (error > 5 BPM)')
      process.exit(1)
    }
  } else {
    console.log('✗ Test FAILED (no BPM detected)')
    process.exit(1)
  }
}

runTest().catch(err => {
  console.error('Test error:', err)
  process.exit(1)
})
