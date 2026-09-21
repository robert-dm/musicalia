/**
 * Browser-local stem separation using Spleeter ONNX magnitude spectrogram models
 * 
 * This implementation uses STFT-based source separation:
 * 1. Compute magnitude spectrogram via STFT
 * 2. Feed to Spleeter models (one per stem)
 * 3. Apply soft mask using all 4 estimates
 * 4. Reconstruct via inverse STFT
 * 
 * Models from Hugging Face Best-Practice/spleeter-4stems-onnx
 */

import * as ort from 'onnxruntime-web'
import FFT from 'fft.js'

export interface StemSeparationResult {
  vocals: AudioBuffer
  drums: AudioBuffer
  bass: AudioBuffer
  other: AudioBuffer
}

export interface StemSeparationProgress {
  progress: number
  stage: string
}

// Spleeter 4-stem ONNX models (fp16, ~20MB each)
// These models process magnitude spectrograms, not waveforms
const SPLEETER_BASE_URL = 'https://huggingface.co/Best-Practice/spleeter-4stems-onnx/resolve/main'
const SPLEETER_MODELS = {
  vocals: `${SPLEETER_BASE_URL}/vocals.fp16.onnx`,
  drums: `${SPLEETER_BASE_URL}/drums.fp16.onnx`,
  bass: `${SPLEETER_BASE_URL}/bass.fp16.onnx`,
  other: `${SPLEETER_BASE_URL}/other.fp16.onnx`,
}

// STFT parameters (from model specification)
const N_FFT = 4096
const HOP_LENGTH = 1024
const N_BINS = 1024  // Use first 1024 of 2049 bins
const FRAMES_PER_SPLIT = 512
const CHUNK_DURATION = 60 // Process in 60-second chunks to manage memory
const CHUNK_OVERLAP = 2   // 2-second overlap between chunks for continuity

/**
 * Initialize ONNX Runtime Web
 */
async function initializeRuntime(): Promise<void> {
  ort.env.wasm.wasmPaths = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.30.0/dist/'
  ort.env.wasm.numThreads = 1
  ort.env.wasm.simd = true
  console.log('ONNX Runtime configured for Spleeter STFT models')
}

/**
 * Create periodic Hann window (N_FFT+1)[:-1]
 */
function createPeriodicHannWindow(size: number): Float32Array {
  const window = new Float32Array(size)
  for (let i = 0; i < size; i++) {
    window[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / size))
  }
  return window
}

/**
 * Compute STFT with front padding
 * Returns complex STFT: { real: Float32Array, imag: Float32Array, frames: number }
 */
function computeSTFT(
  audio: Float32Array,
  onProgress?: (progress: StemSeparationProgress) => void
): { real: Float32Array[][], imag: Float32Array[][], frames: number } {
  
  onProgress?.({ progress: 15, stage: 'Calculando STFT...' })
  
  const frontPad = N_FFT - HOP_LENGTH
  const paddedLength = audio.length + frontPad
  const numFrames = Math.floor((paddedLength - N_FFT) / HOP_LENGTH) + 1
  
  // Create periodic Hann window
  const window = createPeriodicHannWindow(N_FFT)
  
  // Initialize FFT
  const fft = new FFT(N_FFT)
  
  // Allocate output [channels=1, frames, bins=N_FFT/2+1]
  const realSTFT: Float32Array[][] = [[]]
  const imagSTFT: Float32Array[][] = [[]]
  
  for (let frame = 0; frame < numFrames; frame++) {
    const start = frame * HOP_LENGTH - frontPad
    const windowed = new Float32Array(N_FFT)
    
    // Extract and window frame
    for (let i = 0; i < N_FFT; i++) {
      const sampleIdx = start + i
      const sample = (sampleIdx >= 0 && sampleIdx < audio.length) ? audio[sampleIdx] : 0
      windowed[i] = sample * window[i]
    }
    
    // Compute FFT
    const complexOut = fft.createComplexArray()
    fft.realTransform(complexOut, windowed)
    
    // Extract first N_FFT/2 + 1 bins (2049 bins)
    const numBins = N_FFT / 2 + 1
    const realFrame = new Float32Array(numBins)
    const imagFrame = new Float32Array(numBins)
    
    for (let bin = 0; bin < numBins; bin++) {
      realFrame[bin] = complexOut[bin * 2]
      imagFrame[bin] = complexOut[bin * 2 + 1]
    }
    
    realSTFT[0].push(realFrame)
    imagSTFT[0].push(imagFrame)
  }
  
  return { real: realSTFT, imag: imagSTFT, frames: numFrames }
}

