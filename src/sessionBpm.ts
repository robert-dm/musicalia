/** Auto-detect BPM only for the first audio in an empty session. */

export function sessionHasAudio(tracks: Array<{ clips?: readonly unknown[] | null } | null | undefined>): boolean {
  return tracks.some((track) => (track?.clips?.length ?? 0) > 0)
}

export function shouldApplyDetectedBpm(input: {
  hasExistingAudio: boolean
  bpmManuallySet?: boolean
  detectedBpm: number | null | undefined
}): boolean {
  if (input.detectedBpm == null || !Number.isFinite(input.detectedBpm)) return false
  if (input.hasExistingAudio) return false
  if (input.bpmManuallySet) return false
  return true
}

/** First song in an empty session always starts at 0:00 / bar 1. */
export function firstImportOffset(hasExistingAudio: boolean, requestedOffset?: number): number {
  if (!hasExistingAudio) return 0
  const n = Number(requestedOffset)
  return Number.isFinite(n) && n > 0 ? n : 0
}
