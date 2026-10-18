import {
  addBeatAt,
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
  trueBeatTimesForLinearDrift
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

const even = buildTempoMap([0, 0.5, 1, 1.5], 120, 2)
const mid = localBpmAt(even, 0.6)
assert(mid === 120, 'even 0.5s grid is 120 BPM')
const ruler = rulerMapBeats(even, { followMode: 'follow', numerator: 4, denominator: 4 }, 120)
assert(ruler?.[0].downbeat === true && ruler?.[1].downbeat === false, 'ruler map marks downbeats from the grid')
assert(rulerMapBeats(even, { followMode: 'fixed' }, 120) == null, 'Tempo fijo keeps the fixed-BPM ruler')

if (failed > 0) {
  console.error(`\n${failed} assertion(s) failed`)
  process.exit(1)
}
console.log('\n✅ beat tracker / tempo map unit tests passed')
