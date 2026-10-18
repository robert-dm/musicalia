import {
  addBeatAt,
  alignTempoMapToOrigin,
  buildTempoMap,
  followClicksInRange,
  hydrateTempoMap,
  hydrateTrackTempoMap,
  isFollowEnabled,
  localBpmAt,
  moveBeatTime,
  removeBeat,
  rulerMapBeats,
  serializeTempoMap,
  serializeTrackTempoMap,
  setDownbeatAt,
  trackBeatsFromMono,
  trueBeatTimesForLinearDrift,
  type TempoMap
} from './beatTracker'
import { DEFAULT_METRONOME_METER } from './metronomeMeter'

class MockAudioBuffer {
  numberOfChannels: number
  length: number
  sampleRate: number
  private channels: Float32Array[]

  constructor(options: { numberOfChannels: number; length: number; sampleRate: number }) {
    this.numberOfChannels = options.numberOfChannels
    this.length = options.length
    this.sampleRate = options.sampleRate
    this.channels = []
    for (let i = 0; i < options.numberOfChannels; i++) {
      this.channels.push(new Float32Array(options.length))
    }
  }

  getChannelData(channel: number): Float32Array {
    return this.channels[channel]
  }
}

global.AudioBuffer = MockAudioBuffer as any

let failed = 0
function assert(cond: boolean, msg: string) {
  if (!cond) {
    failed++
    console.error('FAIL:', msg)
  } else {
    console.log('ok:', msg)
  }
}

function paintClicks(times: number[], duration: number, sampleRate: number): Float32Array {
  const samples = new Float32Array(Math.floor(sampleRate * duration))
  const clickLen = Math.floor(sampleRate * 0.012)
  for (const time of times) {
    const start = Math.round(time * sampleRate)
    for (let i = 0; i < clickLen && start + i < samples.length; i++) {
      const t = i / sampleRate
      samples[start + i] = Math.sin(2 * Math.PI * 1000 * t) * Math.exp(-t * 100) * 0.6
    }
  }
  return samples
}

function maxBeatError(tracked: number[], truth: number[]): number {
  let worst = 0
  for (const t of truth) {
    let best = Infinity
    for (const g of tracked) best = Math.min(best, Math.abs(g - t))
    worst = Math.max(worst, best)
  }
  return worst
}

const sampleRate = 44100
const duration = 24
const truth = trueBeatTimesForLinearDrift(161, 152, duration)
assert(truth.length > 40, `drift 161→152 over ${duration}s has many beats (${truth.length})`)
assert(truth[0] === 0, 'first true beat is at 0')

const samples = paintClicks(truth, duration, sampleRate)
const map = trackBeatsFromMono(samples, sampleRate, 156.5)
assert(!!map, 'tracker returns a map')
const tracked = map?.beats.map((b) => b.time) ?? []
const errMs = maxBeatError(tracked, truth) * 1000
console.log(`161→152 drift: ${truth.length} true beats, ${tracked.length} tracked, max error ${errMs.toFixed(2)} ms`)
assert(tracked.length >= truth.length * 0.85, 'tracked most of the beats')
assert(errMs <= 15, `tracked beats within 15 ms (got ${errMs.toFixed(2)} ms)`)

const follow = followClicksInRange({
  map: map!,
  meter: { ...DEFAULT_METRONOME_METER, followMode: 'follow' },
  end: 2
})
assert(follow.length >= 4, 'follow mode schedules grid clicks')
assert(follow[0].accent, 'first follow click is a downbeat')

assert(isFollowEnabled({ followMode: 'follow' }, map), 'follow is on when a grid exists')
assert(!isFollowEnabled({ followMode: 'fixed' }, map), 'Tempo fijo ignores the grid')

const local = localBpmAt(map!, 0.2)
assert(local > 150 && local < 165, `local BPM near start is ~161 (got ${local})`)

const moved = moveBeatTime(map!, map!.beats[4].id, map!.beats[4].time + 0.03)
assert(moved.beats[4].pinned, 'dragged beat is pinned')
assert(Math.abs(moved.beats[4].time - (map!.beats[4].time + 0.03)) < 1e-6, 'dragged beat moves')
assert(moved.beats[3].time !== map!.beats[3].time, 'neighbours re-interpolate')

const added = addBeatAt(map!, 0.22)
assert(added.beats.length === map!.beats.length + 1, 'Agregar marca de tempo inserts a beat')
const removed = removeBeat(added, added.beats[1].id)
assert(removed.beats.length === added.beats.length - 1, 'Borrar marca removes a beat')

const down = setDownbeatAt(map!, map!.beats[2].id)
assert(down.downbeatIndex === 2, 'Poner el 1 acá sets the downbeat')
const followShifted = followClicksInRange({
  map: down,
  meter: DEFAULT_METRONOME_METER,
  end: down.beats[5].time + 0.01
})
const firstAccent = followShifted.find((c) => c.accent)
assert(firstAccent != null && Math.abs(firstAccent.songTime - down.beats[2].time) < 1e-9, 'accents follow the new 1')

const json = serializeTempoMap(map)
const loaded = hydrateTempoMap(json)
assert(loaded?.beats.length === map!.beats.length, 'tempo map persists in .musicalia')
assert(hydrateTempoMap(undefined) == null, 'missing map hydrates empty')
const trackPayload = serializeTrackTempoMap({ kind: 'metronome', tempoMap: map })
assert(trackPayload.tempoMap?.beats.length === map!.beats.length, 'metronome track payload keeps the grid')
assert(hydrateTrackTempoMap(trackPayload, 'metronome').tempoMap?.beats.length === map!.beats.length, 'track hydrate reads the grid')
assert(hydrateTrackTempoMap(trackPayload, 'audio').tempoMap == null, 'audio tracks omit the tempo map')
assert(
  serializeTrackTempoMap({ kind: 'metronome' }).tempoMap == null,
  'Resetear tempo persists by omitting the map'
)

