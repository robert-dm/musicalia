import { resampleChannel, resampleToLength } from './audioResample'

let failed = 0
function assert(cond: boolean, msg: string) {
  if (!cond) {
    failed++
    console.error('FAIL:', msg)
  } else {
    console.log('ok:', msg)
  }
}

function almost(a: number, b: number, eps = 1e-4) {
  return Math.abs(a - b) <= eps
}

const original = new Float32Array([0, 1, 0, -1, 0])
const same = resampleChannel(original, 44100, 44100)
assert(same.length === original.length, 'same-rate keeps length')
assert(same[2] === 0 && same !== original, 'same-rate returns a copy')

const up = resampleToLength(new Float32Array([0, 1]), 5)
assert(up.length === 5, 'upsample length')
assert(almost(up[0], 0) && almost(up[4], 1), 'upsample endpoints')
assert(almost(up[2], 0.5), 'upsample midpoint')

const down = resampleChannel(new Float32Array([0, 0.25, 0.5, 0.75, 1]), 48000, 24000)
assert(down.length === 3, '48k to 24k halves (rounded)')
assert(almost(down[0], 0) && almost(down[2], 1), 'downsample endpoints')

const back = resampleToLength(down, 5)
assert(back.length === 5, 'round-trip target length')
assert(almost(back[0], 0) && almost(back[4], 1), 'round-trip endpoints')

if (failed > 0) {
  console.error(`\n${failed} assertion(s) failed`)
  process.exit(1)
}
console.log('\n✅ audio resample unit tests passed')
