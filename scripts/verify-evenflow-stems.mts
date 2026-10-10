/**
 * Evenflow calibration: BPM on the mix, per-stem RMS on HT-Demucs chunks,
 * and a monotonic progress replay of worker/main interleaving.
 *
 *   npx tsx scripts/verify-evenflow-stems.mts [/path/to/evenflow.mp3]
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'
import { DEMUCS_N_SAMPLES, DEMUCS_STEM_ROWS, DEMUCS_STRIDE } from '../src/demucsChunking.ts'
import { createDemucsSession, loadDemucsOnnxRuntime } from '../src/demucsOrt.ts'
import { normalizeDetectedBpm } from '../src/bpmDetector.ts'
import { DEMUCS_EXTERNAL_DATA_PATH } from '../src/demucsModel.ts'
import {
  isMonotonic,
  makeProgressReporter,
  phaseProgress,
} from '../src/stemProgress.ts'
import { firstImportOffset } from '../src/sessionBpm.ts'
import { SILENT_ENERGY_RATIO, SILENT_RMS_DBFS, rmsToDbfs, stemEnergyRatio } from '../src/stemTracks.ts'

const mp3 = process.argv[2] || '/tmp/evenflow/evenflow.mp3'
const rawPath = join(tmpdir(), 'evenflow-44100.f32')
const MODEL_PATH = new URL('../public/models/htdemucs_6s_wasm.onnx', import.meta.url).pathname
const MODEL_DATA = new URL('../public/models/htdemucs_6s_wasm.onnx.data', import.meta.url).pathname

function decodeToF32(src: string): { left: Float32Array; right: Float32Array; sampleRate: number } {
  execFileSync('ffmpeg', ['-y', '-i', src, '-ac', '2', '-ar', '44100', '-f', 'f32le', rawPath], {
    stdio: 'ignore',
  })
  const buf = readFileSync(rawPath)
  const interleaved = new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4)
  const frames = Math.floor(interleaved.length / 2)
  const left = new Float32Array(frames)
  const right = new Float32Array(frames)
  for (let i = 0; i < frames; i++) {
    left[i] = interleaved[i * 2]
    right[i] = interleaved[i * 2 + 1]
  }
  return { left, right, sampleRate: 44100 }
}

function channelRms(ch: Float32Array): number {
  let s = 0
  for (let i = 0; i < ch.length; i++) s += ch[i] * ch[i]
  return Math.sqrt(s / Math.max(1, ch.length))
}

async function detectFromMix(left: Float32Array, right: Float32Array, sampleRate: number) {
  const { detectBPM } = await import('../src/bpmDetector.ts')
  const length = left.length
  const buffer = {
    numberOfChannels: 2,
    length,
    sampleRate,
    duration: length / sampleRate,
    getChannelData: (ch: number) => (ch === 0 ? left : right),
  } as unknown as AudioBuffer
  return detectBPM(buffer)
}

function wasmDistDir() {
  return fileURLToPath(new URL('../node_modules/onnxruntime-web/dist/', import.meta.url))
}

async function createVerifySession() {
  const graph = new Uint8Array(readFileSync(MODEL_PATH))
  const data = new Uint8Array(readFileSync(MODEL_DATA))
  try {
    const ortNode = await import('onnxruntime-node') as typeof import('onnxruntime-node')
    console.log('session create via onnxruntime-node')
    const session = await ortNode.InferenceSession.create(graph, {
      executionProviders: ['cpu'],
      graphOptimizationLevel: 'disabled',
      enableCpuMemArena: false,
      enableMemPattern: false,
      externalData: [{ path: DEMUCS_EXTERNAL_DATA_PATH, data }],
    })
    return { ort: ortNode, session, restore: () => undefined }
  } catch (error) {
    console.warn('onnxruntime-node unavailable, using onnxruntime-web', error instanceof Error ? error.message : error)
  }
  const loaded = await loadDemucsOnnxRuntime(false)
  loaded.ort.env.wasm.wasmPaths = wasmDistDir()
  loaded.ort.env.wasm.numThreads = 1
  loaded.ort.env.wasm.proxy = false
  console.log('session create via onnxruntime-web', wasmDistDir())
  const session = await createDemucsSession(loaded.ort, 'wasm', graph, data)
  return { ort: loaded.ort, session, restore: loaded.restore }
}

async function runChunks(
  left: Float32Array,
  right: Float32Array,
  chunkIndexes: number[]
) {
  if (!existsSync(MODEL_PATH) || !existsSync(MODEL_DATA)) {
    throw new Error(`missing ${MODEL_PATH} or ${MODEL_DATA}`)
  }
  const loaded = await createVerifySession()
  try {

    const acc = DEMUCS_STEM_ROWS.map(() => new Float32Array(left.length))
    const mixSlice = new Float32Array(left.length)
    let used = 0

    for (const i of chunkIndexes) {
      const start = i * DEMUCS_STRIDE
      if (start >= left.length) break
      const end = Math.min(start + DEMUCS_N_SAMPLES, left.length)
      const clen = end - start
      const chunk = new Float32Array(2 * DEMUCS_N_SAMPLES)
      chunk.set(left.subarray(start, end), 0)
      chunk.set(right.subarray(start, end), DEMUCS_N_SAMPLES)
      const t0 = Date.now()
      const results = await loaded.session.run({
        mix: new loaded.ort.Tensor('float32', chunk, [1, 2, DEMUCS_N_SAMPLES]),
      })
      console.log(`chunk ${i} ${Date.now() - t0}ms`)
      const stems = results.stems ?? results[loaded.session.outputNames[0]]
      const dataOut = stems.data as Float32Array
      for (let row = 0; row < DEMUCS_STEM_ROWS.length; row++) {
        const offset = row * 2 * DEMUCS_N_SAMPLES
        acc[row].set(dataOut.subarray(offset, offset + clen), start)
      }
      mixSlice.set(left.subarray(start, end), start)
      used += clen
    }

    try {
      loaded.session.release()
    } catch {
      /* ignore */
    }

    const mixRms = channelRms(mixSlice.subarray(0, Math.max(used, 1)))
    const edge = Math.min(4410, acc[0].length)
    const leading = DEMUCS_STEM_ROWS.map((name, row) => ({
      name,
      first100msRms: channelRms(acc[row].subarray(0, edge)),
    }))
    console.log('leading_100ms', JSON.stringify(leading))
    const rows = DEMUCS_STEM_ROWS.map((name, row) => {
      const rms = channelRms(acc[row])
      return {
        name,
        rms,
        dbfs: rmsToDbfs(rms),
        energy: stemEnergyRatio(rms, mixRms),
        omit: rmsToDbfs(rms) < SILENT_RMS_DBFS || stemEnergyRatio(rms, mixRms) < SILENT_ENERGY_RATIO,
      }
    })
    return { mixRms, mixDbfs: rmsToDbfs(mixRms), rows, leading }
  } finally {
    loaded.restore()
  }
}

