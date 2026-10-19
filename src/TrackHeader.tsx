import { memo, useRef } from 'react'
import { LiveParamSlider } from './LiveParamSlider'
import { resolveTrackName } from './clipSelection'
import { headerDensity } from './headerDensity'
import { AISLAR_BUTTON_TITLE } from './practiceMode'
import { trackHeaderDataEqual } from './trackRenderMemo'
import { IconMoreHorizontal, IconRecordArm, IconSettings, IconSliders, IconSpline, IconTrash } from './uiIcons'

interface TrackHeaderProps {
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
  onSelectTrackClips?: (trackIndex: number, mode: 'add' | 'toggle' | 'replace') => void
  metroSettingsOpen?: boolean
  metroClickBadge?: string | null
  onOpenMetronomeSettings?: (trackIndex: number) => void
}

export const TrackHeader = memo(function TrackHeader({
  trackIndex,
  name,
  kind,
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
  onReorderMouseDown,
  onSelectTrackClips,
  metroSettingsOpen = false,
  metroClickBadge = null,
  onOpenMetronomeSettings
}: TrackHeaderProps) {
  const renderCountRef = useRef(0)
  renderCountRef.current += 1
  const displayName = resolveTrackName(name, trackIndex)
  const isMetronome = kind === 'metronome'
  const density = headerDensity(height)

  return (
    <div
      className="track-header"
      data-track-index={trackIndex}
      data-track-kind={kind === 'drum' ? 'drum' : kind === 'metronome' ? 'metronome' : 'audio'}
      data-header-density={density}
      data-testid={`track-header-${trackIndex}`}
      data-render-count={renderCountRef.current}
      style={{ height: `${height}px` }}
      onContextMenu={(e) => onContextMenu(e, trackIndex)}
      onMouseDown={(e) => {
        if (e.button !== 0) return
        const target = e.target as HTMLElement
        if (target.closest('button, input, .volume-slider, .track-name-input')) return
        if (e.shiftKey || e.ctrlKey || e.metaKey) {
          e.preventDefault()
          e.stopPropagation()
          if (isMetronome) return
          onSelectTrackClips?.(trackIndex, e.ctrlKey || e.metaKey ? 'toggle' : 'add')
          return
        }
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
              if (isMetronome) return
              onStartRename(trackIndex)
            }}
          >
            {displayName}
          </div>
        )}
        {isMetronome && metroClickBadge && (
          <span className="metro-click-badge" data-testid="metro-click-badge">
            {metroClickBadge}
          </span>
        )}
        {isMetronome && (
          <button
            type="button"
            className={`control-button metro-gear-button header-extra ${metroSettingsOpen ? 'active' : ''}`}
            data-testid="metronome-settings-gear"
            onClick={(e) => {
              e.stopPropagation()
              onOpenMetronomeSettings?.(trackIndex)
            }}
            title="Ajustes del metrónomo"
            aria-label="Ajustes del metrónomo"
            aria-pressed={metroSettingsOpen}
          >
            <IconSettings size={13} />
          </button>
        )}
        <button
          type="button"
          className={`control-button practice-button header-extra ${practiceActive ? 'active' : ''}`}
          data-testid={`practice-${trackIndex}`}
          onClick={() => { if (!isMetronome) onPractice(trackIndex) }}
          title={isMetronome ? 'El metrónomo no se practica' : 'Practicar encima: silencia ESTA pista y deja el resto sonando, para tocar o cantar'}
          aria-label="Practicar encima"
          aria-pressed={practiceActive}
          disabled={isMetronome}
        >
          P
        </button>
        <button
          type="button"
          className={`control-button isolate-button header-extra ${isolated ? 'active' : ''}`}
          data-testid={`aislar-${trackIndex}`}
          onClick={() => { if (!isMetronome) onAislar(trackIndex) }}
          title={isMetronome ? 'Aislar no se aplica al metrónomo; Mute (M) lo apaga. Aislar otra pista no lo silencia si está destildado.' : AISLAR_BUTTON_TITLE}
          aria-label="Aislar: oír solo esta pista"
          aria-pressed={isolated}
          disabled={isMetronome}
        >
          Aislar
        </button>
        <button
          type="button"
          className="control-button track-delete-button header-extra"
          title={isMetronome ? 'El metrónomo no se puede eliminar' : canDelete ? 'Eliminar pista' : 'Debe quedar al menos una pista'}
          aria-label="Eliminar pista"
          disabled={!canDelete || isMetronome}
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
          className={`control-button record-arm-button header-extra ${recordArmed ? 'active' : ''}`}
          data-testid={`record-arm-${trackIndex}`}
          onClick={() => { if (!isMetronome) onRecordArm(trackIndex) }}
          title={isMetronome ? 'No se graba en el metrónomo' : recordArmed ? 'Quitar rec-arm' : 'Armar pista para grabar'}
          aria-label="Armar grabación"
          aria-pressed={recordArmed}
          disabled={isMetronome}
        >
          <IconRecordArm size={12} />
        </button>
        <button
          type="button"
          className={`control-button fx-button header-extra ${fxOpen ? 'active' : ''}`}
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
          className={`control-button auto-button header-extra ${autoOpen ? 'active' : ''}`}
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
          className="volume-slider header-volume"
          value={volume}
          title="Volumen"
          ariaLabel="Volumen"
          onLive={(v) => onVolumeLive(trackIndex, v)}
          onCommit={(v) => onVolumeCommit(trackIndex, v)}
        />
        <button
          type="button"
          className="control-button header-more"
          data-testid={`header-more-${trackIndex}`}
          title="Más controles de pista"
          aria-label="Más controles de pista"
          onClick={(e) => {
            e.stopPropagation()
            onContextMenu(e, trackIndex)
          }}
        >
          <IconMoreHorizontal size={13} />
        </button>
      </div>
    </div>
  )
}, trackHeaderDataEqual)
