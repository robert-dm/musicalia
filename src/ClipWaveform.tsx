import { memo, useEffect, useRef } from 'react'
import { drawWaveform } from './waveform'

interface ClipWaveformProps {
  buffer: AudioBuffer
  sourceStart: number
  duration: number
}

function ClipWaveformInner({ buffer, sourceStart, duration }: ClipWaveformProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const drawnKeyRef = useRef('')

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const paint = () => {
      const w = Math.max(1, Math.floor(canvas.offsetWidth * 2))
      const h = Math.max(1, Math.floor(canvas.offsetHeight * 2))
      const key = `${buffer.length}:${buffer.sampleRate}:${sourceStart}:${duration}:${w}:${h}`
      if (key === drawnKeyRef.current && canvas.width === w && canvas.height === h) return
      drawnKeyRef.current = key
      if (canvas.width !== w) canvas.width = w
      if (canvas.height !== h) canvas.height = h
      drawWaveform(canvas, buffer, sourceStart, duration)
    }

    paint()
    const observer = new ResizeObserver(paint)
    observer.observe(canvas)
    return () => observer.disconnect()
  }, [buffer, sourceStart, duration])

  return <canvas className="waveform-canvas" ref={canvasRef} />
}

export const ClipWaveform = memo(ClipWaveformInner)
