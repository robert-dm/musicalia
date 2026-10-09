import {
  DEMUCS_LANE_ORDER,
  SPLEETER_LANE_ORDER,
  demucsLanes,
  isNearSilent,
  selectAudibleStems,
  skippedStemNote,
  spleeterLanes,
  type DemucsStemBuffers,
} from './stemTracks'

let failed = 0
function assert(cond: boolean, msg: string) {
  if (!cond) {
    failed++
    console.error('FAIL:', msg)
  } else {
    console.log('ok:', msg)
  }
}

function fakeBuffer(peak: number, length = 32): AudioBuffer {
  const data = new Float32Array(length)
  if (peak !== 0) data[0] = peak
  return {
    numberOfChannels: 1,
    length,
    sampleRate: 44100,
    duration: length / 44100,
    getChannelData: () => data,
  } as unknown as AudioBuffer
}

assert(SPLEETER_LANE_ORDER.map((l) => l.name).join(',') === 'Vocals,Drums,Bass,Other', 'Básica names unchanged')
assert(DEMUCS_LANE_ORDER.length === 6, 'Demucs has 6 lanes')
assert(DEMUCS_LANE_ORDER.map((l) => l.name).join(',') === 'Voz,Batería,Bajo,Guitarra,Piano,Otros', 'Spanish Demucs names')

const spleeter = spleeterLanes({
  vocals: fakeBuffer(0.5),
  drums: fakeBuffer(0.5),
  bass: fakeBuffer(0.5),
  other: fakeBuffer(0.5),
})
assert(spleeter.length === 4 && spleeter[0].name === 'Vocals', 'Spleeter stays at 4 tracks')

const silent = fakeBuffer(0)
const loud = fakeBuffer(0.4)
assert(isNearSilent(silent), 'zero buffer is near-silent')
assert(!isNearSilent(loud), 'audible buffer is kept')

const stems = {
  vocals: loud,
  drums: loud,
  bass: loud,
  other: loud,
  guitar: silent,
  piano: silent,
} as DemucsStemBuffers
const { kept, skipped } = selectAudibleStems(demucsLanes(stems))
assert(kept.map((l) => l.name).join(',') === 'Voz,Batería,Bajo,Otros', 'keeps audible Demucs stems')
assert(skipped.map((l) => l.name).join(',') === 'Guitarra,Piano', 'skips silent guitar/piano')
assert((skippedStemNote(skipped) || '').includes('Guitarra'), 'Spanish skip note')

if (failed > 0) {
  console.error(`\n${failed} assertion(s) failed`)
  process.exit(1)
}
console.log('\n✅ stem track unit tests passed')
