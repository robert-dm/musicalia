import { useEffect, useMemo, useState } from 'react'
import {
  alignTempoMapToOrigin,
  isDownbeat,
  localBpmAt,
  type TempoMap
} from './beatTracker'
import { beatIndexAtOrAfter } from './tempoMapSanitize'
import { formatBpm } from './tempoMath'
import { viewTimeWindow } from './timelineZoom'

const MAX_VISIBLE_MARKERS = 240

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
  viewStart,
  viewEnd,
  follow,
  onGestureStart,
  onMove,
  onAdd,
  onRemove,
  onSetDownbeat
}: TempoMapMarkersProps) {
  const aligned = useMemo(() => alignTempoMapToOrigin(map), [map])
  const [hoverId, setHoverId] = useState<string | null>(null)
  const [menu, setMenu] = useState<{ id: string; x: number; y: number; time: number } | null>(null)
  const [view, setView] = useState<{ start: number; end: number }>({
    start: viewStart ?? 0,
    end: viewEnd ?? duration
  })

  useEffect(() => {
    if (viewStart != null && viewEnd != null) {
      setView({ start: viewStart, end: viewEnd })
      return
    }
    const host = document.querySelector('[data-testid="metronome-lane"]') as HTMLElement | null
    const scroller = host?.closest('.lanes-scroll-content') as HTMLElement | null
    const update = () => {
      if (!scroller) {
        setView({ start: 0, end: duration })
        return
      }
      setView(viewTimeWindow({
        scrollLeft: scroller.scrollLeft,
        viewportWidth: scroller.clientWidth || 1,
        zoom: Math.max(1e-6, (scroller.scrollWidth || 1) / Math.max(1, scroller.clientWidth || 1)),
        layoutMax: duration,
        padPx: 80
      }))
    }
    update()
    if (!scroller) return
    scroller.addEventListener('scroll', update, { passive: true })
    const ro = new ResizeObserver(update)
    ro.observe(scroller)
    return () => {
      scroller.removeEventListener('scroll', update)
      ro.disconnect()
    }
  }, [duration, viewStart, viewEnd])

  const visible = useMemo(() => {
    const start = view.start - 0.05
    const end = view.end + 0.05
    const beats = aligned.beats
    const i0 = beatIndexAtOrAfter(beats, start)
    const out: Array<{ beat: (typeof beats)[number]; index: number }> = []
    for (let i = i0; i < beats.length; i++) {
      if (beats[i].time > end) break
      out.push({ beat: beats[i], index: i })
    }
    if (out.length <= MAX_VISIBLE_MARKERS) return out
    const downs = out.filter((row) => isDownbeat(aligned, row.index, pulsesPerBar))
    if (downs.length > 0 && downs.length <= MAX_VISIBLE_MARKERS) return downs
    const stride = Math.ceil(out.length / MAX_VISIBLE_MARKERS)
    return out.filter((_, i) => i % stride === 0)
  }, [aligned, pulsesPerBar, view.start, view.end])

  const hoverBpm = hoverId
    ? localBpmAt(aligned, aligned.beats.find((b) => b.id === hoverId)?.time ?? 0)
    : null

  if (!follow || duration <= 0) return null

  return (
    <div className="tempo-map-overlay" data-testid="tempo-map-overlay">
      {visible.map(({ beat, index }, i) => {
        const down = isDownbeat(aligned, index, pulsesPerBar)
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
            title={hoverId === beat.id && hoverBpm != null ? `${formatBpm(hoverBpm)} BPM` : undefined}
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
            {hoverId === beat.id && hoverBpm != null && (
              <span className="tempo-marker-bpm">{formatBpm(hoverBpm)}</span>
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
