/**
 * Browser-local HT-Demucs 4-stem separation (StemSplitio ONNX).
 *
 * Model: huggingface.co/StemSplitio/htdemucs-onnx htdemucs_fp16weights.onnx (~166 MB)
 * Input mix:  (1, 2, 343980)  stereo 44.1 kHz, 7.8 s
 * Output stems: (1, 4, 2, 343980)  drums, bass, other, vocals
 */

import { resampleChannel, resampleToLength } from './audioResample'
import {
  accumulateStemChannel,
  DEMUCS_N_SAMPLES,
  DEMUCS_OVERLAP,
  DEMUCS_SAMPLE_RATE,
  DEMUCS_STEM_ROWS,
  DEMUCS_STRIDE,
  demucsChunkCount,
  makeTransitionWindow,
  normalizeOverlapAdd,
  packStereoChunk,
} from './demucsChunking'
import { fetchModelWithProgress } from './modelDownload'
import { hasWebGPU, isMobileUserAgent, loadOnnxRuntime } from './onnxRuntime'
import { interpolateChunkProgress, makeProgressReporter, type StemSeparationProgress } from './stemProgress'
import type { StemSeparationResult } from './stemSeparator'

const DEMUCS_MODEL_URL =
  'https://huggingface.co/StemSplitio/htdemucs-onnx/resolve/main/htdemucs_fp16weights.onnx'
const DEMUCS_MODEL_BYTES = 165_612_636
const WATCHDOG_MS = 5 * 60 * 1000

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new Error('Cancelado por el usuario')
}

function mapDemucsError(error: unknown): Error {
  if (error instanceof Error && error.message.startsWith('Cancelado')) return error
  const msg = error instanceof Error ? error.message : String(error)
  const lower = msg.toLowerCase()
  if (lower.includes('móvil') || lower.includes('movil')) {
    return error instanceof Error ? error : new Error(msg)
  }
  if (lower.includes('bad_alloc') || lower.includes('oom') || lower.includes('out of memory') ||
      (lower.includes('memory') && (lower.includes('alloc') || lower.includes('insufficient')))) {
    return new Error(
      'Memoria insuficiente para HT-Demucs. Prueba la opción Básica / Rápida o carga el audio como pista única.'
    )
  }
  if (lower.includes('failed to fetch') || lower.includes('network') || lower.includes('descargar') ||
      lower.includes('load failed') || lower.includes('err_http')) {
    return new Error(
      'Error al descargar el modelo HT-Demucs. Verifica tu conexión a internet. Se cargará como pista única.'
    )
  }
  if (lower.includes('webgpu') || lower.includes('wasm') || lower.includes('onnx')) {
    return new Error(
      'No se pudo iniciar HT-Demucs (WebGPU/WASM). Prueba Chrome o Edge actualizados, o carga el audio como pista única.'
    )
  }
  return new Error(`Error en separación HT-Demucs: ${msg}. Se cargará como pista única.`)
}

function toStereoBuffer(
  left: Float32Array,
  right: Float32Array,
  sampleRate: number,
  length: number
): AudioBuffer {
  const l = resampleToLength(left, length)
  const r = resampleToLength(right, length)
  const buffer = new AudioBuffer({ numberOfChannels: 2, length, sampleRate })
  buffer.getChannelData(0).set(l)
  buffer.getChannelData(1).set(r)
  return buffer
}

function validateDemucsStems(stems: StemSeparationResult): void {
  const names: (keyof StemSeparationResult)[] = ['vocals', 'drums', 'bass', 'other']
  let anyAudio = false
  for (const name of names) {
    const data = stems[name].getChannelData(0)
    for (let i = 0; i < data.length; i++) {
      if (!Number.isFinite(data[i])) {
        throw new Error(`Error en separación: ${name} contiene valores inválidos. Se cargará como pista única.`)
      }
      if (data[i] !== 0) anyAudio = true
    }
  }
  if (!anyAudio) {
    throw new Error('Error en separación HT-Demucs: las pistas quedaron en silencio. Se cargará como pista única.')
  }
}