/**
 * Compute magnitude from complex STFT and extract first 1024 bins
 */
function extractMagnitude(
  real: Float32Array[][],
  imag: Float32Array[][]
): Float32Array[][] {
  
  const magnitude: Float32Array[][] = []
  
  for (let ch = 0; ch < real.length; ch++) {
    magnitude[ch] = []
    for (let frame = 0; frame < real[ch].length; frame++) {
      const magFrame = new Float32Array(N_BINS)
      for (let bin = 0; bin < N_BINS; bin++) {
        const re = real[ch][frame][bin]
        const im = imag[ch][frame][bin]
        magFrame[bin] = Math.sqrt(re * re + im * im)
      }
      magnitude[ch].push(magFrame)
    }
  }
  
  return magnitude
}

/**
 * Split magnitude into 512-frame chunks and create model input
 */
function createModelInput(magnitude: Float32Array[][]): ort.Tensor {
  const channels = magnitude.length
  const totalFrames = magnitude[0].length
  const numSplits = Math.ceil(totalFrames / FRAMES_PER_SPLIT)
  
  // Shape: [channels, num_splits, frames=512, bins=1024]
  const tensorData = new Float32Array(channels * numSplits * FRAMES_PER_SPLIT * N_BINS)
  
  for (let ch = 0; ch < channels; ch++) {
    for (let split = 0; split < numSplits; split++) {
      for (let frame = 0; frame < FRAMES_PER_SPLIT; frame++) {
        const globalFrame = split * FRAMES_PER_SPLIT + frame
        const frameData = globalFrame < totalFrames ? magnitude[ch][globalFrame] : new Float32Array(N_BINS)
        
        const baseIdx = ch * (numSplits * FRAMES_PER_SPLIT * N_BINS) +
                       split * (FRAMES_PER_SPLIT * N_BINS) +
                       frame * N_BINS
        
        for (let bin = 0; bin < N_BINS; bin++) {
          tensorData[baseIdx + bin] = frameData[bin]
        }
      }
    }
  }
  
  return new ort.Tensor('float32', tensorData, [channels, numSplits, FRAMES_PER_SPLIT, N_BINS])
}

/**
 * Run model for single stem and return magnitude estimate
 */
async function processSingleStem(
  stemName: 'vocals' | 'drums' | 'bass' | 'other',
  inputTensor: ort.Tensor,
  onProgress?: (progress: StemSeparationProgress) => void
): Promise<Float32Array> {
  
  const modelUrl = SPLEETER_MODELS[stemName]
  
  try {
    console.log(`Loading ${stemName} model...`)
    onProgress?.({ progress: 0, stage: `Cargando ${stemName}...` })
    
    const session = await ort.InferenceSession.create(modelUrl, {
      executionProviders: ['wasm'],
      graphOptimizationLevel: 'all',
      enableCpuMemArena: true,
      enableMemPattern: true,
    })
    
    console.log(`Running inference for ${stemName}...`)
    const feeds = { x: inputTensor }
    const results = await session.run(feeds)
    
    const output = results[session.outputNames[0]]
    if (!output) {
      throw new Error(`No output from ${stemName} model`)
    }
    
    console.log(`${stemName} complete, disposing...`)
    session.release()
    
    return output.data as Float32Array
    
  } catch (error) {
    console.error(`Failed to process ${stemName}:`, error)
    const errorMsg = error instanceof Error ? error.message : String(error)
    
    if (errorMsg.includes('bad_alloc') || errorMsg.includes('memory')) {
      throw new Error(`Memoria insuficiente para ${stemName}. Intenta cerrar otras pestañas.`)
    }
    
    throw new Error(`Error al procesar ${stemName}: ${errorMsg}`)
  }
}

/**
 * Apply soft mask and reconstruct stems via inverse STFT
 */
