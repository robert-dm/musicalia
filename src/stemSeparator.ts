/**
 * Browser-local stem separation using real Demucs (HTDemucs) via ONNX Runtime Web
 * 
 * This implementation uses actual ML-based source separation to produce distinct stems.
 * Models are loaded from Hugging Face or a CDN and run with WebGPU acceleration when available.
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

// Model configuration for HTDemucs
// Using StemSplitio public model (4-stem, fp16, ~80MB)
// Source: https://huggingface.co/StemSplitio/htdemucs-onnx
// Input: 'mix' tensor [1, 2, samples] float32
// Output: 'stems' tensor [1, 4, 2, samples] - order: drums, bass, other, vocals
const DEMUCS_MODEL_URL = 'https://huggingface.co/StemSplitio/htdemucs-onnx/resolve/main/htdemucs_fp16weights.onnx'

const SAMPLE_RATE = 44100
const MAX_CHUNK_SIZE = 44100 * 60 // 60 seconds per chunk to manage memory

let cachedSession: ort.InferenceSession | null = null

/**
 * Initialize ONNX Runtime Web with WebGPU if available
 */
async function initializeRuntime(): Promise<void> {
  // Configure ONNX Runtime to use WebGPU when available
  ort.env.wasm.numThreads = navigator.hardwareConcurrency || 4
  ort.env.wasm.simd = true
  
  // Try WebGPU first, fall back to WASM
  if ('gpu' in navigator) {
    try {
      const adapter = await (navigator as any).gpu?.requestAdapter()
      if (adapter) {
        console.log('WebGPU available for Demucs acceleration')
      }
    } catch (e) {
      console.log('WebGPU not available, using WebAssembly')
    }
  }
}

/**
 * Load or retrieve cached Demucs model
 */
async function loadDemucsModel(
  onProgress?: (progress: StemSeparationProgress) => void
): Promise<ort.InferenceSession> {
  if (cachedSession) {
    return cachedSession
  }

  onProgress?.({ progress: 5, stage: 'Descargando modelo Demucs...' })

  try {
    // Load model with progress tracking
    const response = await fetch(DEMUCS_MODEL_URL)
    if (!response.ok) {
      throw new Error(`Failed to load model: ${response.statusText}`)
    }

    const totalBytes = parseInt(response.headers.get('content-length') || '0')
    const reader = response.body?.getReader()
    
    if (!reader) {
      throw new Error('Failed to read model stream')
    }

    const chunks: Uint8Array[] = []
    let receivedBytes = 0

    while (true) {
      const { done, value } = await reader.read()
      
      if (done) break
      
      chunks.push(value)
      receivedBytes += value.length
      
      if (totalBytes > 0) {
        const downloadProgress = Math.min(15, 5 + (receivedBytes / totalBytes) * 10)
        onProgress?.({ 
          progress: downloadProgress, 
          stage: `Descargando modelo: ${Math.round(receivedBytes / 1024 / 1024)}MB` 
        })
      }
    }

    // Combine chunks
    const modelBuffer = new Uint8Array(receivedBytes)
    let offset = 0
    for (const chunk of chunks) {
      modelBuffer.set(chunk, offset)
      offset += chunk.length
    }

    onProgress?.({ progress: 20, stage: 'Inicializando modelo...' })

    // Create ONNX session with optimization
    const session = await ort.InferenceSession.create(modelBuffer.buffer, {
      executionProviders: ['webgpu', 'wasm'],
      graphOptimizationLevel: 'all',
      enableCpuMemArena: true,
      enableMemPattern: true,
    })

    cachedSession = session
    return session
  } catch (error) {
    console.error('Failed to load Demucs model:', error)
    throw new Error('No se pudo cargar el modelo de separación. WebGPU requerido.')
  }
}

/**
 * Prepare audio for Demucs inference
 */
function prepareAudioTensor(audioBuffer: AudioBuffer): ort.Tensor {
  const channels = audioBuffer.numberOfChannels
  const samples = audioBuffer.length
  
  // Get audio data from both channels (or duplicate mono)
  const leftChannel = audioBuffer.getChannelData(0)
  const rightChannel = channels > 1 ? audioBuffer.getChannelData(1) : leftChannel
  
  // Create tensor in format [batch=1, channels=2, samples]
  const tensorData = new Float32Array(2 * samples)
  
  for (let i = 0; i < samples; i++) {
    tensorData[i] = leftChannel[i]
    tensorData[samples + i] = rightChannel[i]
  }
  
  return new ort.Tensor('float32', tensorData, [1, 2, samples])
}

/**
 * Run Demucs inference to separate stems
 */
