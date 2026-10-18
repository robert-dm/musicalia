import { useMemo, useState } from 'react'
import {
  isDownbeat,
  localBpmAt,
  type TempoMap
} from './beatTracker'
import { formatBpm } from './tempoMath'

interface TempoMapMarkersProps {
  map: TempoMap
  pulsesPerBar: number
  duration: number
  viewStart?: number
  viewEnd?: number
  follow: boolean
  onGestureStart?: () => void
  onMove: (id: string, time: number) => void
  onAdd: (time: number) => void
  onRemove: (id: string) => void
  onSetDownbeat: (id: string) => void
}

export function TempoMapMarkers({
  map,
  pulsesPerBar,
  duration,
  viewStart = 0,
  viewEnd,
  follow,
  onGestureStart,
  onMove,
  onAdd,
  onRemove,
  onSetDownbeat
}: TempoMapMarkersProps) {
  const end = viewEnd ?? duration
  const [hoverId, setHoverId] = useState<string | null>(null)
  const [menu, setMenu] = useState<{ id: string; x: number; y: number; time: number } | null>(null)
  const visible = useMemo(
    () => map.beats.filter((b) => b.time >= viewStart - 0.05 && b.time <= end + 0.05),
    [map.beats, viewStart, end]
  )
  if (!follow || duration <= 0) return null

  return (
    <div className="tempo-map-overlay" data-testid="tempo-map-overlay">
      {visible.map((beat, i) => {
        const index = map.beats.findIndex((b) => b.id === beat.id)
        const down = isDownbeat(map, index, pulsesPerBar)
        const local = localBpmAt(map, beat.time + 1e-4)
        return (
          <button
            key={beat.id}
            type="button"
            className={`tempo-marker ${down ? 'downbeat' : ''} ${beat.pinned ? 'pinned' : ''}`}
            data-testid={`tempo-marker-${i}`}
            data-beat-id={beat.id}
            data-beat-time={String(beat.time)}
            data-downbeat={down ? '1' : '0'}
            style={{ left: `${(beat.time / duration) * 100}%` }}
            title={`${formatBpm(local)} BPM`}
            onPointerDown={(e) => {
              if (e.button !== 0) return
              e.preventDefault()
              e.stopPropagation()
              onGestureStart?.()
              const lane = e.currentTarget.closest('.track-content') as HTMLElement | null
              const rect = lane?.getBoundingClientRect()
              if (!rect) return
              const pointerId = e.pointerId
              e.currentTarget.setPointerCapture(pointerId)
              const onMovePtr = (ev: PointerEvent) => {
                const t = Math.max(0, Math.min(duration, ((ev.clientX - rect.left) / rect.width) * duration))
                onMove(beat.id, t)
              }
              const onUp = () => {
                window.removeEventListener('pointermove', onMovePtr)
                window.removeEventListener('pointerup', onUp)
              }
              window.addEventListener('pointermove', onMovePtr)
              window.addEventListener('pointerup', onUp)
            }}
            onContextMenu={(e) => {
              e.preventDefault()
              e.stopPropagation()
              setMenu({ id: beat.id, x: e.clientX, y: e.clientY, time: beat.time })
            }}
            onMouseEnter={() => setHoverId(beat.id)}
            onMouseLeave={() => setHoverId((cur) => (cur === beat.id ? null : cur))}
          >
            {hoverId === beat.id && (
              <span className="tempo-marker-bpm">{formatBpm(local)}</span>
            )}
          </button>
        )
      })}
      {menu && (
        <>
          <div className="tempo-marker-menu-backdrop" onMouseDown={() => setMenu(null)} />
          <div className="tempo-marker-menu" style={{ left: menu.x, top: menu.y }} data-testid="tempo-marker-menu">
            <button type="button" onClick={() => { onAdd(menu.time + 0.05); setMenu(null) }}>
              Agregar marca de tempo
            </button>
            <button type="button" onClick={() => { onRemove(menu.id); setMenu(null) }}>
              Borrar marca
            </button>
            <button type="button" onClick={() => { onSetDownbeat(menu.id); setMenu(null) }}>
              Poner el 1 acá
            </button>
          </div>
        </>
      )}
    </div>
  )
}