async function applyMaskAndReconstruct(
  originalReal: Float32Array[][],
  originalImag: Float32Array[][],
  estimates: { vocals: Float32Array, drums: Float32Array, bass: Float32Array, other: Float32Array },
  shape: number[],
  sampleRate: number,
  onProgress?: (progress: StemSeparationProgress) => void
): Promise<StemSeparationResult> {
  
  onProgress?.({ progress: 85, stage: 'Aplicando máscara y reconstruyendo...' })
  
  const [channels, numSplits, framesPerSplit, bins] = shape
  const totalFrames = originalReal[0].length
  
  // Extend estimates from 1024 to 2049 bins (average method)
  const extendBins = (estimate: Float32Array): Float32Array[][] => {
    const extended: Float32Array[][] = []
    const fullBins = N_FFT / 2 + 1  // 2049
    
    for (let ch = 0; ch < channels; ch++) {
      extended[ch] = []
      for (let frame = 0; frame < totalFrames; frame++) {
        const extFrame = new Float32Array(fullBins)
        const splitIdx = Math.floor(frame / framesPerSplit)
        const frameInSplit = frame % framesPerSplit
        
        // Copy first 1024 bins
        for (let bin = 0; bin < N_BINS; bin++) {
          const idx = ch * (numSplits * framesPerSplit * bins) +
                     splitIdx * (framesPerSplit * bins) +
                     frameInSplit * bins + bin
          extFrame[bin] = estimate[idx]
        }
        
        // Extend remaining bins with average
        const avg = extFrame.slice(0, N_BINS).reduce((a, b) => a + b, 0) / N_BINS
        for (let bin = N_BINS; bin < fullBins; bin++) {
          extFrame[bin] = avg
        }
        
        extended[ch].push(extFrame)
      }
    }
    return extended
  }
  
  const vocalsExt = extendBins(estimates.vocals)
  const drumsExt = extendBins(estimates.drums)
  const bassExt = extendBins(estimates.bass)
  const otherExt = extendBins(estimates.other)
  
  // Compute soft mask for each stem
  const computeMask = (estimate: Float32Array[][]): Float32Array[][] => {
    const mask: Float32Array[][] = []
    const eps = 1e-10
    
    for (let ch = 0; ch < channels; ch++) {
      mask[ch] = []
      for (let frame = 0; frame < totalFrames; frame++) {
        const maskFrame = new Float32Array(N_FFT / 2 + 1)
        
        for (let bin = 0; bin < maskFrame.length; bin++) {
          const v2 = vocalsExt[ch][frame][bin] ** 2
          const d2 = drumsExt[ch][frame][bin] ** 2
          const b2 = bassExt[ch][frame][bin] ** 2
          const o2 = otherExt[ch][frame][bin] ** 2
          const total = v2 + d2 + b2 + o2 + eps
          
          const currentEst2 = estimate[ch][frame][bin] ** 2
          maskFrame[bin] = (currentEst2 + eps / 4) / total
        }
        
        mask[ch].push(maskFrame)
      }
    }
    return mask
  }
  
  const vocalsMask = computeMask(vocalsExt)
  const drumsMask = computeMask(drumsExt)
  const bassMask = computeMask(bassExt)
  const otherMask = computeMask(otherExt)
  
  // Apply masks and reconstruct
  const reconstructStem = (mask: Float32Array[][]): AudioBuffer => {
    const fft = new FFT(N_FFT)
    const window = createPeriodicHannWindow(N_FFT)
    const frontPad = N_FFT - HOP_LENGTH
    const outputLength = (totalFrames - 1) * HOP_LENGTH + N_FFT - frontPad
    const output = new Float32Array(outputLength)
    const normalization = new Float32Array(outputLength)
    
    // Process channel 0 only (convert to mono later if needed)
    for (let frame = 0; frame < totalFrames; frame++) {
      // Apply mask to complex STFT
      const maskedReal = new Float32Array(N_FFT / 2 + 1)
      const maskedImag = new Float32Array(N_FFT / 2 + 1)
      
      for (let bin = 0; bin < maskedReal.length; bin++) {
        maskedReal[bin] = originalReal[0][frame][bin] * mask[0][frame][bin]
        maskedImag[bin] = originalImag[0][frame][bin] * mask[0][frame][bin]
      }
      
      // Prepare complex array for inverse FFT (symmetry)
      const complexIn = new Float32Array(N_FFT * 2)
      for (let bin = 0; bin < N_FFT / 2 + 1; bin++) {
        complexIn[bin * 2] = maskedReal[bin]
        complexIn[bin * 2 + 1] = maskedImag[bin]
      }
      // Mirror for negative frequencies (conjugate symmetry)
      for (let bin = 1; bin < N_FFT / 2; bin++) {
        complexIn[(N_FFT - bin) * 2] = maskedReal[bin]
        complexIn[(N_FFT - bin) * 2 + 1] = -maskedImag[bin]
      }
      
      // Inverse FFT
      const timeData = new Float32Array(N_FFT)
      fft.inverseTransform(timeData, complexIn)
      
      // Overlap-add with windowing
      const start = frame * HOP_LENGTH - frontPad
      for (let i = 0; i < N_FFT; i++) {
        const idx = start + i
        if (idx >= 0 && idx < outputLength) {
          output[idx] += timeData[i] * window[i]
          normalization[idx] += window[i] * window[i]
        }
      }
    }
    
    // Normalize
    for (let i = 0; i < output.length; i++) {
      if (normalization[i] > 1e-8) {
        output[i] /= normalization[i]
      }
    }
    
    // Create stereo AudioBuffer
    const context = new AudioContext({ sampleRate })
    const buffer = context.createBuffer(2, output.length, sampleRate)
    buffer.getChannelData(0).set(output)
    buffer.getChannelData(1).set(output)
    context.close()
    
    return buffer
  }
  
  const vocals = reconstructStem(vocalsMask)
  const drums = reconstructStem(drumsMask)
  const bass = reconstructStem(bassMask)
  const other = reconstructStem(otherMask)
  
  return { vocals, drums, bass, other }
}