export async function separateStemsDemucs(
  audioBuffer: AudioBuffer,
  onProgress?: (progress: StemSeparationProgress) => void,
  signal?: AbortSignal
): Promise<StemSeparationResult> {
  const startTime = Date.now()
  const { report, stop } = makeProgressReporter(onProgress, startTime)
  let lastProgressTime = startTime
  let watchdogFired = false

  const watchdog = setInterval(() => {
    if (Date.now() - lastProgressTime > WATCHDOG_MS) watchdogFired = true
  }, 5000)

  const wrapped = (p: StemSeparationProgress) => {
    lastProgressTime = Date.now()
    report(p)
  }

  try {
    throwIfAborted(signal)

    if (isMobileUserAgent()) {
      throw new Error(
        'HT-Demucs no está disponible en móviles (poca memoria). Usa Básica / Rápida en un ordenador, o carga el audio como pista única.'
      )
    }

    const memory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory
    if (memory !== undefined && memory < 4) {
      throw new Error(
        'HT-Demucs requiere al menos 4 GB de RAM. Prueba la opción Básica / Rápida o carga el audio como pista única.'
      )
    }

    wrapped({ progress: 1, stage: 'Inicializando HT-Demucs...' })

    const preferWebGPU = await hasWebGPU()
    wrapped({
      progress: 3,
      stage: preferWebGPU ? 'Inicializando (WebGPU)...' : 'Inicializando (WASM)...',
    })
    const ort = await loadOnnxRuntime(preferWebGPU)
    throwIfAborted(signal)

    const modelBytes = await fetchModelWithProgress(
      DEMUCS_MODEL_URL,
      DEMUCS_MODEL_BYTES,
      (loaded, total, cached) => {
        const frac = total > 0 ? loaded / total : 0
        wrapped({
          progress: 4 + frac * 18,
          stage: cached
            ? 'Modelo HT-Demucs en caché'
            : `Descargando modelo HT-Demucs… ${Math.round(frac * 100)}%`,
        })
      },
      signal
    )

    wrapped({ progress: 24, stage: 'Creando sesión ONNX...' })

    let session
    const sessionOptions = {
      graphOptimizationLevel: 'all' as const,
      enableCpuMemArena: true,
      enableMemPattern: true,
    }

    if (preferWebGPU) {
      try {
        session = await ort.InferenceSession.create(modelBytes, {
          ...sessionOptions,
          executionProviders: ['webgpu', 'wasm'],
        })
      } catch (error) {
        console.warn('WebGPU falló, usando WASM', error)
        wrapped({ progress: 25, stage: 'WebGPU no disponible, usando WASM...' })
        session = await ort.InferenceSession.create(modelBytes, {
          ...sessionOptions,
          executionProviders: ['wasm'],
        })
      }
    } else {
      session = await ort.InferenceSession.create(modelBytes, {
        ...sessionOptions,
        executionProviders: ['wasm'],
      })
    }

    throwIfAborted(signal)
    wrapped({ progress: 28, stage: 'Preparando audio (44.1 kHz estéreo)...' })

    const origLeft = audioBuffer.getChannelData(0)
    const origRight = audioBuffer.numberOfChannels > 1 ? audioBuffer.getChannelData(1) : origLeft
    const left = resampleChannel(origLeft, audioBuffer.sampleRate, DEMUCS_SAMPLE_RATE)
    const right = audioBuffer.numberOfChannels > 1
      ? resampleChannel(origRight, audioBuffer.sampleRate, DEMUCS_SAMPLE_RATE)
      : new Float32Array(left)

    const total = left.length
    const nChunks = demucsChunkCount(total)
    const window = makeTransitionWindow(DEMUCS_N_SAMPLES, DEMUCS_OVERLAP)

    const drumsL = new Float32Array(total)
    const drumsR = new Float32Array(total)
    const bassL = new Float32Array(total)
    const bassR = new Float32Array(total)
    const otherL = new Float32Array(total)
    const otherR = new Float32Array(total)
    const vocalsL = new Float32Array(total)
    const vocalsR = new Float32Array(total)
    const weight = new Float32Array(total)

    const stemOuts: Array<[Float32Array, Float32Array]> = [
      [drumsL, drumsR],
      [bassL, bassR],
      [otherL, otherR],
      [vocalsL, vocalsR],
    ]

    let estimatedChunkMs = 12_000

    for (let i = 0; i < nChunks; i++) {
      throwIfAborted(signal)
      if (watchdogFired) {
        throw new Error(
          'La separación HT-Demucs se detuvo. Intenta con un archivo más corto, la opción Básica / Rápida, o cárgalo como pista única.'
        )
      }

      const start = i * DEMUCS_STRIDE
      const end = Math.min(start + DEMUCS_N_SAMPLES, total)
      const clen = end - start
      const chunkStart = Date.now()

      const pulse = setInterval(() => {
        wrapped({
          progress: interpolateChunkProgress(i, nChunks, Date.now() - chunkStart, estimatedChunkMs, 30, 90),
          stage: `Procesando chunks ${i + 1}/${nChunks}…`,
        })
      }, 400)

      try {
        const chunkBuf = packStereoChunk(left, right, start, end)
        const feeds = { mix: new ort.Tensor('float32', chunkBuf, [1, 2, DEMUCS_N_SAMPLES]) }
        const results = await session.run(feeds)
        const stemsTensor = results.stems ?? results[session.outputNames[0]]
        if (!stemsTensor) throw new Error('El modelo HT-Demucs no devolvió stems')
        const stemsData = stemsTensor.data as Float32Array

        for (let row = 0; row < DEMUCS_STEM_ROWS.length; row++) {
          accumulateStemChannel(
            stemsData, DEMUCS_N_SAMPLES, row, 0, start, clen, window, stemOuts[row][0],
            row === 0 ? weight : undefined
          )
          accumulateStemChannel(stemsData, DEMUCS_N_SAMPLES, row, 1, start, clen, window, stemOuts[row][1])
        }
      } finally {
        clearInterval(pulse)
      }

      estimatedChunkMs = Date.now() - chunkStart
      wrapped({
        progress: interpolateChunkProgress(i + 1, nChunks, estimatedChunkMs, estimatedChunkMs, 30, 90),
        stage: `Procesando chunks ${i + 1}/${nChunks}…`,
      })
      await new Promise((r) => setTimeout(r, 0))
    }

    wrapped({ progress: 92, stage: 'Reconstruyendo pistas...' })
    normalizeOverlapAdd(
      [drumsL, drumsR, bassL, bassR, otherL, otherR, vocalsL, vocalsR],
      weight
    )

    try {
      session.release()
    } catch {
      /* ignore */
    }

    wrapped({ progress: 96, stage: 'Ajustando sample rate...' })
    const length = audioBuffer.length
    const sampleRate = audioBuffer.sampleRate
    const result: StemSeparationResult = {
      drums: toStereoBuffer(drumsL, drumsR, sampleRate, length),
      bass: toStereoBuffer(bassL, bassR, sampleRate, length),
      other: toStereoBuffer(otherL, otherR, sampleRate, length),
      vocals: toStereoBuffer(vocalsL, vocalsR, sampleRate, length),
    }

    validateDemucsStems(result)
    wrapped({ progress: 100, stage: 'Completado' })
    return result
  } catch (error) {
    throw mapDemucsError(error)
  } finally {
    stop()
    clearInterval(watchdog)
  }
}
