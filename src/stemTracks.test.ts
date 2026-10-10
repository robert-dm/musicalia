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
assert((skippedStemNote(skipped) || '') === 'Se omitieron: Guitarra, Piano (sin contenido)', 'Spanish skip note')

function constRms(rms: number, length = 1000): AudioBuffer {
  const data = new Float32Array(length)
  data.fill(rms)
  return {
    numberOfChannels: 1,
    length,
    sampleRate: 44100,
    duration: length / 44100,
    getChannelData: () => data,
  } as unknown as AudioBuffer
}

const mixish = { rms: 0.15 }
const bleed = constRms(0.015)
assert(isNearSilent(bleed, mixish.rms), '2% energy vs mix is omitted')
assert(!isNearSilent(loud, mixish.rms), 'real part vs mix is kept')
assert(isNearSilent(constRms(0.002), mixish.rms), 'Evenflow-like piano (-54 dBFS) is omitted')
assert(!isNearSilent(constRms(0.06), mixish.rms), 'guitar-level stem is kept')

// Measured on Evenflow via scripts/verify-evenflow-stems.mts (chunks 0 + 25).
const evenflowMix = 0.0899
assert(isNearSilent(constRms(0.000019), evenflowMix), 'Evenflow piano (−94 dBFS) is omitted')
assert(isNearSilent(constRms(0.0000095), evenflowMix), 'Evenflow other (−100 dBFS) is omitted')
assert(!isNearSilent(constRms(0.0148), evenflowMix), 'Evenflow guitar is kept')
assert(!isNearSilent(constRms(0.0129), evenflowMix), 'Evenflow bass is kept')

if (failed > 0) {
  console.error(`\n${failed} assertion(s) failed`)
  process.exit(1)
}
console.log('\n✅ stem track unit tests passed')