/**
 * Process a single audio chunk through the full pipeline
 */
async function processChunk(
  audioChunk: Float32Array,
  sampleRate: number,
  chunkIndex: number,
  totalChunks: number,
  onProgress?: (progress: StemSeparationProgress) => void
): Promise<StemSeparationResult> {
  
  const chunkLabel = totalChunks > 1 ? ` (parte ${chunkIndex + 1}/${totalChunks})` : ''
  
  // Compute STFT
  onProgress?.({ progress: 0, stage: `Calculando STFT${chunkLabel}...` })
  const { real, imag } = computeSTFT(audioChunk, onProgress)
  
  // Convert to stereo for model (duplicate mono)
  const stereoReal = [real[0], real[0]]
  const stereoImag = [imag[0], imag[0]]
  
  // Extract magnitude and create input
  const magnitude = extractMagnitude(stereoReal, stereoImag)
  const inputTensor = createModelInput(magnitude)
  
  // Process all 4 stems sequentially
  onProgress?.({ progress: 0, stage: `Procesando vocals${chunkLabel}...` })
  const vocalsEst = await processSingleStem('vocals', inputTensor, onProgress)
  
  onProgress?.({ progress: 0, stage: `Procesando drums${chunkLabel}...` })
  const drumsEst = await processSingleStem('drums', inputTensor, onProgress)
  
  onProgress?.({ progress: 0, stage: `Procesando bass${chunkLabel}...` })
  const bassEst = await processSingleStem('bass', inputTensor, onProgress)
  
  onProgress?.({ progress: 0, stage: `Procesando other${chunkLabel}...` })
  const otherEst = await processSingleStem('other', inputTensor, onProgress)
  
  // Apply masks and reconstruct
  const estimates = {
    vocals: vocalsEst,
    drums: drumsEst,
    bass: bassEst,
    other: otherEst
  }
  
  return await applyMaskAndReconstruct(
    stereoReal,
    stereoImag,
    estimates,
    inputTensor.dims as number[],
    sampleRate,
    onProgress
  )
}

/**
 * Stitch overlapping audio buffers together
 */
function stitchChunks(
  chunks: AudioBuffer[],
  overlapSamples: number,
  totalSamples: number,
  sampleRate: number
): AudioBuffer {
  
  const context = new AudioContext({ sampleRate })
  const output = context.createBuffer(2, totalSamples, sampleRate)
  
  let position = 0
  
  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i]
    const chunkLength = chunk.length
    
    // Determine how much to copy from this chunk
    const startSample = i === 0 ? 0 : overlapSamples / 2
    const endSample = i === chunks.length - 1 ? chunkLength : chunkLength - overlapSamples / 2
    const copyLength = endSample - startSample
    
    // Copy with crossfade in overlap regions
    for (let ch = 0; ch < 2; ch++) {
      const chunkData = chunk.getChannelData(ch)
      const outputData = output.getChannelData(ch)
      
      for (let j = 0; j < copyLength; j++) {
        const sourceIdx = startSample + j
        const destIdx = position + j
        
        if (destIdx < totalSamples) {
          // Simple copy (crossfade could be added here if needed)
          outputData[destIdx] = chunkData[sourceIdx]
        }
      }
    }
    
    position += copyLength
  }
  
  context.close()
  return output
}

/**
 * Main stem separation function with chunking support
 */
