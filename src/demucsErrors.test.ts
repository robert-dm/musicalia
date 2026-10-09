import { classifyDemucsError, formatDemucsError } from './demucsErrors'

let failed = 0
function assert(cond: boolean, msg: string) {
  if (!cond) {
    failed++
    console.error('FAIL:', msg)
  } else {
    console.log('ok:', msg)
  }
}

assert(classifyDemucsError(new Error('Cancelado por el usuario')) === 'cancel', 'cancel')
assert(classifyDemucsError(new Error('HT-Demucs no está disponible en móviles (poca memoria).')) === 'mobile', 'mobile not remapped as OOM')
assert(classifyDemucsError(new Error('RuntimeError: aborted(OOM)')) === 'oom', 'aborted OOM')
assert(classifyDemucsError(new Error('Failed to allocate memory')) === 'oom', 'allocate memory')
assert(classifyDemucsError(new Error('Cannot enlarge memory arrays')) === 'oom', 'wasm enlarge')
assert(classifyDemucsError(new Error('WebGPU device lost')) === 'runtime', 'webgpu init is not OOM')
assert(classifyDemucsError(new Error('Failed to fetch model')) === 'download', 'download')
assert(classifyDemucsError(new Error('onnxruntime session create failed')) === 'runtime', 'onnx session')

const oom = formatDemucsError(new Error('Failed to allocate memory'))
assert(oom.message.includes('Memoria insuficiente'), 'OOM headline')
assert(oom.message.includes('Failed to allocate memory'), 'OOM keeps original detail')

const gpu = formatDemucsError(new Error('WebGPU adapter request failed'))
assert(gpu.message.includes('WebGPU adapter request failed'), 'runtime keeps original detail')
assert(!gpu.message.startsWith('Memoria insuficiente'), 'webgpu is not classified as OOM')

if (failed > 0) {
  console.error(`\n${failed} assertion(s) failed`)
  process.exit(1)
}
console.log('\n✅ demucs error unit tests passed')
