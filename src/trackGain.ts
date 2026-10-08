export const VOLUME_RAMP_SECONDS = 0.02
export const VOLUME_COMMIT_MS = 150

export function effectiveTrackGain(
  volume: number,
  mute: boolean,
  solo: boolean,
  anySolo: boolean
): number {
  const v = Math.max(0, Math.min(1, volume))
  if (mute) return 0
  if (anySolo && !solo) return 0
  return v
}

export function rampTrackGain(
  gain: { gain: { value: number; rampTo?: (value: number, seconds: number) => void } } | null | undefined,
  value: number,
  seconds = VOLUME_RAMP_SECONDS
): void {
  if (!gain) return
  const next = Math.max(0, Math.min(1, value))
  if (typeof gain.gain.rampTo === 'function' && seconds > 0) {
    try {
      gain.gain.rampTo(next, seconds)
      return
    } catch {
      // Context may not be running yet
    }
  }
  gain.gain.value = next
}
