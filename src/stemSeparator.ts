/**
 * Browser-local stem separation using Spleeter ONNX models
 * 
 * This implementation uses actual ML-based source separation to produce distinct stems.
 * Uses smaller Spleeter fp16 models (~20MB each) loaded sequentially to fit in WASM memory.
 * Models are from Hugging Face Best-Practice/spleeter-4stems-onnx
 */

import * as ort from 'onnxruntime-web'

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
// Source: https://huggingface.co/Best-Practice/spleeter-4stems-onnx
// Each model processes the mix and outputs one stem
const SPLEETER_BASE_URL = 'https://huggingface.co/Best-Practice/spleeter-4stems-onnx/resolve/main'
const SPLEETER_MODELS = {
  vocals: `${SPLEETER_BASE_URL}/vocals.fp16.onnx`,
  drums: `${SPLEETER_BASE_URL}/drums.fp16.onnx`,
  bass: `${SPLEETER_BASE_URL}/bass.fp16.onnx`,
  other: `${SPLEETER_BASE_URL}/other.fp16.onnx`,
}

const SAMPLE_RATE = 44100
const MAX_CHUNK_SIZE = 44100 * 60 // 60 seconds per chunk to manage memory

/**
 * Initialize ONNX Runtime Web with appropriate backend
 */
async function initializeRuntime(): Promise<void> {
  // Configure WASM backend using CDN (most reliable for production)
  // The CDN is maintained by Microsoft and includes all necessary files (.wasm, .mjs, etc.)
  ort.env.wasm.wasmPaths = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.30.0/dist/'
  
  // Start with single thread for maximum compatibility
  // Threading may not work in all environments (requires COOP/COEP headers)
  ort.env.wasm.numThreads = 1
  ort.env.wasm.simd = true
  
  console.log('ONNX Runtime configured with CDN WASM backend for Spleeter')
}

/**
 * Load and run a single Spleeter model for one stem
 * Models are loaded one at a time and disposed immediately to minimize memory
 */
async function processSingleStem(
  stemName: 'vocals' | 'drums' | 'bass' | 'other',
  audioTensor: ort.Tensor,
  onProgress?: (progress: StemSeparationProgress) => void
): Promise<Float32Array> {
  const modelUrl = SPLEETER_MODELS[stemName]
  
  try {
    // Load model for this stem only
    console.log(`Loading ${stemName} model (~20MB)...`)
    onProgress?.({ 
      progress: 0, 
      stage: `Cargando modelo ${stemName}...` 
    })
    
    const session = await ort.InferenceSession.create(modelUrl, {
      executionProviders: ['wasm'],
      graphOptimizationLevel: 'all',
      enableCpuMemArena: true,
      enableMemPattern: true,
    })
    
    console.log(`${stemName} model loaded, running inference...`)
    onProgress?.({ 
      progress: 0, 
      stage: `Procesando ${stemName}...` 
    })
    
    // Log actual model I/O names for debugging
    console.log(`${stemName} model input names:`, session.inputNames)
    console.log(`${stemName} model output names:`, session.outputNames)
    
    // Run inference
    // Spleeter ONNX models use 'x' as input name (verified from error)
    // Input shape: [batch, samples, channels] float32
    const feeds = { x: audioTensor }
    const results = await session.run(feeds)
    
    // Get the output - try common output names
    // Spleeter typically uses 'y' or the first output name
    const outputName = session.outputNames[0]
    const output = results[outputName]
    
    if (!output) {
      throw new Error(`No output from ${stemName} model (tried output name: ${outputName})`)
    }
    
    const outputData = output.data as Float32Array
    const dims = output.dims as number[]
    
    console.log(`${stemName} output dims:`, dims)
    
    // Extract audio data (average stereo to mono)
    // Output shape: [batch=1, channels=2, height=1, samples]
    // Data layout: [L0, L1, ..., Ln, R0, R1, ..., Rn]
    
    if (dims.length === 4) {
      // 4D tensor: [batch, channels, height, samples]
      const [, channels, , samples] = dims
      const monoData = new Float32Array(samples)
      
      if (channels === 2) {
        // Average stereo channels
        // Left channel: indices 0 to samples-1
        // Right channel: indices samples to 2*samples-1
        for (let i = 0; i < samples; i++) {
          const left = outputData[i]
          const right = outputData[samples + i]
          monoData[i] = (left + right) / 2
        }
      } else if (channels === 1) {
        // Mono output
        for (let i = 0; i < samples; i++) {
          monoData[i] = outputData[i]
        }
      } else {
        throw new Error(`Unexpected number of channels: ${channels}`)
      }
      
      // Dispose session immediately to free memory
      console.log(`${stemName} complete, disposing session...`)
      session.release()
      
      return monoData
    } else {
      throw new Error(`Unexpected output dimensions: expected 4D, got ${dims.length}D with shape ${dims}`)
    }
    
  } catch (error) {
    console.error(`Failed to process ${stemName}:`, error)
    
    const errorMsg = error instanceof Error ? error.message : String(error)
    
    if (errorMsg.includes('bad_alloc') || errorMsg.includes('memory')) {
      throw new Error(`Memoria insuficiente para procesar ${stemName}. Intenta cerrar otras pestañas o usar un navegador con más memoria disponible.`)
    }
    
    if (errorMsg.includes('fetch') || errorMsg.includes('network') || errorMsg.includes('load')) {
      throw new Error(`Error al descargar modelo de ${stemName}: ${errorMsg}. Verifica tu conexión a internet.`)
    }
    
    throw new Error(`Error al procesar ${stemName}: ${errorMsg}`)
  }
}

