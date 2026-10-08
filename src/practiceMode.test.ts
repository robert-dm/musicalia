import {
  AISLAR_BUTTON_TITLE,
  AISLAR_TRANSPORT_TITLE,
  newLaneJoinsSolo,
  resolvePracticeTrack,
  toggleAislar,
  togglePractice
} from './practiceMode'

let failed = 0
function assert(cond: boolean, msg: string) {
  if (!cond) {
    failed++
    console.error('FAIL:', msg)
  } else {
    console.log('ok:', msg)
  }
}

const tracks = [
  { mute: false, solo: false },
  { mute: false, solo: false },
  { mute: false, solo: false }
]

const prac = togglePractice(tracks, 1, null)
assert(prac.practiceIndex === 1 && prac.tracks[1].mute && !prac.tracks[0].mute, 'practicar mutes that stem')
assert(prac.tracks.every((t) => !t.solo), 'practicar clears solos so the rest play')

const off = togglePractice(prac.tracks, 1, 1)
assert(off.practiceIndex === null && !off.tracks[1].mute, 'second click leaves practice')

const switched = togglePractice(prac.tracks, 0, 1)
assert(switched.practiceIndex === 0 && switched.tracks[0].mute && !switched.tracks[1].mute, 'switching practice unmutes the previous stem')

const iso = toggleAislar(tracks, 2)
assert(iso.tracks[2].solo && iso.tracks.filter((t) => t.solo).length === 1, 'aislar is exclusive solo')
assert(!iso.tracks[2].mute && iso.practiceIndex === null, 'aislar unmutes the stem')

const isoOff = toggleAislar(iso.tracks, 2)
assert(!isoOff.tracks[2].solo, 'second aislar clears solo')

const withNewLane = [...iso.tracks, { mute: false, solo: true }]
const exitGroup = toggleAislar(withNewLane, 2)
assert(exitGroup.tracks.every((t) => !t.solo), 'Aislar off after play-along lane hears all tracks')

assert(!newLaneJoinsSolo(tracks), 'no solo: new lane stays unsoloed')
assert(newLaneJoinsSolo(iso.tracks), 'after Aislar, new lane must join solo or it is silent')
assert(AISLAR_BUTTON_TITLE.includes('Mute') && AISLAR_BUTTON_TITLE.includes('Solo'), 'Aislar tooltip contrasts Mute/Solo')
assert(AISLAR_TRANSPORT_TITLE.includes('Mute') && AISLAR_TRANSPORT_TITLE.includes('Solo'), 'transport Aislar explains vs Mute/Solo')

assert(resolvePracticeTrack(2, 0, 4) === 2, 'selected track wins')
assert(resolvePracticeTrack(null, 1, 4) === 1, 'armed track if none selected')
assert(resolvePracticeTrack(null, null, 3) === 0, 'falls back to first track')
assert(resolvePracticeTrack(null, null, 0) === null, 'no tracks')

if (failed > 0) {
  console.error(`\n${failed} assertion(s) failed`)
  process.exit(1)
}
console.log('\n✅ practice mode unit tests passed')
