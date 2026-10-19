import {
  DEFAULT_METRONOME_METER,
  barDurationSeconds,
  formatClickBarsBadge,
  formatTimeSignature,
  hydrateMetronomeMeter,
  hydrateTrackMetronome,
  isCompoundMeter,
  meterFromBeatsPerBar,
  metronomeClicksInRange,
  nudgePhaseSeconds,
  phaseFromDownbeat,
  phaseMs,
  pulseDurationSeconds,
  pulsesPerBar,
  resetMetronomeToFixedTempo,
  serializeMetronomeMeter,
  serializeTrackMetronome
} from './metronomeMeter'

let failed = 0
function assert(cond: boolean, msg: string) {
  if (!cond) {
    failed++
    console.error('FAIL:', msg)
  } else {
    console.log('ok:', msg)
  }
}

assert(formatTimeSignature({ numerator: 7, denominator: 8 }) === '7/8', 'prints 7/8')
assert(isCompoundMeter(6, 8) && isCompoundMeter(12, 8) && !isCompoundMeter(7, 8), '6/8 and 12/8 are compound')
assert(barDurationSeconds(120, { ...DEFAULT_METRONOME_METER, numerator: 4, denominator: 4 }) === 2, '4/4 bar at 120 is 2s')
assert(barDurationSeconds(120, { ...DEFAULT_METRONOME_METER, numerator: 3, denominator: 4 }) === 1.5, '3/4 bar at 120 is 1.5s')
assert(barDurationSeconds(120, { ...DEFAULT_METRONOME_METER, numerator: 6, denominator: 8 }) === 1.5, '6/8 bar at 120 is 1.5s')
assert(barDurationSeconds(120, { ...DEFAULT_METRONOME_METER, numerator: 7, denominator: 8 }) === 1.75, '7/8 bar at 120 is 1.75s')

const sixEight = { ...DEFAULT_METRONOME_METER, numerator: 6, denominator: 8, compoundPulse: 'dotted-quarter' as const }
assert(Math.abs(pulseDurationSeconds(120, sixEight) - 0.75) < 1e-12, '6/8 dotted-quarter pulse is 0.75s at 120')
assert(pulsesPerBar(sixEight, 120) === 2, '6/8 dotted-quarter has 2 clicks per bar')

const sixEight8 = { ...sixEight, compoundPulse: 'eighth' as const }
assert(Math.abs(pulseDurationSeconds(120, sixEight8) - 0.25) < 1e-12, '6/8 eighth pulse is 0.25s at 120')
assert(pulsesPerBar(sixEight8, 120) === 6, '6/8 eighths have 6 clicks per bar')

const four = metronomeClicksInRange({ bpm: 120, end: 2 })
assert(four.length === 4 && four[0].accent && !four[1].accent, 'default 4/4 accents beat 1')
assert(four.map((c) => c.songTime).join(',') === '0,0.5,1,1.5', '4/4 clicks on quarters')

const noAccent = metronomeClicksInRange({
  bpm: 120,
  end: 2,
  meter: { ...DEFAULT_METRONOME_METER, accentDownbeat: false }
})
assert(noAccent.every((c) => !c.accent), 'Acentuar el 1 off removes accents')

const eighths = metronomeClicksInRange({
  bpm: 120,
  end: 0.5,
  meter: { ...DEFAULT_METRONOME_METER, subdivision: 'eighths' }
})
assert(eighths.length === 2, '8th subdivision adds the off-beat in half a second')
assert(eighths[0].sub === false && eighths[1].sub === true, 'off-beat is a subdivision click')

const aligned = metronomeClicksInRange({
  bpm: 120,
  end: 2.2,
  meter: { ...DEFAULT_METRONOME_METER, phaseSeconds: 0.12 }
})
assert(Math.abs(aligned[0].songTime - 0.12) < 1e-9, 'phase shifts the first click')
assert(aligned[0].accent, 'shifted first click is still the downbeat')

assert(Math.abs(phaseFromDownbeat(2.12, 120, DEFAULT_METRONOME_METER) - 0.12) < 1e-9, 'click-to-align wraps into the bar')
assert(phaseMs(0.12, 120, DEFAULT_METRONOME_METER) === 120, 'phase in ms')
assert(
  Math.abs(nudgePhaseSeconds(0.12, 10, 120, DEFAULT_METRONOME_METER) - 0.13) < 1e-9,
  'nudge +10 ms'
)

const custom = hydrateMetronomeMeter({
  numerator: 5,
  denominator: 4,
  compoundPulse: 'eighth',
  phaseSeconds: 0.2,
  accentDownbeat: false,
  subdivision: 'triplets',
  clickSound: 'rim',
  clickBars: 8,
  clickRepeatEachLoop: true
})
const saved = serializeMetronomeMeter(custom)
assert(saved.numerator === 5 && saved.denominator === 4 && saved.clickSound === 'rim', 'persists custom meter')
assert(saved.subdivision === 'triplets' && saved.accentDownbeat === false, 'persists subdivision and accent')
assert(saved.followMode === 'follow', 'missing followMode hydrates to Seguir la canción')
assert(saved.clickBars === 8 && saved.clickRepeatEachLoop === true, 'click duration persists in .musicalia')
assert(hydrateMetronomeMeter({ followMode: 'fixed' }).followMode === 'fixed', 'Tempo fijo persists')
assert(hydrateMetronomeMeter(undefined).numerator === 4, 'missing meter hydrates 4/4')
assert(
  hydrateMetronomeMeter({ numerator: 4 }).clickBars == null
    && hydrateMetronomeMeter({ numerator: 4 }).clickRepeatEachLoop === false,
  'missing duration hydrates to Siempre'
)
assert(hydrateMetronomeMeter({ clickBars: 0 }).clickBars == null, 'clickBars 0 is Siempre')
assert(hydrateMetronomeMeter({ clickBars: 140 }).clickBars === 99, 'clickBars clamps at 99')
assert(formatClickBarsBadge(4) === 'Clic: 4 compases', 'badge for 4 bars')
assert(formatClickBarsBadge(1) === 'Clic: 1 compás', 'badge singular')
assert(formatClickBarsBadge(null) == null, 'Siempre has no badge')

const reset = resetMetronomeToFixedTempo({
  ...custom,
  followMode: 'follow',
  phaseSeconds: 0.42
})
assert(reset.followMode === 'fixed', 'Resetear tempo switches to Tempo fijo')
assert(reset.phaseSeconds === 0, 'Resetear tempo clears the phase / accent offset')
assert(reset.numerator === 5 && reset.clickSound === 'rim', 'Resetear tempo keeps the rest of the meter')
assert(reset.clickBars === 8, 'Resetear tempo keeps click duration')

const trackJson = { kind: 'metronome', metronome: saved }
assert(serializeTrackMetronome(trackJson).metronome?.clickSound === 'rim', 'track payload keeps rim')
assert(hydrateTrackMetronome(trackJson, 'metronome').metronome?.numerator === 5, 'track hydrate reads 5/4')
assert(hydrateTrackMetronome({}, 'audio').metronome == null, 'audio tracks omit meter')
assert(meterFromBeatsPerBar(3).numerator === 3 && meterFromBeatsPerBar(3).denominator === 4, 'legacy 3 beats → 3/4')

if (failed > 0) {
  console.error(`\n${failed} assertion(s) failed`)
  process.exit(1)
}
console.log('\n✅ metronome meter unit tests passed')
