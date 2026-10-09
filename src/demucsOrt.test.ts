import { shouldBlockForDeviceMemory, wasmSessionOptions, webgpuSessionOptions } from './demucsOrt'

let failed = 0
function assert(cond: boolean, msg: string) {
  if (!cond) {
    failed++
    console.error('FAIL:', msg)
  } else {
    console.log('ok:', msg)
  }
}

assert(!shouldBlockForDeviceMemory(undefined), 'unknown deviceMemory is allowed')
assert(!shouldBlockForDeviceMemory(4), '4 GB bucket is allowed')
assert(!shouldBlockForDeviceMemory(8), '8 GB bucket is allowed')
assert(shouldBlockForDeviceMemory(1), '1 GB bucket is blocked')
assert(!shouldBlockForDeviceMemory(2), '2 GB bucket is allowed to try')

const wasm = wasmSessionOptions()
assert(wasm.enableCpuMemArena === false && wasm.enableMemPattern === false, 'WASM disables arenas')
assert(wasm.graphOptimizationLevel === 'basic', 'WASM avoids full graph opt peak')
assert(wasm.executionProviders[0] === 'wasm', 'WASM provider')

const gpu = webgpuSessionOptions()
assert(gpu.executionProviders[0] === 'webgpu', 'WebGPU-only first (no wasm fallback in the same session)')
assert(gpu.enableMemPattern === false, 'WebGPU also skips mem pattern')

if (failed > 0) {
  console.error(`\n${failed} assertion(s) failed`)
  process.exit(1)
}
console.log('\n✅ demucs ort unit tests passed')
