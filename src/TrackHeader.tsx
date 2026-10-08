import { memo, useRef } from 'react'
import { LiveParamSlider } from './LiveParamSlider'
import { resolveTrackName } from './clipSelection'
import { trackHeaderDataEqual } from './trackRenderMemo'

interface TrackHeaderProps {
  trackIndex: number
  name?: string
  mute: boolean
  solo: boolean
  volume: number
  height: number
  canDelete: boolean
  isRenaming: boolean
  renameDraft: string
  onContextMenu: (e: React.MouseEvent, trackIndex: number) => void
  onStartRename: (trackIndex: number) => void
  onRenameDraftChange: (value: string) => void
  onCommitRename: (trackIndex: number, raw: string) => void
  onCancelRename: () => void
  onDelete: (trackIndex: number) => void
  onMute: (trackIndex: number) => void
  onSolo: (trackIndex: number) => void
  onVolumeLive: (trackIndex: number, volume: number) => void
  onVolumeCommit: (trackIndex: number, volume: number) => void
}

export const TrackHeader = memo(function TrackHeader({
  trackIndex,
  name,
  mute,
  solo,
  volume,
  height,
  canDelete,
  isRenaming,
  renameDraft,
  onContextMenu,
  onStartRename,
  onRenameDraftChange,
  onCommitRename,
  onCancelRename,
  onDelete,
  onMute,
  onSolo,
  onVolumeLive,
  onVolumeCommit
}: TrackHeaderProps) {
  const renderCountRef = useRef(0)
  renderCountRef.current += 1
  const displayName = resolveTrackName(name, trackIndex)

  return (
    <div
      className="track-header"
      data-track-index={trackIndex}
      data-render-count={renderCountRef.current}
      style={{ height: `${height}px` }}
      onContextMenu={(e) => onContextMenu(e, trackIndex)}
    >
      <div className="track-name-row">
        {isRenaming ? (
          <input
            className="track-name-input"
            value={renameDraft}
            autoFocus
            aria-label="Nombre de pista"
            onChange={(e) => onRenameDraftChange(e.target.value)}
            onFocus={(e) => e.currentTarget.select()}
            onKeyDown={(e) => {
              e.stopPropagation()
              if (e.key === 'Enter') {
                e.preventDefault()
                onCommitRename(trackIndex, renameDraft)
              } else if (e.key === 'Escape') {
                e.preventDefault()
                onCancelRename()
              }
            }}
            onBlur={() => onCommitRename(trackIndex, renameDraft)}
            onClick={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
          />
        ) : (
          <div
            className="track-name"
            title={displayName}
            onDoubleClick={(e) => {
              e.preventDefault()
              e.stopPropagation()
              onStartRename(trackIndex)
            }}
          >
            {displayName}
          </div>
        )}
        <button
          type="button"
          className="control-button track-delete-button"
          title={canDelete ? 'Eliminar pista' : 'Debe quedar al menos una pista'}
          aria-label="Eliminar pista"
          disabled={!canDelete}
          onClick={(e) => {
            e.stopPropagation()
            onDelete(trackIndex)
          }}
        >
          <svg width="13" height="13" viewBox="0 0 16 16" aria-hidden="true">
            <path
              fill="currentColor"
              d="M6.2 2h3.6l.4 1.2H14v1.2H2V3.2h3.8L6.2 2zM3.2 5.2h9.6l-.7 8.4c-.1.7-.7 1.2-1.4 1.2H5.3c-.7 0-1.3-.5-1.4-1.2l-.7-8.4zM6.4 6.4v6H5.2v-6h1.2zm4.4 0v6H9.6v-6h1.2z"
            />
          </svg>
        </button>
      </div>
      <div className="track-controls">
        <button
          className={`control-button mute-button ${mute ? 'active' : ''}`}
          onClick={() => onMute(trackIndex)}
          title="Mute"
        >
          M
        </button>
        <button
          className={`control-button solo-button ${solo ? 'active' : ''}`}
          onClick={() => onSolo(trackIndex)}
          title="Solo"
        >
          S
        </button>
        <LiveParamSlider
          className="volume-slider"
          value={volume}
          title="Volumen"
          ariaLabel="Volumen"
          onLive={(v) => onVolumeLive(trackIndex, v)}
          onCommit={(v) => onVolumeCommit(trackIndex, v)}
        />
      </div>
    </div>
  )
}, trackHeaderDataEqual)
