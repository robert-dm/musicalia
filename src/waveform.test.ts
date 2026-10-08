import { waveformVerticalLayout } from './waveform'

let failed = 0
function assert(cond: boolean, msg: string) {
  if (!cond) {
    failed++
    console.error('FAIL:', msg)
  } else {
    console.log('ok:', msg)
  }
}

function almost(a: number, b: number, eps = 1e-9) {
  return Math.abs(a - b) <= eps
}

const tall = waveformVerticalLayout(176)
assert(almost(tall.centerY, 88), 'zero-line is mid-canvas at default 2x 88px lane')
assert(tall.amp > 70, 'amplitude uses most of the available height')
assert(tall.centerY - tall.amp >= 0, 'negative peaks stay inside the canvas')
assert(tall.centerY + tall.amp <= 176, 'positive peaks stay inside the canvas')

const shortCss = waveformVerticalLayout(44 * 2)
assert(almost(shortCss.centerY, 44), 'zero-line stays centered at minimum zoom (44px lane, 2x canvas)')
assert(shortCss.amp >= 20, 'short clips still have a visible amplitude')
assert(shortCss.centerY - shortCss.amp >= 0 && shortCss.centerY + shortCss.amp <= 88, 'short waveform fits the canvas')

const tiny = waveformVerticalLayout(10)
assert(almost(tiny.centerY, 5), 'even a 10px canvas centers the zero-line')
assert(tiny.amp > 0, 'tiny height still scales amplitude')

const invalid = waveformVerticalLayout(Number.NaN)
assert(invalid.centerY === 0.5 && invalid.amp >= 0.5, 'non-finite height falls back to 1px layout')

const oldTopPad = 48
const oldBottomPad = 16
const oldCenter = oldTopPad + (88 - oldTopPad - oldBottomPad) / 2
assert(oldCenter > 44, 'regression: old 48/16 padding sat below mid on a short 88px canvas')
assert(shortCss.centerY < oldCenter, 'new layout is higher (centered) than the old bottom-biased baseline')

assert(
  waveformVerticalLayout(200).amp > waveformVerticalLayout(80).amp,
  'amplitude scales up with available height'
)

if (failed > 0) {
  console.error(`\n${failed} assertion(s) failed`)
  process.exit(1)
}
console.log('\n✅ waveform layout unit tests passed')
