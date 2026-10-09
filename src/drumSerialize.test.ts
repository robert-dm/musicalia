import { createEmptyDrumKit, expandDrumKit, setPatternStep, setPatternStepCount } from './drumKit'
import { programBasicBeat } from './drumProject'
import {
  hydrateDrumKit,
  hydratePatternClips,
  serializeDrumKit,
  serializePatternClip
} from './drumSerialize'

let failed = 0
function assert(cond: boolean, msg: string) {
  if (!cond) {
    failed++
    console.error('FAIL:', msg)
  } else {
    console.log('ok:', msg)
  }
}

const kit = setPatternStep(createEmptyDrumKit(), 0, 0, 2)
const json = serializeDrumKit(kit)
assert(json.pads.length === 8, 'serializes 8 starter pads')
assert(json.pads[0].name === 'Bombo', 'starter kick name')
assert(json.patterns.A.rows[0][0] === 2, 'programmed kick step survives')
assert(json.swing === 0, 'default swing 0')

const roundtrip = hydrateDrumKit(JSON.parse(JSON.stringify(json)))
assert(roundtrip.pads[0].name === 'Bombo', 'hydrate keeps pad name')
assert(roundtrip.patterns.A.rows[0][0] === 2, 'hydrate keeps velocity')
assert(roundtrip.patterns.B.rows[0].length === 16, 'empty patterns stay 16')

const long = setPatternStepCount(roundtrip, 32)
assert(long.patterns.A.stepCount === 32, 'switch to 32 steps')
assert(long.patterns.A.rows[0][0] === 2, 'existing hits kept when expanding')
assert(long.patterns.A.rows[0].length === 32, 'rows grow to 32')

const sixteen = expandDrumKit(roundtrip)
assert(sixteen.padCount === 16 && sixteen.pads.length === 16, 'expand to 16 pads')
assert(sixteen.patterns.A.rows.length === 16, 'pattern rows follow pad count')

const junk = hydrateDrumKit({ padCount: 99, activePattern: 'Z', swing: 4, pads: [{ volume: 8 }] })
assert(junk.padCount === 16, 'pad count clamps to 16')
assert(junk.activePattern === 'A', 'bad pattern falls back to A')
assert(junk.swing === 0.75, 'swing clamps to 0.75')
assert(junk.pads[0].volume === 1, 'volume clamps to 1')

const clip = serializePatternClip({
  id: 'c1',
  patternId: 'B',
  offsetSeconds: 2,
  duration: 4
})
assert(clip.kind === 'pattern' && clip.patternId === 'B', 'pattern clip kind')
assert(clip.fileName === 'Patrón B', 'default clip name')

const clips = hydratePatternClips([
  { kind: 'pattern', id: 'a', patternId: 'C', offsetSeconds: 0, duration: 2 },
  { kind: 'audio', id: 'nope' },
  { id: 'legacy', patternId: 'A', offsetSeconds: 1, duration: 1 }
])
assert(clips.length === 2, 'skips audio clips')
assert(clips[0].patternId === 'C' && clips[1].patternId === 'A', 'hydrates pattern ids')

const beat = serializeDrumKit(programBasicBeat(createEmptyDrumKit()))
assert(beat.patterns.A.rows[0][0] === 3, 'basic beat kick vel')
assert(beat.patterns.A.rows[1][4] === 3, 'basic beat snare vel')
assert(hydrateDrumKit(beat).patterns.A.rows[3][2] === 2, 'basic beat hat survives hydrate')

if (failed > 0) {
  console.error(`\n${failed} assertion(s) failed`)
  process.exit(1)
}
console.log('\n✅ drum serialize unit tests passed')
