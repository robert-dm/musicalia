import {
  MIN_BEAT_INTERVAL,
  isTempoMapUsable,
  openingMedianPeriod,
  sanitizeTempoMap,
  smoothedLocalBpm,
  tempoMapQuality
} from './tempoMapSanitize'
import {
  buildTempoMap,
  hydrateTempoMap,
  trackBeatsFromMono,
  trueBeatTimesForLinearDrift,
  type TempoMap
} from './beatTracker'

let failed = 0
function assert(cond: boolean, msg: string) {
  if (!cond) {
    failed++
    console.error('FAIL:', msg)
  } else {
    console.log('ok:', msg)
  }
}

function legacyFirstGapPeriod(times: number[], bpm: number): number {
  const fromBpm = 60 / Math.max(1, bpm)
  const dt = times[1] - times[0]
  if (!(dt > 1e-6)) return fromBpm
  const n = Math.max(1, Math.round(dt / fromBpm))
  const period = dt / n
  if (period > fromBpm * 0.45 && period < fromBpm * 1.8) return period
  return fromBpm
}

const bpm = 160.2
const period = 60 / bpm

/** Old-style Sidewinder save: first beat late, downbeatIndex 0, short opening gap. */
const lateCluster = [40, 40.2, 40.575, 40.95, 41.324, 41.698, 42.072, 42.447, 42.821, 43.196]
const legacyPeriod = legacyFirstGapPeriod(lateCluster, bpm)
assert(legacyPeriod < 0.25, `0.0097b first-gap period was ~0.2s (got ${legacyPeriod.toFixed(3)})`)
assert(openingMedianPeriod(lateCluster, bpm) > 0.3, 'median of first 8 beats stays near 160')

const extras = Math.ceil(40 / legacyPeriod)
assert(extras > 150, `0.0097b would insert ~${extras} beats before t=40 at the short period`)

const raw: TempoMap = {
  beats: [
    { id: 'a', time: 1.497, pinned: false },
    { id: 'b', time: 1.525, pinned: false },
    { id: 'c', time: 1.553, pinned: false },
    ...[2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((i) => ({
      id: `q${i}`,
      time: 1.497 + i * period,
      pinned: false
    }))
  ],
  downbeatIndex: 0,
  globalBpm: bpm,
  sourceDuration: 10
}
const rawLocal = 60 / (raw.beats[1].time - raw.beats[0].time)
assert(rawLocal > 2000, `cluster yields insane local BPM (${rawLocal.toFixed(1)})`)

const cleaned = sanitizeTempoMap(raw)
const intervals: number[] = []
for (let i = 1; i < cleaned.beats.length; i++) {
  intervals.push(cleaned.beats[i].time - cleaned.beats[i - 1].time)
}
assert(cleaned.beats[0].time === 0, 'sanitizer puts a beat at t=0')
assert(intervals.every((dt) => dt >= MIN_BEAT_INTERVAL - 1e-9), 'no interval under 60/300 s')
assert(intervals.every((dt) => dt <= 60 / 30 + 1e-6), 'no interval over 60/30 s')
const local = smoothedLocalBpm(cleaned, 0.4)
assert(local >= 20 && local <= 300, `local BPM is clamped (got ${local})`)
assert(local > 140 && local < 190, `local BPM stays near 160 (got ${local})`)
assert(tempoMapQuality(cleaned).ok, 'sanitized late-start map is usable')

const packedRaw: TempoMap = {
  beats: lateCluster.map((time, i) => ({ id: `p${i}`, time, pinned: false })),
  downbeatIndex: 0,
  globalBpm: bpm,
  sourceDuration: 43
}
const packed = sanitizeTempoMap(packedRaw)
const packedBars = Math.floor(packed.beats.filter((b) => b.time <= 40).length / 4)
assert(packedBars < 28, `ruler must not pack 50 bars into 40s (got ${packedBars} bars)`)
assert(isTempoMapUsable(packed), 'packed old save becomes usable after sanitize')

const hydrated = hydrateTempoMap({
  beats: raw.beats.map((b) => ({ id: b.id, time: b.time, pinned: false })),
  downbeatIndex: 0,
  globalBpm: bpm,
  sourceDuration: 10
})
assert(hydrated != null && hydrated.beats[0].time === 0, 'hydrate sanitizes old maps')
assert(
  hydrated!.beats.every((b, i) => i === 0 || b.time - hydrated!.beats[i - 1].time >= MIN_BEAT_INTERVAL - 1e-9),
  'hydrated map has no sub-min gaps'
)

const fresh = buildTempoMap(
  [0.4, 0.428, 0.775, 1.15, 1.524, 1.899, 2.273],
  bpm,
  3
)
assert(fresh.beats[0].time === 0, 'fresh analysis sanitizes and extrapolates to 0')
assert(
  fresh.beats.every((b, i) => i === 0 || b.time - fresh.beats[i - 1].time >= MIN_BEAT_INTERVAL - 1e-9),
  'fresh map has no sub-min gaps'
)

const sampleRate = 22050
const duration = 600
const truth = trueBeatTimesForLinearDrift(161, 159, duration)
function paintSwing(times: number[]): Float32Array {
  const samples = new Float32Array(Math.floor(sampleRate * duration))
  const clickLen = Math.floor(sampleRate * 0.01)
  for (const time of times) {
    const start = Math.round(time * sampleRate)
    for (let i = 0; i < clickLen && start + i < samples.length; i++) {
      const t = i / sampleRate
      samples[start + i] += Math.sin(2 * Math.PI * 1000 * t) * Math.exp(-t * 120) * 0.7
    }
    const swing = time + (60 / (161 + (159 - 161) * (time / duration))) * 0.66
    const off = Math.round(swing * sampleRate)
    for (let i = 0; i < clickLen && off + i < samples.length; i++) {
      const t = i / sampleRate
      samples[off + i] += Math.sin(2 * Math.PI * 700 * t) * Math.exp(-t * 140) * 0.22
    }
  }
  return samples
}

console.log(`tracking ${duration}s swing at ~160 BPM (${truth.length} true beats)…`)
const tracked = trackBeatsFromMono(paintSwing(truth), sampleRate, 160)
assert(!!tracked, 'tracker returns a map for the 10-minute swing')
const trackedIntervals: number[] = []
if (tracked) {
  for (let i = 1; i < tracked.beats.length; i++) {
    trackedIntervals.push(tracked.beats[i].time - tracked.beats[i - 1].time)
  }
}
assert(
  trackedIntervals.every((dt) => dt >= 0.2 - 1e-9),
  `no tracked interval under 0.2s (min ${Math.min(...trackedIntervals).toFixed(4)})`
)
const midLocal = tracked ? smoothedLocalBpm(tracked, 120) : 0
const startLocal = tracked ? smoothedLocalBpm(tracked, 1) : 0
const endLocal = tracked ? smoothedLocalBpm(tracked, 500) : 0
console.log(`local BPM start/mid/end ${startLocal} / ${midLocal} / ${endLocal}, beats ${tracked?.beats.length}`)
assert(startLocal >= 140 && startLocal <= 180, `start local BPM in 140–180 (got ${startLocal})`)
assert(midLocal >= 140 && midLocal <= 180, `mid local BPM in 140–180 (got ${midLocal})`)
assert(endLocal >= 140 && endLocal <= 180, `end local BPM in 140–180 (got ${endLocal})`)

if (failed > 0) {
  console.error(`\n${failed} assertion(s) failed`)
  process.exit(1)
}
console.log('\n✅ tempo map sanitizer unit tests passed')