export async function separateStems(
  audioBuffer: AudioBuffer,
  onProgress?: (progress: StemSeparationProgress) => void
): Promise<StemSeparationResult> {
  
  try {
    await initializeRuntime()
    
    onProgress?.({ progress: 5, stage: 'Inicializando...' })
    
    const duration = audioBuffer.length / audioBuffer.sampleRate
    const sampleRate = audioBuffer.sampleRate
    
    // Convert to mono
    const mono = new Float32Array(audioBuffer.length)
    const left = audioBuffer.getChannelData(0)
    const right = audioBuffer.numberOfChannels > 1 ? audioBuffer.getChannelData(1) : left
    for (let i = 0; i < mono.length; i++) {
      mono[i] = (left[i] + right[i]) / 2
    }
    
    // Determine chunking strategy
    const chunkSamples = Math.floor(CHUNK_DURATION * sampleRate)
    const overlapSamples = Math.floor(CHUNK_OVERLAP * sampleRate)
    const stride = chunkSamples - overlapSamples
    
    // Check if we need chunking (process chunks if > 90 seconds to stay safe)
    const needsChunking = duration > 90
    
    if (!needsChunking) {
      // Process entire audio at once
      onProgress?.({ progress: 10, stage: 'Procesando audio...' })
      
      const { real, imag } = computeSTFT(mono, onProgress)
      
      onProgress?.({ progress: 20, stage: 'Extrayendo magnitudes...' })
      
      const stereoReal = [real[0], real[0]]
      const stereoImag = [imag[0], imag[0]]
      
      const magnitude = extractMagnitude(stereoReal, stereoImag)
      const inputTensor = createModelInput(magnitude)
      
      console.log('Input tensor shape:', inputTensor.dims)
      
      onProgress?.({ progress: 30, stage: 'Procesando vocals...' })
      const vocalsEst = await processSingleStem('vocals', inputTensor, onProgress)
      
      onProgress?.({ progress: 45, stage: 'Procesando drums...' })
      const drumsEst = await processSingleStem('drums', inputTensor, onProgress)
      
      onProgress?.({ progress: 60, stage: 'Procesando bass...' })
      const bassEst = await processSingleStem('bass', inputTensor, onProgress)
      
      onProgress?.({ progress: 75, stage: 'Procesando other...' })
      const otherEst = await processSingleStem('other', inputTensor, onProgress)
      
      const estimates = {
        vocals: vocalsEst,
        drums: drumsEst,
        bass: bassEst,
        other: otherEst
      }
      
      const result = await applyMaskAndReconstruct(
        stereoReal,
        stereoImag,
        estimates,
        inputTensor.dims as number[],
        sampleRate,
        onProgress
      )
      
      onProgress?.({ progress: 100, stage: 'Completado' })
      return result
    }
    
    // Chunked processing for long audio
    console.log(`Processing ${duration.toFixed(1)}s audio in chunks...`)
    
    const numChunks = Math.ceil((mono.length - overlapSamples) / stride)
    const stemChunks: { vocals: AudioBuffer[], drums: AudioBuffer[], bass: AudioBuffer[], other: AudioBuffer[] } = {
      vocals: [],
      drums: [],
      bass: [],
      other: []
    }
    
    for (let chunkIdx = 0; chunkIdx < numChunks; chunkIdx++) {
      const startSample = chunkIdx * stride
      const endSample = Math.min(startSample + chunkSamples, mono.length)
      
      // Extract chunk
      const audioChunk = mono.slice(startSample, endSample)
      
      // Update progress
      const chunkProgress = Math.floor(10 + (chunkIdx / numChunks) * 85)
      onProgress?.({ progress: chunkProgress, stage: `Procesando parte ${chunkIdx + 1}/${numChunks}...` })
      
      // Process chunk
      const chunkResult = await processChunk(audioChunk, sampleRate, chunkIdx, numChunks, onProgress)
      
      stemChunks.vocals.push(chunkResult.vocals)
      stemChunks.drums.push(chunkResult.drums)
      stemChunks.bass.push(chunkResult.bass)
      stemChunks.other.push(chunkResult.other)
    }
    
    // Stitch chunks together
    onProgress?.({ progress: 95, stage: 'Uniendo partes...' })
    
    const vocals = stitchChunks(stemChunks.vocals, overlapSamples, mono.length, sampleRate)
    const drums = stitchChunks(stemChunks.drums, overlapSamples, mono.length, sampleRate)
    const bass = stitchChunks(stemChunks.bass, overlapSamples, mono.length, sampleRate)
    const other = stitchChunks(stemChunks.other, overlapSamples, mono.length, sampleRate)
    
    onProgress?.({ progress: 100, stage: 'Completado' })
    
    return { vocals, drums, bass, other }
    
  } catch (error) {
    console.error('Stem separation failed:', error)
    throw error
  }
}

/**
 * Check browser support
 */
export function isStemSeparationSupported(): { supported: boolean, reason?: string } {
  if (typeof WebAssembly === 'undefined') {
    return { supported: false, reason: 'WebAssembly no está disponible' }
  }
  return { supported: true }
}
