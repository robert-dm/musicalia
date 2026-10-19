export const WAVEFORM_MIP_STEPS = [256, 1024, 4096] as const
export const WAVEFORM_TILE_CSS_PX = 1536
export const WAVEFORM_VIEW_PAD_PX = 64
export const WAVEFORM_SAMPLE_LOD = 'samples' as const
/** Device-pixel density at or below this draws the true sample polyline. */
export const WAVEFORM_SAMPLE_THRESHOLD = 2

export const WAVEFORM_PEAK_FILL = 'rgba(0, 170, 85, 0.78)'
export const WAVEFORM_RMS_FILL = 'rgba(94, 220, 150, 0.92)'
export const WAVEFORM_CENTER_LINE = 'rgba(10, 170, 85, 0.28)'
export const WAVEFORM_SAMPLE_STROKE = '#00aa55'
export const WAVEFORM_BG = '#1a1a1a'

const SYNC_SAMPLE_BUDGET = 1_800_000

export type WaveformLod = (typeof WAVEFORM_MIP_STEPS)[number] | typeof WAVEFORM_SAMPLE_LOD

export interface WaveformMip {
  samplesPerBucket: number
  data: Float32Array
}

export interface WaveformMips {
  sampleRate: number
  length: number
  mips: Map<number, Float32Array>
}

export interface VisibleHostRange {
  cssLeft: number
  cssWidth: number
}

export interface WaveformTileRange extends VisibleHostRange {}

type MipListener = () => void

const mipCache = new WeakMap<AudioBuffer, WaveformMips>()
const mipListeners = new WeakMap<AudioBuffer, Set<MipListener>>()
const peakCache = new WeakMap<AudioBuffer, Float32Array>()

function channelList(buffer: AudioBuffer): Float32Array[] {
  const channels: Float32Array[] = []
  for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
    channels.push(buffer.getChannelData(ch))
  }
  return channels
}

function computeMip(channels: Float32Array[], length: number, samplesPerBucket: number): Float32Array {
  const buckets = Math.max(1, Math.ceil(length / samplesPerBucket))
  const out = new Float32Array(buckets * 3)
  const channelCount = channels.length
  for (let i = 0; i < buckets; i++) {
    const start = i * samplesPerBucket
    const end = Math.min(start + samplesPerBucket, length)
    let min = 1
    let max = -1
    let sumSq = 0
    let n = 0
    for (let ch = 0; ch < channelCount; ch++) {
      const data = channels[ch]
      for (let j = start; j < end; j++) {
        const sample = data[j]
        if (sample < min) min = sample
        if (sample > max) max = sample
        sumSq += sample * sample
        n++
      }
    }
    out[i * 3] = min
    out[i * 3 + 1] = max
    out[i * 3 + 2] = n > 0 ? Math.sqrt(sumSq / n) : 0
  }
  return out
}

function downsampleMip(src: Float32Array, fromStep: number, toStep: number): Float32Array {
  const factor = Math.max(1, Math.round(toStep / fromStep))
  const srcBuckets = src.length / 3
  const buckets = Math.max(1, Math.ceil(srcBuckets / factor))
  const out = new Float32Array(buckets * 3)
  for (let i = 0; i < buckets; i++) {
    const start = i * factor
    const end = Math.min(start + factor, srcBuckets)
    let min = 1
    let max = -1
    let rmsMax = 0
    for (let b = start; b < end; b++) {
      const minB = src[b * 3]
      const maxB = src[b * 3 + 1]
      const rmsB = src[b * 3 + 2]
      if (minB < min) min = minB
      if (maxB > max) max = maxB
      if (rmsB > rmsMax) rmsMax = rmsB
    }
    out[i * 3] = min
    out[i * 3 + 1] = max
    out[i * 3 + 2] = rmsMax
  }
  return out
}

function notifyMips(buffer: AudioBuffer): void {
  const listeners = mipListeners.get(buffer)
  if (!listeners) return
  listeners.forEach((fn) => {
    try {
      fn()
    } catch {
      /* ignore */
    }
  })
}

