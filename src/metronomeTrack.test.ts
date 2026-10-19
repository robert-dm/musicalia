import { buildTempoMap } from './beatTracker'
import { transportTimeForHit } from './drumTiming'
import {
  canDeleteTrack,
  canRenameTrack,
  clickTimesInRange,
  createMetronomeTrack,
  effectiveMetronomeGain,
  ensureMetronomeTrack,
  findMetronomeIndex,
  METRONOME_LOOKAHEAD_SECONDS,
  METRONOME_TRACK_NAME,
  metronomeIsOn,
  scheduledMetronomeClicks,
  secondsPerBeat,
  shouldExportMetronome
} from './metronomeTrack'

let failed = 0
function assert(cond: boolean, msg: string) {
  if (!cond) {
    failed++
    console.error('FAIL:', msg)
  } else {
    console.log('ok:', msg)
  }
}

assert(secondsPerBeat(120) === 0.5, '120 BPM → 0.5 s/beat')
assert(secondsPerBeat(60) === 1, '60 BPM → 1 s/beat')
assert(Math.abs(secondsPerBeat(140) - 60 / 140) < 1e-12, '140 BPM → 60/140 s/beat')

const at120 = clickTimesInRange({ bpm: 120, beatsPerBar: 4, end: 2 })
assert(at120.length === 4, '120 BPM 4/4 over 2s has 4 clicks')
assert(
  at120.every((c, i) => Math.abs(c.songTime - i * 0.5) < 1e-9),
  '120 BPM clicks land on 0, 0.5, 1.0, 1.5'
)
assert(at120[0].accent && at120[1].accent === false && at120[4] == null, 'accent on beat 1 of the bar')
assert(at120.map((c) => c.beatInBar).join(',') === '0,1,2,3', '4/4 beat-in-bar sequence')

const at60 = clickTimesInRange({ bpm: 60, beatsPerBar: 4, end: 4 })
assert(at60.map((c) => c.songTime).join(',') === '0,1,2,3', '60 BPM clicks on whole seconds')
assert(at60.filter((c) => c.accent).length === 1, '60 BPM 4/4 in 4s: one downbeat')

const triple = clickTimesInRange({ bpm: 120, beatsPerBar: 3, end: 3 })
assert(triple.length === 6, '120 BPM 3/4 over 3s has 6 clicks')
assert(
  triple.filter((c) => c.accent).map((c) => c.songTime).join(',') === '0,1.5',
  '3/4 accents every 1.5s (end-exclusive drops the barline at 3.0)'
)
assert(triple[0].accent && !triple[1].accent && !triple[2].accent && triple[3].accent, '3/4 accent pattern 1-2-3')

const waltz60 = clickTimesInRange({ bpm: 60, beatsPerBar: 3, end: 6 })
assert(waltz60.length === 6, '60 BPM 3/4 over 6s has 6 clicks')
assert(waltz60.filter((c) => c.accent).map((c) => c.songTime).join(',') === '0,3', '60 BPM 3/4 accents at 0 and 3')

const windowed = clickTimesInRange({ bpm: 120, beatsPerBar: 4, start: 0.5, end: 2 })
assert(windowed[0].songTime === 0.5 && windowed[windowed.length - 1].songTime === 1.5, 'range is start-inclusive, end-exclusive')

const velSong = clickTimesInRange({ bpm: 120, beatsPerBar: 4, end: 2 })
const velTransport = velSong.map((c) => transportTimeForHit(c.songTime, 0, 0.75))
assert(
  velSong.every((c, i) => Math.abs(c.songTime - i * 0.5) < 1e-9),
  'Vel 0.75x does not move song-time click grid'
)
assert(
  velTransport.every((t, i) => Math.abs(t - (i * 0.5) / 0.75) < 1e-9),
  'Vel 0.75x stretches transport times by 1/0.75'
)

const fromOrigin = scheduledMetronomeClicks({
  bpm: 120,
  beatsPerBar: 4,
  songTime: 0,
  playOriginSong: 0,
  tempoRate: 0.75,
  songEnd: 1
})
assert(fromOrigin.length === 2, 'schedules two clicks in 1s at 120 BPM')
assert(Math.abs(fromOrigin[1].transportTime - 0.5 / 0.75) < 1e-9, 'second click transport is 0.666… at 0.75x')