const even = buildTempoMap([0, 0.5, 1, 1.5], 120, 2)
const mid = localBpmAt(even, 0.6)
assert(mid === 120, 'even 0.5s grid is 120 BPM')
const ruler = rulerMapBeats(even, { followMode: 'follow', numerator: 4, denominator: 4 }, 120)
assert(ruler?.[0].downbeat === true && ruler?.[1].downbeat === false, 'ruler map marks downbeats from the grid')
assert(rulerMapBeats(even, { followMode: 'fixed' }, 120) == null, 'Tempo fijo keeps the fixed-BPM ruler')

const sidewinderBpm = 160.2
const sidePeriod = 60 / sidewinderBpm
const lateTimes = [1, 2, 3, 4, 5, 6, 7, 8].map((i) => i * sidePeriod)
const lateRaw: TempoMap = {
  beats: lateTimes.map((time, index) => ({ id: `late-${index}`, time, pinned: false })),
  downbeatIndex: 0,
  globalBpm: sidewinderBpm,
  sourceDuration: 10
}
const alignedLate = alignTempoMapToOrigin(lateRaw)
assert(alignedLate.beats[0].time === 0, 'tracker-default late grid gets a beat at t=0')
assert(alignedLate.downbeatIndex === 0, 'default downbeat re-homes to the origin beat')
assert(
  alignedLate.beats.some((b) => Math.abs(b.time - sidePeriod) < 1e-9),
  'detected first beat is kept (not a pre-roll shift)'
)
const lateClicks = followClicksInRange({
  map: lateRaw,
  meter: { followMode: 'follow', numerator: 4, denominator: 4 },
  end: sidePeriod * 2
})
assert(lateClicks[0]?.songTime === 0 && lateClicks[0].accent, 'follow clicks start at t=0 / bar 1')
assert(Math.abs((lateClicks[1]?.songTime ?? -1) - sidePeriod) < 1e-9, 'second click stays on the detected beat')
const lateRuler = rulerMapBeats(lateRaw, { followMode: 'follow', numerator: 4, denominator: 4 }, sidewinderBpm)
assert(!!(lateRuler?.[0].t === 0 && lateRuler?.[0].downbeat && lateRuler?.[0].bar === 1), 'ruler 1 is at t=0')
assert(
  lateRuler?.find((b) => b.bar === 1)?.t === lateClicks[0].songTime,
  'ruler bar 1 time equals first scheduled click'
)
assert(lateClicks[0].songTime === 0, 'click, ruler, and clip origin share t=0')

const builtLate = buildTempoMap(lateTimes, sidewinderBpm, 10)
assert(builtLate.beats[0].time === 0 && builtLate.downbeatIndex === 0, 'buildTempoMap persists origin beats')

const near = buildTempoMap([0.012, 0.012 + sidePeriod, 0.012 + sidePeriod * 2, 0.012 + sidePeriod * 3], sidewinderBpm, 4)
assert(near.beats[0].time === 0, 'a first beat a few ms late snaps to t=0 — no pre-roll hole')
const nearClicks = followClicksInRange({
  map: near,
  meter: { followMode: 'follow' },
  end: sidePeriod
})
assert(nearClicks[0]?.songTime === 0, 'first click is exactly t=0 after the snap')

const hydratedLate = hydrateTempoMap({
  beats: lateTimes.map((time, index) => ({ id: `old-${index}`, time, pinned: false })),
  downbeatIndex: 0,
  globalBpm: sidewinderBpm,
  sourceDuration: 10
})
assert(hydratedLate?.beats[0].time === 0, 'old .musicalia Sidewinder maps re-home bar 1 to t=0')

const userOne = setDownbeatAt(alignedLate, alignedLate.beats[2].id)
assert(userOne.downbeatIndex === 2, 'Poner el 1 acá still moves the downbeat')
const pickupClicks = followClicksInRange({
  map: userOne,
  meter: { followMode: 'follow', numerator: 4, denominator: 4 },
  end: sidePeriod * 6
})
const pickupAccent = pickupClicks.find((c) => Math.abs(c.songTime - alignedLate.beats[2].time) < 1e-9)
assert(pickupAccent?.accent === true, 'accents follow the user 1 (true pickup)')
const pickupRuler = rulerMapBeats(userOne, { followMode: 'follow', numerator: 4, denominator: 4 }, sidewinderBpm)
assert(pickupRuler?.[0].t === 0 && pickupRuler?.[0].bar === 1, 'ruler first bar line stays at t=0 labeled 1')
assert(pickupClicks[0]?.songTime === 0, 'first click is still at t=0 with a pickup downbeat')

const lateUser = hydrateTempoMap({
  beats: lateTimes.map((time, index) => ({ id: `u-${index}`, time, pinned: false })),
  downbeatIndex: 2,
  globalBpm: sidewinderBpm,
  sourceDuration: 10
})
assert(lateUser != null && lateUser.beats[0].time === 0, 'hydrate still fills back to 0 when the 1 was moved')
assert(lateUser!.downbeatIndex === 2 + (lateUser!.beats.length - lateTimes.length), 'user downbeat index shifts by prepended beats')

if (failed > 0) {
  console.error(`\n${failed} assertion(s) failed`)
  process.exit(1)
}
console.log('\n✅ beat tracker / tempo map unit tests passed')
