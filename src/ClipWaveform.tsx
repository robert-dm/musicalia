import { memo, useEffect, useRef } from 'react'
import { isClipInteractLocked } from './clipDrag'
import { waveformCropStyle } from './clipTrim'
import { MAX_WAVEFORM_CANVAS_PX, waveformBitmapWidth } from './timelineZoom'
import { drawWaveform } from './waveform'

interface ClipWaveformProps {
  buffer: AudioBuffer
  sourceStart: number
  duration: number
}

function ClipWaveformInner({ buffer, sourceStart, duration }: ClipWaveformProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const drawnKeyRef = useRef('')
  const crop = waveformCropStyle(sourceStart, duration, buffer.duration)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const paint = () => {
      if (isClipInteractLocked()) return
      const host = canvas.parentElement
      const cssW = Math.max(1, canvas.offsetWidth || host?.clientWidth || 1)
      const cssH = Math.max(1, host?.clientHeight || canvas.offsetHeight || 1)
      const visibleCap = typeof window !== 'undefined' ? window.innerWidth * 3 : cssW
      const w = waveformBitmapWidth(Math.min(cssW, visibleCap), Math.min(2, window.devicePixelRatio || 2))
      const h = Math.max(1, Math.min(MAX_WAVEFORM_CANVAS_PX, Math.floor(cssH * 2)))
      const key = `${buffer.length}:${buffer.sampleRate}:${w}:${h}`
      if (key === drawnKeyRef.current && canvas.width === w && canvas.height === h) return
      drawnKeyRef.current = key
      if (canvas.width !== w) canvas.width = w
      if (canvas.height !== h) canvas.height = h
      drawWaveform(canvas, buffer, 0, buffer.duration)
    }

    paint()
    const observer = new ResizeObserver(() => {
      if (isClipInteractLocked()) return
      paint()
    })
    observer.observe(canvas)
    const host = canvas.parentElement
    if (host) observer.observe(host)
    return () => observer.disconnect()
  }, [buffer])

  return (
    <div className="waveform-window">
      <canvas
        ref={canvasRef}
        className="waveform-full"
        data-waveform-full="true"
        style={{
          width: `${crop.widthPct}%`,
          height: '100%',
          transform: `translateX(${crop.translatePct}%)`
        }}
      />
    </div>
  )
}

export const ClipWaveform = memo(ClipWaveformInner)