const looped = scheduledMetronomeClicks({
  bpm: 120,
  beatsPerBar: 4,
  songTime: 0,
  playOriginSong: 0,
  tempoRate: 1,
  songEnd: 10,
  loopEnabled: true,
  loopStart: 1,
  loopEnd: 2
})
assert(looped.every((c) => c.songTime >= 1 && c.songTime < 2), 'loop window clips scheduled clicks')
assert(looped.length === 2, 'loop 1–2s at 120 BPM: clicks at 1.0 and 1.5')

const metro = createMetronomeTrack()
assert(metro.name === METRONOME_TRACK_NAME && metro.kind === 'metronome', 'factory name/kind')
assert(metro.metronome?.numerator === 4 && metro.metronome?.clickSound === 'beep', 'factory meter is 4/4 beep')
assert(metro.mute === true && metro.volume === 0.8, 'muted by default with normal volume')
assert(!canDeleteTrack(metro) && !canRenameTrack(metro), 'cannot delete or rename')
assert(!shouldExportMetronome(metro), 'muted metronome is omitted from export')
assert(shouldExportMetronome({ ...metro, mute: false }), 'unmuted metronome is exported')

const oldSave: Array<{ name: string; kind?: string; mute: boolean }> = [
  { name: 'Pista 1', kind: 'audio', mute: false },
  { name: 'Pista 2', kind: 'audio', mute: false }
]
const upgraded = ensureMetronomeTrack(oldSave)
assert(upgraded.length === 3 && upgraded[0].kind === 'metronome', 'old save gets a metronome at the top')
assert(upgraded[0].mute === true, 'old save metronome is muted (ignore legacy toolbar flag)')
assert(ensureMetronomeTrack(upgraded) === upgraded, 'ensure is a no-op when already present')
assert(findMetronomeIndex(upgraded) === 0, 'metronome index is 0 after upgrade')
assert(metronomeIsOn(upgraded) === false, 'toolbar-on means track is unmuted')
assert(metronomeIsOn([{ kind: 'metronome', mute: false }]) === true, 'unmuted track turns the toolbar on')

const driftMap = buildTempoMap([0, 0.372, 0.76, 1.16], 156, 2)
const followClicks = clickTimesInRange({
  bpm: 120,
  meter: { followMode: 'follow' },
  tempoMap: driftMap,
  end: 1
})
assert(followClicks.map((c) => c.songTime).join(',') === '0,0.372,0.76', 'Seguir la canción uses beat-grid times')
const fixedOverMap = clickTimesInRange({
  bpm: 120,
  meter: { followMode: 'fixed' },
  tempoMap: driftMap,
  end: 1
})
assert(fixedOverMap.map((c) => c.songTime).join(',') === '0,0.5', 'Tempo fijo ignores the beat grid')

const followVel = scheduledMetronomeClicks({
  bpm: 120,
  meter: { followMode: 'follow' },
  tempoMap: driftMap,
  songTime: 0,
  playOriginSong: 0,
  tempoRate: 0.5,
  songEnd: 0.4
})
assert(followVel.length === 2 && followVel[1].songTime === 0.372, 'Vel does not move song-time beat grid')

const longTimes: number[] = []
for (let t = 0; t < 600; t += 0.375) longTimes.push(t)
const longMap = buildTempoMap(longTimes, 160, 600)
const lookahead = scheduledMetronomeClicks({
  bpm: 160,
  meter: { followMode: 'follow' },
  tempoMap: longMap,
  songTime: 0,
  playOriginSong: 0,
  tempoRate: 1,
  songEnd: 600
})
assert(lookahead.length > 4, 'lookahead still schedules the opening clicks')
assert(
  lookahead.every((c) => c.songTime < METRONOME_LOOKAHEAD_SECONDS + 1e-6),
  `follow clicks stay in the ${METRONOME_LOOKAHEAD_SECONDS}s lookahead, not the whole song`
)
assert(lookahead.length < 50, `does not schedule ~1600 clicks at once (got ${lookahead.length})`)
assert(Math.abs(followVel[1].transportTime - 0.372 / 0.5) < 1e-9, 'Vel 0.5x stretches follow-mode transport times')

assert(effectiveMetronomeGain(0.7, false) === 0.7, 'unmuted metro gain is volume')
assert(effectiveMetronomeGain(0.7, true) === 0, 'mute silences metro')
assert(effectiveMetronomeGain(1.4, false) === 1, 'metro gain clamps')

if (failed > 0) {
  console.error(`\n${failed} assertion(s) failed`)
  process.exit(1)
}
console.log('\n✅ metronome track unit tests passed')
