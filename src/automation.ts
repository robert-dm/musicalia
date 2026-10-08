export interface AutomationPoint {
  t: number
  v: number
}

export interface AutomationLane {
  paramId: string
  points: AutomationPoint[]
}

export function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0
  return Math.max(0, Math.min(1, n))
}

export function normFromValue(value: number, min: number, max: number): number {
  if (max === min) return 0
  return clamp01((value - min) / (max - min))
}

export function valueFromNorm(norm: number, min: number, max: number): number {
  return min + clamp01(norm) * (max - min)
}

export function clamp(n: number, min: number, max: number): number {
  if (!Number.isFinite(n)) return min
  return Math.max(min, Math.min(max, n))
}

export function sortPoints(points: AutomationPoint[]): AutomationPoint[] {
  return [...points].sort((a, b) => a.t - b.t || a.v - b.v)
}

export function evalAutomation(points: AutomationPoint[], time: number): number | null {
  if (!points.length) return null
  const t = Number.isFinite(time) ? time : 0
  if (points.length === 1) return points[0].v
  if (t <= points[0].t) return points[0].v
  const last = points[points.length - 1]
  if (t >= last.t) return last.v
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i]
    const b = points[i + 1]
    if (t >= a.t && t <= b.t) {
      const span = b.t - a.t
      if (span <= 1e-9) return b.v
      const u = (t - a.t) / span
      return a.v + (b.v - a.v) * u
    }
  }
  return last.v
}

export function laneForParam(lanes: AutomationLane[] | undefined, paramId: string): AutomationLane | undefined {
  return lanes?.find((lane) => lane.paramId === paramId)
}

export function upsertPoint(points: AutomationPoint[], time: number, value: number, mergeEps = 0.04): AutomationPoint[] {
  const next = sortPoints(points)
  const hit = next.findIndex((p) => Math.abs(p.t - time) <= mergeEps)
  if (hit >= 0) {
    next[hit] = { t: Math.max(0, time), v: value }
    return sortPoints(next)
  }
  next.push({ t: Math.max(0, time), v: value })
  return sortPoints(next)
}

export function replacePoint(points: AutomationPoint[], index: number, time: number, value: number): AutomationPoint[] {
  if (index < 0 || index >= points.length) return points
  return points.map((p, i) => (i === index ? { t: Math.max(0, time), v: value } : p))
}

export function movePoint(points: AutomationPoint[], index: number, time: number, value: number): AutomationPoint[] {
  return sortPoints(replacePoint(points, index, time, value))
}

export function removePoint(points: AutomationPoint[], index: number): AutomationPoint[] {
  if (index < 0 || index >= points.length) return points
  return points.filter((_, i) => i !== index)
}

export function nearestPointIndex(
  points: AutomationPoint[],
  time: number,
  value: number,
  xScale: number,
  yScale: number,
  thresholdPx = 10
): number {
  let best = -1
  let bestDist = thresholdPx
  for (let i = 0; i < points.length; i++) {
    const dx = (points[i].t - time) * xScale
    const dy = (points[i].v - value) * yScale
    const d = Math.hypot(dx, dy)
    if (d < bestDist) {
      bestDist = d
      best = i
    }
  }
  return best
}

export function hydrateAutomation(raw: unknown): AutomationLane[] {
  if (!Array.isArray(raw)) return []
  const lanes: AutomationLane[] = []
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue
    const rec = entry as { paramId?: unknown; id?: unknown; points?: unknown }
    const paramId = typeof rec.paramId === 'string' ? rec.paramId : typeof rec.id === 'string' ? rec.id : ''
    if (!paramId || !Array.isArray(rec.points)) continue
    const points: AutomationPoint[] = []
    for (const p of rec.points) {
      if (!p || typeof p !== 'object') continue
      const pr = p as { t?: unknown; v?: unknown; time?: unknown; value?: unknown }
      const t = Number(pr.t ?? pr.time)
      const v = Number(pr.v ?? pr.value)
      if (!Number.isFinite(t) || !Number.isFinite(v)) continue
      points.push({ t: Math.max(0, t), v })
    }
    if (points.length === 0) continue
    lanes.push({ paramId, points: sortPoints(points) })
  }
  return lanes
}

export function serializeAutomation(lanes: AutomationLane[] | undefined): AutomationLane[] {
  return (lanes ?? []).map((lane) => ({
    paramId: lane.paramId,
    points: sortPoints(lane.points).map((p) => ({ t: p.t, v: p.v }))
  }))
}

export function setLanePoints(lanes: AutomationLane[], paramId: string, points: AutomationPoint[]): AutomationLane[] {
  const cleaned = sortPoints(points)
  const others = lanes.filter((lane) => lane.paramId !== paramId)
  if (cleaned.length === 0) return others
  return [...others, { paramId, points: cleaned }]
}
