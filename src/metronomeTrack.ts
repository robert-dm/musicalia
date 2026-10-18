import { DEFAULT_PAN, defaultTrackFx } from './trackFx'
import { DEFAULT_TRACK_VOLUME, type EmptyTrack } from './trackList'
import { transportTimeForHit } from './drumTiming'
import {
  DEFAULT_METRONOME_METER,
  barDurationSeconds,
  meterFromBeatsPerBar,
  metronomeClicksInRange,
  normalizeMetronomeMeter,
  type ClickSound,
  type MetronomeMeter
} from './metronomeMeter'
import { followClicksInRange, hasTempoMap, isFollowEnabled, type TempoMap } from './beatTracker'
import { secondsPerBeatSafe } from './tempoMath'

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
  sub?: boolean
}

export interface MetronomeTrackSeed extends EmptyTrack {
  kind: typeof METRONOME_TRACK_KIND
  metronome: MetronomeMeter
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
    kind: METRONOME_TRACK_KIND,
    metronome: { ...DEFAULT_METRONOME_METER }
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
  return secondsPerBeatSafe(bpm)
}

export function normalizeBeatsPerBar(beatsPerBar?: number): number {
  const n = Math.floor(Number(beatsPerBar))
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_BEATS_PER_BAR
}

/** Song-time click grid. Vel (tempoRate) does not move these times. */
export function clickTimesInRange(args: {
  bpm: number
  beatsPerBar?: number
  meter?: Partial<MetronomeMeter> | null
  tempoMap?: TempoMap | null
  start?: number
  end: number
}): MetronomeClick[] {
  const meter = args.meter
    ? normalizeMetronomeMeter(args.meter)
    : meterFromBeatsPerBar(args.beatsPerBar)
  if (isFollowEnabled(meter, args.tempoMap) && hasTempoMap(args.tempoMap)) {
    return followClicksInRange({
      map: args.tempoMap,
      meter,
      start: args.start,
      end: args.end
    })
  }
  return metronomeClicksInRange({
    bpm: args.bpm,
    meter,
    start: args.start,
    end: args.end
  })
}

export function scheduledMetronomeClicks(args: {
  bpm: number
  beatsPerBar?: number
  meter?: Partial<MetronomeMeter> | null
  tempoMap?: TempoMap | null
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
    meter: args.meter,
    tempoMap: args.tempoMap,
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
  fillClickSound(out, sampleRate, 'beep', freq, amplitude)
}

export function fillClickSound(
  out: Float32Array,
  sampleRate: number,
  sound: ClickSound,
  freq: number,
  amplitude: number
): void {
  const sr = sampleRate > 0 ? sampleRate : 44100
  for (let i = 0; i < out.length; i++) {
    const t = i / sr
    if (sound === 'wood') {
      const noise = ((i * 1103515245 + 12345) % 2147483648) / 2147483648 - 0.5
      out[i] =
        (Math.sin(2 * Math.PI * (accentish(freq, 180)) * t) * Math.exp(-t * 38) * 0.72 +
          noise * Math.exp(-t * 90) * 0.85) *
        amplitude
    } else if (sound === 'rim') {
      const noise = ((i * 1664525 + 1013904223) % 2147483648) / 2147483648 - 0.5
      out[i] =
        (Math.sin(2 * Math.PI * (accentish(freq, 2100)) * t) * Math.exp(-t * 70) * 0.55 +
          noise * Math.exp(-t * 140) * 1.05) *
        amplitude
    } else {
      out[i] = Math.sin(2 * Math.PI * freq * t) * Math.exp(-t * 20) * amplitude
    }
  }
}

function accentish(freq: number, woodOrRim: number): number {
  return freq >= ACCENT_CLICK_HZ ? woodOrRim * 1.12 : woodOrRim
}

function clickDurationFor(sound: ClickSound): number {
  if (sound === 'wood') return 0.032
  if (sound === 'rim') return 0.024
  return CLICK_DURATION_SECONDS
}

export function createClickAudioBuffer(
  ctx: { sampleRate: number; createBuffer: (ch: number, length: number, sampleRate: number) => AudioBuffer },
  accent: boolean,
  sound: ClickSound = 'beep'
): AudioBuffer {
  const sampleRate = ctx.sampleRate > 0 ? ctx.sampleRate : 44100
  const length = Math.max(8, Math.floor(sampleRate * clickDurationFor(sound)))
  const buffer = ctx.createBuffer(2, length, sampleRate)
  const freq = accent ? ACCENT_CLICK_HZ : BEAT_CLICK_HZ
  const amp = accent ? ACCENT_CLICK_GAIN : BEAT_CLICK_GAIN
  for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
    fillClickSound(buffer.getChannelData(ch), sampleRate, sound, freq, amp)
  }
  return buffer
}

export function renderMetronomeClicksOffline(
  ctx: OfflineAudioContext,
  dest: AudioNode,
  args: {
    bpm: number
    beatsPerBar?: number
    meter?: Partial<MetronomeMeter> | null
    tempoMap?: TempoMap | null
    songEnd: number
    countInSeconds?: number
    volume?: number
  }
): number {
  const volume = Math.max(0, Math.min(1, args.volume ?? DEFAULT_TRACK_VOLUME))
  if (volume <= 0) return 0
  const shift = Math.max(0, args.countInSeconds ?? 0)
  const meter = args.meter ? normalizeMetronomeMeter(args.meter) : meterFromBeatsPerBar(args.beatsPerBar)
  const clicks = clickTimesInRange({
    bpm: args.bpm,
    beatsPerBar: args.beatsPerBar,
    meter,
    tempoMap: args.tempoMap,
    start: 0,
    end: args.songEnd
  })
  const accentBuf = createClickAudioBuffer(ctx, true, meter.clickSound)
  const beatBuf = createClickAudioBuffer(ctx, false, meter.clickSound)
  for (const click of clicks) {
    const source = ctx.createBufferSource()
    source.buffer = click.accent ? accentBuf : beatBuf
    const gain = ctx.createGain()
    gain.gain.value = click.sub ? volume * 0.55 : volume
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
    meter?: Partial<MetronomeMeter> | null
    countInBars: number
    volume?: number
  }
): number {
  const meter = args.meter ? normalizeMetronomeMeter(args.meter) : meterFromBeatsPerBar(args.beatsPerBar)
  const bars = Math.max(0, args.countInBars)
  const songEnd = bars * barDurationSeconds(args.bpm, meter)
  return renderMetronomeClicksOffline(ctx, dest, {
    bpm: args.bpm,
    beatsPerBar: args.beatsPerBar,
    meter,
    songEnd,
    countInSeconds: 0,
    volume: args.volume ?? 0.5
  })
}
