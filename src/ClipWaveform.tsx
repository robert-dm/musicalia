import { memo, useEffect, useRef } from 'react'
import { isClipInteractLocked } from './clipDrag'
import { MAX_WAVEFORM_CANVAS_PX } from './timelineZoom'
import {
  WAVEFORM_TILE_CSS_PX,
  WAVEFORM_VIEW_PAD_PX,
  bestAvailableLod,
  canvasDeviceSize,
  clipTimelineCssWidth,
  drawWaveformRange,
  getOrComputeMips,
  pickWaveformLod,
  samplesPerDevicePixel,
  subscribeWaveformMips,
  tileRanges,
  visibleHostRange
} from './waveform'

interface ClipWaveformProps {
  buffer: AudioBuffer
  sourceStart: number
  duration: number
}

function findScrollPort(el: HTMLElement | null): HTMLElement | null {
  return (el?.closest('.lanes-scroll-content') as HTMLElement | null) || null
}

function findTimelineInner(el: HTMLElement | null): HTMLElement | null {
  return (el?.closest('[data-testid="lanes-scroll-inner"]') as HTMLElement | null)
    || (el?.closest('.lanes-scroll-inner') as HTMLElement | null)
}

function ClipWaveformInner({ buffer, sourceStart, duration }: ClipWaveformProps) {
  const hostRef = useRef<HTMLDivElement>(null)
  const tilesRef = useRef<HTMLCanvasElement[]>([])
  const drawnKeyRef = useRef('')
  const rafRef = useRef(0)

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    getOrComputeMips(buffer)

    const paint = () => {
      if (isClipInteractLocked()) return
      const port = findScrollPort(host)
      const inner = findTimelineInner(host)
      const range = visibleHostRange(host, port, WAVEFORM_VIEW_PAD_PX)
      const cssH = Math.max(1, host.clientHeight || host.getBoundingClientRect().height || 1)
      const layoutMax = Number(inner?.dataset.layoutMax || 0)
      const timelineW = inner?.clientWidth || 0
      const expectedW = clipTimelineCssWidth(duration, layoutMax, timelineW)
      const hostW = Math.max(
        1,
        expectedW > 1 ? expectedW : (host.clientWidth || host.getBoundingClientRect().width || 1)
      )
      if (!range) {
        for (const tile of tilesRef.current) tile.style.display = 'none'
        return
      }
      const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1
      const tiles = tileRanges(range.cssLeft, range.cssWidth, WAVEFORM_TILE_CSS_PX)
      const sampleCount = Math.max(1, Math.round(duration * buffer.sampleRate))
      const spp = samplesPerDevicePixel({ sampleCount, cssWidth: hostW, dpr })
      const lod = bestAvailableLod(getOrComputeMips(buffer), pickWaveformLod(spp))
      const zoomKey = inner?.dataset.horizontalZoom || ''
      const key = [
        buffer.length,
        buffer.sampleRate,
        sourceStart.toFixed(5),
        duration.toFixed(5),
        dpr.toFixed(3),
        lod,
        hostW.toFixed(1),
        zoomKey,
        tiles.map((t) => `${t.cssLeft.toFixed(1)}:${t.cssWidth.toFixed(1)}`).join('|'),
        cssH.toFixed(1)
      ].join('/')
      if (key === drawnKeyRef.current) return
      drawnKeyRef.current = key

      while (tilesRef.current.length < tiles.length) {
        const canvas = document.createElement('canvas')
        canvas.className = 'waveform-tile'
        canvas.setAttribute('data-waveform-tile', 'true')
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
        const t0 = sourceStart + (tile.cssLeft / hostW) * duration
        const t1 = sourceStart + ((tile.cssLeft + tile.cssWidth) / hostW) * duration
        const used = drawWaveformRange(canvas, buffer, t0, Math.max(1e-6, t1 - t0))
        canvas.dataset.lod = String(used)
        canvas.dataset.dpr = String(dpr)
      })
      host.dataset.waveformLod = String(lod)
      host.dataset.waveformTiles = String(tiles.length)
      host.dataset.waveformDpr = String(dpr)
      host.dataset.waveformHostW = hostW.toFixed(1)
    }

    const schedule = () => {
      if (rafRef.current) return
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = 0
        paint()
      })
    }

    paint()
    const port = findScrollPort(host)
    const inner = findTimelineInner(host)
    const observer = new ResizeObserver(() => {
      if (isClipInteractLocked()) return
      drawnKeyRef.current = ''
      schedule()
    })
    observer.observe(host)
    if (port) {
      observer.observe(port)
      port.addEventListener('scroll', schedule, { passive: true })
    }
    if (inner) observer.observe(inner)
    const zoomWatch = inner
      ? new MutationObserver(() => {
        if (isClipInteractLocked()) return
        drawnKeyRef.current = ''
        schedule()
      })
      : null
    zoomWatch?.observe(inner!, { attributes: true, attributeFilter: ['data-horizontal-zoom', 'data-layout-max'] })
    window.addEventListener('resize', schedule)
    const unlock = new MutationObserver(() => {
      if (!isClipInteractLocked()) {
        drawnKeyRef.current = ''
        schedule()
      }
    })
    unlock.observe(document.documentElement, { attributes: true, attributeFilter: ['data-clip-interact'] })
    const unsub = subscribeWaveformMips(buffer, () => {
      if (isClipInteractLocked()) return
      drawnKeyRef.current = ''
      schedule()
    })

    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
      observer.disconnect()
      zoomWatch?.disconnect()
      port?.removeEventListener('scroll', schedule)
      window.removeEventListener('resize', schedule)
      unlock.disconnect()
      unsub()
      for (const canvas of tilesRef.current) canvas.remove()
      tilesRef.current = []
    }
  }, [buffer, sourceStart, duration])

  return <div ref={hostRef} className="waveform-window" data-waveform-host="true" />
}

export const ClipWaveform = memo(ClipWaveformInner)
