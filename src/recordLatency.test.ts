import {
  autoRecordLatencySeconds,
  calibratedSecondsForDevice,
  clampLatencyMs,
  effectiveRecordLatencySeconds,
  findDelaySamples,
  findDelaySeconds,
  formatLatencyMs,
  hydrateRecordLatencySettings,
  makeClickTrain,
  mixToMono,
  nudgeClipOffsetSeconds,
  parseLatencyMs,
  peakTimeSeconds,
  placeRecordedClip,
  songTimeOfContextTime
} from './recordLatency'

let failed = 0
function assert(cond: boolean, msg: string) {
  if (!cond) {
    failed++
    console.error('FAIL:', msg)
  } else {
    console.log('ok:', msg)
  }
}

function almost(a: number, b: number, eps = 1e-6) {
  return Math.abs(a - b) <= eps
}

assert(autoRecordLatencySeconds({}) === 0, 'missing latencies are 0')
assert(
  almost(autoRecordLatencySeconds({ baseLatency: 0.005, outputLatency: 0.02 }, { getSettings: () => ({ latency: 0.012 }) }), 0.037),
  'auto is output + base + input'
)
assert(
  almost(effectiveRecordLatencySeconds({ autoSeconds: 0.04, manualSeconds: 0.01 }), 0.05),
  'manual adds on top of auto'
)
assert(
  almost(effectiveRecordLatencySeconds({ autoSeconds: 0.04, calibratedSeconds: 0.09, manualSeconds: 0.005 }), 0.095),
  'calibrated replaces auto, then manual'
)
assert(
  effectiveRecordLatencySeconds({ autoSeconds: 0.04, calibratedSeconds: 0.02, manualSeconds: -0.03 }) === 0,
  'total does not go below 0'
)

const delayed = new Float32Array(200)
const reference = new Float32Array(80)
for (let i = 0; i < reference.length; i++) reference[i] = Math.sin(i / 3)
delayed.set(reference, 37)
assert(findDelaySamples(reference, delayed) === 37, 'cross-correlation finds 37-sample delay')
assert(almost(findDelaySeconds(reference, delayed, 1000), 0.037), 'delay in seconds')

const noisy = new Float32Array(delayed)
for (let i = 0; i < noisy.length; i++) noisy[i] += (i % 7) * 0.002
assert(Math.abs(findDelaySamples(reference, noisy) - 37) <= 1, 'still finds the click under light noise')

const train = makeClickTrain(1000, { count: 4, interval: 0.2, clickMs: 3 })
assert(train.length >= 800, 'click train covers the intervals')
const lateTrain = new Float32Array(train.length + 50)
lateTrain.set(train, 50)
assert(findDelaySamples(train, lateTrain) === 50, 'click-train delay is 50 samples')

assert(mixToMono([new Float32Array([1, 2]), new Float32Array([3, 4])])[0] === 2, 'mono mix averages')
assert(formatLatencyMs(12) === '+12 ms', 'positive ms')
assert(formatLatencyMs(-8) === '-8 ms', 'negative ms')
assert(formatLatencyMs(0) === '0 ms', 'zero ms')
assert(parseLatencyMs('+15 ms') === 15, 'parses stepper text')
assert(clampLatencyMs(400) === 200 && clampLatencyMs(-400) === -200, 'manual clamp')
assert(almost(nudgeClipOffsetSeconds(1.2, 80), 1.12), 'positive ms shifts clip earlier')
assert(nudgeClipOffsetSeconds(0.02, 80) === 0, 'nudge does not go below 0')

const peakBuf = {
  numberOfChannels: 1,
  length: 8,
  sampleRate: 8,
  getChannelData: () => new Float32Array([0, 0.1, 0.9, 0.2, 0, 0, 0, 0])
}
assert(almost(peakTimeSeconds(peakBuf), 0.25), 'peak time is sample index / sr')

assert(almost(songTimeOfContextTime(2.5, 10, 2, 1), 10.5), 'context time maps to song time')
assert(almost(songTimeOfContextTime(2.5, 10, 2, 0.5), 10.25), 'tempo rate scales the mapping')

assert(
  almost(
    placeRecordedClip({
      firstContextTime: 5.2,
      fallbackSong: 4,
      playOriginSong: 4,
      playOriginContext: 5,
      tempoRate: 1,
      latencySeconds: 0.03
    }),
    4.17
  ),
  'clip starts at first-frame song time minus latency'
)
assert(
  placeRecordedClip({
    firstContextTime: null,
    fallbackSong: 8,
    playOriginSong: 0,
    playOriginContext: 0,
    tempoRate: 1,
    latencySeconds: 0.2
  }) === 7.8,
  'falls back to playhead if no frame timestamp'
)

const settings = hydrateRecordLatencySettings({
  manualMs: 5,
  devices: { abc: { calibratedMs: 87, updatedAt: 1 }, bad: { calibratedMs: -3 } }
})
assert(settings.manualMs === 5, 'hydrates manual')
assert(calibratedSecondsForDevice(settings, 'abc') === 0.087, 'per-device calibration')
assert(calibratedSecondsForDevice(settings, 'missing') == null, 'unknown device has no calibration')

if (failed > 0) {
  console.error(`\n${failed} assertion(s) failed`)
  process.exit(1)
}
console.log('\n✅ record latency unit tests passed')
