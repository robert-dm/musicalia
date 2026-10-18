import {
  WAVEFORM_MIP_STEPS,
  WAVEFORM_SAMPLE_LOD,
  WAVEFORM_SAMPLE_THRESHOLD,
  WAVEFORM_TILE_CSS_PX,
  bestAvailableLod,
  canvasDeviceSize,
  columnsFromMip,
  getOrComputeMips,
  getOrComputePeaks,
  pickWaveformLod,
  samplesPerDevicePixel,
  tileRanges,
  visibleHostRange,
  waveformVerticalLayout
} from './waveform'

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

assert(pickWaveformLod(0.4) === WAVEFORM_SAMPLE_LOD, 'sub-sample zoom uses the sample line')
assert(pickWaveformLod(WAVEFORM_SAMPLE_THRESHOLD) === WAVEFORM_SAMPLE_LOD, '2 samples/device-px still uses samples')
assert(pickWaveformLod(8) === 256, 'between sample view and 256 uses the finest mip (interpolated)')
assert(pickWaveformLod(300) === 256, '300 samples/px picks 256 so ≥1 bucket/device-px')
assert(pickWaveformLod(1500) === 1024, '1500 samples/px picks 1024')
assert(pickWaveformLod(8000) === 4096, 'zoomed-out view uses the coarsest mip')

assert(samplesPerDevicePixel({ sampleCount: 4096, cssWidth: 128, dpr: 2 }) === 16, 'spp = samples / (css*dpr)')
assert(samplesPerDevicePixel({ sampleCount: 0, cssWidth: 100, dpr: 2 }) === 0, 'empty range is 0 spp')

const tiles = tileRanges(100, 2000, 1024)
assert(tiles.length === 3, '2000px visible range splits into 1024-aligned tiles')
assert(tiles[0].cssLeft === 100 && tiles[0].cssWidth === 924, 'first tile starts at the visible left')
assert(tiles[1].cssLeft === 1024 && tiles[1].cssWidth === 1024, 'middle tile is full width')
assert(Math.abs(tiles[2].cssLeft + tiles[2].cssWidth - 2100) < 1e-6, 'tiles cover the visible end')
assert(tileRanges(10, 40, WAVEFORM_TILE_CSS_PX).length === 1, 'narrow view is a single tile')

const host = {
  getBoundingClientRect: () => ({ left: 200, right: 1200, width: 1000, height: 80 })
}
const port = {
  getBoundingClientRect: () => ({ left: 0, right: 400 })
}
const vis = visibleHostRange(host, port, 64)
assert(vis != null && almost(vis.cssLeft, 0) && almost(vis.cssWidth, 264), 'visible range is the viewport overlap plus pad')
assert(visibleHostRange(host, { getBoundingClientRect: () => ({ left: 2000, right: 2400 }) }, 0) === null, 'offscreen host has no tiles')

function fakeBuffer(length: number, sr: number, fill: (i: number) => number): AudioBuffer {
  const data = new Float32Array(length)
  for (let i = 0; i < length; i++) data[i] = fill(i)
  return {
    numberOfChannels: 1,
    length,
    sampleRate: sr,
    duration: length / sr,
    getChannelData: () => data
  } as unknown as AudioBuffer
}

const sine = fakeBuffer(4096, 48000, (i) => Math.sin((2 * Math.PI * i) / 64))
const mips = getOrComputeMips(sine)
assert(WAVEFORM_MIP_STEPS.every((step) => mips.mips.has(step)), 'computes 256/1024/4096 mips once')
const fine = mips.mips.get(256)!
assert(fine.length === Math.ceil(4096 / 256) * 3, '256-sample mip has min/max/rms per bucket')
assert(fine[0] < 0 && fine[1] > 0 && fine[2] > 0, 'sine bucket stores signed peaks and RMS')
const coarse = mips.mips.get(4096)!
assert(coarse[0] <= fine[0] && coarse[1] >= fine[1], 'coarser mip keeps outer extrema')

const peaks = getOrComputePeaks(sine, 4096)
assert(peaks.length === 2, 'legacy peak cache is min/max for one 4096-sample bucket')
assert(peaks[0] < 0 && peaks[1] > 0, 'legacy peaks stay signed')

const cols = columnsFromMip(fine, 0, 4096, 256, 8)
assert(cols.mins.length === 8 && cols.maxs.length === 8 && cols.rms.length === 8, 'one column per device pixel')
assert(cols.mins[0] < 0 && cols.maxs[0] > 0, 'envelope columns keep a min/max pair')
assert(cols.rms[0] > 0 && cols.rms[0] < Math.max(Math.abs(cols.mins[0]), cols.maxs[0]) + 1e-6, 'RMS sits inside the peak envelope')

const partial = { sampleRate: 48000, length: 4096, mips: new Map([[4096, coarse]]) }
assert(bestAvailableLod(partial, 256) === 4096, 'falls back to a ready coarser mip while idle work finishes')
assert(bestAvailableLod(mips, WAVEFORM_SAMPLE_LOD) === WAVEFORM_SAMPLE_LOD, 'sample lod is not replaced by a mip')

const bitmap = canvasDeviceSize(200, 44, 2)
assert(bitmap.width === 400 && bitmap.height === 88, 'bitmap follows devicePixelRatio, not CSS stretch')
assert(canvasDeviceSize(20000, 40, 3).width === 8192, 'giant tiles stay capped')

if (failed > 0) {
  console.error(`\n${failed} assertion(s) failed`)
  process.exit(1)
}
console.log('\n✅ waveform layout unit tests passed')
