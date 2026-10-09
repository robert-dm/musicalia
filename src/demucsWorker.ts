/// <reference lib="webworker" />
import { DEMUCS_MODEL_BYTES, DEMUCS_MODEL_URL } from './demucsModel'
import { inferDemucsChunks } from './demucsInfer'
import { fetchModelWithProgress } from './modelDownload'
import { hasWebGPU, loadDemucsOnnxRuntime, wasmSessionOptions, webgpuSessionOptions } from './demucsOrt'
import type { StemSeparationProgress } from './stemProgress'

export type DemucsWorkerRequest = {
  type: 'run'
  left: Float32Array
  right: Float32Array
  preferWebGPU: boolean
}

export type DemucsWorkerResponse =
  | { type: 'progress'; progress: number; stage: string }
  | { type: 'done'; stems: Array<[Float32Array, Float32Array]> }
  | { type: 'error'; message: string }

function postProgress(progress: StemSeparationProgress): void {
  const msg: DemucsWorkerResponse = { type: 'progress', progress: progress.progress, stage: progress.stage }
  self.postMessage(msg)
}

async function createSession(
  ort: typeof import('onnxruntime-web'),
  provider: 'webgpu' | 'wasm',
  modelBytes: Uint8Array,
  onProgress: (p: StemSeparationProgress) => void
) {
  onProgress({ progress: 24, stage: provider === 'webgpu' ? 'Creando sesión WebGPU…' : 'Creando sesión WASM…' })
  const options = provider === 'webgpu' ? webgpuSessionOptions() : wasmSessionOptions()
  return ort.InferenceSession.create(modelBytes, options)
}

self.onmessage = async (event: MessageEvent<DemucsWorkerRequest>) => {
  const data = event.data
  if (!data || data.type !== 'run') return
  let restore: (() => void) | undefined
  try {
    const preferWebGPU = data.preferWebGPU && await hasWebGPU()
    postProgress({
      progress: 3,
      stage: preferWebGPU ? 'Inicializando (WebGPU)…' : 'Inicializando (WASM)…',
    })
    const loaded = await loadDemucsOnnxRuntime(preferWebGPU)
    restore = loaded.restore
    const { ort } = loaded
    let provider = loaded.provider

    const modelBytes = await fetchModelWithProgress(
      DEMUCS_MODEL_URL,
      DEMUCS_MODEL_BYTES,
      (loadedBytes, total, cached) => {
        const frac = total > 0 ? loadedBytes / total : 0
        postProgress({
          progress: 4 + frac * 18,
          stage: cached
            ? 'Modelo HT-Demucs en caché'
            : `Descargando modelo HT-Demucs… ${Math.round(frac * 100)}%`,
        })
      }
    )

    let session
    try {
      session = await createSession(ort, provider, modelBytes, postProgress)
    } catch (error) {
      if (provider === 'webgpu') {
        console.warn('[HT-Demucs] WebGPU falló, reintentando WASM', error)
        postProgress({ progress: 25, stage: 'WebGPU no disponible, usando WASM…' })
        loaded.restore()
        const wasm = await loadDemucsOnnxRuntime(false)
        restore = wasm.restore
        provider = 'wasm'
        session = await createSession(wasm.ort, 'wasm', modelBytes, postProgress)
      } else {
        throw error
      }
    }
    modelBytes.fill(0)

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
