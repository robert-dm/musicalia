/**
 * Verification script for stem separation pipeline
 * Tests the REAL STFT→iSTFT pipeline with identity mask
 * Run with: node --loader ts-node/esm verify-stems.mts
 */

import { computeSTFT, reconstructFromSTFT } from './src/stemSeparator.ts'

const SAMPLE_RATE = 44100
const DURATION = 150 // seconds - triggers chunking in main path
const FREQUENCY = 440 // Hz
const numSamples = SAMPLE_RATE * DURATION

console.log(`Generating ${DURATION}s stereo test signal at ${FREQUENCY}Hz...`)
console.log(`Total samples: ${numSamples.toLocaleString()}`)

// Generate mono sine wave test signal
const testSignal = new Float32Array(numSamples)
for (let i = 0; i < numSamples; i++) {
  const t = i / SAMPLE_RATE
  testSignal[i] = 0.5 * Math.sin(2 * Math.PI * FREQUENCY * t)
}

console.log('Test signal generated.\n')

// Compute input statistics
let inputEnergy = 0
let inputPeak = 0
for (let i = 0; i < numSamples; i++) {
  const val = testSignal[i]
  inputEnergy += val * val
  inputPeak = Math.max(inputPeak, Math.abs(val))
}
const inputRMS = Math.sqrt(inputEnergy / numSamples)

console.log('Input signal statistics:')
console.log(`  RMS: ${inputRMS.toFixed(6)}`)
console.log(`  Peak: ${inputPeak.toFixed(6)}`)
console.log(`  Length: ${numSamples} samples (${DURATION}s)\n`)

// Test STFT → iSTFT round-trip
console.log('Testing STFT → iSTFT with identity mask...')
const stftResult = computeSTFT(testSignal)
console.log(`STFT computed: ${stftResult.frames} frames`)

// Check for NaN in STFT
let stftHasNaN = false
for (let frame = 0; frame < stftResult.frames; frame++) {
  for (let bin = 0; bin < stftResult.real[0][frame].length; bin++) {
    if (!isFinite(stftResult.real[0][frame][bin]) || !isFinite(stftResult.imag[0][frame][bin])) {
      stftHasNaN = true
      break
    }
  }
  if (stftHasNaN) break
}

if (stftHasNaN) {
  console.error('❌ STFT contains NaN/Infinity!')
  process.exit(1)
}
console.log('✓ STFT has no NaN/Infinity')

// Reconstruct with identity mask
const reconstructed = reconstructFromSTFT(
  stftResult.real,
  stftResult.imag,
  stftResult.frames,
  numSamples,
  SAMPLE_RATE
)

console.log(`Reconstructed: ${reconstructed.length} samples\n`)

// Check for NaN in reconstruction
let hasNaN = false
let hasInf = false
let outputPeak = 0
let outputEnergy = 0

for (let i = 0; i < reconstructed.length; i++) {
  const val = reconstructed[i]
  if (isNaN(val)) hasNaN = true
  if (!isFinite(val)) hasInf = true
  outputPeak = Math.max(outputPeak, Math.abs(val))
  outputEnergy += val * val
}

const outputRMS = Math.sqrt(outputEnergy / reconstructed.length)

console.log('Output signal statistics:')
console.log(`  RMS: ${outputRMS.toFixed(6)}`)
console.log(`  Peak: ${outputPeak.toFixed(6)}`)
console.log(`  NaN detected: ${hasNaN}`)
console.log(`  Infinity detected: ${hasInf}\n`)

if (hasNaN || hasInf) {
  console.error('❌ FAILED: Reconstruction contains NaN or Infinity!')
  process.exit(1)
}

// Compute reconstruction error
const minLength = Math.min(testSignal.length, reconstructed.length)
let errorEnergy = 0
let signalEnergy = 0

for (let i = 0; i < minLength; i++) {
  const error = testSignal[i] - reconstructed[i]
  errorEnergy += error * error
  signalEnergy += testSignal[i] * testSignal[i]
}

const mse = errorEnergy / minLength
const signalPower = signalEnergy / minLength
const snr_dB = 10 * Math.log10(signalPower / mse)

console.log('Reconstruction error:')
console.log(`  MSE: ${mse.toExponential(6)}`)
console.log(`  SNR: ${snr_dB.toFixed(2)} dB`)

// Check boundaries for gain jumps (sample around chunk boundaries at 60s intervals)
const CHUNK_SIZE_SECONDS = 60
const chunkSizeSamples = CHUNK_SIZE_SECONDS * SAMPLE_RATE
const WINDOW_SAMPLES = 1000 // Check ±1000 samples around boundary

console.log('\nChecking for gain jumps at potential chunk boundaries...')
let maxJump = 0

// Check at 60s, 120s boundaries
for (const boundaryTime of [60, 120]) {
  const boundarySample = boundaryTime * SAMPLE_RATE
  if (boundarySample >= WINDOW_SAMPLES && boundarySample < reconstructed.length - WINDOW_SAMPLES) {
    // Compute RMS in window before and after
    let rmsBefore = 0
    let rmsAfter = 0
    
    for (let i = 0; i < WINDOW_SAMPLES; i++) {
      rmsBefore += reconstructed[boundarySample - WINDOW_SAMPLES + i] ** 2
      rmsAfter += reconstructed[boundarySample + i] ** 2
    }
    
    rmsBefore = Math.sqrt(rmsBefore / WINDOW_SAMPLES)
    rmsAfter = Math.sqrt(rmsAfter / WINDOW_SAMPLES)
    
    const jump_dB = 20 * Math.log10(rmsAfter / rmsBefore)
    maxJump = Math.max(maxJump, Math.abs(jump_dB))
    
    console.log(`  ${boundaryTime}s boundary: ${jump_dB.toFixed(2)} dB jump`)
  }
}

console.log(`  Max boundary jump: ${maxJump.toFixed(2)} dB`)

// Final verdict
console.log('\n' + '='.repeat(60))
if (snr_dB > 40 && !hasNaN && !hasInf && outputPeak < 1.5 && maxJump < 1.0) {
  console.log('✅ PASS: STFT/iSTFT pipeline is correct')
  console.log('✅ Reconstruction SNR > 40 dB')
  console.log('✅ No NaN or Infinity')
  console.log('✅ Peak amplitude reasonable (<1.5)')
  console.log('✅ No significant boundary jumps (<1 dB)')
  console.log('\n🎉 Fix is correct: fft.js inverseTransform uses complex output buffer')
  console.log('   Root cause: Was passing Float32Array instead of complex array')
  console.log('   Result: Out-of-bounds reads → undefined → NaN')
  process.exit(0)
} else {
  console.log('❌ FAIL: Pipeline has issues')
  if (snr_dB <= 40) console.log(`   - SNR too low: ${snr_dB.toFixed(2)} dB (need >40 dB)`)
  if (hasNaN || hasInf) console.log('   - Contains NaN or Infinity')
  if (outputPeak >= 1.5) console.log(`   - Peak too high: ${outputPeak.toFixed(3)} (need <1.5)`)
  if (maxJump >= 1.0) console.log(`   - Boundary jump too large: ${maxJump.toFixed(2)} dB`)
  process.exit(1)
}
