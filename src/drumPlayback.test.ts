import { createEmptyDrumKit, setPatternStep } from './drumKit'
import { collectClipHits, scheduledEventsForPlay } from './drumPlayback'
import { programBasicBeat } from './drumProject'
import { transportTimeForHit } from './drumTiming'

let failed = 0
function assert(cond: boolean, msg: string) {
  if (!cond) {
    failed++
    console.error('FAIL:', msg)
  } else {
    console.log('ok:', msg)
  }
}

const kit = programBasicBeat(createEmptyDrumKit())
const clips = [{ kind: 'pattern' as const, patternId: 'A' as const, offsetSeconds: 0, duration: 2 }]
const hits = collectClipHits({ kit, clips, bpm: 120, windowStart: 0, windowEnd: 2 })
const kicks = hits.filter((h) => h.padIndex === 0)
const snares = hits.filter((h) => h.padIndex === 1)
const hats = hits.filter((h) => h.padIndex === 3)
assert(kicks.length === 4, 'basic beat: 4 kicks')
assert(snares.length === 2, 'basic beat: 2 snares')
assert(hats.length === 8, 'basic beat: 8 hats')
assert(Math.abs(kicks[1].songTime - 0.5) < 1e-12, 'second kick at 0.5s')
assert(Math.abs(snares[0].songTime - 0.5) < 1e-12, 'snare on beat 2')

const events = scheduledEventsForPlay({
  kit,
  clips,
  bpm: 120,
  songTime: 0,
  playOriginSong: 0,
  tempoRate: 1,
  lookAhead: 2
})
assert(events.length === hits.length, 'schedule matches collected hits')
assert(
  events.every((e) => Math.abs(e.transportTime - e.songTime) < 1e-12),
  'at 1x tempo transport time equals song time'
)
assert(
  Math.abs(transportTimeForHit(0.5, 0, 1) - 0.5) < 1e-12,
  'snare transport time at 120 / 1x is 0.5'
)

const stepped = setPatternStep(createEmptyDrumKit(), 0, 1, 2)
const swung = scheduledEventsForPlay({
  kit: { ...stepped, swing: 0.5 },
  clips,
  bpm: 120,
  songTime: 0,
  playOriginSong: 0,
  tempoRate: 1,
  lookAhead: 2
})
assert(Math.abs(swung[0].songTime - 0.1875) < 1e-12, 'swing delays the offbeat hit')

if (failed > 0) {
  console.error(`\n${failed} assertion(s) failed`)
  process.exit(1)
}
console.log('\n✅ drum playback unit tests passed')
