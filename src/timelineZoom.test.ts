import {
  HORIZONTAL_ZOOM_MAX,
  HORIZONTAL_ZOOM_MAX_LEGACY,
  HORIZONTAL_ZOOM_MIN,
  HORIZONTAL_ZOOM_MIN_LEGACY,
  MAX_WAVEFORM_CANVAS_PX,
  anchoredScrollLeft,
  clampHorizontalZoom,
  pxPerSecond,
  sliderToZoom,
  tickIntervalSeconds,
  timeDeltaFromPx,
  timelineTicks,
  viewTimeWindow,
  waveformBitmapWidth,
  wheelZoom,
  zoomToSlider
} from './timelineZoom'

let failed = 0
function assert(cond: boolean, msg: string) {
  if (!cond) {
    failed++
    console.error('FAIL:', msg)
  } else {
    console.log('ok:', msg)
  }
}

assert(HORIZONTAL_ZOOM_MIN < HORIZONTAL_ZOOM_MIN_LEGACY, 'new min zooms out further than 0.5')
assert(HORIZONTAL_ZOOM_MAX > HORIZONTAL_ZOOM_MAX_LEGACY * 10, 'new max is much higher than 4')
assert(clampHorizontalZoom(0) === HORIZONTAL_ZOOM_MIN, 'clamps below min')
assert(clampHorizontalZoom(1e9) === HORIZONTAL_ZOOM_MAX, 'clamps above max')

const mid = sliderToZoom(zoomToSlider(8))
assert(Math.abs(mid - 8) / 8 < 0.02, 'log slider round-trips mid zoom')
assert(Math.abs(sliderToZoom(0) - HORIZONTAL_ZOOM_MIN) < 1e-9, 'slider 0 is min zoom')
assert(Math.abs(sliderToZoom(1000) - HORIZONTAL_ZOOM_MAX) < 1e-6, 'slider max is max zoom')

assert(pxPerSecond(200, 10) === 20, '20 px per second')
assert(timeDeltaFromPx(40, 20) === 2, 'N px / pxPerSec = seconds')
assert(timeDeltaFromPx(80, pxPerSecond(400, 10)) === 2, 'drag 80px at 40px/s is 2s')

const zoomed = wheelZoom(1, -400)
assert(zoomed > 1, 'wheel up zooms in')
assert(wheelZoom(1, 400) < 1, 'wheel down zooms out')
assert(wheelZoom(HORIZONTAL_ZOOM_MAX, -8000) === HORIZONTAL_ZOOM_MAX, 'wheel respects max')

const left = anchoredScrollLeft({
  scrollLeft: 100,
  mouseX: 200,
  oldZoom: 1,
  newZoom: 2,
  viewportWidth: 400
})
assert(Math.abs(left - 400) < 1e-6, 'zoom in keeps time under cursor (contentX 300 → 600, minus 200)')

const win = viewTimeWindow({ scrollLeft: 0, viewportWidth: 200, zoom: 1, layoutMax: 10, padPx: 0 })
assert(win.start === 0 && win.end === 10, 'zoom 1 shows the whole layoutMax')

assert(waveformBitmapWidth(50_000) === MAX_WAVEFORM_CANVAS_PX, 'caps canvas bitmap')
assert(waveformBitmapWidth(100, 2) === 200, 'uses dpr under the cap')

const coarse = tickIntervalSeconds(2, 52, 120)
assert(coarse >= 0.5, 'zoomed out uses coarse ticks')
const fine = tickIntervalSeconds(80_000, 52, 120)
assert(fine <= 0.01, 'sample-ish zoom uses fine ticks')

const ticks = timelineTicks({
  layoutMax: 8,
  pxPerSec: 50,
  viewStart: 0,
  viewEnd: 8,
  bpm: 120
})
assert(ticks.length > 0 && ticks.length < 240, 'virtualized tick count stays bounded')
assert(ticks[0].t >= 0 && ticks[ticks.length - 1].t <= 8, 'ticks stay inside the view')

if (failed > 0) {
  console.error(`\n${failed} assertion(s) failed`)
  process.exit(1)
}
console.log('\n✅ timeline zoom unit tests passed')
