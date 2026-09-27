/**
 * Validation script for stem separation amplitude
 * Tests that stems have reasonable amplitude relative to input
 * Run with: npx tsx verify-stem-amplitude.mts
 */

import { separateStems } from './src/stemSeparator.js'

const SAMPLE_RATE = 44100
const DURATION = 10 // 10 seconds for quick test
const FREQUENCY = 440
const numSamples = SAMPLE_RATE * DURATION

console.log(`Generating ${DURATION}s test signal at ${FREQUENCY}Hz...`)

// Generate test AudioBuffer (simulate browser environment)
class MockAudioBuffer {
  numberOfChannels = 2
  length: number
  sampleRate: number
  private channels: Float32Array[]

  constructor(options: { numberOfChannels: number, length: number, sampleRate: number }) {
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

  copyFromChannel(destination: Float32Array, channelNumber: number) {
    destination.set(this.channels[channelNumber])
  }

  copyToChannel(source: Float32Array, channelNumber: number) {
    this.channels[channelNumber].set(source)
  }
}

// Mock AudioContext
global.AudioContext = class MockAudioContext {
  sampleRate = SAMPLE_RATE
  state = 'running'
  
  createBuffer(channels: number, length: number, sampleRate: number) {
    return new MockAudioBuffer({ numberOfChannels: channels, length, sampleRate })
  }
  
  close() {}
} as any

const inputBuffer = new MockAudioBuffer({
  numberOfChannels: 2,
  length: numSamples,
  sampleRate: SAMPLE_RATE
}) as any

// Fill with test signal
const leftData = inputBuffer.getChannelData(0)
const rightData = inputBuffer.getChannelData(1)
for (let i = 0; i < numSamples; i++) {
  const t = i / SAMPLE_RATE
  const val = 0.5 * Math.sin(2 * Math.PI * FREQUENCY * t)
  leftData[i] = val
  rightData[i] = val
}

// Compute input statistics
let inputPeak = 0
let inputRMS = 0
for (let i = 0; i < numSamples; i++) {
  const val = leftData[i]
  inputPeak = Math.max(inputPeak, Math.abs(val))
  inputRMS += val * val
}
inputRMS = Math.sqrt(inputRMS / numSamples)

console.log(`Input signal: peak=${inputPeak.toFixed(4)}, rms=${inputRMS.toFixed(4)}`)
console.log('\nRunning stem separation...')

const stems = await separateStems(inputBuffer as any)

console.log('\nStem amplitude analysis:')

const stemNames = ['vocals', 'drums', 'bass', 'other'] as const
const stemBuffers = [stems.vocals, stems.drums, stems.bass, stems.other]

let allPassed = true

for (let i = 0; i < stemBuffers.length; i++) {
  const buffer = stemBuffers[i]
  const data = buffer.getChannelData(0)
  
  let stemPeak = 0
  let stemRMS = 0
  
  for (let j = 0; j < data.length; j++) {
    stemPeak = Math.max(stemPeak, Math.abs(data[j]))
    stemRMS += data[j] * data[j]
  }
  stemRMS = Math.sqrt(stemRMS / data.length)
  
  const peakRatio_dB = 20 * Math.log10(stemPeak / inputPeak)
  const rmsRatio_dB = 20 * Math.log10(stemRMS / inputRMS)
  
  console.log(`  ${stemNames[i].padEnd(6)}: peak=${stemPeak.toFixed(4)} (${peakRatio_dB.toFixed(1)} dB), rms=${stemRMS.toFixed(4)} (${rmsRatio_dB.toFixed(1)} dB)`)
  
  // Check: stem peak should be within 20 dB of input peak
  if (peakRatio_dB < -20) {
    console.error(`    ❌ FAIL: Peak too low (${peakRatio_dB.toFixed(1)} dB, need > -20 dB)`)
    allPassed = false
  }
}

// Check sum of stems
console.log('\nReconstruction check (sum of stems):')
const sumData = new Float32Array(numSamples)
for (const buffer of stemBuffers) {
  const data = buffer.getChannelData(0)
  for (let i = 0; i < Math.min(numSamples, data.length); i++) {
    sumData[i] += data[i]
  }
}

let sumRMS = 0
for (let i = 0; i < numSamples; i++) {
  sumRMS += sumData[i] * sumData[i]
}
sumRMS = Math.sqrt(sumRMS / numSamples)

const reconstructionError_dB = 20 * Math.log10(sumRMS / inputRMS)
console.log(`  Sum RMS: ${sumRMS.toFixed(4)} (${reconstructionError_dB.toFixed(1)} dB vs input)`)

if (Math.abs(reconstructionError_dB) > 3) {
  console.error(`  ❌ FAIL: Reconstruction error too large (${reconstructionError_dB.toFixed(1)} dB, need within ±3 dB)`)
  allPassed = false
}

console.log('\n' + '='.repeat(60))
if (allPassed) {
  console.log('✅ PASS: All stems have reasonable amplitude')
  console.log('✅ Each stem peak within 20 dB of input')
  console.log('✅ Sum of stems within 3 dB of input')
  process.exit(0)
} else {
  console.log('❌ FAIL: Amplitude validation failed')
  process.exit(1)
}
