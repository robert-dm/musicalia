import { normalizeDetectedBpm } from './bpmDetector'

let failed = 0
function assert(cond: boolean, msg: string) {
  if (!cond) {
    failed++
    console.error('FAIL:', msg)
  } else {
    console.log('ok:', msg)
  }
}

assert(normalizeDetectedBpm(105) === 105, '105 stays 105')
assert(normalizeDetectedBpm(52.5) === 105, 'half-time 52.5 → 105')
assert(normalizeDetectedBpm(210) === 105, 'double-time 210 → 105')
assert(normalizeDetectedBpm(120) === 120, '120 stays 120')
assert(normalizeDetectedBpm(null) === null, 'null is missing')
assert(normalizeDetectedBpm(0) === null, 'zero is missing')

if (failed > 0) {
  console.error(`\n${failed} assertion(s) failed`)
  process.exit(1)
}
console.log('\n✅ bpm normalize unit tests passed')
