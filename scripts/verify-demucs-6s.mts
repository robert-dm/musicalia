/**
 * Real HT-Demucs 6-stem inference check (Node onnxruntime).
 * Downloads StemSplitio htdemucs_6s_fp16weights.onnx if missing, runs one
 * 7.8 s chunk, and asserts output shape + non-silent stems.
 *
 *   npx tsx scripts/verify-demucs-6s.mts
 */
import { createWriteStream, existsSync, statSync } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import { pipeline } from 'node:stream/promises'
import { Readable } from 'node:stream'
import { DEMUCS_MODEL_URL, DEMUCS_MODEL_BYTES } from '../src/demucsSeparator.ts'
import { DEMUCS_N_SAMPLES, DEMUCS_STEM_ROWS } from '../src/demucsChunking.ts'

const MODEL_PATH = '/tmp/musicalia-verify/htdemucs_6s_fp16weights.onnx'

function tone(freq: number, sr: number, n: number, amp: number): Float32Array {
  const out = new Float32Array(n)
  const step = (2 * Math.PI * freq) / sr
  for (let i = 0; i < n; i++) out[i] = Math.sin(step * i) * amp
  return out
}

async function ensureModel(): Promise<string> {
  await mkdir('/tmp/musicalia-verify', { recursive: true })
  if (existsSync(MODEL_PATH) && statSync(MODEL_PATH).size > 10_000_000) {
    console.log('Using cached model', MODEL_PATH, statSync(MODEL_PATH).size)
    return MODEL_PATH
  }
  console.log('Downloading', DEMUCS_MODEL_URL)
  const res = await fetch(DEMUCS_MODEL_URL)
  if (!res.ok || !res.body) throw new Error(`download failed: ${res.status}`)
  const out = createWriteStream(MODEL_PATH)
  await pipeline(Readable.fromWeb(res.body as never), out)
  const size = statSync(MODEL_PATH).size
  console.log('Downloaded', size, 'bytes (hint', DEMUCS_MODEL_BYTES, ')')
  if (size < 10_000_000) throw new Error('model file too small')
  return MODEL_PATH
}

async function main() {
  const modelPath = await ensureModel()
  const ort = await import('onnxruntime-node') as typeof import('onnxruntime-node')
  const session = await ort.InferenceSession.create(modelPath, {
    executionProviders: ['cpu'],
    graphOptimizationLevel: 'all',
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
  console.log('OK htdemucs_6s loaded; audible stems:', audible.map((s) => s.name).join(', '))
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
