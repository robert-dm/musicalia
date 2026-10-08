import { memo, useRef, useState } from 'react'
import {
  nearestPointIndex,
  normFromValue,
  removePoint,
  replacePoint,
  sortPoints,
  upsertPoint,
  valueFromNorm,
  type AutomationPoint
} from './automation'
import { AUTO_LANE_HEIGHT } from './trackFx'

interface AutomationLaneViewProps {
  points: AutomationPoint[]
  min: number
  max: number
  maxDur: number
  staticValue: number
  selectedIndex: number
  onGestureStart: () => void
  onSelect: (index: number) => void
  onLive: (points: AutomationPoint[]) => void
  onCommit: (points: AutomationPoint[], selectedIndex: number) => void
}

function coordsFromEvent(
  e: { clientX: number; clientY: number },
  el: { getBoundingClientRect: () => DOMRect },
  maxDur: number,
  min: number,
  max: number
): { t: number; v: number } {
  const rect = el.getBoundingClientRect()
  const x = Math.max(0, Math.min(1, (e.clientX - rect.left) / Math.max(1, rect.width)))
  const y = Math.max(0, Math.min(1, (e.clientY - rect.top) / Math.max(1, rect.height)))
  return {
    t: x * maxDur,
    v: valueFromNorm(1 - y, min, max)
  }
}

export const AutomationLaneView = memo(function AutomationLaneView({
  points,
  min,
  max,
  maxDur,
  staticValue,
  selectedIndex,
  onGestureStart,
  onSelect,
  onLive,
  onCommit
}: AutomationLaneViewProps) {
  const svgRef = useRef<SVGSVGElement>(null)
  const dragRef = useRef<{ index: number; moved: boolean } | null>(null)
  const gestureSavedRef = useRef(false)
  const pointsRef = useRef(points)
  pointsRef.current = points
  const [livePoints, setLivePoints] = useState<AutomationPoint[] | null>(null)
  const display = livePoints ?? points
  const duration = Math.max(maxDur, 0.001)
  const width = 1000
  const height = AUTO_LANE_HEIGHT

  const toX = (t: number) => (t / duration) * width
  const toY = (v: number) => (1 - normFromValue(v, min, max)) * height

  const polyline = display.map((p) => `${toX(p.t).toFixed(1)},${toY(p.v).toFixed(1)}`).join(' ')
  const fallbackY = toY(staticValue)

  const beginGesture = () => {
    if (!gestureSavedRef.current) {
      gestureSavedRef.current = true
      onGestureStart()
    }
  }

  const hitIndex = (t: number, v: number) => {
    const el = svgRef.current
    if (!el) return -1
    return nearestPointIndex(
      display,
      t,
      v,
      el.clientWidth / duration,
      el.clientHeight / Math.max(1e-6, max - min),
      12
    )
  }

  const finish = (next: AutomationPoint[], selected: number) => {
    const sorted = sortPoints(next)
    const keep = next[selected]
    const nextIndex = keep
      ? sorted.findIndex((p) => p.t === keep.t && p.v === keep.v)
      : -1
    setLivePoints(null)
    dragRef.current = null
    gestureSavedRef.current = false
    onCommit(sorted, nextIndex)
  }

  return (
    <div
      className="auto-lane"
      style={{ height: `${AUTO_LANE_HEIGHT}px` }}
      data-testid="automation-lane"
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.stopPropagation()}
    >
      <svg
        ref={svgRef}
        className="auto-lane-svg"
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none"
        onPointerDown={(e) => {
          if (!svgRef.current) return
          e.preventDefault()
          e.stopPropagation()
          const { t, v } = coordsFromEvent(e, svgRef.current, duration, min, max)
          const hit = hitIndex(t, v)
          if (hit >= 0) {
            dragRef.current = { index: hit, moved: false }
            onSelect(hit)
            e.currentTarget.setPointerCapture(e.pointerId)
            return
          }
          if (e.detail > 1) return
          beginGesture()
          const next = upsertPoint(pointsRef.current, t, v)
          finish(next, next.findIndex((p) => Math.abs(p.t - t) <= 0.04))
        }}
        onPointerMove={(e) => {
          if (!dragRef.current || !svgRef.current) return
          const { t, v } = coordsFromEvent(e, svgRef.current, duration, min, max)
          if (!dragRef.current.moved) beginGesture()
          dragRef.current.moved = true
          const next = replacePoint(display, dragRef.current.index, t, v)
          setLivePoints(next)
          onLive(next)
        }}
        onPointerUp={() => {
          if (dragRef.current?.moved) {
            finish(livePoints ?? display, dragRef.current.index)
            return
          }
          dragRef.current = null
          gestureSavedRef.current = false
        }}
        onPointerCancel={() => {
          setLivePoints(null)
          dragRef.current = null
          gestureSavedRef.current = false
        }}
        onDoubleClick={(e) => {
          if (!svgRef.current) return
          e.preventDefault()
          e.stopPropagation()
          const { t, v } = coordsFromEvent(e, svgRef.current, duration, min, max)
          const hit = hitIndex(t, v)
          if (hit < 0) return
          beginGesture()
          finish(removePoint(display, hit), -1)
        }}
      >
        <line className="auto-lane-baseline" x1="0" y1={fallbackY} x2={width} y2={fallbackY} />
        {display.length > 1 && <polyline className="auto-lane-curve" points={polyline} />}
        {display.length === 1 && (
          <line
            className="auto-lane-curve"
            x1="0"
            y1={toY(display[0].v)}
            x2={width}
            y2={toY(display[0].v)}
          />
        )}
        {display.map((p, i) => (
          <circle
            key={`${p.t}-${i}`}
            className={`auto-lane-point${i === selectedIndex ? ' selected' : ''}`}
            cx={toX(p.t)}
            cy={toY(p.v)}
            r="6"
          />
        ))}
      </svg>
    </div>
  )
})
