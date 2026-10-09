import * as Tone from 'tone'

export const MIN_TEMPO_RATE = 0.5
export const MAX_TEMPO_RATE = 1.5
export const MIN_PITCH_SEMITONES = -12
export const MAX_PITCH_SEMITONES = 12

export function clampTempoRate(n: number): number {
  if (!Number.isFinite(n)) return 1
  return Math.max(MIN_TEMPO_RATE, Math.min(MAX_TEMPO_RATE, n))
}

export function clampPitchSemitones(n: number): number {
  if (!Number.isFinite(n)) return 0
  return Math.max(MIN_PITCH_SEMITONES, Math.min(MAX_PITCH_SEMITONES, Math.round(n)))
}

export function effectiveBpm(baseBpm: number, tempoRate: number): number {
  const bpm = Number.isFinite(baseBpm) ? baseBpm : 120
  return Math.max(20, Math.min(300, Math.round(bpm * clampTempoRate(tempoRate))))
}

type ClipBufferSource = AudioBuffer | { get: () => AudioBuffer | undefined | null }

export function nativeFromClipSource(buffer: ClipBufferSource): AudioBuffer | undefined {
  if (buffer && typeof (buffer as { get?: unknown }).get === 'function') {
    return (buffer as { get: () => AudioBuffer | undefined | null }).get() ?? undefined
  }
  return buffer as AudioBuffer
}

/**
 * GrainPlayer.buffer is a public field, not a setter. Replacing it with
 * another ToneAudioBuffer shares that wrapper. Tone.Player.dispose() then
 * calls wrapper.dispose() and sets _buffer = undefined — clip.buffer (the
 * native AudioBuffer from .get()) still draws the waveform, but playback
 * is silent. Copy the native samples into GrainPlayer's own wrapper.
 */
export function assignOwnedClipBuffer(
  player: { buffer: { set: (buffer: AudioBuffer) => unknown } },
  buffer: ClipBufferSource
): void {
  const native = nativeFromClipSource(buffer)
  if (native) player.buffer.set(native)
}

export function createClipPlayer(buffer?: AudioBuffer | Tone.ToneAudioBuffer): Tone.GrainPlayer {
  const player = new Tone.GrainPlayer()
  player.grainSize = 0.1
  player.overlap = 0.05
  player.loop = false
  if (buffer) assignOwnedClipBuffer(player, buffer)
  return player
}

export function applyClipPlayback(
  player: { playbackRate: number; detune: number },
  tempoRate: number,
  pitchSemitones: number
): void {
  player.playbackRate = clampTempoRate(tempoRate)
  player.detune = clampPitchSemitones(pitchSemitones) * 100
}

export function wallDelayForSong(songDeltaSeconds: number, tempoRate: number): number {
  return Math.max(0, songDeltaSeconds) / clampTempoRate(tempoRate)
}

export function songTimeFromWall(
  originSong: number,
  originWall: number,
  nowWall: number,
  tempoRate: number
): number {
  return originSong + (nowWall - originWall) * clampTempoRate(tempoRate)
}
