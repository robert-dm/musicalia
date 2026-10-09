import type * as OrtNS from 'onnxruntime-web'
import { DEMUCS_EXTERNAL_DATA_PATH } from './demucsModel'

const ORT_WASM_PATHS = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.30.0/dist/'

function snapshotWasmEnv(ort: typeof OrtNS) {
  return {
    numThreads: ort.env.wasm.numThreads,
    simd: ort.env.wasm.simd,
    proxy: ort.env.wasm.proxy,
    wasmPaths: ort.env.wasm.wasmPaths,
  }
}

function restoreWasmEnv(ort: typeof OrtNS, snap: ReturnType<typeof snapshotWasmEnv>): void {
  Object.assign(ort.env.wasm, snap)
}

export function isDedicatedWorker(): boolean {
  return typeof self !== 'undefined' && typeof (self as { document?: unknown }).document === 'undefined'
}

export async function probeWebGpu(): Promise<{
  inWorker: boolean
  hasNavigatorGpu: boolean
  adapter: boolean
}> {
  const inWorker = isDedicatedWorker()
  const gpu = (globalThis as unknown as { navigator?: { gpu?: { requestAdapter: () => Promise<unknown> } } })
    .navigator?.gpu
  const hasNavigatorGpu = !!gpu
  let adapter = false
  if (gpu) {
    try {
      adapter = !!(await gpu.requestAdapter())
    } catch (error) {
      console.warn('[HT-Demucs] navigator.gpu.requestAdapter failed', { inWorker, error })
    }
  }
  console.info('[HT-Demucs] WebGPU probe', { inWorker, hasNavigatorGpu, adapter })
  return { inWorker, hasNavigatorGpu, adapter }
}

export async function hasWebGPU(): Promise<boolean> {
  const probe = await probeWebGpu()
  return probe.adapter
}

export function wasmSessionOptions() {
  return {
    graphOptimizationLevel: 'disabled' as const,
    enableCpuMemArena: false,
    enableMemPattern: false,
    executionMode: 'sequential' as const,
    intraOpNumThreads: 1,
    interOpNumThreads: 1,
    executionProviders: ['wasm'] as const,
    extra: {
      session: {
        disable_prepacking: '1',
      },
    },
  }
}

export function webgpuSessionOptions() {
  return {
    graphOptimizationLevel: 'disabled' as const,
    enableCpuMemArena: false,
    enableMemPattern: false,
    executionMode: 'sequential' as const,
    executionProviders: ['webgpu'] as const,
    extra: {
      session: {
        disable_prepacking: '1',
      },
    },
  }
}

export function demucsExternalData(dataBytes: Uint8Array) {
  return [{ path: DEMUCS_EXTERNAL_DATA_PATH, data: dataBytes }]
}

/**
 * Load ORT for Demucs only. Prefer the WebGPU build so weights stay on GPU.
 * WASM uses a single thread and no proxy to cut peak heap. Spleeter env is restored.
 */
export async function loadDemucsOnnxRuntime(preferWebGPU: boolean): Promise<{
  ort: typeof OrtNS
  provider: 'webgpu' | 'wasm'
  restore: () => void
}> {
  let ort: typeof OrtNS
  let provider: 'webgpu' | 'wasm' = 'wasm'
  if (preferWebGPU) {
    try {
      ort = await import('onnxruntime-web/webgpu')
      provider = 'webgpu'
    } catch (error) {
      console.warn('[HT-Demucs] onnxruntime-web/webgpu no disponible, usando WASM', error)
      ort = await import('onnxruntime-web')
    }
  } else {
    ort = await import('onnxruntime-web')
  }

  const snap = snapshotWasmEnv(ort)
  if (!ort.env.wasm.wasmPaths) {
    ort.env.wasm.wasmPaths = ORT_WASM_PATHS
  }
  if (provider === 'wasm') {
    ort.env.wasm.numThreads = 1
    ort.env.wasm.proxy = false
  }

  return {
    ort,
    provider,
    restore: () => restoreWasmEnv(ort, snap),
  }
}

export async function createDemucsSession(
  ort: typeof OrtNS,
  provider: 'webgpu' | 'wasm',
  graphBytes: Uint8Array,
  dataBytes: Uint8Array
): Promise<OrtNS.InferenceSession> {
  const options = provider === 'webgpu' ? webgpuSessionOptions() : wasmSessionOptions()
  return ort.InferenceSession.create(graphBytes, {
    ...options,
    externalData: demucsExternalData(dataBytes),
  })
}

export function isMobileUserAgent(ua = typeof navigator !== 'undefined' ? navigator.userAgent : ''): boolean {
  return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(ua)
}

export function shouldBlockForDeviceMemory(deviceMemory?: number): boolean {
  return deviceMemory !== undefined && deviceMemory < 2
}
