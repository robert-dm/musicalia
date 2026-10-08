import { memo, useEffect, useRef } from 'react'
import { drawWaveform } from './waveform'
import { waveformCropStyle } from './clipTrim'

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
      const w = Math.max(1, Math.floor(canvas.offsetWidth * 2))
      const h = Math.max(1, Math.floor(canvas.offsetHeight * 2))
      const key = `${buffer.length}:${buffer.sampleRate}:${w}:${h}`
      if (key === drawnKeyRef.current && canvas.width === w && canvas.height === h) return
      drawnKeyRef.current = key
      if (canvas.width !== w) canvas.width = w
      if (canvas.height !== h) canvas.height = h
      drawWaveform(canvas, buffer, 0, buffer.duration)
    }

    paint()
    const observer = new ResizeObserver(paint)
    observer.observe(canvas)
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
