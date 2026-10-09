import type { ReactNode } from 'react'
import { RULER_HEIGHT_PX, displayLoop, rulerCursor, type LoopHit } from './loopRegion'

interface TimelineRulerProps {
  bars: ReactNode
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

  return (
    <div
      className={`bar-ruler${loopEnabled ? ' loop-armed' : ''}`}
      data-testid="bar-ruler"
      style={{ height: RULER_HEIGHT_PX, cursor }}
      onMouseDown={onMouseDown}
      onMouseMove={onMouseMove}
      onMouseLeave={onMouseLeave}
    >
      {bars}
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
