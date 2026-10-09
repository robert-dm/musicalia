import { useLayoutEffect, useState, type MutableRefObject, type ReactNode } from 'react'
import { RULER_HEIGHT_PX, displayLoop, rulerCursor, type LoopHit } from './loopRegion'
import { pxPerSecond, timelineTicks, viewTimeWindow, type TimelineTick } from './timelineZoom'

interface TimelineRulerProps {
  bars?: ReactNode
  scrollerRef?: MutableRefObject<HTMLDivElement | null>
  zoom?: number
  bpm?: number
  layoutMax: number
  loopStart: number | null
  loopEnd: number | null
  tempLoopStart: number | null
  tempLoopEnd: number | null
  loopEnabled: boolean
  hoverHit: LoopHit
  dragging: boolean
  onMouseDown: (e: React.MouseEvent<HTMLDivElement>) => void
  onMouseMove: (e: React.MouseEvent<HTMLDivElement>) => void
  onMouseLeave: () => void
}

export function TimelineRuler({
  bars,
  scrollerRef,
  zoom = 1,
  bpm = 120,
  layoutMax,
  loopStart,
  loopEnd,
  tempLoopStart,
  tempLoopEnd,
  loopEnabled,
  hoverHit,
  dragging,
  onMouseDown,
  onMouseMove,
  onMouseLeave
}: TimelineRulerProps) {
  const loop = displayLoop(loopStart, loopEnd, tempLoopStart, tempLoopEnd)
  const max = layoutMax > 0 ? layoutMax : 1
  const cursor = dragging && hoverHit === 'body' ? 'grabbing' : rulerCursor(hoverHit)
  const [ticks, setTicks] = useState<TimelineTick[]>([])

  useLayoutEffect(() => {
    const scroller = scrollerRef?.current
    const update = () => {
      const viewportWidth = scroller?.clientWidth || 1
      const scrollLeft = scroller?.scrollLeft || 0
      const inner = viewportWidth * Math.max(zoom, 1e-6)
      const pps = pxPerSecond(inner, max)
      const view = viewTimeWindow({
        scrollLeft,
        viewportWidth,
        zoom,
        layoutMax: max,
        padPx: 80
      })
      setTicks(timelineTicks({
        layoutMax: max,
        pxPerSec: pps,
        viewStart: view.start,
        viewEnd: view.end,
        bpm
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
  }, [scrollerRef, zoom, bpm, max])

  const generated = ticks.map((tick, i) => (
    tick.kind === 'bar' ? (
      <div key={`b-${tick.t}-${i}`} className="bar-marker" style={{ left: `${(tick.t / max) * 100}%` }}>
        {tick.label && <span className="bar-number">{tick.label}</span>}
      </div>
    ) : (
      <div
        key={`t-${tick.t}-${i}`}
        className={tick.kind === 'beat' ? 'beat-marker' : 'sub-marker'}
        style={{ left: `${(tick.t / max) * 100}%` }}
      />
    )
  ))

  return (
    <div
      className={`bar-ruler${loopEnabled ? ' loop-armed' : ''}`}
      data-testid="bar-ruler"
      style={{ height: RULER_HEIGHT_PX, cursor }}
      onMouseDown={onMouseDown}
      onMouseMove={onMouseMove}
      onMouseLeave={onMouseLeave}
    >
      {bars ?? generated}
      {loop && (
        <>
          <div
            className="ruler-loop-band"
            data-testid="ruler-loop-band"
            data-loop-enabled={loopEnabled ? '1' : '0'}
            data-loop-start={String(loop.start)}
            data-loop-end={String(loop.end)}
            style={{
              left: `${(loop.start / max) * 100}%`,
              width: `${((loop.end - loop.start) / max) * 100}%`
            }}
          />
          <div
            className="ruler-loop-handle start"
            data-testid="ruler-loop-start"
            style={{ left: `${(loop.start / max) * 100}%` }}
            title="Inicio del loop"
          />
          <div
            className="ruler-loop-handle end"
            data-testid="ruler-loop-end"
            style={{ left: `${(loop.end / max) * 100}%` }}
            title="Fin del loop"
          />
        </>
      )}
    </div>
  )
}
