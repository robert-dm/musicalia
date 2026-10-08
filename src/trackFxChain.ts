import * as Tone from 'tone'
import { effectiveTrackGain, rampTrackGain, VOLUME_RAMP_SECONDS } from './trackGain'
import {
  dbToGain,
  defaultTrackFx,
  effectiveCompressor,
  effectiveDelayMix,
  effectiveEq,
  effectiveFilter,
  effectiveReverbMix,
  resolvedParamValue,
  type FilterType,
  type TrackFxState
} from './trackFx'
import type { AutomationLane } from './automation'

export interface TrackFxChain {
  gain: Tone.Gain
  eq: Tone.EQ3
  compressor: Tone.Compressor
  makeup: Tone.Gain
  filter: Tone.Filter
  delay: Tone.FeedbackDelay
  reverb: Tone.Freeverb
  panner: Tone.Panner
}

export interface TrackAudioSnapshot {
  mute: boolean
  solo: boolean
  volume: number
  pan?: number
  fx?: TrackFxState
  automation?: AutomationLane[]
}

function setSignal(
  signal: { value: unknown; rampTo?: (value: number, seconds: number) => unknown } | undefined,
  value: number,
  rampSeconds = 0
): void {
  if (!signal) return
  const next = Number.isFinite(value) ? value : 0
  if (rampSeconds > 0 && typeof signal.rampTo === 'function') {
    try {
      signal.rampTo(next, rampSeconds)
      return
    } catch {
      // Context may not be running yet
    }
  }
  signal.value = next
}

export function createTrackFxChain(volume = 0.8): TrackFxChain {
  const gain = new Tone.Gain(volume)
  const eq = new Tone.EQ3({ low: 0, mid: 0, high: 0 })
  const compressor = new Tone.Compressor({
    threshold: -18,
    ratio: 4,
    attack: 0.01,
    release: 0.12,
    knee: 6
  })
  const makeup = new Tone.Gain(1)
  const filter = new Tone.Filter({ frequency: 18000, Q: 0.7, type: 'lowpass' })
  const delay = new Tone.FeedbackDelay({ delayTime: 0.25, feedback: 0.25, wet: 0 })
  const reverb = new Tone.Freeverb({ roomSize: 0.7, wet: 0 })
  const panner = new Tone.Panner(0)

  gain.connect(eq)
  eq.connect(compressor)
  compressor.connect(makeup)
  makeup.connect(filter)
  filter.connect(delay)
  delay.connect(reverb)
  reverb.connect(panner)
  panner.toDestination()

  return { gain, eq, compressor, makeup, filter, delay, reverb, panner }
}

export function disposeTrackFxChain(chain: TrackFxChain | undefined): void {
  if (!chain) return
  const nodes = [
    chain.gain,
    chain.eq,
    chain.compressor,
    chain.makeup,
    chain.filter,
    chain.delay,
    chain.reverb,
    chain.panner
  ]
  for (const node of nodes) {
    try { node.disconnect() } catch { /* already disconnected */ }
    try { node.dispose() } catch { /* already disposed */ }
  }
}

export function applyTrackFxChain(
  chain: TrackFxChain,
  track: TrackAudioSnapshot,
  time: number,
  anySolo: boolean,
  rampSeconds = VOLUME_RAMP_SECONDS
): void {
  const fx = track.fx ?? defaultTrackFx()
  const volume = resolvedParamValue(track, 'volume', time)
  rampTrackGain(
    chain.gain,
    effectiveTrackGain(volume, track.mute, track.solo, anySolo),
    rampSeconds
  )

  const pan = resolvedParamValue(track, 'pan', time)
  setSignal(chain.panner.pan, pan, rampSeconds)

  const eq = effectiveEq({
    bypass: fx.eq.bypass,
    low: resolvedParamValue(track, 'eq.low', time),
    mid: resolvedParamValue(track, 'eq.mid', time),
    high: resolvedParamValue(track, 'eq.high', time)
  })
  setSignal(chain.eq.low, eq.low, rampSeconds)
  setSignal(chain.eq.mid, eq.mid, rampSeconds)
  setSignal(chain.eq.high, eq.high, rampSeconds)

  const compressor = effectiveCompressor({
    ...fx.compressor,
    threshold: resolvedParamValue(track, 'comp.threshold', time),
    ratio: resolvedParamValue(track, 'comp.ratio', time),
    attack: resolvedParamValue(track, 'comp.attack', time),
    release: resolvedParamValue(track, 'comp.release', time),
    makeup: resolvedParamValue(track, 'comp.makeup', time)
  })
  setSignal(chain.compressor.threshold, compressor.threshold, rampSeconds)
  setSignal(chain.compressor.ratio, compressor.ratio, rampSeconds)
  setSignal(chain.compressor.attack, compressor.attack, rampSeconds)
  setSignal(chain.compressor.release, compressor.release, rampSeconds)
  setSignal(chain.makeup.gain, dbToGain(compressor.makeup), rampSeconds)

  const filter = effectiveFilter({
    ...fx.filter,
    cutoff: resolvedParamValue(track, 'filter.cutoff', time),
    resonance: resolvedParamValue(track, 'filter.resonance', time)
  })
  const filterType: FilterType = filter.type === 'highpass' ? 'highpass' : 'lowpass'
  if (chain.filter.type !== filterType) {
    chain.filter.type = filterType
  }
  setSignal(chain.filter.frequency, filter.cutoff, rampSeconds)
  setSignal(chain.filter.Q, filter.resonance, rampSeconds)

  const delayTime = resolvedParamValue(track, 'delay.time', time)
  const delayFeedback = resolvedParamValue(track, 'delay.feedback', time)
  const delayMix = effectiveDelayMix({
    ...fx.delay,
    time: delayTime,
    feedback: delayFeedback,
    mix: resolvedParamValue(track, 'delay.mix', time)
  })
  setSignal(chain.delay.delayTime, delayTime, rampSeconds)
  setSignal(chain.delay.feedback, delayFeedback, rampSeconds)
  setSignal(chain.delay.wet, delayMix, rampSeconds)

  const reverbSize = resolvedParamValue(track, 'reverb.size', time)
  const reverbMix = effectiveReverbMix({
    ...fx.reverb,
    size: reverbSize,
    mix: resolvedParamValue(track, 'reverb.mix', time)
  })
  setSignal(chain.reverb.roomSize, reverbSize, rampSeconds)
  setSignal(chain.reverb.wet, reverbMix, rampSeconds)
}