async function runDemucsInference(
  session: ort.InferenceSession,
  audioTensor: ort.Tensor,
  onProgress?: (progress: StemSeparationProgress) => void
): Promise<{ vocals: Float32Array, drums: Float32Array, bass: Float32Array, other: Float32Array }> {
  
  onProgress?.({ progress: 30, stage: 'Ejecutando modelo de separación...' })

  try {
    // Run inference with correct input name for StemSplitio model
    const feeds = { mix: audioTensor }  // Input tensor name is 'mix'
    const results = await session.run(feeds)
    
    // Extract stems from output
    // StemSplitio model output: 'stems' tensor [1, 4, 2, samples]
    // Stem order: drums, bass, other, vocals
    const output = results.stems
    
    if (!output) {
      throw new Error('No stems output from model')
    }
    
    const outputData = output.data as Float32Array
    const dims = output.dims as number[]
    
    // Expected shape: [batch=1, stems=4, channels=2, samples]
    if (dims.length !== 4) {
      throw new Error(`Unexpected output dimensions: ${dims.length}`)
    }
    
    const [, numStems, channels, samples] = dims
    
    if (numStems !== 4) {
      throw new Error(`Expected 4 stems, got ${numStems}`)
    }
    
    if (channels !== 2) {
      throw new Error(`Expected stereo (2 channels), got ${channels}`)
    }
    
    onProgress?.({ progress: 60, stage: 'Extrayendo pistas...' })
    
    // Extract each stem (averaging stereo to mono)
    // Output layout: [batch, stem, channel, sample]
    // Flatten index: batch*stems*channels*samples + stem*channels*samples + channel*samples + sample
    
    const drums = new Float32Array(samples)
    const bass = new Float32Array(samples)
    const other = new Float32Array(samples)
    const vocals = new Float32Array(samples)
    
    // StemSplitio order: drums (0), bass (1), other (2), vocals (3)
    for (let i = 0; i < samples; i++) {
      // Average left and right channels for each stem
      const channelStride = samples
      const stemStride = channels * samples
      
      // Drums (stem 0)
      const drumsL = outputData[0 * stemStride + 0 * channelStride + i]
      const drumsR = outputData[0 * stemStride + 1 * channelStride + i]
      drums[i] = (drumsL + drumsR) / 2
      
      // Bass (stem 1)
      const bassL = outputData[1 * stemStride + 0 * channelStride + i]
      const bassR = outputData[1 * stemStride + 1 * channelStride + i]
      bass[i] = (bassL + bassR) / 2
      
      // Other (stem 2)
      const otherL = outputData[2 * stemStride + 0 * channelStride + i]
      const otherR = outputData[2 * stemStride + 1 * channelStride + i]
      other[i] = (otherL + otherR) / 2
      
      // Vocals (stem 3)
      const vocalsL = outputData[3 * stemStride + 0 * channelStride + i]
      const vocalsR = outputData[3 * stemStride + 1 * channelStride + i]
      vocals[i] = (vocalsL + vocalsR) / 2
    }
    
    return { vocals, drums, bass, other }
    
  } catch (error) {
    console.error('Demucs inference failed:', error)
    throw new Error('La separación de stems falló. Intenta con un archivo más corto.')
  }
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
 * Separate an audio buffer into stems (Vocals, Drums, Bass, Other) using real Demucs
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
    
    // Load Demucs model
    const session = await loadDemucsModel(onProgress)
    
    onProgress?.({ progress: 25, stage: 'Preparando audio...' })
    
    // Check if audio is too long and needs chunking
    const maxDuration = MAX_CHUNK_SIZE / SAMPLE_RATE // ~60 seconds
    const audioDuration = audioBuffer.length / audioBuffer.sampleRate
    
    if (audioDuration > maxDuration * 2) {
      throw new Error(`Audio demasiado largo (${Math.round(audioDuration)}s). Máximo recomendado: ${Math.round(maxDuration * 2)}s`)
    }
    
    // Resample if needed (Demucs expects 44.1kHz)
    let processBuffer = audioBuffer
    if (audioBuffer.sampleRate !== SAMPLE_RATE) {
      console.warn(`Processing at ${audioBuffer.sampleRate}Hz (model expects ${SAMPLE_RATE}Hz)`)
      // Note: For best results, audio should be resampled to 44.1kHz
      // Current implementation processes at original rate
    }
    
    // Ensure stereo (duplicate mono if needed)
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
    
    // Prepare input tensor
    const inputTensor = prepareAudioTensor(processBuffer)
    
    // Run inference
    const separatedData = await runDemucsInference(session, inputTensor, onProgress)
    
    onProgress?.({ progress: 80, stage: 'Creando buffers de audio...' })
    
    // Create AudioBuffers for each stem
    const vocals = createStereoBuffer(separatedData.vocals, audioBuffer.sampleRate)
    const drums = createStereoBuffer(separatedData.drums, audioBuffer.sampleRate)
    const bass = createStereoBuffer(separatedData.bass, audioBuffer.sampleRate)
    const other = createStereoBuffer(separatedData.other, audioBuffer.sampleRate)
    
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
  // Check WebAssembly
  if (typeof WebAssembly === 'undefined') {
    return { supported: false, reason: 'WebAssembly no está disponible' }
  }
  
  // Check for sufficient memory (at least 2GB recommended)
  if ('deviceMemory' in navigator) {
    const memory = (navigator as any).deviceMemory
    if (memory && memory < 2) {
      return { supported: false, reason: 'Memoria insuficiente (mínimo 2GB recomendado)' }
    }
  }
  
  // WebGPU is recommended but not required
  const hasWebGPU = 'gpu' in navigator
  if (!hasWebGPU) {
    console.warn('WebGPU not available - stem separation will be slower')
  }
  
  return { supported: true }
}
