import type * as OrtNS from 'onnxruntime-web'

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

export async function hasWebGPU(): Promise<boolean> {
  const gpu = (navigator as Navigator & { gpu?: { requestAdapter: () => Promise<unknown> } }).gpu
  if (!gpu) return false
  try {
    return !!(await gpu.requestAdapter())
  } catch {
    return false
  }
}

export function wasmSessionOptions() {
  return {
    graphOptimizationLevel: 'basic' as const,
    enableCpuMemArena: false,
    enableMemPattern: false,
    executionProviders: ['wasm'] as const,
  }
}

export function webgpuSessionOptions() {
  return {
    graphOptimizationLevel: 'basic' as const,
    enableCpuMemArena: false,
    enableMemPattern: false,
    executionProviders: ['webgpu'] as const,
  }
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

export function isMobileUserAgent(ua = typeof navigator !== 'undefined' ? navigator.userAgent : ''): boolean {
  return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(ua)
}

export function shouldBlockForDeviceMemory(deviceMemory?: number): boolean {
  return deviceMemory !== undefined && deviceMemory < 2
}
