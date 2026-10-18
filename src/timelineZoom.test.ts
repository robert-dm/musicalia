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

const waltz = timelineTicks({
  layoutMax: 6,
  pxPerSec: 80,
  viewStart: 0,
  viewEnd: 6,
  bpm: 120,
  beatsPerBar: 3,
  pulseSeconds: 0.5,
  barSeconds: 1.5
})
assert(waltz.some((t) => t.kind === 'bar' && t.label === '1' && t.t === 0), '3/4 bar 1 at 0')
assert(waltz.some((t) => t.kind === 'bar' && t.label === '2' && Math.abs(t.t - 1.5) < 1e-9), '3/4 bar 2 at 1.5s')

const shifted = timelineTicks({
  layoutMax: 4,
  pxPerSec: 80,
  viewStart: 0,
  viewEnd: 4,
  bpm: 120,
  barSeconds: 2,
  pulseSeconds: 0.5,
  phaseSeconds: 0.12
})
assert(shifted.some((t) => t.kind === 'bar' && Math.abs(t.t - 0.12) < 1e-9), 'ruler follows metronome phase')

const mapped = timelineTicks({
  layoutMax: 4,
  pxPerSec: 80,
  viewStart: 0,
  viewEnd: 4,
  bpm: 120,
  mapBeats: [
    { t: 0, downbeat: true },
    { t: 0.4 },
    { t: 0.85 },
    { t: 1.3, downbeat: true }
  ]
})
assert(mapped[0]?.kind === 'bar' && mapped[0].t === 0, 'follow-mode ruler uses the first downbeat')
assert(mapped.some((t) => t.kind === 'beat' && t.t === 0.4), 'follow-mode ruler shows in-between beats')
assert(mapped.some((t) => t.kind === 'bar' && t.t === 1.3 && t.label === '2'), 'follow-mode ruler numbers bars from the map')

const sidePeriod = 60 / 160.2
const lateMapped = timelineTicks({
  layoutMax: 6,
  pxPerSec: 80,
  viewStart: 0,
  viewEnd: 6,
  bpm: 160.2,
  beatsPerBar: 4,
  pulseSeconds: sidePeriod,
  mapBeats: [1, 2, 3, 4, 5, 6, 7, 8].map((i) => ({
    t: i * sidePeriod,
    downbeat: (i - 1) % 4 === 0
  }))
})
assert(
  lateMapped.some((t) => t.kind === 'bar' && t.label === '1' && Math.abs(t.t) < 1e-9),
  'follow ruler draws bar 1 at t=0 when the map starts one beat late'
)
assert(
  lateMapped.some((t) => t.kind === 'beat' && Math.abs(t.t - sidePeriod) < 1e-6),
  'follow ruler keeps the first detected beat'
)

const pickupMapped = timelineTicks({
  layoutMax: 6,
  pxPerSec: 80,
  viewStart: 0,
  viewEnd: 6,
  bpm: 160.2,
  beatsPerBar: 4,
  pulseSeconds: sidePeriod,
  mapBeats: [
    { t: 0, downbeat: true, bar: 0 },
    { t: sidePeriod },
    { t: sidePeriod * 2 },
    { t: sidePeriod * 3 },
    { t: sidePeriod * 4, downbeat: true, bar: 1 }
  ]
})
assert(
  pickupMapped.some((t) => t.kind === 'bar' && t.label === '1' && Math.abs(t.t - sidePeriod * 4) < 1e-6),
  'Poner el 1 acá keeps bar 1 on the user downbeat'
)
assert(
  pickupMapped.some((t) => t.kind === 'bar' && t.label === '0' && t.t === 0),
  'pickup still numbers the origin so the ruler is not empty'
)

if (failed > 0) {
  console.error(`\n${failed} assertion(s) failed`)
  process.exit(1)
}
console.log('\n✅ timeline zoom unit tests passed')
