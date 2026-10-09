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
  const wasm = ort.env.wasm as typeof snap
  Object.assign(wasm, snap)
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

/**
 * Run Demucs against onnxruntime-web without leaving Spleeter's global
 * ort.env.wasm settings changed. Never imports stemSeparator.
 */
export async function withIsolatedOnnxRuntime<T>(
  fn: (ort: typeof OrtNS) => Promise<T>
): Promise<T> {
  const ort = await import('onnxruntime-web')
  const snap = snapshotWasmEnv(ort)
  try {
    if (!ort.env.wasm.wasmPaths) {
      ort.env.wasm.wasmPaths = ORT_WASM_PATHS
    }
    return await fn(ort)
  } finally {
    restoreWasmEnv(ort, snap)
  }
}

export function isMobileUserAgent(ua = typeof navigator !== 'undefined' ? navigator.userAgent : ''): boolean {
  return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(ua)
}
