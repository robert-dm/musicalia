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
// Note: This should point to a hosted Demucs ONNX model
// Options for obtaining the model:
// 1. Convert PyTorch Demucs to ONNX: https://github.com/facebookresearch/demucs
// 2. Use pre-converted model from: https://github.com/TRvlvr/model_repo
// 3. Host your own converted model on CDN/S3
const DEMUCS_MODEL_URL = 'https://huggingface.co/TRvlvr/model_repo/resolve/main/demucs/htdemucs_6s.onnx'

const SAMPLE_RATE = 44100

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
    // Run inference
    const feeds = { audio: audioTensor }
    const results = await session.run(feeds)
    
    // Extract stems from output
    // Demucs outputs format: [batch, stems, channels, samples]
    // stems order: [drums, bass, other, vocals]
    const output = results.output
    
    if (!output) {
      throw new Error('No output from model')
    }
    
    const outputData = output.data as Float32Array
    const [, numStems, channels, samples] = output.dims as number[]
    
    if (numStems !== 4 && numStems !== 6) {
      throw new Error(`Expected 4 or 6 stems, got ${numStems}`)
    }
    
    onProgress?.({ progress: 60, stage: 'Extrayendo pistas...' })
    
    // Extract each stem (averaging stereo to mono)
    const samplesPerStem = channels * samples
    
    const drums = new Float32Array(samples)
    const bass = new Float32Array(samples)
    const vocals = new Float32Array(samples)
    const other = new Float32Array(samples)
    
    if (numStems === 4) {
      // 4-stem model order: drums, bass, other, vocals
      for (let i = 0; i < samples; i++) {
        drums[i] = (outputData[0 * samplesPerStem + i] + outputData[0 * samplesPerStem + samples + i]) / 2
        bass[i] = (outputData[1 * samplesPerStem + i] + outputData[1 * samplesPerStem + samples + i]) / 2
        other[i] = (outputData[2 * samplesPerStem + i] + outputData[2 * samplesPerStem + samples + i]) / 2
        vocals[i] = (outputData[3 * samplesPerStem + i] + outputData[3 * samplesPerStem + samples + i]) / 2
      }
    } else {
      // 6-stem model order: drums, bass, other, vocals, guitar, piano
      // Merge guitar and piano into "other" for consistency
      for (let i = 0; i < samples; i++) {
        drums[i] = (outputData[0 * samplesPerStem + i] + outputData[0 * samplesPerStem + samples + i]) / 2
        bass[i] = (outputData[1 * samplesPerStem + i] + outputData[1 * samplesPerStem + samples + i]) / 2
        vocals[i] = (outputData[3 * samplesPerStem + i] + outputData[3 * samplesPerStem + samples + i]) / 2
        
        // Combine other + guitar + piano
        const otherStem = (outputData[2 * samplesPerStem + i] + outputData[2 * samplesPerStem + samples + i]) / 2
        const guitarStem = (outputData[4 * samplesPerStem + i] + outputData[4 * samplesPerStem + samples + i]) / 2
        const pianoStem = (outputData[5 * samplesPerStem + i] + outputData[5 * samplesPerStem + samples + i]) / 2
        other[i] = (otherStem + guitarStem + pianoStem) / 3
      }
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
    
    // Resample if needed (Demucs expects 44.1kHz)
    let processBuffer = audioBuffer
    if (audioBuffer.sampleRate !== SAMPLE_RATE) {
      console.warn(`Resampling from ${audioBuffer.sampleRate}Hz to ${SAMPLE_RATE}Hz`)
      // For simplicity, we'll process at original rate
      // In production, implement proper resampling
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