function fillMips(buffer: AudioBuffer, cached: WaveformMips, finest: boolean): void {
  const channels = channelList(buffer)
  if (finest) {
    const base = computeMip(channels, cached.length, WAVEFORM_MIP_STEPS[0])
    cached.mips.set(WAVEFORM_MIP_STEPS[0], base)
    for (let i = 1; i < WAVEFORM_MIP_STEPS.length; i++) {
      const step = WAVEFORM_MIP_STEPS[i]
      cached.mips.set(step, downsampleMip(base, WAVEFORM_MIP_STEPS[0], step))
    }
    return
  }
  const coarse = WAVEFORM_MIP_STEPS[WAVEFORM_MIP_STEPS.length - 1]
  cached.mips.set(coarse, computeMip(channels, cached.length, coarse))
}

function scheduleFineMips(buffer: AudioBuffer, cached: WaveformMips): void {
  const run = () => {
    if (cached.mips.has(WAVEFORM_MIP_STEPS[0])) return
    fillMips(buffer, cached, true)
    notifyMips(buffer)
  }
  if (typeof requestIdleCallback === 'function') {
    requestIdleCallback(() => run(), { timeout: 1200 })
    return
  }
  setTimeout(run, 0)
}

export function getOrComputeMips(buffer: AudioBuffer): WaveformMips {
  const hit = mipCache.get(buffer)
  if (hit) return hit
  const cached: WaveformMips = {
    sampleRate: buffer.sampleRate,
    length: buffer.length,
    mips: new Map()
  }
  mipCache.set(buffer, cached)
  const samples = buffer.length * Math.max(1, buffer.numberOfChannels)
  fillMips(buffer, cached, samples <= SYNC_SAMPLE_BUDGET)
  if (!cached.mips.has(WAVEFORM_MIP_STEPS[0])) {
    scheduleFineMips(buffer, cached)
  }
  return cached
}

export function subscribeWaveformMips(buffer: AudioBuffer, onReady: MipListener): () => void {
  let set = mipListeners.get(buffer)
  if (!set) {
    set = new Set()
    mipListeners.set(buffer, set)
  }
  set.add(onReady)
  return () => {
    set?.delete(onReady)
  }
}

export function pickWaveformLod(samplesPerDevicePixel: number): WaveformLod {
  if (!Number.isFinite(samplesPerDevicePixel) || samplesPerDevicePixel <= WAVEFORM_SAMPLE_THRESHOLD) {
    return WAVEFORM_SAMPLE_LOD
  }
  let chosen: (typeof WAVEFORM_MIP_STEPS)[number] = WAVEFORM_MIP_STEPS[0]
  for (const step of WAVEFORM_MIP_STEPS) {
    if (step <= samplesPerDevicePixel) chosen = step
  }
  return chosen
}

export function bestAvailableLod(mips: WaveformMips, wanted: WaveformLod): WaveformLod {
  if (wanted === WAVEFORM_SAMPLE_LOD) return WAVEFORM_SAMPLE_LOD
  if (mips.mips.has(wanted)) return wanted
  for (const step of WAVEFORM_MIP_STEPS) {
    if (step <= wanted && mips.mips.has(step)) return step
  }
  for (let i = WAVEFORM_MIP_STEPS.length - 1; i >= 0; i--) {
    const step = WAVEFORM_MIP_STEPS[i]
    if (mips.mips.has(step)) return step
  }
  return WAVEFORM_SAMPLE_LOD
}

export function samplesPerDevicePixel(input: {
  sampleCount: number
  cssWidth: number
  dpr: number
}): number {
  const devicePx = Math.max(1, input.cssWidth * Math.max(1, input.dpr))
  return Math.max(0, input.sampleCount) / devicePx
}

/** CSS width of a clip on the timeline. Zoom changes `timelineWidthPx`. */
export function clipTimelineCssWidth(
  duration: number,
  layoutMax: number,
  timelineWidthPx: number
): number {
  if (!(duration > 0) || !(layoutMax > 0) || !(timelineWidthPx > 0)) return 0
  return (duration / layoutMax) * timelineWidthPx
}

