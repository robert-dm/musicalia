/**
 * HT-Demucs 6-stem (htdemucs_6s). Loaded only via dynamic import.
 * Does not import stemSeparator. ORT env is restored after use.
 *
 * Model: same-origin folded graph public/models/htdemucs_6s_wasm.onnx
 * (from StemSplitio htdemucs_6s_fp16weights.onnx).
 * Input mix:    (1, 2, 343980)   stereo 44.1 kHz, 7.8 s
 * Output stems: (1, 6, 2, 343980) drums, bass, other, vocals, guitar, piano
 */

import { resampleChannel } from './audioResample'
import { DEMUCS_SAMPLE_RATE } from './demucsChunking'
import { channelsAtDemucsRate, inferDemucsChunks, type DemucsChannelPair } from './demucsInfer'
import { mapDemucsError } from './demucsErrors'
export { DEMUCS_MODEL_BYTES, DEMUCS_MODEL_DATA_BYTES, DEMUCS_MODEL_URL, DEMUCS_MODEL_DATA_URL } from './demucsModel'
import {
  DEMUCS_MODEL_BYTES,
  DEMUCS_MODEL_DATA_BYTES,
  DEMUCS_MODEL_DATA_URL,
  DEMUCS_MODEL_URL,
} from './demucsModel'
import {
  createDemucsSession,
  hasWebGPU,
  isMobileUserAgent,
  loadDemucsOnnxRuntime,
  shouldBlockForDeviceMemory,
} from './demucsOrt'
import type { DemucsWorkerRequest, DemucsWorkerResponse } from './demucsWorker'
import { fetchDemucsModelFiles } from './modelDownload'
import { makeProgressReporter, phaseProgress, type StemSeparationProgress } from './stemProgress'
import type { DemucsStemBuffers } from './stemTracks'

const WATCHDOG_MS = 5 * 60 * 1000

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new Error('Cancelado por el usuario')
}

function toStereoBuffer(
  left: Float32Array,
  right: Float32Array,
  sampleRate: number,
  length: number
): AudioBuffer {
  const buffer = new AudioBuffer({ numberOfChannels: 2, length, sampleRate })
  const outL = buffer.getChannelData(0)
  const outR = buffer.getChannelData(1)
  const copy = Math.min(length, left.length, right.length)
  if (copy > 0) {
    outL.set(left.subarray(0, copy))
    outR.set(right.subarray(0, copy))
  }
  return buffer
}

function toOriginalRate(left: Float32Array, right: Float32Array, sampleRate: number, length: number): AudioBuffer {
  const l = sampleRate === DEMUCS_SAMPLE_RATE ? left : resampleChannel(left, DEMUCS_SAMPLE_RATE, sampleRate)
  const r = sampleRate === DEMUCS_SAMPLE_RATE ? right : resampleChannel(right, DEMUCS_SAMPLE_RATE, sampleRate)
  return toStereoBuffer(l, r, sampleRate, length)
}

function pairsToStems(outs: DemucsChannelPair[], sampleRate: number, length: number): DemucsStemBuffers {
  return {
    drums: toOriginalRate(outs[0][0], outs[0][1], sampleRate, length),
    bass: toOriginalRate(outs[1][0], outs[1][1], sampleRate, length),
    other: toOriginalRate(outs[2][0], outs[2][1], sampleRate, length),
    vocals: toOriginalRate(outs[3][0], outs[3][1], sampleRate, length),
    guitar: toOriginalRate(outs[4][0], outs[4][1], sampleRate, length),
    piano: toOriginalRate(outs[5][0], outs[5][1], sampleRate, length),
  }
}

function validateDemucsStems(stems: DemucsStemBuffers): void {
  const names = Object.keys(stems) as Array<keyof DemucsStemBuffers>
  let anyAudio = false
  for (const name of names) {
    const data = stems[name].getChannelData(0)
    for (let i = 0; i < data.length; i++) {
      if (!Number.isFinite(data[i])) {
        throw new Error(`Error en separación: ${name} contiene valores inválidos.`)
      }
      if (data[i] !== 0) anyAudio = true
    }
  }
  if (!anyAudio) {
    throw new Error('Error en HT-Demucs: las pistas quedaron en silencio.')
  }
}

function copyChannel(source: Float32Array): Float32Array {
  return new Float32Array(source)
}

async function runInWorker(
  left: Float32Array,
  right: Float32Array,
  preferWebGPU: boolean,
  onProgress: (p: StemSeparationProgress) => void,
  signal?: AbortSignal
): Promise<DemucsChannelPair[]> {
  if (typeof Worker === 'undefined') throw new Error('Worker no disponible')
  const worker = new Worker(new URL('./demucsWorker.ts', import.meta.url), { type: 'module' })
  const request: DemucsWorkerRequest = {
    type: 'run',
    left: copyChannel(left),
    right: copyChannel(right),
    preferWebGPU,
  }

  return new Promise((resolve, reject) => {
    const abort = () => {
      worker.terminate()
      reject(new Error('Cancelado por el usuario'))
    }
    if (signal?.aborted) {
      abort()
      return
    }
    signal?.addEventListener('abort', abort, { once: true })

    worker.onmessage = (event: MessageEvent<DemucsWorkerResponse>) => {
      const msg = event.data
      if (msg.type === 'progress') {
        onProgress({ progress: msg.progress, stage: msg.stage, etaSeconds: msg.etaSeconds })
        return
      }
      signal?.removeEventListener('abort', abort)
      worker.terminate()
      if (msg.type === 'done') resolve(msg.stems)
      else reject(new Error(msg.message))
    }
    worker.onerror = (event) => {
      signal?.removeEventListener('abort', abort)
      worker.terminate()
      reject(new Error(event.message || 'Error en el worker HT-Demucs'))
    }
    worker.postMessage(request, [request.left.buffer, request.right.buffer])
  })
}

