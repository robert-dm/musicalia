export const MIC_DEVICE_STORAGE_KEY = 'musicalia-audio-input'
export const GRABACION_NAME_RE = /^(?:grabaci[oó]n)\s+(\d+)$/i

export const MUSIC_MIC_CONSTRAINTS: MediaTrackConstraints = {
  echoCancellation: false,
  noiseSuppression: false,
  autoGainControl: false
}

export function readStoredMicDeviceId(): string | null {
  try {
    if (typeof localStorage === 'undefined') return null
    const value = localStorage.getItem(MIC_DEVICE_STORAGE_KEY)
    return value && value.length > 0 ? value : null
  } catch {
    return null
  }
}

export function persistMicDeviceId(deviceId: string): void {
  try {
    if (typeof localStorage === 'undefined') return
    localStorage.setItem(MIC_DEVICE_STORAGE_KEY, deviceId)
  } catch {
    // private mode
  }
}

export function nextGrabacionNumber(
  names: Array<string | undefined | null>,
  _trackCount: number
): number {
  let max = 0
  for (const name of names) {
    if (typeof name !== 'string') continue
    const match = name.trim().match(GRABACION_NAME_RE)
    if (!match) continue
    const n = parseInt(match[1], 10)
    if (Number.isFinite(n)) max = Math.max(max, n)
  }
  return Math.max(max, 0) + 1
}

export function nextGrabacionName(
  names: Array<string | undefined | null>,
  trackCount: number
): string {
  return `Grabación ${nextGrabacionNumber(names, trackCount)}`
}

export function resolveRecordTrack(
  armedIndex: number | null,
  selectedIndex: number | null,
  trackCount: number
): { trackIndex: number; createNew: boolean } {
  if (armedIndex != null && armedIndex >= 0 && armedIndex < trackCount) {
    return { trackIndex: armedIndex, createNew: false }
  }
  if (selectedIndex != null && selectedIndex >= 0 && selectedIndex < trackCount) {
    return { trackIndex: selectedIndex, createNew: false }
  }
  return { trackIndex: Math.max(0, trackCount), createNew: true }
}

export function armedIndexAfterDelete(armed: number | null, deleted: number): number | null {
  if (armed == null) return null
  if (armed === deleted) return null
  if (armed > deleted) return armed - 1
  return armed
}

export function recordLatencySeconds(ctx: {
  baseLatency?: number
  outputLatency?: number
}): number {
  const base = typeof ctx.baseLatency === 'number' && Number.isFinite(ctx.baseLatency) ? ctx.baseLatency : 0
  const output = typeof ctx.outputLatency === 'number' && Number.isFinite(ctx.outputLatency) ? ctx.outputLatency : 0
  return Math.max(0, base + output)
}

export function compensatedRecordOffset(startOffset: number, latencySeconds: number): number {
  return Math.max(0, startOffset - latencySeconds)
}

export function micErrorMessage(err: unknown): string {
  const name = err && typeof err === 'object' && 'name' in err ? String((err as { name: string }).name) : ''
  if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
    return 'Permiso de micrófono denegado'
  }
  if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
    return 'No se encontró un micrófono'
  }
  if (name === 'NotReadableError') {
    return 'El micrófono está ocupado o no se puede usar'
  }
  return 'No se pudo acceder al micrófono'
}

export function micConstraints(deviceId?: string | null): MediaStreamConstraints {
  const audio: MediaTrackConstraints = { ...MUSIC_MIC_CONSTRAINTS }
  if (deviceId) audio.deviceId = { exact: deviceId }
  return { audio }
}

export async function requestMicStream(deviceId?: string | null): Promise<MediaStream> {
  if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
    const err = new Error('No se pudo acceder al micrófono')
    err.name = 'NotFoundError'
    throw err
  }
  try {
    return await navigator.mediaDevices.getUserMedia(micConstraints(deviceId))
  } catch (err) {
    if (deviceId) return navigator.mediaDevices.getUserMedia(micConstraints(null))
    throw err
  }
}

export async function listAudioInputDevices(): Promise<MediaDeviceInfo[]> {
  if (typeof navigator === 'undefined' || !navigator.mediaDevices?.enumerateDevices) return []
  const devices = await navigator.mediaDevices.enumerateDevices()
  return devices.filter((d) => d.kind === 'audioinput')
}

