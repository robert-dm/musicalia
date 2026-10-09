export interface TrackHeaderDataProps {
  trackIndex: number
  name?: string
  kind?: string
  mute: boolean
  solo: boolean
  volume: number
  height: number
  canDelete: boolean
  isRenaming: boolean
  renameDraft: string
  recordArmed?: boolean
  fxOpen?: boolean
  autoOpen?: boolean
  practiceActive?: boolean
  isolated?: boolean
}

export interface TrackLaneDataProps {
  trackIndex: number
  trackKind?: string
  hasClips: boolean
  isAnyClipPlaying: boolean
  height: number
  maxDur: number
  clips: unknown
  selectedClipIds: unknown
  isLoopEnabled: boolean
  loopStart: number | null
  loopEnd: number | null
  tempLoopStart: number | null
  tempLoopEnd: number | null
  isRecordingLane?: boolean
  recordingStartOffset?: number
}

export function trackHeaderDataEqual(prev: TrackHeaderDataProps, next: TrackHeaderDataProps): boolean {
  return (
    prev.trackIndex === next.trackIndex &&
    prev.name === next.name &&
    prev.kind === next.kind &&
    prev.mute === next.mute &&
    prev.solo === next.solo &&
    prev.volume === next.volume &&
    prev.height === next.height &&
    prev.canDelete === next.canDelete &&
    prev.isRenaming === next.isRenaming &&
    prev.recordArmed === next.recordArmed &&
    prev.fxOpen === next.fxOpen &&
    prev.autoOpen === next.autoOpen &&
    prev.practiceActive === next.practiceActive &&
    prev.isolated === next.isolated &&
    (!next.isRenaming || prev.renameDraft === next.renameDraft)
  )
}

export function trackLaneDataEqual(prev: TrackLaneDataProps, next: TrackLaneDataProps): boolean {
  return (
    prev.trackIndex === next.trackIndex &&
    prev.trackKind === next.trackKind &&
    prev.hasClips === next.hasClips &&
    prev.isAnyClipPlaying === next.isAnyClipPlaying &&
    prev.height === next.height &&
    prev.maxDur === next.maxDur &&
    prev.clips === next.clips &&
    prev.selectedClipIds === next.selectedClipIds &&
    prev.isLoopEnabled === next.isLoopEnabled &&
    prev.loopStart === next.loopStart &&
    prev.loopEnd === next.loopEnd &&
    prev.tempLoopStart === next.tempLoopStart &&
    prev.tempLoopEnd === next.tempLoopEnd &&
    prev.isRecordingLane === next.isRecordingLane &&
    prev.recordingStartOffset === next.recordingStartOffset
  )
}

export interface LaneClipViewData {
  trackIndex: number
  maxDur: number
  selected: boolean
  clip: {
    id: string
    fileName: string
    offsetSeconds: number
    duration: number
    sourceStart: number
    buffer: unknown
    kind?: string
    patternId?: string
    patternRows?: unknown
  }
}

export function laneClipDataEqual(prev: LaneClipViewData, next: LaneClipViewData): boolean {
  return (
    prev.trackIndex === next.trackIndex &&
    prev.maxDur === next.maxDur &&
    prev.selected === next.selected &&
    prev.clip.id === next.clip.id &&
    prev.clip.fileName === next.clip.fileName &&
    prev.clip.offsetSeconds === next.clip.offsetSeconds &&
    prev.clip.duration === next.clip.duration &&
    prev.clip.sourceStart === next.clip.sourceStart &&
    prev.clip.buffer === next.clip.buffer &&
    prev.clip.kind === next.clip.kind &&
    prev.clip.patternId === next.clip.patternId &&
    prev.clip.patternRows === next.clip.patternRows
  )
}

export function clipBufferSignature(
  tracks: Array<{
    kind?: string
    clips: Array<{ id: string; buffer: { length: number; sampleRate: number } }>
    drum?: { pads?: Array<{ id?: string; buffer?: { length: number; sampleRate: number } | null }> }
  }>
): string {
  return tracks
    .map((t) => {
      const clips = t.clips.map((c) => `${c.id}:${c.buffer.length}:${c.buffer.sampleRate}`).join(',')
      const pads = (t.drum?.pads ?? [])
        .map((p, i) => `${p.id ?? i}:${p.buffer?.length ?? 0}:${p.buffer?.sampleRate ?? 0}`)
        .join(',')
      return `${t.kind || 'audio'}:${clips}|${pads}`
    })
    .join('|')
}
