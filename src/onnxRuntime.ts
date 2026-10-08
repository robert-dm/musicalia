import type * as OrtNS from 'onnxruntime-web'

const ORT_WASM_PATHS = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.30.0/dist/'

let ortLoad: Promise<typeof OrtNS> | null = null

export async function hasWebGPU(): Promise<boolean> {
  const gpu = (navigator as Navigator & { gpu?: { requestAdapter: () => Promise<unknown> } }).gpu
  if (!gpu) return false
  try {
    return !!(await gpu.requestAdapter())
  } catch {
    return false
  }
}

function configureOrt(ort: typeof OrtNS): void {
  const isolated = typeof crossOriginIsolated !== 'undefined' && crossOriginIsolated
  const hw = typeof navigator !== 'undefined' ? navigator.hardwareConcurrency || 4 : 4
  ort.env.wasm.numThreads = isolated ? Math.min(hw, 4) : 1
  ort.env.wasm.simd = true
  ort.env.wasm.proxy = isolated && typeof SharedArrayBuffer !== 'undefined'
  ort.env.wasm.wasmPaths = ORT_WASM_PATHS
}

export async function loadOnnxRuntime(preferWebGPU: boolean): Promise<typeof OrtNS> {
  if (!ortLoad) {
    ortLoad = (async () => {
      if (preferWebGPU) {
        try {
          const webgpu = await import('onnxruntime-web/webgpu')
          configureOrt(webgpu)
          return webgpu
        } catch (error) {
          console.warn('onnxruntime-web/webgpu no disponible, usando WASM', error)
        }
      }
      const wasm = await import('onnxruntime-web')
      configureOrt(wasm)
      return wasm
    })()
  }
  const ort = await ortLoad
  configureOrt(ort)
  return ort
}

export function isMobileUserAgent(ua = typeof navigator !== 'undefined' ? navigator.userAgent : ''): boolean {
  return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(ua)
}