export function pcmChunksToAudioBuffer(
  ctx: { sampleRate: number; createBuffer: (channels: number, length: number, sampleRate: number) => AudioBuffer },
  chunks: Float32Array[][],
  sampleRate?: number
): AudioBuffer {
  const sr = sampleRate ?? ctx.sampleRate
  if (!chunks.length || !chunks[0]?.length) {
    return ctx.createBuffer(1, 1, sr)
  }
  const channels = chunks[0].length
  let length = 0
  for (const chunk of chunks) length += chunk[0]?.length ?? 0
  if (length <= 0) return ctx.createBuffer(Math.max(1, channels), 1, sr)
  const buffer = ctx.createBuffer(channels, length, sr)
  for (let ch = 0; ch < channels; ch++) {
    const dest = buffer.getChannelData(ch)
    let offset = 0
    for (const chunk of chunks) {
      const src = chunk[ch] ?? chunk[0]
      if (!src) continue
      dest.set(src, offset)
      offset += src.length
    }
  }
  return buffer
}

export interface PcmCapture {
  peaks: number[]
  stop: () => { chunks: Float32Array[][]; sampleRate: number; peaks: number[] }
}

export function nativeAudioContext(ctx: unknown): AudioContext {
  if (!ctx || typeof ctx !== 'object') {
    throw new Error('No se pudo iniciar la captura de audio')
  }
  const rec = ctx as {
    createScriptProcessor?: AudioContext['createScriptProcessor']
    createMediaStreamSource?: AudioContext['createMediaStreamSource']
    _nativeContext?: AudioContext
    rawContext?: unknown
  }
  if (typeof rec.createScriptProcessor === 'function' && typeof rec.createMediaStreamSource === 'function') {
    return rec as AudioContext
  }
  if (rec._nativeContext) return nativeAudioContext(rec._nativeContext)
  if (rec.rawContext) return nativeAudioContext(rec.rawContext)
  throw new Error('No se pudo iniciar la captura de audio')
}

export function startPcmCapture(ctx: AudioContext, stream: MediaStream): PcmCapture {
  const native = nativeAudioContext(ctx)
  const source = native.createMediaStreamSource(stream)
  const channelCount = Math.max(1, source.channelCount || 1)
  const processor = native.createScriptProcessor(4096, channelCount, 1)
  const mute = native.createGain()
  mute.gain.value = 0
  const chunks: Float32Array[][] = []
  const peaks: number[] = []

  processor.onaudioprocess = (event) => {
    const input = event.inputBuffer
    const frame: Float32Array[] = []
    let peak = 0
    for (let ch = 0; ch < input.numberOfChannels; ch++) {
      const data = input.getChannelData(ch)
      const copy = new Float32Array(data.length)
      copy.set(data)
      frame.push(copy)
      for (let i = 0; i < data.length; i++) {
        const a = Math.abs(data[i])
        if (a > peak) peak = a
      }
    }
    if (frame.length) {
      chunks.push(frame)
      peaks.push(peak)
    }
  }

  source.connect(processor)
  processor.connect(mute)
  mute.connect(native.destination)

  return {
    peaks,
    stop() {
      try { processor.disconnect() } catch { /* already disconnected */ }
      try { source.disconnect() } catch { /* already disconnected */ }
      try { mute.disconnect() } catch { /* already disconnected */ }
      return { chunks, sampleRate: native.sampleRate, peaks }
    }
  }
}

export function drawRecordingPeaks(
  canvas: HTMLCanvasElement,
  peaks: number[],
  color = '#ff6b6b'
): void {
  const width = canvas.width
  const height = canvas.height
  const ctx = canvas.getContext('2d')
  if (!ctx || width < 2 || height < 2 || peaks.length === 0) return
  ctx.clearRect(0, 0, width, height)
  ctx.fillStyle = color
  const mid = height / 2
  const step = Math.max(1, Math.floor(peaks.length / width))
  for (let x = 0; x < width; x++) {
    let peak = 0
    const start = x * step
    for (let i = start; i < start + step && i < peaks.length; i++) {
      peak = Math.max(peak, peaks[i] || 0)
    }
    const h = Math.max(1, peak * mid)
    ctx.fillRect(x, mid - h, 1, h * 2)
  }
}
