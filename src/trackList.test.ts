import { newLaneJoinsSolo } from './practiceMode'
import {
  appendEmptyTrack,
  createEmptyTrack,
  initialEmptyTracks,
  insertEmptyTrack,
  nextPistaName,
  nextPistaNumber
} from './trackList'

let failed = 0
function assert(cond: boolean, msg: string) {
  if (!cond) {
    failed++
    console.error('FAIL:', msg)
  } else {
    console.log('ok:', msg)
  }
}

const eight = initialEmptyTracks()
assert(eight.length === 8, 'new session starts with 8 tracks')
assert(eight[0].name === 'Pista 1' && eight[7].name === 'Pista 8', 'initial names are Pista 1–8')
assert(eight[0].volume === 0.8 && eight[0].mute === false && eight[0].clips.length === 0, 'empty track defaults')

assert(nextPistaNumber(eight.map((t) => t.name), 8) === 9, 'next after Pista 1–8 is 9')
assert(nextPistaName(['Track 1', 'Track 8'], 8) === 'Pista 9', 'Track N names still yield Pista 9')
assert(nextPistaName(['Voces', 'Bateria'], 2) === 'Pista 3', 'custom names use count + 1')
assert(nextPistaName(['Pista 12'], 1) === 'Pista 13', 'uses highest existing number')

const nine = appendEmptyTrack(eight, createEmptyTrack)
assert(nine.length === 9 && nine[8].name === 'Pista 9', 'append adds Pista 9')
const ten = appendEmptyTrack(nine, createEmptyTrack)
assert(ten.length === 10 && ten[9].name === 'Pista 10', 'append adds Pista 10')
const inserted = insertEmptyTrack(eight, 1, createEmptyTrack)
assert(inserted.length === 9 && inserted[1].name === 'Pista 9', 'insert between keeps later tracks')
assert(inserted[0].name === 'Pista 1' && inserted[2].name === 'Pista 2', 'insert does not rename neighbors')
assert(insertEmptyTrack(eight, 0, createEmptyTrack)[0].name === 'Pista 9', 'insert at top')
assert(insertEmptyTrack(eight, 99, createEmptyTrack)[8].name === 'Pista 9', 'insert past end appends')

const created = createEmptyTrack('Pista 9')
assert(created.volume === 0.8 && created.solo === false && created.clips.length === 0, 'factory volume/mute/empty lane')

const afterStems = [
  { solo: false },
  { solo: true },
  { solo: false },
  { solo: false }
]
assert(newLaneJoinsSolo(afterStems), 'Aislar/solo after stems: added track must join or stay silent')
const joined = appendEmptyTrack(
  afterStems.map((t, i) => ({ ...createEmptyTrack(`Pista ${i + 1}`), ...t })),
  (name) => ({ ...createEmptyTrack(name), solo: newLaneJoinsSolo(afterStems) })
)
assert(joined[joined.length - 1].solo === true, 'appended lane is soloed so it can be heard')

if (failed > 0) {
  console.error(`\n${failed} assertion(s) failed`)
  process.exit(1)
}
console.log('\n✅ track list unit tests passed')
