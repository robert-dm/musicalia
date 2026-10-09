import { memo, useRef } from 'react'
import { LiveParamSlider } from './LiveParamSlider'
import { resolveTrackName } from './clipSelection'
import { AISLAR_BUTTON_TITLE } from './practiceMode'
import { trackHeaderDataEqual } from './trackRenderMemo'
import { IconRecordArm, IconSliders, IconSpline, IconTrash } from './uiIcons'

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
  practiceActive?: boolean
  isolated?: boolean
  onPractice: (trackIndex: number) => void
  onAislar: (trackIndex: number) => void
  onVolumeLive: (trackIndex: number, volume: number) => void
  onVolumeCommit: (trackIndex: number, volume: number) => void
  recordArmed?: boolean
  onRecordArm: (trackIndex: number) => void
  fxOpen?: boolean
  autoOpen?: boolean
  onToggleFx: (trackIndex: number) => void
  onToggleAuto: (trackIndex: number) => void
  onReorderMouseDown?: (e: React.MouseEvent, trackIndex: number) => void
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
  practiceActive = false,
  isolated = false,
  onPractice,
  onAislar,
  onVolumeLive,
  onVolumeCommit,
  recordArmed = false,
  onRecordArm,
  fxOpen = false,
  autoOpen = false,
  onToggleFx,
  onToggleAuto,
  onReorderMouseDown
}: TrackHeaderProps) {
  const renderCountRef = useRef(0)
  renderCountRef.current += 1
  const displayName = resolveTrackName(name, trackIndex)

  return (
    <div
      className="track-header"
      data-track-index={trackIndex}
      data-testid={`track-header-${trackIndex}`}
      data-render-count={renderCountRef.current}
      style={{ height: `${height}px` }}
      onContextMenu={(e) => onContextMenu(e, trackIndex)}
      onMouseDown={(e) => {
        if (e.button !== 0) return
        const target = e.target as HTMLElement
        if (target.closest('button, input, .volume-slider, .track-name-input')) return
        onReorderMouseDown?.(e, trackIndex)
      }}
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
            data-testid={`track-name-${trackIndex}`}
            title={`${displayName} — arrastrá para reordenar`}
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
          className={`control-button practice-button ${practiceActive ? 'active' : ''}`}
          data-testid={`practice-${trackIndex}`}
          onClick={() => onPractice(trackIndex)}
          title="Practicar encima: silencia ESTA pista y deja el resto sonando, para tocar o cantar"
          aria-label="Practicar encima"
          aria-pressed={practiceActive}
        >
          P
        </button>
        <button
          type="button"
          className={`control-button isolate-button ${isolated ? 'active' : ''}`}
          data-testid={`aislar-${trackIndex}`}
          onClick={() => onAislar(trackIndex)}
          title={AISLAR_BUTTON_TITLE}
          aria-label="Aislar: oír solo esta pista"
          aria-pressed={isolated}
        >
          Aislar
        </button>
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
          <IconTrash size={13} />
        </button>
      </div>
      <div className="track-controls">
        <button
          type="button"
          className={`control-button record-arm-button ${recordArmed ? 'active' : ''}`}
          data-testid={`record-arm-${trackIndex}`}
          onClick={() => onRecordArm(trackIndex)}
          title={recordArmed ? 'Quitar rec-arm' : 'Armar pista para grabar'}
          aria-label="Armar grabación"
          aria-pressed={recordArmed}
        >
          <IconRecordArm size={12} />
        </button>
        <button
          type="button"
          className={`control-button fx-button ${fxOpen ? 'active' : ''}`}
          data-testid={`fx-toggle-${trackIndex}`}
          onClick={() => onToggleFx(trackIndex)}
          title={fxOpen ? 'Cerrar efectos' : 'Efectos de pista'}
          aria-label="Efectos de pista"
          aria-pressed={fxOpen}
        >
          <IconSliders size={12} />
        </button>
        <button
          type="button"
          className={`control-button auto-button ${autoOpen ? 'active' : ''}`}
          data-testid={`auto-toggle-${trackIndex}`}
          onClick={() => onToggleAuto(trackIndex)}
          title={autoOpen ? 'Ocultar automatización' : 'Mostrar automatización'}
          aria-label="Automatización"
          aria-pressed={autoOpen}
        >
          <IconSpline size={12} />
        </button>
        <button
          className={`control-button mute-button ${mute ? 'active' : ''}`}
          onClick={() => onMute(trackIndex)}
          title="Mute: silencia esta pista. Distinto de Aislar (oír solo una)."
          aria-pressed={mute}
        >
          M
        </button>
        <button
          className={`control-button solo-button ${solo ? 'active' : ''}`}
          onClick={() => onSolo(trackIndex)}
          title="Solo: deja esta pista sonando (podés activar Solo en varias). Aislar deja una sola."
          aria-pressed={solo}
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
