import {
  cycleStepVelocity,
  hitsInWindow,
  patternPeriodSeconds,
  sixteenthSeconds,
  stepSongTime,
  transportTimeForHit
} from './drumTiming'

let failed = 0
function assert(cond: boolean, msg: string) {
  if (!cond) {
    failed++
    console.error('FAIL:', msg)
  } else {
    console.log('ok:', msg)
  }
}

assert(Math.abs(sixteenthSeconds(120) - 0.125) < 1e-12, '16th at 120 BPM is 0.125s')
assert(Math.abs(patternPeriodSeconds(16, 120) - 2) < 1e-12, '1 bar of 16ths at 120 = 2s')
assert(Math.abs(patternPeriodSeconds(32, 120) - 4) < 1e-12, '32 steps at 120 = 4s')
assert(Math.abs(stepSongTime(0, 120, 0) - 0) < 1e-12, 'step 0 at t=0')
assert(Math.abs(stepSongTime(4, 120, 0) - 0.5) < 1e-12, 'step 4 is beat 1')
assert(Math.abs(stepSongTime(1, 120, 0) - 0.125) < 1e-12, 'no swing on offbeat')
assert(Math.abs(stepSongTime(1, 120, 0.5) - 0.1875) < 1e-12, '50% swing delays odd 16ths by 0.0625')
assert(stepSongTime(0, 120, 0.5) === 0, 'downbeats ignore swing')

assert(cycleStepVelocity(0) === 2, 'empty → medium')
assert(cycleStepVelocity(2) === 3, 'medium → hard')
assert(cycleStepVelocity(3) === 1, 'hard → soft')
assert(cycleStepVelocity(1) === 0, 'soft → empty')

const rows = [
  [2, 0, 0, 0, 2, 0, 0, 0, 2, 0, 0, 0, 2, 0, 0, 0],
  [0, 0, 0, 0, 3, 0, 0, 0, 0, 0, 0, 0, 3, 0, 0, 0]
]
const hits = hitsInWindow({
  rows,
  stepCount: 16,
  bpm: 120,
  swing: 0,
  clipStart: 0,
  clipDuration: 2,
  windowStart: 0,
  windowEnd: 2
})
assert(hits.filter((h) => h.padIndex === 0).length === 4, 'kick on each beat')
assert(hits.filter((h) => h.padIndex === 1).length === 2, 'snare on 2 and 4')
assert(hits.every((h) => h.songTime >= 0 && h.songTime < 2), 'hits stay inside the bar')
assert(Math.abs(hits.find((h) => h.padIndex === 1)!.songTime - 0.5) < 1e-12, 'first snare at 0.5s')

const looped = hitsInWindow({
  rows,
  stepCount: 16,
  bpm: 120,
  swing: 0,
  clipStart: 0,
  clipDuration: 4,
  windowStart: 2,
  windowEnd: 4
})
assert(looped.filter((h) => h.padIndex === 0).length === 4, 'pattern repeats in second bar')
assert(Math.abs(looped[0].songTime - 2) < 1e-12, 'repeat starts at 2s')

const trimmed = hitsInWindow({
  rows,
  stepCount: 16,
  bpm: 120,
  swing: 0,
  clipStart: 1,
  clipDuration: 0.4,
  windowStart: 0,
  windowEnd: 10
})
assert(trimmed.every((h) => h.songTime >= 1 && h.songTime < 1.4), 'trim window clips hits')

assert(transportTimeForHit(2, 0, 1) === 2, 'identity transport time')
assert(Math.abs(transportTimeForHit(2, 0, 2) - 1) < 1e-12, '2x tempo lands earlier on transport')
assert(Math.abs(transportTimeForHit(3, 1, 0.5) - 5) < 1e-12, 'half speed stretches transport time')

if (failed > 0) {
  console.error(`\n${failed} assertion(s) failed`)
  process.exit(1)
}
console.log('\n✅ drum timing unit tests passed')