function replayProgress(): number[] {
  const seen: number[] = []
  const reporter = makeProgressReporter((p) => seen.push(p.progress), Date.now())
  const steps = [
    { progress: phaseProgress('init', 1), stage: 'init' },
    { progress: phaseProgress('download', 0.5), stage: 'dl' },
    { progress: phaseProgress('download', 1), stage: 'dl done' },
    { progress: phaseProgress('decode', 1), stage: 'decode' },
    { progress: phaseProgress('session', 0.4), stage: 'session' },
    { progress: phaseProgress('init', 1), stage: 'worker restart' },
    { progress: phaseProgress('download', 0), stage: 'worker dl reset' },
    { progress: phaseProgress('infer', 0.2), stage: 'chunk 1' },
    { progress: phaseProgress('infer', 0.1), stage: 'stale pulse' },
    { progress: phaseProgress('infer', 1), stage: 'infer done' },
    { progress: phaseProgress('assemble', 1), stage: 'ola' },
    { progress: phaseProgress('tracks', 1), stage: 'done' },
  ]
  for (const step of steps) reporter.report(step)
  reporter.stop()
  return seen
}

async function main() {
  if (!existsSync(mp3)) throw new Error(`missing ${mp3}`)
  console.log('decoding', mp3)
  const { left, right, sampleRate } = decodeToF32(mp3)
  console.log('frames', left.length, 'seconds', (left.length / sampleRate).toFixed(2))

  const bpm = await detectFromMix(left, right, sampleRate)
  console.log('detected_bpm', bpm.bpm, 'normalized_52.5', normalizeDetectedBpm(52.5))
  const clipStart = firstImportOffset(false, 70)
  console.log('clip_start', clipStart)

  const nChunks = Math.max(1, Math.ceil(left.length / DEMUCS_STRIDE))
  const mid = Math.floor(nChunks / 2)
  const indexes = [0, mid].filter((i, idx, all) => i >= 0 && i < nChunks && all.indexOf(i) === idx)
  console.log('running chunks', indexes.join(','), 'of', nChunks)
  const { mixRms, mixDbfs, rows } = await runChunks(left, right, indexes)
  console.log(JSON.stringify({ mixRms, mixDbfs, rows }, null, 2))

  const progress = replayProgress()
  const mono = isMonotonic(progress)
  console.log('progress_log', progress)
  console.log('progress_monotonic', mono)
  if (!mono) throw new Error('progress was not monotonic')
  if (clipStart !== 0) throw new Error('first import must start at 0')

  const out = {
    durationSeconds: left.length / sampleRate,
    detectedBpm: bpm.bpm,
    clipStart,
    mixDbfs,
    rows,
    omitted: rows.filter((r) => r.omit).map((r) => r.name),
    progressMonotonic: mono,
    progress,
  }
  writeFileSync('/tmp/evenflow-verify.json', JSON.stringify(out, null, 2))
  console.log('OK evenflow verification → /tmp/evenflow-verify.json')
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
