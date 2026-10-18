import {
  appendTap,
  clampBpm,
  doubleBpm,
  formatBpm,
  halfBpm,
  parseBpmInput,
  roundBpm,
  tapTempoFromTimestamps
} from './tempoMath'

let failed = 0
function assert(cond: boolean, msg: string) {
  if (!cond) {
    failed++
    console.error('FAIL:', msg)
  } else {
    console.log('ok:', msg)
  }
}

assert(roundBpm(117.54) === 117.5, 'rounds to one decimal')
assert(roundBpm(117.55) === 117.6, 'rounds 117.55 up')
assert(clampBpm(10) === 20, 'clamps below 20')
assert(clampBpm(400) === 300, 'clamps above 300')
assert(parseBpmInput('117.5') === 117.5, 'parses 117.5')
assert(parseBpmInput('117,5') === 117.5, 'parses comma decimal')
assert(parseBpmInput('nope') === 120, 'invalid BPM falls back to 120')
assert(formatBpm(120) === '120', 'integer BPM has no decimal')
assert(formatBpm(117.5) === '117.5', 'prints one decimal')
assert(doubleBpm(76) === 152, '×2 76 → 152')
assert(halfBpm(152) === 76, '÷2 152 → 76')
assert(doubleBpm(200) === 300, '×2 clamps at 300')
assert(halfBpm(30) === 20, '÷2 clamps at 20')

const taps = [0, 500, 1000, 1500]
assert(tapTempoFromTimestamps(taps) === 120, '500 ms taps → 120 BPM')
assert(tapTempoFromTimestamps([0]) === null, 'one tap is not enough')
assert(tapTempoFromTimestamps([0, 394.7368, 789.4737, 1184.2105]) === 152, '152 BPM taps')

const reset = appendTap([0, 500], 4000)
assert(reset.length === 1 && reset[0] === 4000, 'long gap resets tap history')
assert(appendTap([1000, 1500], 2000).join(',') === '1000,1500,2000', 'appends a tap')

if (failed > 0) {
  console.error(`\n${failed} assertion(s) failed`)
  process.exit(1)
}
console.log('\n✅ tempo math unit tests passed')
