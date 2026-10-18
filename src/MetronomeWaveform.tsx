import { memo, useEffect, useRef } from 'react'
import { clickTimesInRange, DEFAULT_BEATS_PER_BAR } from './metronomeTrack'
import {
  DEFAULT_METRONOME_METER,
  formatTimeSignature,
  normalizeMetronomeMeter,
  serializeMetronomeMeter,
  type MetronomeMeter
} from './metronomeMeter'
import { MAX_WAVEFORM_CANVAS_PX } from './timelineZoom'
import {
  WAVEFORM_TILE_CSS_PX,
  WAVEFORM_VIEW_PAD_PX,
  canvasDeviceSize,
  tileRanges,
  visibleHostRange
} from './waveform'

interface MetronomeWaveformProps {
  bpm: number
  beatsPerBar?: number
  meter?: MetronomeMeter
  duration: number
}

function drawMetronomeTicks(
  canvas: HTMLCanvasElement,
  bpm: number,
  beatsPerBar: number,
  timeStart: number,
  timeEnd: number,
  meter?: MetronomeMeter
): void {
  const width = canvas.width
  const height = canvas.height
  const ctx = canvas.getContext('2d', { alpha: false })
  if (!ctx || width < 1 || height < 1) return
  ctx.imageSmoothingEnabled = true
  const mid = height / 2
  ctx.fillStyle = '#1b2230'
  ctx.fillRect(0, 0, width, height)
  ctx.strokeStyle = 'rgba(255,255,255,0.06)'
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(0, mid)
  ctx.lineTo(width, mid)
  ctx.stroke()

  const span = timeEnd - timeStart
  if (!(span > 0)) return
  const clicks = clickTimesInRange({ bpm, beatsPerBar, meter, start: timeStart, end: timeEnd })
  let lastX = -8
  for (const click of clicks) {
    const x = ((click.songTime - timeStart) / span) * width
    if (x - lastX < 1) continue
    lastX = x
    const h = click.accent ? height * 0.86 : click.sub ? height * 0.28 : height * 0.48
    ctx.strokeStyle = click.accent
      ? 'rgba(245, 196, 92, 0.95)'
      : click.sub
        ? 'rgba(150, 176, 214, 0.38)'
        : 'rgba(150, 176, 214, 0.72)'
    ctx.lineWidth = click.accent ? 1.6 : click.sub ? 0.8 : 1
    ctx.beginPath()
    ctx.moveTo(x, mid - h / 2)
    ctx.lineTo(x, mid + h / 2)
    ctx.stroke()
  }
}

export const MetronomeWaveform = memo(function MetronomeWaveform({
  bpm,
  beatsPerBar = DEFAULT_BEATS_PER_BAR,
  meter,
  duration
}: MetronomeWaveformProps) {
  const hostRef = useRef<HTMLDivElement>(null)
  const tilesRef = useRef<HTMLCanvasElement[]>([])
  const drawnKeyRef = useRef('')
  const rafRef = useRef(0)

  useEffect(() => {
    const host = hostRef.current
    if (!host) return

    const paint = () => {
      const port = host.closest('.lanes-scroll-content') as HTMLElement | null
      const range = visibleHostRange(host, port, WAVEFORM_VIEW_PAD_PX)
      const cssH = Math.max(1, host.clientHeight || host.getBoundingClientRect().height || 1)
      const hostW = Math.max(1, host.clientWidth || host.getBoundingClientRect().width || 1)
      if (!range) {
        for (const tile of tilesRef.current) tile.style.display = 'none'
        return
      }
      const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1
      const tiles = tileRanges(range.cssLeft, range.cssWidth, WAVEFORM_TILE_CSS_PX)
      const meterKey = meter ? JSON.stringify(serializeMetronomeMeter(meter)) : String(beatsPerBar)
      const key = `${bpm}:${meterKey}:${duration}:${dpr}:${cssH}:${tiles
        .map((t) => `${t.cssLeft.toFixed(1)}:${t.cssWidth.toFixed(1)}`)
        .join('|')}`
      if (key === drawnKeyRef.current) return
      drawnKeyRef.current = key

      while (tilesRef.current.length < tiles.length) {
        const canvas = document.createElement('canvas')
        canvas.className = 'metronome-waveform'
        canvas.setAttribute('data-testid', 'metronome-waveform-tile')
        canvas.setAttribute('aria-hidden', 'true')
        host.appendChild(canvas)
        tilesRef.current.push(canvas)
      }
      for (let i = tiles.length; i < tilesRef.current.length; i++) {
        tilesRef.current[i].style.display = 'none'
      }

      tiles.forEach((tile, i) => {
        const canvas = tilesRef.current[i]
        canvas.style.display = 'block'
        canvas.style.left = `${tile.cssLeft}px`
        canvas.style.width = `${tile.cssWidth}px`
        canvas.style.height = `${cssH}px`
        const bitmap = canvasDeviceSize(tile.cssWidth, cssH, dpr, MAX_WAVEFORM_CANVAS_PX)
        if (canvas.width !== bitmap.width) canvas.width = bitmap.width
        if (canvas.height !== bitmap.height) canvas.height = bitmap.height
        const t0 = (tile.cssLeft / hostW) * duration
        const t1 = ((tile.cssLeft + tile.cssWidth) / hostW) * duration
        drawMetronomeTicks(canvas, bpm, beatsPerBar, t0, t1, meter)
      })
      host.dataset.waveformDpr = String(dpr)
    }

    const schedule = () => {
      if (rafRef.current) return
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = 0
        paint()
      })
    }

    paint()
    const port = host.closest('.lanes-scroll-content') as HTMLElement | null
    const ro = new ResizeObserver(schedule)
    ro.observe(host)
    if (port) {
      ro.observe(port)
      port.addEventListener('scroll', schedule, { passive: true })
    }
    window.addEventListener('resize', schedule)
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
      ro.disconnect()
      port?.removeEventListener('scroll', schedule)
      window.removeEventListener('resize', schedule)
      for (const canvas of tilesRef.current) canvas.remove()
      tilesRef.current = []
    }
  }, [bpm, beatsPerBar, duration, meter])

  return (
    <div
      ref={hostRef}
      className="metronome-waveform-host"
      data-testid="metronome-waveform"
      data-bpm={String(bpm)}
      data-beats-per-bar={String(beatsPerBar)}
      data-time-signature={formatTimeSignature(normalizeMetronomeMeter(meter ?? DEFAULT_METRONOME_METER))}
      data-duration={String(duration)}
    />
  )
})
