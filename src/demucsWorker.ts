/// <reference lib="webworker" />
import { DEMUCS_MODEL_BYTES, DEMUCS_MODEL_DATA_BYTES, DEMUCS_MODEL_DATA_URL, DEMUCS_MODEL_URL } from './demucsModel'
import { inferDemucsChunks } from './demucsInfer'
import { fetchModelWithProgress } from './modelDownload'
import { createDemucsSession, hasWebGPU, loadDemucsOnnxRuntime } from './demucsOrt'
import { phaseProgress, type StemSeparationProgress } from './stemProgress'

export type DemucsWorkerRequest = {
  type: 'run'
  left: Float32Array
  right: Float32Array
  preferWebGPU: boolean
}

export type DemucsWorkerResponse =
  | { type: 'progress'; progress: number; stage: string; etaSeconds?: number }
  | { type: 'done'; stems: Array<[Float32Array, Float32Array]> }
  | { type: 'error'; message: string }

function postProgress(progress: StemSeparationProgress): void {
  const msg: DemucsWorkerResponse = {
    type: 'progress',
    progress: progress.progress,
    stage: progress.stage,
    etaSeconds: progress.etaSeconds,
  }
  self.postMessage(msg)
}

async function loadGraphAndWeights(
  onProgress: (p: StemSeparationProgress) => void,
  signal?: AbortSignal
) {
  const graphBytes = await fetchModelWithProgress(
    DEMUCS_MODEL_URL,
    DEMUCS_MODEL_BYTES,
    (loadedBytes, total, cached) => {
      const frac = total > 0 ? loadedBytes / total : 0
      onProgress({
        progress: phaseProgress('download', frac * 0.45),
        stage: cached
          ? 'Modelo HT-Demucs en caché'
          : `Descargando grafo HT-Demucs… ${Math.round(frac * 100)}%`,
      })
    },
    signal
  )
  const dataBytes = await fetchModelWithProgress(
    DEMUCS_MODEL_DATA_URL,
    DEMUCS_MODEL_DATA_BYTES,
    (loadedBytes, total, cached) => {
      const frac = total > 0 ? loadedBytes / total : 0
      onProgress({
        progress: phaseProgress('download', 0.45 + frac * 0.55),
        stage: cached
          ? 'Pesos HT-Demucs en caché'
          : `Descargando pesos HT-Demucs… ${Math.round(frac * 100)}%`,
      })
    },
    signal
  )
  return { graphBytes, dataBytes }
}

self.onmessage = async (event: MessageEvent<DemucsWorkerRequest>) => {
  const data = event.data
  if (!data || data.type !== 'run') return
  let restore: (() => void) | undefined
  try {
    const workerGpu = await hasWebGPU()
    const preferWebGPU = data.preferWebGPU && workerGpu
    if (data.preferWebGPU && !workerGpu) {
      console.info('[HT-Demucs] navigator.gpu ausente en el worker; WASM en el worker')
    }
    postProgress({
      progress: phaseProgress('init', 1),
      stage: preferWebGPU ? 'Inicializando (WebGPU)…' : 'Inicializando (WASM)…',
    })
    const loaded = await loadDemucsOnnxRuntime(preferWebGPU)
    restore = loaded.restore
    let provider = loaded.provider
    let ort = loaded.ort

    const { graphBytes, dataBytes } = await loadGraphAndWeights(postProgress)

    postProgress({
      progress: phaseProgress('session', 0.4),
      stage: provider === 'webgpu' ? 'Creando sesión WebGPU…' : 'Creando sesión WASM…',
    })
    let session
    try {
      session = await createDemucsSession(ort, provider, graphBytes, dataBytes)
    } catch (error) {
      if (provider === 'webgpu') {
        console.warn('[HT-Demucs] WebGPU falló, reintentando WASM', error)
        postProgress({ progress: phaseProgress('session', 0.7), stage: 'WebGPU no disponible, usando WASM…' })
        loaded.restore()
        const wasm = await loadDemucsOnnxRuntime(false)
        restore = wasm.restore
        provider = 'wasm'
        ort = wasm.ort
        session = await createDemucsSession(wasm.ort, 'wasm', graphBytes, dataBytes)
      } else {
        throw error
      }
    }
    graphBytes.fill(0)
    dataBytes.fill(0)
    postProgress({ progress: phaseProgress('session', 1), stage: 'Sesión lista. Separando…' })

    const outs = await inferDemucsChunks(ort, session, data.left, data.right, postProgress)
    try {
      session.release()
    } catch {
      /* ignore */
    }

    const transfer: Transferable[] = []
    const stems: Array<[Float32Array, Float32Array]> = outs.map(([l, r]) => {
      transfer.push(l.buffer as ArrayBuffer, r.buffer as ArrayBuffer)
      return [l, r]
    })
    const msg: DemucsWorkerResponse = { type: 'done', stems }
    self.postMessage(msg, transfer)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error('[HT-Demucs worker]', error)
    const msg: DemucsWorkerResponse = { type: 'error', message }
    self.postMessage(msg)
  } finally {
    restore?.()
  }
}
