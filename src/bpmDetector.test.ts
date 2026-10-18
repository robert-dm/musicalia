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

  for (let beat = 0; beat < Math.floor(durationSeconds / secondsPerBeat); beat++) {
    const beatStart = Math.round(beat * sampleRate * secondsPerBeat)
    const clickDuration = Math.floor(sampleRate * 0.012)
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

async function expectBpm(expected: number, duration = 12) {
  const sampleRate = 44100
  console.log(`\nCreating synthetic click track: ${expected} BPM, ${duration}s, ${sampleRate}Hz`)
  const channels = createClickTrack(expected, duration, sampleRate)
  const audioBuffer = createAudioBuffer(channels, sampleRate)
  const result = await detectBPM(audioBuffer)
  console.log(`Expected: ${expected} BPM`)
  console.log(`Detected: ${result.bpm} BPM (confidence ${result.confidence.toFixed(3)})`)
  if (result.candidates?.length) {
    console.log('Candidates:', result.candidates.slice(0, 6).map((c) => `${c.bpm}@${c.strength.toFixed(3)}`).join(', '))
  }
  if (result.bpm == null) {
    throw new Error(`no BPM detected for ${expected}`)
  }
  const error = Math.abs(result.bpm - expected)
  console.log(`Error: ${error} BPM`)
  if (error > 0.2) {
    throw new Error(`detector off by ${error} BPM for ${expected} (got ${result.bpm})`)
  }
  return result.bpm
}

async function runTest() {
  const at120 = await expectBpm(120, 10)
  const at152 = await expectBpm(152, 12)
  const at76 = await expectBpm(76, 12)
  console.log('\n--- synthetic report ---')
  console.log(`152 BPM click → ${at152}`)
  console.log(`76 BPM click → ${at76}`)
  console.log(`120 BPM click → ${at120}`)
  console.log('✓ BPM detector tests PASSED')
}

runTest().catch((err) => {
  console.error('Test error:', err)
  process.exit(1)
})
