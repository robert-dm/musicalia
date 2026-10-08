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
  return {
    tracks: tracks.map((track, i) => ({
      ...track,
      solo: i === index,
      mute: i === index ? false : track.mute
    })),
    practiceIndex: null
  }
}

export function resolvePracticeTrack(
  selected: number | null,
  armed: number | null,
  trackCount: number
): number | null {
  if (selected != null && selected >= 0 && selected < trackCount) return selected
  if (armed != null && armed >= 0 && armed < trackCount) return armed
  return trackCount > 0 ? 0 : null
}