async function runOnMainThread(
  left: Float32Array,
  right: Float32Array,
  preferWebGPU: boolean,
  onProgress: (p: StemSeparationProgress) => void,
  signal?: AbortSignal
): Promise<DemucsChannelPair[]> {
  throwIfAborted(signal)
  let loaded = await loadDemucsOnnxRuntime(preferWebGPU)
  try {
    const files = await fetchDemucsModelFiles(
      DEMUCS_MODEL_URL,
      DEMUCS_MODEL_BYTES,
      DEMUCS_MODEL_DATA_URL,
      DEMUCS_MODEL_DATA_BYTES,
      (loadedBytes, total, cached, part) => {
        const frac = total > 0 ? loadedBytes / total : 0
        const label = part === 'graph' ? 'grafo' : 'pesos'
        onProgress({
          progress: phaseProgress('download', part === 'graph' ? frac * 0.45 : 0.45 + frac * 0.55),
          stage: cached
            ? `Modelo HT-Demucs (${label}) en caché`
            : `Descargando ${label} HT-Demucs… ${Math.round(frac * 100)}%`,
        })
      },
      signal
    )
    throwIfAborted(signal)
    onProgress({
      progress: phaseProgress('session', 0.4),
      stage: loaded.provider === 'webgpu' ? 'Creando sesión WebGPU…' : 'Creando sesión WASM…',
    })

    let session
    try {
      session = await createDemucsSession(loaded.ort, loaded.provider, files.graph, files.data)
    } catch (error) {
      if (loaded.provider !== 'webgpu') throw error
      console.warn('[HT-Demucs] WebGPU falló, usando WASM', error)
      onProgress({ progress: phaseProgress('session', 0.7), stage: 'WebGPU no disponible, usando WASM…' })
      loaded.restore()
      loaded = await loadDemucsOnnxRuntime(false)
      session = await createDemucsSession(loaded.ort, 'wasm', files.graph, files.data)
    }
    files.graph.fill(0)
    files.data.fill(0)
    onProgress({ progress: phaseProgress('session', 1), stage: 'Sesión lista. Separando…' })

    throwIfAborted(signal)
    const outs = await inferDemucsChunks(loaded.ort, session, left, right, onProgress, signal)
    try {
      session.release()
    } catch {
      /* ignore */
    }
    return outs
  } finally {
    loaded.restore()
  }
}

export async function separateStemsDemucs(
  audioBuffer: AudioBuffer,
  onProgress?: (progress: StemSeparationProgress) => void,
  signal?: AbortSignal
): Promise<DemucsStemBuffers> {
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
    console.info('[HT-Demucs] deviceMemory=', memory, 'crossOriginIsolated=', typeof crossOriginIsolated !== 'undefined' ? crossOriginIsolated : false)
    if (shouldBlockForDeviceMemory(memory)) {
      throw new Error(
        'HT-Demucs requiere más RAM de la que reporta este navegador. Usa Básica / Rápida o carga el audio como pista única.'
      )
    }

    wrapped({ progress: phaseProgress('init', 0.4), stage: 'Inicializando HT-Demucs…' })
    // Probe GPU on the page thread. Dedicated module workers in Chrome often
    // lack navigator.gpu even when the tab can use WebGPU.
    const preferWebGPU = await hasWebGPU()
    wrapped({
      progress: phaseProgress('init', 1),
      stage: preferWebGPU ? 'Inicializando (WebGPU)…' : 'Inicializando (WASM)…',
    })

    const origLeft = audioBuffer.getChannelData(0)
    const origRight = audioBuffer.numberOfChannels > 1 ? audioBuffer.getChannelData(1) : origLeft
    wrapped({ progress: phaseProgress('decode', 0.3), stage: 'Preparando audio…' })
    const { left, right } = channelsAtDemucsRate(origLeft, origRight, audioBuffer.sampleRate, resampleChannel)
    wrapped({ progress: phaseProgress('decode', 1), stage: 'Audio a 44.1 kHz' })

    let outs: DemucsChannelPair[]
    if (preferWebGPU) {
      try {
        outs = await runOnMainThread(left, right, true, wrapped, signal)
      } catch (error) {
        if (signal?.aborted) throw error
        console.warn('[HT-Demucs] WebGPU en hilo principal falló, WASM en worker', error)
        wrapped({ progress: phaseProgress('session', 0.2), stage: 'WebGPU no disponible, usando WASM…' })
        outs = await runInWorker(left, right, false, wrapped, signal)
      }
    } else {
      try {
        outs = await runInWorker(left, right, false, wrapped, signal)
      } catch (error) {
        if (signal?.aborted) throw error
        console.warn('[HT-Demucs] worker no disponible, usando hilo principal', error)
        wrapped({ progress: phaseProgress('session', 0.2), stage: 'Worker no disponible, usando hilo principal…' })
        outs = await runOnMainThread(left, right, false, wrapped, signal)
      }
    }

    if (watchdogFired) {
      throw new Error(
        'La separación HT-Demucs se detuvo. Intenta un archivo más corto, Básica / Rápida, o una sola pista.'
      )
    }

    wrapped({ progress: phaseProgress('assemble', 1), stage: 'Alineando con el original…' })
    const result = pairsToStems(outs, audioBuffer.sampleRate, audioBuffer.length)
    validateDemucsStems(result)
    wrapped({ progress: phaseProgress('tracks', 1), stage: 'Completado' })
    return result
  } catch (error) {
    throw mapDemucsError(error)
  } finally {
    stop()
    clearInterval(watchdog)
  }
}
