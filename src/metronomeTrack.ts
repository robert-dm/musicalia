import { DEFAULT_PAN, defaultTrackFx } from './trackFx'
import { DEFAULT_TRACK_VOLUME, type EmptyTrack } from './trackList'
import { transportTimeForHit } from './drumTiming'

export const METRONOME_TRACK_NAME = 'Metrónomo'
export const METRONOME_TRACK_KIND = 'metronome' as const
export const DEFAULT_BEATS_PER_BAR = 4
export const CLICK_DURATION_SECONDS = 0.05
export const BEAT_CLICK_HZ = 1000
export const ACCENT_CLICK_HZ = 1250
export const BEAT_CLICK_GAIN = 0.28
export const ACCENT_CLICK_GAIN = 0.38

/**
 * Aislar / Solo never silence an unmuted metronome. The click is a time
 * reference, not a mix stem: Mute (M) is the only way to turn it off.
 * Solo on the metronome itself still silences other tracks as usual.
 */
export const METRONOME_AISLAR_RULE =
  'Aislar no silencia el metrónomo si está destildado (M). Mute es la única forma de apagarlo.'

export interface MetronomeClick {
  songTime: number
  beatIndex: number
  beatInBar: number
  accent: boolean
}

export interface MetronomeTrackSeed extends EmptyTrack {
  kind: typeof METRONOME_TRACK_KIND
}

export function isMetronomeTrack(track: { kind?: string } | null | undefined): boolean {
  return track?.kind === METRONOME_TRACK_KIND
}

export function createMetronomeTrack(): MetronomeTrackSeed {
  return {
    name: METRONOME_TRACK_NAME,
    mute: true,
    solo: false,
    volume: DEFAULT_TRACK_VOLUME,
    pan: DEFAULT_PAN,
    fx: defaultTrackFx(),
    automation: [],
    clips: [],
    kind: METRONOME_TRACK_KIND
  }
}

/** Older saves have no metronome track. Always insert it muted at the top. */
export function ensureMetronomeTrack<T extends { kind?: string; name?: string }>(
  tracks: T[],
  factory: () => T = () => createMetronomeTrack() as unknown as T
): T[] {
  if (tracks.some(isMetronomeTrack)) return tracks
  return [factory(), ...tracks]
}

export function findMetronomeIndex(tracks: Array<{ kind?: string }>): number {
  return tracks.findIndex(isMetronomeTrack)
}

export function canDeleteTrack(track: { kind?: string } | null | undefined): boolean {
  return !isMetronomeTrack(track)
}

export function canRenameTrack(track: { kind?: string } | null | undefined): boolean {
  return !isMetronomeTrack(track)
}

export function metronomeIsOn(tracks: Array<{ kind?: string; mute?: boolean }>): boolean {
  const idx = findMetronomeIndex(tracks)
  if (idx < 0) return false
  return tracks[idx].mute !== true
}

export function secondsPerBeat(bpm: number): number {
  const safe = Number.isFinite(bpm) && bpm > 0 ? bpm : 120
  return 60 / safe
}

export function normalizeBeatsPerBar(beatsPerBar?: number): number {
  const n = Math.floor(Number(beatsPerBar))
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_BEATS_PER_BAR
}

/** Song-time click grid. Vel (tempoRate) does not move these times. */
export function clickTimesInRange(args: {
  bpm: number
  beatsPerBar?: number
  start?: number
  end: number
}): MetronomeClick[] {
  const spb = secondsPerBeat(args.bpm)
  const bpb = normalizeBeatsPerBar(args.beatsPerBar)
  const start = Math.max(0, args.start ?? 0)
  const end = args.end
  if (!(end > start) || !(spb > 0)) return []

  const firstBeat = Math.ceil(start / spb - 1e-9)
  const clicks: MetronomeClick[] = []
  for (let i = firstBeat; ; i++) {
    const songTime = i * spb
    if (songTime >= end - 1e-12) break
    if (songTime < start) continue
    const beatInBar = ((i % bpb) + bpb) % bpb
    clicks.push({
      songTime,
      beatIndex: i,
      beatInBar,
      accent: beatInBar === 0
    })
  }
  return clicks
}

