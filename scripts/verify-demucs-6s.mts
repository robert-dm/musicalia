/**
 * HT-Demucs 6-stem check against the shipped WASM model (folded graph).
 *
 *   npx tsx scripts/verify-demucs-6s.mts
 */
import { existsSync, statSync } from 'node:fs'
import { DEMUCS_N_SAMPLES, DEMUCS_STEM_ROWS } from '../src/demucsChunking.ts'

const MODEL_PATH = new URL('../public/models/htdemucs_6s_wasm.onnx', import.meta.url)
const MODEL_DATA = new URL('../public/models/htdemucs_6s_wasm.onnx.data', import.meta.url)

function tone(freq: number, sr: number, n: number, amp: number): Float32Array {
  const out = new Float32Array(n)
  const step = (2 * Math.PI * freq) / sr
  for (let i = 0; i < n; i++) out[i] = Math.sin(step * i) * amp
  return out
}

async function main() {
  const modelPath = MODEL_PATH.pathname
  const dataPath = MODEL_DATA.pathname
  if (!existsSync(modelPath) || !existsSync(dataPath)) {
    throw new Error(`missing ${modelPath} or ${dataPath}`)
  }
  console.log('model', modelPath, statSync(modelPath).size, 'data', statSync(dataPath).size)

  const ort = await import('onnxruntime-node') as typeof import('onnxruntime-node')
  const session = await ort.InferenceSession.create(modelPath, {
    executionProviders: ['cpu'],
    graphOptimizationLevel: 'disabled',
    enableCpuMemArena: false,
    enableMemPattern: false,
  })
  console.log('inputs', session.inputNames, 'outputs', session.outputNames)

  const n = DEMUCS_N_SAMPLES
  const mix = new Float32Array(2 * n)
  const kick = tone(80, 44100, n, 0.35)
  const bass = tone(110, 44100, n, 0.25)
  const guitar = tone(330, 44100, n, 0.2)
  const piano = tone(523.25, 44100, n, 0.18)
  const voice = tone(220, 44100, n, 0.22)
  const other = tone(880, 44100, n, 0.12)
  for (let i = 0; i < n; i++) {
    const sample = kick[i] + bass[i] + guitar[i] + piano[i] + voice[i] + other[i]
    mix[i] = sample
    mix[n + i] = sample * 0.92
  }

  const feeds = { mix: new ort.Tensor('float32', mix, [1, 2, n]) }
  const t0 = Date.now()
  const results = await session.run(feeds)
  const stems = results.stems ?? results[session.outputNames[0]]
  console.log('infer_ms', Date.now() - t0, 'dims', stems.dims)

  if (stems.dims.length !== 4 || stems.dims[0] !== 1 || stems.dims[1] !== 6 || stems.dims[2] !== 2 || stems.dims[3] !== n) {
    throw new Error(`unexpected dims ${JSON.stringify(stems.dims)}`)
  }

  const data = stems.data as Float32Array
  const stats = DEMUCS_STEM_ROWS.map((name, row) => {
    let peak = 0
    let sumSq = 0
    let finite = true
    const offset = row * 2 * n
    for (let i = 0; i < n; i++) {
      const v = data[offset + i]
      if (!Number.isFinite(v)) finite = false
      peak = Math.max(peak, Math.abs(v))
      sumSq += v * v
    }
    const rms = Math.sqrt(sumSq / n)
    return { name, peak, rms, finite }
  })
  console.log(JSON.stringify({ stats }, null, 2))

  if (stats.some((s) => !s.finite)) throw new Error('NaN/Inf in stems')
  const audible = stats.filter((s) => s.peak > 1e-4)
  if (audible.length === 0) throw new Error('all stems silent')
  console.log('OK htdemucs_6s wasm model; audible stems:', audible.map((s) => s.name).join(', '))
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