/**
 * Prepare audio for Spleeter inference
 * Spleeter ONNX models expect 4D tensor: [batch, channels, 1, samples]
 * This treats audio as a 2D image with height=1
 */
function prepareAudioTensor(audioBuffer: AudioBuffer): ort.Tensor {
  const channels = audioBuffer.numberOfChannels
  const samples = audioBuffer.length
  
  // Get audio data from both channels (or duplicate mono)
  const leftChannel = audioBuffer.getChannelData(0)
  const rightChannel = channels > 1 ? audioBuffer.getChannelData(1) : leftChannel
  
  // Create 4D tensor: [batch=1, channels=2, height=1, width=samples]
  // Layout: [L0, L1, L2, ..., R0, R1, R2, ...]
  const tensorData = new Float32Array(2 * samples)
  
  // Channel 0 (left)
  for (let i = 0; i < samples; i++) {
    tensorData[i] = leftChannel[i]
  }
  
  // Channel 1 (right)
  for (let i = 0; i < samples; i++) {
    tensorData[samples + i] = rightChannel[i]
  }
  
  return new ort.Tensor('float32', tensorData, [1, 2, 1, samples])
}

/**
 * Create stereo AudioBuffer from mono Float32Array
 */
function createStereoBuffer(
  monoData: Float32Array,
  sampleRate: number
): AudioBuffer {
  const context = new AudioContext({ sampleRate })
  const buffer = context.createBuffer(2, monoData.length, sampleRate)
  
  // Duplicate mono to both channels
  const leftChannel = buffer.getChannelData(0)
  const rightChannel = buffer.getChannelData(1)
  
  leftChannel.set(monoData)
  rightChannel.set(monoData)
  
  context.close()
  return buffer
}

/**
 * Separate an audio buffer into stems (Vocals, Drums, Bass, Other) using Spleeter
 * Loads models sequentially (~20MB each) to stay within WASM memory limits
 * @param audioBuffer The input audio buffer to separate
 * @param onProgress Optional callback for progress updates
 * @returns Promise with separated stems as AudioBuffers
 */
export async function separateStems(
  audioBuffer: AudioBuffer,
  onProgress?: (progress: StemSeparationProgress) => void
): Promise<StemSeparationResult> {
  
  try {
    // Initialize ONNX Runtime
    await initializeRuntime()
    
    onProgress?.({ progress: 5, stage: 'Inicializando...' })
    
    // Check if audio is too long
    const maxDuration = MAX_CHUNK_SIZE / SAMPLE_RATE // ~60 seconds
    const audioDuration = audioBuffer.length / audioBuffer.sampleRate
    
    if (audioDuration > maxDuration * 2) {
      throw new Error(`Audio demasiado largo (${Math.round(audioDuration)}s). Máximo recomendado: ${Math.round(maxDuration * 2)}s`)
    }
    
    // Ensure stereo (duplicate mono if needed)
    let processBuffer = audioBuffer
    if (audioBuffer.numberOfChannels === 1) {
      console.log('Converting mono to stereo')
      const context = new AudioContext({ sampleRate: audioBuffer.sampleRate })
      const stereoBuffer = context.createBuffer(2, audioBuffer.length, audioBuffer.sampleRate)
      const monoData = audioBuffer.getChannelData(0)
      stereoBuffer.getChannelData(0).set(monoData)
      stereoBuffer.getChannelData(1).set(monoData)
      context.close()
      processBuffer = stereoBuffer
    }
    
    onProgress?.({ progress: 10, stage: 'Preparando audio...' })
    
    // Prepare input tensor (same for all models)
    const inputTensor = prepareAudioTensor(processBuffer)
    
    // Process each stem sequentially to minimize memory usage
    // Each model is ~20MB, loaded one at a time and disposed immediately
    
    onProgress?.({ progress: 15, stage: 'Separando vocals...' })
    const vocalsData = await processSingleStem('vocals', inputTensor, onProgress)
    
    onProgress?.({ progress: 35, stage: 'Separando drums...' })
    const drumsData = await processSingleStem('drums', inputTensor, onProgress)
    
    onProgress?.({ progress: 55, stage: 'Separando bass...' })
    const bassData = await processSingleStem('bass', inputTensor, onProgress)
    
    onProgress?.({ progress: 75, stage: 'Separando other...' })
    const otherData = await processSingleStem('other', inputTensor, onProgress)
    
    onProgress?.({ progress: 90, stage: 'Creando buffers de audio...' })
    
    // Create AudioBuffers for each stem
    const vocals = createStereoBuffer(vocalsData, audioBuffer.sampleRate)
    const drums = createStereoBuffer(drumsData, audioBuffer.sampleRate)
    const bass = createStereoBuffer(bassData, audioBuffer.sampleRate)
    const other = createStereoBuffer(otherData, audioBuffer.sampleRate)
    
    onProgress?.({ progress: 100, stage: 'Completado' })
    
    return { vocals, drums, bass, other }
    
  } catch (error) {
    console.error('Stem separation failed:', error)
    throw error
  }
}

/**
 * Check if the browser supports the required features for stem separation
 */
export function isStemSeparationSupported(): { supported: boolean, reason?: string } {
  // Check WebAssembly (required)
  if (typeof WebAssembly === 'undefined') {
    return { supported: false, reason: 'WebAssembly no está disponible' }
  }
  
  // Check for sufficient memory (at least 2GB recommended)
  if ('deviceMemory' in navigator) {
    const memory = (navigator as any).deviceMemory
    if (memory && memory < 2) {
      console.warn('Low memory detected - stem separation may be slow')
    }
  }
  
  // WebGPU is not required for Spleeter WASM models
  return { supported: true }
}
