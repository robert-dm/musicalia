import { memo, useEffect, useRef } from 'react'
import { clickTimesInRange, DEFAULT_BEATS_PER_BAR } from './metronomeTrack'

interface MetronomeWaveformProps {
  bpm: number
  beatsPerBar?: number
  duration: number
}

function drawMetronomeTicks(
  canvas: HTMLCanvasElement,
  bpm: number,
  beatsPerBar: number,
  duration: number
): void {
  const width = Math.max(1, canvas.clientWidth || canvas.width || 1)
  const height = Math.max(1, canvas.clientHeight || canvas.height || 1)
  if (canvas.width !== width) canvas.width = width
  if (canvas.height !== height) canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  ctx.clearRect(0, 0, width, height)

  const mid = height / 2
  ctx.fillStyle = '#1b2230'
  ctx.fillRect(0, 0, width, height)
  ctx.strokeStyle = 'rgba(255,255,255,0.04)'
  ctx.beginPath()
  ctx.moveTo(0, mid)
  ctx.lineTo(width, mid)
  ctx.stroke()

  const end = duration > 0 ? duration : 0
  if (end <= 0 || width <= 0) return
  const clicks = clickTimesInRange({ bpm, beatsPerBar, start: 0, end })
  let lastX = -8
  for (const click of clicks) {
    const x = (click.songTime / end) * width
    if (x - lastX < 1) continue
    lastX = x
    const h = click.accent ? height * 0.86 : height * 0.48
    ctx.strokeStyle = click.accent ? 'rgba(245, 196, 92, 0.95)' : 'rgba(150, 176, 214, 0.72)'
    ctx.lineWidth = click.accent ? 1.6 : 1
    ctx.beginPath()
    ctx.moveTo(x, mid - h / 2)
    ctx.lineTo(x, mid + h / 2)
    ctx.stroke()
  }
}

export const MetronomeWaveform = memo(function MetronomeWaveform({
  bpm,
  beatsPerBar = DEFAULT_BEATS_PER_BAR,
  duration
}: MetronomeWaveformProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const redraw = () => drawMetronomeTicks(canvas, bpm, beatsPerBar, duration)
    redraw()
    const ro = new ResizeObserver(redraw)
    ro.observe(canvas)
    return () => ro.disconnect()
  }, [bpm, beatsPerBar, duration])

  return (
    <canvas
      ref={canvasRef}
      className="metronome-waveform"
      data-testid="metronome-waveform"
      data-bpm={String(bpm)}
      data-beats-per-bar={String(beatsPerBar)}
      data-duration={String(duration)}
      aria-hidden="true"
    />
  )
})
