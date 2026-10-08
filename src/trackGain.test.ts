import { effectiveTrackGain, rampTrackGain } from './trackGain'

let failed = 0
function assert(cond: boolean, msg: string) {
  if (!cond) {
    failed++
    console.error('FAIL:', msg)
  } else {
    console.log('ok:', msg)
  }
}

assert(effectiveTrackGain(0.7, false, false, false) === 0.7, 'unmuted gain is volume')
assert(effectiveTrackGain(0.7, true, false, false) === 0, 'mute silences')
assert(effectiveTrackGain(0.7, false, false, true) === 0, 'non-solo track silent when any solo')
assert(effectiveTrackGain(0.7, false, true, true) === 0.7, 'soloed track keeps volume')
assert(effectiveTrackGain(1.5, false, false, false) === 1, 'clamps above 1')
assert(effectiveTrackGain(-0.2, false, false, false) === 0, 'clamps below 0')

const ramped: { value: number; last?: [number, number] } = { value: 0.8 }
const node = {
  gain: {
    get value() { return ramped.value },
    set value(v: number) { ramped.value = v },
    rampTo(v: number, s: number) { ramped.last = [v, s]; ramped.value = v }
  }
}
rampTrackGain(node, 0.25, 0.02)
assert(ramped.last?.[0] === 0.25 && ramped.last?.[1] === 0.02, 'uses rampTo to avoid zipper noise')

const plain = { gain: { value: 0.5 } }
rampTrackGain(plain, 0.1)
assert(plain.gain.value === 0.1, 'falls back to immediate value without rampTo')

if (failed > 0) {
  console.error(`\n${failed} assertion(s) failed`)
  process.exit(1)
}
console.log('\n✅ track gain unit tests passed')
