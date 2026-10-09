import {
  applyClipTrim,
  applyTrimPreviewPx,
  applyTrimPreviewStyles,
  deltaTimeFromLanePx,
  trimStatesEqual,
  waveformCropStyle
} from './clipTrim'

let failed = 0
function assert(cond: boolean, msg: string) {
  if (!cond) {
    failed++
    console.error('FAIL:', msg)
  } else {
    console.log('ok:', msg)
  }
}

const orig = { sourceStart: 1, duration: 4, offsetSeconds: 8, bufferDuration: 10 }

const left = applyClipTrim('left', 1, orig)
assert(left.sourceStart === 2, 'left trim advances sourceStart')
assert(left.duration === 3, 'left trim shortens duration from origin')
assert(left.offsetSeconds === 9, 'left trim moves clip on the timeline')

const leftBack = applyClipTrim('left', -1, orig)
assert(leftBack.sourceStart === 0, 'left trim cannot go below 0')
assert(leftBack.duration === 5, 'revealing earlier audio lengthens the clip')
assert(leftBack.offsetSeconds === 7, 'clip moves left when revealing start')

const right = applyClipTrim('right', -1.5, orig)
assert(right.duration === 2.5 && right.sourceStart === 1 && right.offsetSeconds === 8, 'right trim only changes duration')

const rightMax = applyClipTrim('right', 100, orig)
assert(rightMax.duration === 9, 'right trim cannot exceed remaining buffer')

const tiny = applyClipTrim('right', -100, orig)
assert(tiny.duration === 0.1, 'duration floors at 0.1s')

assert(deltaTimeFromLanePx(50, 200, 100) === 25, 'lane px maps to time')
assert(deltaTimeFromLanePx(10, 0, 100) === 0, 'zero-width lane is 0')

const crop = waveformCropStyle(2, 4, 10)
assert(crop.widthPct === 250, 'full waveform is buffer/visible wide')
assert(crop.translatePct === -20, 'crop offset is sourceStart/buffer')

const wrap = { style: { left: '', width: '' } }
const wave = { style: { width: '', transform: '' } }
applyTrimPreviewStyles(wrap, wave, left, 10, 100)
assert(wrap.style.left === '9%' && wrap.style.width === '3%', 'preview writes left/width percents')
assert(wave.style.width === `${(10 / 3) * 100}%`, 'preview waveform width follows crop')
assert(wave.style.transform.includes('translateX'), 'preview shifts waveform with translateX')

const pxWrap = { style: { transform: '', width: '', zIndex: '', willChange: '' } }
applyTrimPreviewPx(pxWrap, wave, left, orig, 80, 20, 10)
assert(pxWrap.style.transform === 'translateX(20px)', 'trim preview dx = Δoffset * pxPerSec')
assert(pxWrap.style.width === '60px', 'trim preview width = origWidth + Δduration * pxPerSec')

assert(trimStatesEqual(left, { ...left }), 'equal trim states')
assert(!trimStatesEqual(left, right), 'different trim states')

if (failed > 0) {
  console.error(`\n${failed} assertion(s) failed`)
  process.exit(1)
}
console.log('\n✅ clip trim unit tests passed')