export function visibleHostRange(
  host: { getBoundingClientRect(): { left: number; right: number; width: number; height: number } },
  viewport: { getBoundingClientRect(): { left: number; right: number } } | null,
  padPx = WAVEFORM_VIEW_PAD_PX
): VisibleHostRange | null {
  const hr = host.getBoundingClientRect()
  if (!(hr.width > 0) || !(hr.height > 0)) return null
  const viewLeft = (viewport ? viewport.getBoundingClientRect().left : 0) - padPx
  const viewRight = (viewport ? viewport.getBoundingClientRect().right : hr.width) + padPx
  const left = Math.max(0, viewLeft - hr.left)
  const right = Math.min(hr.width, viewRight - hr.left)
  const width = right - left
  if (!(width > 0.5)) return null
  return { cssLeft: left, cssWidth: width }
}

export function tileRanges(
  cssLeft: number,
  cssWidth: number,
  tileCssPx = WAVEFORM_TILE_CSS_PX
): WaveformTileRange[] {
  const tile = Math.max(64, tileCssPx)
  const end = cssLeft + cssWidth
  const start = Math.floor(cssLeft / tile) * tile
  const out: WaveformTileRange[] = []
  for (let x = start; x < end - 1e-6; x += tile) {
    const left = Math.max(cssLeft, x)
    const right = Math.min(end, x + tile)
    if (right - left > 0.5) out.push({ cssLeft: left, cssWidth: right - left })
  }
  return out.length ? out : [{ cssLeft, cssWidth: Math.max(1, cssWidth) }]
}

export function columnsFromMip(
  data: Float32Array,
  startSample: number,
  endSample: number,
  samplesPerBucket: number,
  columns: number
): { mins: Float32Array; maxs: Float32Array; rms: Float32Array } {
  const cols = Math.max(1, columns | 0)
  const mins = new Float32Array(cols)
  const maxs = new Float32Array(cols)
  const rms = new Float32Array(cols)
  const buckets = Math.max(1, (data.length / 3) | 0)
  const sampleCount = Math.max(1, endSample - startSample)
  const step = Math.max(1e-6, samplesPerBucket)

  for (let i = 0; i < cols; i++) {
    const sampleA = startSample + (i / cols) * sampleCount
    const sampleB = startSample + ((i + 1) / cols) * sampleCount
    const bucketA = sampleA / step
    const bucketB = sampleB / step
    const span = bucketB - bucketA
    if (span <= 1.25) {
      const mid = (bucketA + bucketB) * 0.5
      const b0 = Math.max(0, Math.min(buckets - 1, Math.floor(mid)))
      const b1 = Math.max(0, Math.min(buckets - 1, b0 + 1))
      const t = Math.max(0, Math.min(1, mid - b0))
      mins[i] = data[b0 * 3] * (1 - t) + data[b1 * 3] * t
      maxs[i] = data[b0 * 3 + 1] * (1 - t) + data[b1 * 3 + 1] * t
      rms[i] = data[b0 * 3 + 2] * (1 - t) + data[b1 * 3 + 2] * t
      continue
    }
    const first = Math.max(0, Math.floor(bucketA))
    const last = Math.min(buckets - 1, Math.ceil(bucketB) - 1)
    let min = 1
    let max = -1
    let rmsMax = 0
    for (let b = first; b <= last; b++) {
      const minB = data[b * 3]
      const maxB = data[b * 3 + 1]
      const rmsB = data[b * 3 + 2]
      if (minB < min) min = minB
      if (maxB > max) max = maxB
      if (rmsB > rmsMax) rmsMax = rmsB
    }
    mins[i] = min
    maxs[i] = max
    rms[i] = rmsMax
  }
  return { mins, maxs, rms }
}

export function waveformVerticalLayout(height: number): { centerY: number; amp: number } {
  const h = Math.max(1, Number.isFinite(height) ? height : 1)
  const pad = Math.max(0, Math.min(h * 0.06, (h - 1) / 2))
  return {
    centerY: h / 2,
    amp: Math.max(0.5, (h - pad * 2) / 2)
  }
}

