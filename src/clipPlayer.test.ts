import {
  applyClipPlayback,
  clampPitchSemitones,
  clampTempoRate,
  effectiveBpm,
  songTimeFromWall,
  wallDelayForSong
} from './clipPlayer'

let failed = 0
function assert(cond: boolean, msg: string) {
  if (!cond) {
    failed++
    console.error('FAIL:', msg)
  } else {
    console.log('ok:', msg)
  }
}

assert(clampTempoRate(1) === 1, 'identity tempo')
assert(clampTempoRate(0.2) === 0.5, 'tempo floor 0.5x')
assert(clampTempoRate(3) === 1.5, 'tempo cap 1.5x')
assert(clampPitchSemitones(3.7) === 4, 'pitch rounds to semitone')
assert(clampPitchSemitones(-20) === -12, 'pitch floor')
assert(clampPitchSemitones(20) === 12, 'pitch cap')
assert(effectiveBpm(120, 0.5) === 60, 'half speed shows 60 BPM')
assert(effectiveBpm(120, 1.5) === 180, '1.5x shows 180 BPM')
assert(wallDelayForSong(4, 0.5) === 8, 'half speed waits twice as long')
assert(wallDelayForSong(4, 2) === 4 / 1.5, 'delay uses clamped rate')
assert(songTimeFromWall(10, 0, 4, 0.5) === 12, 'playhead advances at tempo rate')
assert(
  wallDelayForSong(6, 0.5) === 12,
  'GrainPlayer duration is wall-clock: remaining song seconds / tempoRate'
)

const node = { playbackRate: 1, detune: 0 }
applyClipPlayback(node, 0.75, -5)
assert(node.playbackRate === 0.75 && node.detune === -500, 'grain player rate + detune in cents')

if (failed > 0) {
  console.error(`\n${failed} assertion(s) failed`)
  process.exit(1)
}
console.log('\n✅ clip player unit tests passed')
