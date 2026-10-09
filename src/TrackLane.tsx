import { memo, useRef } from 'react'
import { ClipWaveform } from './ClipWaveform'
import { displayLoop } from './loopRegion'
import { laneClipDataEqual, trackLaneDataEqual } from './trackRenderMemo'

export interface LaneClip {
  id: string
  fileName: string
  offsetSeconds: number
  duration: number
  buffer: AudioBuffer
  sourceStart: number
  kind?: string
  patternId?: string
  patternRows?: number[][]
}

interface TrackLaneProps {
  trackIndex: number
  trackKind?: string
  hasClips: boolean
  isAnyClipPlaying: boolean
  height: number
  maxDur: number
  clips: LaneClip[]
  selectedClipIds: Set<string>
  isLoopEnabled: boolean
  loopStart: number | null
  loopEnd: number | null
  tempLoopStart: number | null
  tempLoopEnd: number | null
  onWaveformClick: (e: React.MouseEvent<HTMLDivElement>) => void
  onDoubleClick: (trackIndex: number) => void
  onMouseDown: (e: React.MouseEvent<HTMLDivElement>) => void
  onContextMenuTrack: (e: React.MouseEvent, trackIndex: number, clipId: string | null) => void
  onClipClick: (e: React.MouseEvent, trackIndex: number, clipId: string) => void
  onClipDoubleClick?: (trackIndex: number, clipId: string) => void
  onResizeStart: (e: React.PointerEvent, trackIndex: number, clipId: string, edge: 'left' | 'right') => void
  onClipDragStart: (e: React.PointerEvent, trackIndex: number, clipId: string) => void
  isRecordingLane?: boolean
  recordingStartOffset?: number
}

interface LaneClipViewProps {
  trackIndex: number
  maxDur: number
  clip: LaneClip
  selected: boolean
  onClipClick: (e: React.MouseEvent, trackIndex: number, clipId: string) => void
  onClipDoubleClick?: (trackIndex: number, clipId: string) => void
  onContextMenuTrack: (e: React.MouseEvent, trackIndex: number, clipId: string | null) => void
  onResizeStart: (e: React.PointerEvent, trackIndex: number, clipId: string, edge: 'left' | 'right') => void
  onClipDragStart: (e: React.PointerEvent, trackIndex: number, clipId: string) => void
}

const LaneClipView = memo(function LaneClipView({
  trackIndex,
  maxDur,
  clip,
  selected,
  onClipClick,
  onClipDoubleClick,
  onContextMenuTrack,
  onResizeStart,
  onClipDragStart
}: LaneClipViewProps) {
  const renderCountRef = useRef(0)
  renderCountRef.current += 1

  return (
    <div
      data-clip-id={clip.id}
      data-clip-offset={String(clip.offsetSeconds)}
      data-render-count={renderCountRef.current}
      className={`clip-wrapper ${selected ? 'selected' : ''}`}
      data-testid="clip-wrapper"
      style={{
        position: 'absolute',
        left: `${(clip.offsetSeconds / maxDur) * 100}%`,
        width: `${(clip.duration / maxDur) * 100}%`,
        height: '100%'
      }}
      onClick={(e) => onClipClick(e, trackIndex, clip.id)}
      onDoubleClick={(e) => {
        e.stopPropagation()
        onClipDoubleClick?.(trackIndex, clip.id)
      }}
      onContextMenu={(e) => onContextMenuTrack(e, trackIndex, clip.id)}
    >
      <div
        className="clip-trim-handle left"
        onPointerDown={(e) => onResizeStart(e, trackIndex, clip.id, 'left')}
        title="Arrastra para recortar desde el inicio"
      />
      <div
        className="clip-body"
        onPointerDown={(e) => onClipDragStart(e, trackIndex, clip.id)}
        title="Arrastra para mover (clic derecho para editar, Alt+arrastrar para duplicar)"
        style={{ cursor: 'move', touchAction: 'none' }}
      >
        <div className="clip-info">
          <span className="clip-filename">{clip.fileName}</span>
        </div>
        {clip.kind === 'pattern' && clip.patternRows ? (
          <div className="pattern-clip-preview" aria-hidden="true">
            {clip.patternRows.slice(0, 8).map((row, ri) => (
              <div key={ri} className="pattern-clip-row">
                {row.slice(0, 16).map((cell, ci) => (
                  <span key={ci} className={`pattern-clip-cell ${cell ? 'on' : ''}`} />
                ))}
              </div>
            ))}
          </div>
        ) : (
          <ClipWaveform
            buffer={clip.buffer}
            sourceStart={clip.sourceStart}
            duration={clip.duration}
          />
        )}
      </div>
      <div
        className="clip-trim-handle right"
        onPointerDown={(e) => onResizeStart(e, trackIndex, clip.id, 'right')}
        title="Arrastra para recortar desde el final"
      />
    </div>
  )
}, laneClipDataEqual)

export const TrackLane = memo(function TrackLane({
  trackIndex,
  trackKind,
  hasClips,
  isAnyClipPlaying,
  height,
  maxDur,
  clips,
  selectedClipIds,
  isLoopEnabled,
  loopStart,
  loopEnd,
  tempLoopStart,
  tempLoopEnd,
  onWaveformClick,
  onDoubleClick,
  onMouseDown,
  onContextMenuTrack,
  onClipClick,
  onClipDoubleClick,
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
      data-track-kind={trackKind === 'drum' ? 'drum' : 'audio'}
      data-render-count={renderCountRef.current}
      style={{ height: `${height}px` }}
      onClick={onWaveformClick}
      onDoubleClick={() => onDoubleClick(trackIndex)}
      onMouseDown={onMouseDown}
      onContextMenu={(e) => onContextMenuTrack(e, trackIndex, null)}
    >
      {hasClips ? (
        <div className="clip-region">
          {clips.map((clip) => (
            <LaneClipView
              key={clip.id}
              trackIndex={trackIndex}
              maxDur={maxDur}
              clip={clip}
              selected={selectedClipIds.has(clip.id)}
              onClipClick={onClipClick}
              onClipDoubleClick={onClipDoubleClick}
              onContextMenuTrack={onContextMenuTrack}
              onResizeStart={onResizeStart}
              onClipDragStart={onClipDragStart}
            />
          ))}
        </div>
      ) : (
        <div className="empty-lane">
          <span className="import-hint">
            {trackKind === 'drum'
              ? 'Doble clic para abrir pads y secuenciador'
              : 'Doble clic o arrastrá un archivo de audio'}
          </span>
        </div>
      )}
      {(() => {
        const loop = displayLoop(loopStart, loopEnd, tempLoopStart, tempLoopEnd)
        if (!loop) return null
        return (
          <div
            className={`loop-region${isLoopEnabled ? ' armed' : ''}`}
            data-testid={trackIndex === 0 ? 'lane-loop-overlay' : undefined}
            style={{
              left: `${(loop.start / maxDur) * 100}%`,
              width: `${((loop.end - loop.start) / maxDur) * 100}%`
            }}
          />
        )
      })()}
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
