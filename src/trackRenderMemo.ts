export interface TrackHeaderDataProps {
  trackIndex: number
  name?: string
  mute: boolean
  solo: boolean
  volume: number
  height: number
  canDelete: boolean
  isRenaming: boolean
  renameDraft: string
}

export interface TrackLaneDataProps {
  trackIndex: number
  hasClips: boolean
  isAnyClipPlaying: boolean
  height: number
  maxDur: number
  clips: unknown
  selectedClipIds: unknown
  isLoopEnabled: boolean
  isDraggingLoopEdge: boolean
  isDraggingClip: boolean
  loopStart: number | null
  loopEnd: number | null
  tempLoopStart: number | null
  tempLoopEnd: number | null
}

export function trackHeaderDataEqual(prev: TrackHeaderDataProps, next: TrackHeaderDataProps): boolean {
  return (
    prev.trackIndex === next.trackIndex &&
    prev.name === next.name &&
    prev.mute === next.mute &&
    prev.solo === next.solo &&
    prev.volume === next.volume &&
    prev.height === next.height &&
    prev.canDelete === next.canDelete &&
    prev.isRenaming === next.isRenaming &&
    (!next.isRenaming || prev.renameDraft === next.renameDraft)
  )
}

export function trackLaneDataEqual(prev: TrackLaneDataProps, next: TrackLaneDataProps): boolean {
  return (
    prev.trackIndex === next.trackIndex &&
    prev.hasClips === next.hasClips &&
    prev.isAnyClipPlaying === next.isAnyClipPlaying &&
    prev.height === next.height &&
    prev.maxDur === next.maxDur &&
    prev.clips === next.clips &&
    prev.selectedClipIds === next.selectedClipIds &&
    prev.isLoopEnabled === next.isLoopEnabled &&
    prev.isDraggingLoopEdge === next.isDraggingLoopEdge &&
    prev.isDraggingClip === next.isDraggingClip &&
    prev.loopStart === next.loopStart &&
    prev.loopEnd === next.loopEnd &&
    prev.tempLoopStart === next.tempLoopStart &&
    prev.tempLoopEnd === next.tempLoopEnd
  )
}

export function clipBufferSignature(
  tracks: Array<{ clips: Array<{ id: string; buffer: { length: number; sampleRate: number } }> }>
): string {
  return tracks
    .map((t) => t.clips.map((c) => `${c.id}:${c.buffer.length}:${c.buffer.sampleRate}`).join(','))
    .join('|')
}
