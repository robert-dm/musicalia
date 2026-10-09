import type { DrumKit, PatternId } from './drumKit'
import { isPatternId } from './drumKit'
import { serializeDrumKit, serializePatternClip, isDrumTrackKind } from './drumSerialize'
import { collectClipHits, padPlaybackRate, padVoiceGain } from './drumPlayback'
import { reverseAudioBuffer } from './drumSynth'
import { patternPeriodSeconds, type StepVelocity } from './drumTiming'

export const PATTERN_CLIP_MAX_SECONDS = 3600

let silentCache: AudioBuffer | null = null

export function silentPatternBuffer(sampleRate = 44100): AudioBuffer {
  if (silentCache && silentCache.sampleRate === sampleRate) return silentCache
  silentCache = new AudioBuffer({ length: 8, numberOfChannels: 1, sampleRate })
  return silentCache
}

export function isPatternClip(clip: { kind?: string; patternId?: string }): boolean {
  return clip.kind === 'pattern' || isPatternId(clip.patternId)
}

export function defaultPatternClipDuration(bpm: number, stepCount = 16, bars = 4): number {
  return patternPeriodSeconds(stepCount, bpm) * Math.max(1, bars)
}

export function patternClipFileName(patternId: PatternId | string = 'A'): string {
  return `Patrón ${isPatternId(patternId) ? patternId : 'A'}`
}

export function padZipName(trackIdx: number, padIdx: number): string {
  return `drum_${trackIdx}_${padIdx}.wav`
}

export function padIdbKey(trackIdx: number, padIdx: number): string {
  return `drum-pad-${trackIdx}-${padIdx}`
}

export function projectClipPayload(clip: {
  id: string
  fileName: string
  startPosition: number
  offsetSeconds: number
  sourceStart: number
  duration: number
  kind?: string
  patternId?: string
}, trackIdx: number, clipIdx: number) {
  if (isPatternClip(clip)) {
    return serializePatternClip(clip)
  }
  return {
    kind: 'audio' as const,
    fileName: clip.fileName,
    startPosition: clip.startPosition,
    offsetSeconds: clip.offsetSeconds,
    id: clip.id,
    sourceStart: clip.sourceStart,
    duration: clip.duration,
    audioFile: `audio_${trackIdx}_${clipIdx}.wav`
  }
}

export function projectDrumPayload(kit: DrumKit | undefined, trackIdx: number) {
  if (!kit) return undefined
  return serializeDrumKit(
    kit,
    kit.pads.map((_, padIdx) => ({
      audioFile: padZipName(trackIdx, padIdx),
      audioBufferKey: padIdbKey(trackIdx, padIdx)
    }))
  )
}

export function trackKindOf(kind: unknown): 'audio' | 'drum' {
  return isDrumTrackKind(kind) ? 'drum' : 'audio'
}

export function clipBufferDuration(clip: { kind?: string; buffer: { duration: number } }): number {
  return isPatternClip(clip) ? PATTERN_CLIP_MAX_SECONDS : clip.buffer.duration
}

export function renderDrumHitsOffline(
  ctx: OfflineAudioContext,
  dest: AudioNode,
  kit: DrumKit,
  clips: Array<{ offsetSeconds: number; duration: number; patternId?: string; kind?: string }>,
  bpm: number,
  countInSeconds = 0
): number {
  const hits = collectClipHits({
    kit,
    clips,
    bpm,
    windowStart: 0,
    windowEnd: 1e7
  })
  for (const hit of hits) {
    const pad = kit.pads[hit.padIndex]
    if (!pad?.buffer) continue
    const source = ctx.createBufferSource()
    const buffer = pad.reverse ? reverseAudioBuffer(pad.buffer) : pad.buffer
    source.buffer = buffer
    source.playbackRate.value = padPlaybackRate(pad)
    const gain = ctx.createGain()
    gain.gain.value = padVoiceGain(pad, hit.velocity)
    const panner = ctx.createStereoPanner()
    panner.pan.value = pad.pan
    source.connect(gain)
    gain.connect(panner)
    panner.connect(dest)
    const when = Math.max(0, hit.songTime + countInSeconds)
    const dur = Math.min(pad.decay, Math.max(0.02, buffer.duration / source.playbackRate.value))
    source.start(when)
    source.stop(when + dur)
  }
  return hits.length
}

export function programBasicBeat(kit: DrumKit): DrumKit {
  const pattern = kit.patterns[kit.activePattern]
  const rows = pattern.rows.map((row) => row.map(() => 0 as StepVelocity))
  const set = (pad: number, step: number, vel: 1 | 2 | 3) => {
    if (!rows[pad]) return
    rows[pad][step] = vel
  }
  for (const step of [0, 4, 8, 12]) set(0, step, 3)
  for (const step of [4, 12]) set(1, step, 3)
  for (let step = 0; step < pattern.stepCount; step += 2) set(3, step, 2)
  return {
    ...kit,
    patterns: {
      ...kit.patterns,
      [kit.activePattern]: { ...pattern, rows }
    }
  }
}