function fillEnvelope(
  ctx: CanvasRenderingContext2D,
  mins: ArrayLike<number>,
  maxs: ArrayLike<number>,
  columns: number,
  width: number,
  centerY: number,
  amp: number,
  fill: string
): void {
  if (columns < 1) return
  ctx.beginPath()
  for (let i = 0; i < columns; i++) {
    const x = ((i + 0.5) / columns) * width
    const y = centerY - maxs[i] * amp
    if (i === 0) ctx.moveTo(x, y)
    else ctx.lineTo(x, y)
  }
  for (let i = columns - 1; i >= 0; i--) {
    const x = ((i + 0.5) / columns) * width
    const y = centerY - mins[i] * amp
    ctx.lineTo(x, y)
  }
  ctx.closePath()
  ctx.fillStyle = fill
  ctx.fill()
}

function drawCenterLine(ctx: CanvasRenderingContext2D, width: number, centerY: number): void {
  ctx.strokeStyle = WAVEFORM_CENTER_LINE
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(0, centerY)
  ctx.lineTo(width, centerY)
  ctx.stroke()
}

function drawSampleLine(
  ctx: CanvasRenderingContext2D,
  buffer: AudioBuffer,
  startSample: number,
  endSample: number,
  width: number,
  centerY: number,
  amp: number
): void {
  const count = Math.max(1, endSample - startSample)
  const channels = buffer.numberOfChannels
  const maxPoints = Math.max(width * 3, 64)
  const step = Math.max(1, Math.floor(count / maxPoints))
  ctx.strokeStyle = WAVEFORM_SAMPLE_STROKE
  ctx.lineWidth = 1.25
  ctx.lineJoin = 'round'
  ctx.lineCap = 'round'
  ctx.beginPath()
  let moved = false
  for (let i = startSample; i < endSample; i += step) {
    let sample = 0
    for (let ch = 0; ch < channels; ch++) {
      sample += buffer.getChannelData(ch)[i] || 0
    }
    sample /= Math.max(1, channels)
    const x = ((i - startSample + 0.5) / count) * width
    const y = centerY - sample * amp
    if (!moved) {
      ctx.moveTo(x, y)
      moved = true
    } else {
      ctx.lineTo(x, y)
    }
  }
  ctx.stroke()
}

export function drawWaveformRange(
  canvas: HTMLCanvasElement,
  buffer: AudioBuffer,
  sourceStart = 0,
  duration?: number
): WaveformLod {
  const ctx = canvas.getContext('2d', { alpha: false })
  if (!ctx) return WAVEFORM_MIP_STEPS[WAVEFORM_MIP_STEPS.length - 1]
  const width = canvas.width
  const height = canvas.height
  ctx.imageSmoothingEnabled = true
  ctx.fillStyle = WAVEFORM_BG
  ctx.fillRect(0, 0, width, height)

  const clipDuration = duration ?? buffer.duration
  const startSample = Math.max(0, Math.floor(sourceStart * buffer.sampleRate))
  const endSample = Math.min(
    buffer.length,
    Math.ceil((sourceStart + clipDuration) * buffer.sampleRate)
  )
  const sampleCount = Math.max(1, endSample - startSample)
  const { centerY, amp } = waveformVerticalLayout(height)
  drawCenterLine(ctx, width, centerY)

  const spp = samplesPerDevicePixel({ sampleCount, cssWidth: width, dpr: 1 })
  const mips = getOrComputeMips(buffer)
  const wanted = pickWaveformLod(spp)
  const lod = bestAvailableLod(mips, wanted)

  if (lod === WAVEFORM_SAMPLE_LOD) {
    drawSampleLine(ctx, buffer, startSample, endSample, width, centerY, amp)
    return lod
  }

  const mip = mips.mips.get(lod)
  if (!mip) {
    drawSampleLine(ctx, buffer, startSample, endSample, width, centerY, amp)
    return WAVEFORM_SAMPLE_LOD
  }
  const cols = columnsFromMip(mip, startSample, endSample, lod, width)
  fillEnvelope(ctx, cols.mins, cols.maxs, width, width, centerY, amp, WAVEFORM_PEAK_FILL)
  const rmsLo = new Float32Array(width)
  const rmsHi = new Float32Array(width)
  for (let i = 0; i < width; i++) {
    const mag = Math.max(0, cols.rms[i])
    rmsLo[i] = -mag
    rmsHi[i] = mag
  }
  fillEnvelope(ctx, rmsLo, rmsHi, width, width, centerY, amp, WAVEFORM_RMS_FILL)
  return lod
}

