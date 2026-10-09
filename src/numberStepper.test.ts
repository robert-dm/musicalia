import {
  clampPitchSemitones,
  clampTempoRate,
  MAX_PITCH_SEMITONES,
  MAX_TEMPO_RATE,
  MIN_PITCH_SEMITONES,
  MIN_TEMPO_RATE,
  PITCH_SEMITONE_RESET,
  PITCH_SEMITONE_STEP,
  TEMPO_RATE_RESET,
  TEMPO_RATE_STEP
} from './clipPlayer'
import {
  formatPitchSemitones,
  formatTempoRate,
  parsePitchSemitones,
  parseTempoRate,
  STEPPER_VALUE_WIDTH_CH,
  stepClamped
} from './numberStepper'

let failed = 0
function assert(cond: boolean, msg: string) {
  if (!cond) {
    failed++
    console.error('FAIL:', msg)
  } else {
    console.log('ok:', msg)
  }
}

assert(TEMPO_RATE_STEP === 0.05, 'Vel step constant 0.05x')
assert(PITCH_SEMITONE_STEP === 0.5, 'Tono step constant 0.5 st')
assert(TEMPO_RATE_RESET === 1, 'Vel reset 1.00x')
assert(PITCH_SEMITONE_RESET === 0, 'Tono reset 0')

let rate = TEMPO_RATE_RESET
for (let i = 0; i < 10; i++) rate = stepClamped(rate, 1, TEMPO_RATE_STEP, clampTempoRate)
assert(rate === MAX_TEMPO_RATE, '10 Vel + steps from 1.00x reach 1.50x')
rate = stepClamped(rate, 1, TEMPO_RATE_STEP, clampTempoRate)
assert(rate === MAX_TEMPO_RATE, 'Vel clamps at 1.50x')

rate = TEMPO_RATE_RESET
for (let i = 0; i < 10; i++) rate = stepClamped(rate, -1, TEMPO_RATE_STEP, clampTempoRate)
assert(rate === MIN_TEMPO_RATE, '10 Vel − steps from 1.00x reach 0.50x')
rate = stepClamped(rate, -1, TEMPO_RATE_STEP, clampTempoRate)
assert(rate === MIN_TEMPO_RATE, 'Vel clamps at 0.50x')

let pitch = PITCH_SEMITONE_RESET
for (let i = 0; i < 24; i++) pitch = stepClamped(pitch, 1, PITCH_SEMITONE_STEP, clampPitchSemitones)
assert(pitch === MAX_PITCH_SEMITONES, '24 Tono + steps from 0 reach +12')
pitch = stepClamped(pitch, 1, PITCH_SEMITONE_STEP, clampPitchSemitones)
assert(pitch === MAX_PITCH_SEMITONES, 'Tono clamps at +12')

pitch = PITCH_SEMITONE_RESET
for (let i = 0; i < 24; i++) pitch = stepClamped(pitch, -1, PITCH_SEMITONE_STEP, clampPitchSemitones)
assert(pitch === MIN_PITCH_SEMITONES, '24 Tono − steps from 0 reach −12')

assert(formatTempoRate(0.5) === '0.50x', 'Vel min format')
assert(formatTempoRate(1) === '1.00x', 'Vel reset format')
assert(formatTempoRate(1.5) === '1.50x', 'Vel max format')
assert(formatTempoRate(0.95) === '0.95x', 'Vel 0.95x format')

const tempoFormats = [0.5, 0.55, 0.95, 1, 1.05, 1.5].map(formatTempoRate)
assert(
  tempoFormats.every((s) => s.length === 5),
  `Vel formats are 5 chars (${tempoFormats.join(', ')})`
)

assert(formatPitchSemitones(0) === '+0.0', 'Tono 0 format')
assert(formatPitchSemitones(0.5) === '+0.5', 'Tono +0.5 format')
assert(formatPitchSemitones(-0.5) === '-0.5', 'Tono −0.5 format')
assert(formatPitchSemitones(12) === '+12.0', 'Tono +12 format')
assert(formatPitchSemitones(-12) === '-12.0', 'Tono −12 format')

const pitchFormats = [-12, -0.5, 0, 0.5, 12].map(formatPitchSemitones)
assert(
  pitchFormats.every((s) => s.length <= STEPPER_VALUE_WIDTH_CH),
  `Tono formats fit ${STEPPER_VALUE_WIDTH_CH}ch (${pitchFormats.join(', ')})`
)

assert(parseTempoRate('1.00x') === 1, 'parse Vel with x')
assert(parseTempoRate(' 0.75 ') === 0.75, 'parse Vel number')
assert(parseTempoRate('nope') == null, 'parse Vel rejects junk')
assert(parsePitchSemitones('+3.5') === 3.5, 'parse Tono with plus')
assert(parsePitchSemitones('-1.5') === -1.5, 'parse Tono negative')
assert(parsePitchSemitones('abc') == null, 'parse Tono rejects junk')

if (failed > 0) {
  console.error(`\n${failed} assertion(s) failed`)
  process.exit(1)
}
console.log('\n✅ number stepper unit tests passed')
