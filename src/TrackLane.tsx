import { memo, useRef } from 'react'
import { ClipWaveform } from './ClipWaveform'
import { laneClipDataEqual, trackLaneDataEqual } from './trackRenderMemo'

export interface LaneClip {
  id: string
  fileName: string
  offsetSeconds: number
  duration: number
  buffer: AudioBuffer
  sourceStart: number
}

interface TrackLaneProps {
  trackIndex: number
  hasClips: boolean
  isAnyClipPlaying: boolean
  height: number
  maxDur: number
  clips: LaneClip[]
  selectedClipIds: Set<string>
  isLoopEnabled: boolean
  isDraggingLoopEdge: boolean
  loopStart: number | null
  loopEnd: number | null
  tempLoopStart: number | null
  tempLoopEnd: number | null
  onWaveformClick: (e: React.MouseEvent<HTMLDivElement>) => void
  onDoubleClick: (trackIndex: number) => void
  onMouseDown: (e: React.MouseEvent<HTMLDivElement>) => void
  onContextMenuTrack: (e: React.MouseEvent, trackIndex: number, clipId: string | null) => void
  onLoopMouseDown: (e: React.MouseEvent<HTMLDivElement>, edge?: 'start' | 'end') => void
  onLoopMouseMove: (e: React.MouseEvent<HTMLDivElement>) => void
  onLoopMouseUp: (e?: MouseEvent | React.MouseEvent) => void
  onClipClick: (e: React.MouseEvent, trackIndex: number, clipId: string) => void
  onResizeStart: (e: React.MouseEvent, trackIndex: number, clipId: string, edge: 'left' | 'right') => void
  onClipDragStart: (e: React.MouseEvent, trackIndex: number, clipId: string) => void
  isRecordingLane?: boolean
  recordingStartOffset?: number
}

interface LaneClipViewProps {
  trackIndex: number
  maxDur: number
  clip: LaneClip
  selected: boolean
  onClipClick: (e: React.MouseEvent, trackIndex: number, clipId: string) => void
  onContextMenuTrack: (e: React.MouseEvent, trackIndex: number, clipId: string | null) => void
  onResizeStart: (e: React.MouseEvent, trackIndex: number, clipId: string, edge: 'left' | 'right') => void
  onClipDragStart: (e: React.MouseEvent, trackIndex: number, clipId: string) => void
}

const LaneClipView = memo(function LaneClipView({
  trackIndex,
  maxDur,
  clip,
  selected,
  onClipClick,
  onContextMenuTrack,
  onResizeStart,
  onClipDragStart
}: LaneClipViewProps) {
  const renderCountRef = useRef(0)
  renderCountRef.current += 1

  return (
    <div
      data-clip-id={clip.id}
      data-render-count={renderCountRef.current}
      className={`clip-wrapper ${selected ? 'selected' : ''}`}
      style={{
        position: 'absolute',
        left: `${(clip.offsetSeconds / maxDur) * 100}%`,
        width: `${(clip.duration / maxDur) * 100}%`,
        height: '100%'
      }}
      onClick={(e) => onClipClick(e, trackIndex, clip.id)}
      onContextMenu={(e) => onContextMenuTrack(e, trackIndex, clip.id)}
    >
      <div
        className="clip-trim-handle left"
        onMouseDown={(e) => onResizeStart(e, trackIndex, clip.id, 'left')}
        title="Arrastra para recortar desde el inicio"
      />
      <div
        className="clip-body"
        onMouseDown={(e) => onClipDragStart(e, trackIndex, clip.id)}
        title="Arrastra para mover (clic derecho para editar, Alt+arrastrar para duplicar)"
        style={{ cursor: 'move' }}
      >
        <div className="clip-info">
          <span className="clip-filename">{clip.fileName}</span>
        </div>
        <ClipWaveform
          buffer={clip.buffer}
          sourceStart={clip.sourceStart}
          duration={clip.duration}
        />
      </div>
      <div
        className="clip-trim-handle right"
        onMouseDown={(e) => onResizeStart(e, trackIndex, clip.id, 'right')}
        title="Arrastra para recortar desde el final"
      />
    </div>
  )
}, laneClipDataEqual)