/** @deprecated single 4096-bucket cache; prefer getOrComputeMips */
export function getOrComputePeaks(buffer: AudioBuffer, peaksPerPixel = 4096): Float32Array {
  const cached = peakCache.get(buffer)
  if (cached) return cached
  const mips = getOrComputeMips(buffer)
  const step = WAVEFORM_MIP_STEPS.includes(peaksPerPixel as (typeof WAVEFORM_MIP_STEPS)[number])
    ? (peaksPerPixel as (typeof WAVEFORM_MIP_STEPS)[number])
    : 4096
  const mip = mips.mips.get(step) || mips.mips.get(4096)
  if (mip) {
    const buckets = mip.length / 3
    const peaks = new Float32Array(buckets * 2)
    for (let i = 0; i < buckets; i++) {
      peaks[i * 2] = mip[i * 3]
      peaks[i * 2 + 1] = mip[i * 3 + 1]
    }
    peakCache.set(buffer, peaks)
    return peaks
  }
  const fallback = new Float32Array(2)
  fallback[0] = -1
  fallback[1] = 1
  return fallback
}

export function drawWaveform(
  canvas: HTMLCanvasElement,
  buffer: AudioBuffer,
  sourceStart = 0,
  duration?: number
): void {
  drawWaveformRange(canvas, buffer, sourceStart, duration)
}

export function drawPeakEnvelope(
  canvas: HTMLCanvasElement,
  peaks: ArrayLike<number>,
  color = '#ff6b6b',
  rmsScale = 0.55
): void {
  const ctx = canvas.getContext('2d', { alpha: false })
  const width = canvas.width
  const height = canvas.height
  if (!ctx || width < 2 || height < 2 || peaks.length === 0) return
  ctx.imageSmoothingEnabled = true
  ctx.fillStyle = WAVEFORM_BG
  ctx.fillRect(0, 0, width, height)
  const { centerY, amp } = waveformVerticalLayout(height)
  drawCenterLine(ctx, width, centerY)

  const columns = width
  const mins = new Float32Array(columns)
  const maxs = new Float32Array(columns)
  const rmsLo = new Float32Array(columns)
  const rmsHi = new Float32Array(columns)
  const step = peaks.length / columns
  for (let x = 0; x < columns; x++) {
    const start = Math.floor(x * step)
    const end = Math.max(start + 1, Math.floor((x + 1) * step))
    let peak = 0
    for (let i = start; i < end && i < peaks.length; i++) {
      const value = Math.abs(peaks[i] || 0)
      if (value > peak) peak = value
    }
    maxs[x] = peak
    mins[x] = -peak
    rmsHi[x] = peak * rmsScale
    rmsLo[x] = -peak * rmsScale
  }
  const peakFill = color === '#ff6b6b' ? 'rgba(255, 107, 107, 0.78)' : color
  const rmsFill = color === '#ff6b6b' ? 'rgba(255, 170, 170, 0.92)' : WAVEFORM_RMS_FILL
  fillEnvelope(ctx, mins, maxs, columns, width, centerY, amp, peakFill)
  fillEnvelope(ctx, rmsLo, rmsHi, columns, width, centerY, amp, rmsFill)
}

export function canvasDeviceSize(cssWidth: number, cssHeight: number, dpr: number, maxPx = 8192): {
  width: number
  height: number
} {
  const scale = Math.max(1, dpr)
  return {
    width: Math.max(1, Math.min(maxPx, Math.round(cssWidth * scale))),
    height: Math.max(1, Math.min(maxPx, Math.round(cssHeight * scale)))
  }
}
