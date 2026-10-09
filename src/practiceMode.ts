export function togglePractice<T extends { mute: boolean; solo: boolean }>(
  tracks: T[],
  index: number,
  currentPractice: number | null
): { tracks: T[]; practiceIndex: number | null } {
  if (index < 0 || index >= tracks.length) return { tracks, practiceIndex: currentPractice }
  if (currentPractice === index) {
    return {
      tracks: tracks.map((track, i) => (i === index ? { ...track, mute: false } : track)),
      practiceIndex: null
    }
  }
  return {
    tracks: tracks.map((track, i) => ({
      ...track,
      mute: i === index ? true : currentPractice === i ? false : track.mute,
      solo: false
    })),
    practiceIndex: index
  }
}

export function toggleAislar<T extends { mute: boolean; solo: boolean }>(
  tracks: T[],
  index: number
): { tracks: T[]; practiceIndex: number | null } {
  if (index < 0 || index >= tracks.length) return { tracks, practiceIndex: null }
  const isolated = tracks[index].solo && tracks.every((track, i) => (i === index ? track.solo : !track.solo))
  if (isolated) {
    return {
      tracks: tracks.map((track, i) => (i === index ? { ...track, solo: false } : track)),
      practiceIndex: null
    }
  }
  // After adding a play-along lane, several tracks can be soloed. A second
  // Aislar click should hear everything again, not re-silence the new lane.
  if (tracks[index].solo) {
    return {
      tracks: tracks.map((track) => ({ ...track, solo: false })),
      practiceIndex: null
    }
  }
  return {
    tracks: tracks.map((track, i) => ({
      ...track,
      solo: i === index,
      mute: i === index ? false : track.mute
    })),
    practiceIndex: null
  }
}

/** While Solo/Aislar is on, a new lane must join the group or its clips stay silent. */
export function newLaneJoinsSolo(tracks: { solo: boolean }[]): boolean {
  return tracks.some((track) => track.solo)
}

export const AISLAR_BUTTON_TITLE =
  'Aislar: oís SOLO esta pista, para tocar o cantar encima. Mute (M) silencia una pista. Solo (S) puede dejar varias sonando. Si agregás una pista nueva, también se oye. Pulsá de nuevo para oír todas.'

export const AISLAR_TRANSPORT_TITLE =
  'Aislar la pista seleccionada: oís solo esa (las pistas nuevas también se oyen, para tocar encima). Distinto de Mute (silenciar) y de Solo (varias a la vez).'

export function resolvePracticeTrack(
  selected: number | null,
  armed: number | null,
  trackCount: number
): number | null {
  if (selected != null && selected >= 0 && selected < trackCount) return selected
  if (armed != null && armed >= 0 && armed < trackCount) return armed
  return trackCount > 0 ? 0 : null
}
