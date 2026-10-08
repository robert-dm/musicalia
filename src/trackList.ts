export const DEFAULT_TRACK_VOLUME = 0.8
export const INITIAL_TRACK_COUNT = 8

export interface EmptyTrack {
  name: string
  mute: boolean
  solo: boolean
  volume: number
  clips: []
}

const NAMED_PISTA_RE = /^(?:pista|track)\s+(\d+)$/i

export function createEmptyTrack(name: string): EmptyTrack {
  return {
    name,
    mute: false,
    solo: false,
    volume: DEFAULT_TRACK_VOLUME,
    clips: []
  }
}

export function nextPistaNumber(
  names: Array<string | undefined | null>,
  trackCount: number
): number {
  let max = Math.max(0, trackCount)
  for (const name of names) {
    if (typeof name !== 'string') continue
    const match = name.trim().match(NAMED_PISTA_RE)
    if (!match) continue
    const n = parseInt(match[1], 10)
    if (Number.isFinite(n)) max = Math.max(max, n)
  }
  return max + 1
}

export function nextPistaName(
  names: Array<string | undefined | null>,
  trackCount: number
): string {
  return `Pista ${nextPistaNumber(names, trackCount)}`
}

export function appendEmptyTrack<T extends { name?: string }>(
  tracks: T[],
  factory: (name: string) => T
): T[] {
  return [...tracks, factory(nextPistaName(tracks.map((t) => t.name), tracks.length))]
}

export function initialEmptyTracks(count = INITIAL_TRACK_COUNT): EmptyTrack[] {
  return Array.from({ length: count }, (_, i) => createEmptyTrack(`Pista ${i + 1}`))
}