export function scheduledMetronomeClicks(args: {
  bpm: number
  beatsPerBar?: number
  songTime: number
  playOriginSong: number
  tempoRate: number
  songEnd: number
  loopStart?: number | null
  loopEnd?: number | null
  loopEnabled?: boolean
}): Array<MetronomeClick & { transportTime: number }> {
  let windowStart = Math.max(0, args.songTime)
  let windowEnd = Math.max(windowStart, args.songEnd)
  if (args.loopEnabled && args.loopStart != null && args.loopEnd != null && args.loopEnd > args.loopStart) {
    windowStart = Math.max(windowStart, args.loopStart)
    windowEnd = Math.min(windowEnd, args.loopEnd)
  }
  return clickTimesInRange({
    bpm: args.bpm,
    beatsPerBar: args.beatsPerBar,
    start: windowStart,
    end: windowEnd
  }).map((click) => ({
    ...click,
    transportTime: transportTimeForHit(click.songTime, args.playOriginSong, args.tempoRate)
  }))
}

export function effectiveMetronomeGain(volume: number, mute: boolean): number {
  if (mute) return 0
  const v = Math.max(0, Math.min(1, volume))
  return v
}

export function shouldExportMetronome(track: { kind?: string; mute?: boolean } | null | undefined): boolean {
  return isMetronomeTrack(track) && track?.mute !== true
}

export function fillClickSamples(
  out: Float32Array,
  sampleRate: number,
  freq: number,
  amplitude: number
): void {
  const sr = sampleRate > 0 ? sampleRate : 44100
  for (let i = 0; i < out.length; i++) {
    const t = i / sr
    out[i] = Math.sin(2 * Math.PI * freq * t) * Math.exp(-t * 20) * amplitude
  }
}

export function createClickAudioBuffer(
  ctx: { sampleRate: number; createBuffer: (ch: number, length: number, sampleRate: number) => AudioBuffer },
  accent: boolean
): AudioBuffer {
  const sampleRate = ctx.sampleRate > 0 ? ctx.sampleRate : 44100
  const length = Math.max(8, Math.floor(sampleRate * CLICK_DURATION_SECONDS))
  const buffer = ctx.createBuffer(2, length, sampleRate)
  const freq = accent ? ACCENT_CLICK_HZ : BEAT_CLICK_HZ
  const amp = accent ? ACCENT_CLICK_GAIN : BEAT_CLICK_GAIN
  for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
    fillClickSamples(buffer.getChannelData(ch), sampleRate, freq, amp)
  }
  return buffer
}

export function renderMetronomeClicksOffline(
  ctx: OfflineAudioContext,
  dest: AudioNode,
  args: {
    bpm: number
    beatsPerBar?: number
    songEnd: number
    countInSeconds?: number
    volume?: number
  }
): number {
  const volume = Math.max(0, Math.min(1, args.volume ?? DEFAULT_TRACK_VOLUME))
  if (volume <= 0) return 0
  const shift = Math.max(0, args.countInSeconds ?? 0)
  const clicks = clickTimesInRange({
    bpm: args.bpm,
    beatsPerBar: args.beatsPerBar,
    start: 0,
    end: args.songEnd
  })
  const accentBuf = createClickAudioBuffer(ctx, true)
  const beatBuf = createClickAudioBuffer(ctx, false)
  for (const click of clicks) {
    const source = ctx.createBufferSource()
    source.buffer = click.accent ? accentBuf : beatBuf
    const gain = ctx.createGain()
    gain.gain.value = volume
    source.connect(gain)
    gain.connect(dest)
    source.start(Math.max(0, click.songTime + shift))
  }
  return clicks.length
}

export function renderCountInClicksOffline(
  ctx: OfflineAudioContext,
  dest: AudioNode,
  args: {
    bpm: number
    beatsPerBar?: number
    countInBars: number
    volume?: number
  }
): number {
  const bpb = normalizeBeatsPerBar(args.beatsPerBar)
  const bars = Math.max(0, args.countInBars)
  const songEnd = bars * bpb * secondsPerBeat(args.bpm)
  return renderMetronomeClicksOffline(ctx, dest, {
    bpm: args.bpm,
    beatsPerBar: bpb,
    songEnd,
    countInSeconds: 0,
    volume: args.volume ?? 0.5
  })
}