export const TrackLane = memo(function TrackLane({
  trackIndex,
  hasClips,
  isAnyClipPlaying,
  height,
  maxDur,
  clips,
  selectedClipIds,
  isLoopEnabled,
  isDraggingLoopEdge,
  loopStart,
  loopEnd,
  tempLoopStart,
  tempLoopEnd,
  onWaveformClick,
  onDoubleClick,
  onMouseDown,
  onContextMenuTrack,
  onLoopMouseDown,
  onLoopMouseMove,
  onLoopMouseUp,
  onClipClick,
  onResizeStart,
  onClipDragStart,
  isRecordingLane = false,
  recordingStartOffset = 0
}: TrackLaneProps) {
  const renderCountRef = useRef(0)
  renderCountRef.current += 1

  return (
    <div
      className={`track-content ${hasClips ? 'has-clip' : ''} ${isAnyClipPlaying ? 'playing' : ''}`}
      data-track-index={trackIndex}
      data-render-count={renderCountRef.current}
      style={{ height: `${height}px` }}
      onClick={onWaveformClick}
      onDoubleClick={() => onDoubleClick(trackIndex)}
      onMouseDown={onMouseDown}
      onContextMenu={(e) => onContextMenuTrack(e, trackIndex, null)}
    >
      {hasClips ? (
        <div
          className="clip-region"
          onMouseDown={(e) => {
            if (isLoopEnabled && e.button === 0 && !isDraggingLoopEdge) {
              onLoopMouseDown(e)
            }
          }}
          onMouseMove={onLoopMouseMove}
          onMouseUp={onLoopMouseUp}
        >
          {clips.map((clip) => (
            <LaneClipView
              key={clip.id}
              trackIndex={trackIndex}
              maxDur={maxDur}
              clip={clip}
              selected={selectedClipIds.has(clip.id)}
              onClipClick={onClipClick}
              onContextMenuTrack={onContextMenuTrack}
              onResizeStart={onResizeStart}
              onClipDragStart={onClipDragStart}
            />
          ))}
          {(loopStart !== null || tempLoopStart !== null) && (
            <div
              className="loop-marker loop-start draggable"
              style={{
                left: `${((tempLoopStart ?? loopStart)! / maxDur) * 100}%`
              }}
              onMouseDown={(e) => onLoopMouseDown(e, 'start')}
              title="Arrastra para ajustar inicio"
            />
          )}
          {(loopEnd !== null || tempLoopEnd !== null) && (
            <div
              className="loop-marker loop-end draggable"
              style={{
                left: `${((tempLoopEnd ?? loopEnd)! / maxDur) * 100}%`
              }}
              onMouseDown={(e) => onLoopMouseDown(e, 'end')}
              title="Arrastra para ajustar fin"
            />
          )}
          {((loopStart !== null && loopEnd !== null) || (tempLoopStart !== null && tempLoopEnd !== null)) && (
            <div
              className="loop-region"
              style={{
                left: `${((tempLoopStart ?? loopStart)! / maxDur) * 100}%`,
                width: `${(((tempLoopEnd ?? loopEnd)! - (tempLoopStart ?? loopStart)!) / maxDur) * 100}%`
              }}
            />
          )}
        </div>
      ) : (
        <div className="empty-lane">
          <span className="import-hint">Doble clic o arrastrá un archivo de audio</span>
        </div>
      )}
      {isRecordingLane && (
        <div
          className="recording-clip"
          data-testid="recording-clip"
          data-recording-clip="true"
          style={{
            left: `${(recordingStartOffset / Math.max(maxDur, 1e-6)) * 100}%`,
            width: `${(0.08 / Math.max(maxDur, 1e-6)) * 100}%`
          }}
        >
          <canvas />
        </div>
      )}
    </div>
  )
}, trackLaneDataEqual)
