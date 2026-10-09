import {
  DEMUCS_N_SAMPLES,
  DEMUCS_OVERLAP,
  DEMUCS_SAMPLE_RATE,
  DEMUCS_STEM_ROWS,
  DEMUCS_STRIDE,
  accumulateStemChannel,
  demucsChunkCount,
  makeTransitionWindow,
  normalizeOverlapAdd,
  packStereoChunk,
} from './demucsChunking'

let failed = 0
function assert(cond: boolean, msg: string) {
  if (!cond) {
    failed++
    console.error('FAIL:', msg)
  } else {
    console.log('ok:', msg)
  }
}

function almost(a: number, b: number, eps = 1e-5) {
  return Math.abs(a - b) <= eps
}

assert(DEMUCS_SAMPLE_RATE === 44100, '44.1 kHz')
assert(DEMUCS_N_SAMPLES === 343980, '7.8 s chunk size')
assert(DEMUCS_OVERLAP === Math.floor(343980 / 4), '25% overlap')
assert(DEMUCS_STRIDE === DEMUCS_N_SAMPLES - DEMUCS_OVERLAP, 'stride')
assert(DEMUCS_STEM_ROWS.join(',') === 'drums,bass,other,vocals,guitar,piano', 'ONNX 6-stem row order')

assert(demucsChunkCount(1) === 1, 'short audio is one chunk')
assert(demucsChunkCount(DEMUCS_N_SAMPLES) === 2, 'one full segment plus overlap chunk')
assert(demucsChunkCount(DEMUCS_STRIDE) === 1, 'exactly one stride is one chunk')
assert(demucsChunkCount(DEMUCS_STRIDE + 1) === 2, 'one sample over stride is two chunks')

const w = makeTransitionWindow(8, 4)
assert(almost(w[0], 0) && almost(w[3], 1) && almost(w[4], 1) && almost(w[7], 0), 'linspace fade window')

const left = new Float32Array([1, 2, 3, 4, 5])
const right = new Float32Array([9, 8, 7, 6, 5])
const packed = packStereoChunk(left, right, 3, 5, 4)
assert(packed.length === 8, 'packed stereo length')
assert(packed[0] === 4 && packed[1] === 5 && packed[2] === 0, 'left padded')
assert(packed[4] === 6 && packed[5] === 5 && packed[6] === 0, 'right padded')

const n = 4
const stems = new Float32Array(1 * 6 * 2 * n)
const vocalsLeft = (3 * 2 + 0) * n
stems.set([1, 1, 1, 1], vocalsLeft)
const out = new Float32Array(4)
const weight = new Float32Array(4)
const win = makeTransitionWindow(4, 2)
accumulateStemChannel(stems, n, 3, 0, 0, 4, win, out, weight)
assert(almost(out[1], win[1]) && almost(out[2], win[2]), 'weighted accumulate')
normalizeOverlapAdd([out], weight)
assert(almost(out[1], 1) && almost(out[2], 1), 'overlap-add normalize')

if (failed > 0) {
  console.error(`\n${failed} assertion(s) failed`)
  process.exit(1)
}
console.log('\n✅ demucs chunking unit tests passed')
