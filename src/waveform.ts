const peakCache = new Map<AudioBuffer, Float32Array>()

export function getOrComputePeaks(buffer: AudioBuffer, peaksPerPixel = 4096): Float32Array {
  const cached = peakCache.get(buffer)
  if (cached) return cached

  const channelCount = buffer.numberOfChannels
  const dataLength = buffer.length
  const peakCount = Math.ceil(dataLength / peaksPerPixel)
  const peaks = new Float32Array(peakCount * 2)

  for (let i = 0; i < peakCount; i++) {
    const start = i * peaksPerPixel
    const end = Math.min(start + peaksPerPixel, dataLength)
    let min = 1.0
    let max = -1.0

    for (let ch = 0; ch < channelCount; ch++) {
      const data = buffer.getChannelData(ch)
      for (let j = start; j < end; j++) {
        const sample = data[j]
        if (sample < min) min = sample
        if (sample > max) max = sample
      }
    }

    peaks[i * 2] = min
    peaks[i * 2 + 1] = max
  }

  peakCache.set(buffer, peaks)
  return peaks
}

export function drawWaveform(
  canvas: HTMLCanvasElement,
  buffer: AudioBuffer,
  sourceStart = 0,
  duration?: number
) {
  const ctx = canvas.getContext('2d')
  if (!ctx) return

  const width = canvas.width
  const height = canvas.height
  const clipDuration = duration ?? buffer.duration
  const peaksPerPixel = 4096
  const peaks = getOrComputePeaks(buffer, peaksPerPixel)

  const startSample = Math.floor(sourceStart * buffer.sampleRate)
  const endSample = Math.floor((sourceStart + clipDuration) * buffer.sampleRate)
  const sampleCount = Math.max(1, endSample - startSample)

  const topPadding = 48
  const bottomPadding = 16
  const waveformHeight = height - topPadding - bottomPadding
  const amp = waveformHeight / 2
  const centerY = topPadding + waveformHeight / 2

  ctx.fillStyle = '#1a1a1a'
  ctx.fillRect(0, 0, width, height)

  ctx.strokeStyle = '#0a5'
  ctx.lineWidth = 1.5
  ctx.beginPath()

  for (let i = 0; i < width; i++) {
    const sampleStart = startSample + Math.floor((i / width) * sampleCount)
    const sampleEnd = startSample + Math.floor(((i + 1) / width) * sampleCount)

    let min = 1.0
    let max = -1.0

    const peakStart = Math.floor(sampleStart / peaksPerPixel)
    const peakEnd = Math.ceil(sampleEnd / peaksPerPixel)

    for (let p = peakStart; p < peakEnd && p < peaks.length / 2; p++) {
      const peakMin = peaks[p * 2]
      const peakMax = peaks[p * 2 + 1]
      if (peakMin < min) min = peakMin
      if (peakMax > max) max = peakMax
    }

    const yMin = centerY + min * amp
    const yMax = centerY + max * amp

    if (i === 0) {
      ctx.moveTo(i, yMin)
    }

    ctx.lineTo(i, yMin)
    ctx.lineTo(i, yMax)
  }

  ctx.stroke()
}
