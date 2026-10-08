import FFT from 'fft.js'

export type HarmonyMode = 'major' | 'minor'
export type ChordQuality = 'maj' | 'min'

export interface HarmonyChord {
  t: number
  end: number
  label: string
  tonic: number
  quality: ChordQuality
  confidence: number
}

export interface HarmonyResult {
  key: { tonic: number; mode: HarmonyMode; label: string }
  chords: HarmonyChord[]
  source: 'mix' | number
}

export interface HarmonyClip {
  buffer: { numberOfChannels: number; length: number; sampleRate: number; getChannelData: (ch: number) => Float32Array }
  offsetSeconds: number
  sourceStart: number
  duration: number
}

const NOTE_ES = ['Do', 'Do♯', 'Re', 'Re♯', 'Mi', 'Fa', 'Fa♯', 'Sol', 'Sol♯', 'La', 'La♯', 'Si']

const KS_MAJOR = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88]
const KS_MINOR = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17]

export function noteNameEs(pc: number): string {
  return NOTE_ES[(((pc % 12) + 12) % 12)]
}

export function keyLabelEs(tonic: number, mode: HarmonyMode): string {
  return mode === 'minor' ? `${noteNameEs(tonic)} menor` : `${noteNameEs(tonic)} mayor`
}

export function chordLabelEs(tonic: number, quality: ChordQuality): string {
  return quality === 'min' ? `${noteNameEs(tonic)} m` : noteNameEs(tonic)
}

export function rotate12(src: number[], shift: number): number[] {
  const out = new Array<number>(12)
  for (let i = 0; i < 12; i++) out[i] = src[(i - shift + 12) % 12]
  return out
}

export function cosine(a: number[], b: number[]): number {
  let dot = 0
  let na = 0
  let nb = 0
  const n = Math.min(a.length, b.length)
  for (let i = 0; i < n; i++) {
    dot += a[i] * b[i]
    na += a[i] * a[i]
    nb += b[i] * b[i]
  }
  if (na < 1e-12 || nb < 1e-12) return 0
  return dot / Math.sqrt(na * nb)
}

export function detectKey(chroma: number[]): { tonic: number; mode: HarmonyMode; label: string; score: number } {
  let best = { tonic: 0, mode: 'major' as HarmonyMode, label: keyLabelEs(0, 'major'), score: -1 }
  for (let tonic = 0; tonic < 12; tonic++) {
    for (const mode of ['major', 'minor'] as HarmonyMode[]) {
      const profile = rotate12(mode === 'major' ? KS_MAJOR : KS_MINOR, tonic)
      const score = cosine(chroma, profile)
      if (score > best.score) best = { tonic, mode, label: keyLabelEs(tonic, mode), score }
    }
  }
  return best
}

function triadTemplate(quality: ChordQuality): number[] {
  const t = new Array(12).fill(0)
  t[0] = 1
  t[quality === 'min' ? 3 : 4] = 1
  t[7] = 1
  return t
}

export function detectChord(chroma: number[]): { tonic: number; quality: ChordQuality; label: string; confidence: number } {
  let best = { tonic: 0, quality: 'maj' as ChordQuality, label: chordLabelEs(0, 'maj'), confidence: -1 }
  for (let tonic = 0; tonic < 12; tonic++) {
    for (const quality of ['maj', 'min'] as ChordQuality[]) {
      const score = cosine(chroma, rotate12(triadTemplate(quality), tonic))
      if (score > best.confidence) {
        best = { tonic, quality, label: chordLabelEs(tonic, quality), confidence: score }
      }
    }
  }
  return best
}

export function mixClipsMono(clips: HarmonyClip[], outRate = 11025): Float32Array {
  let end = 0
  for (const clip of clips) end = Math.max(end, clip.offsetSeconds + clip.duration)
  const length = Math.max(1, Math.ceil(end * outRate))
  const mix = new Float32Array(length)
  for (const clip of clips) {
    const sr = clip.buffer.sampleRate
    const ch0 = clip.buffer.getChannelData(0)
    const ch1 = clip.buffer.numberOfChannels > 1 ? clip.buffer.getChannelData(1) : ch0
    const startOut = Math.floor(clip.offsetSeconds * outRate)
    const nOut = Math.floor(clip.duration * outRate)
    const srcStart = Math.floor(clip.sourceStart * sr)
    for (let i = 0; i < nOut; i++) {
      const src = srcStart + Math.floor((i / outRate) * sr)
      if (src < 0 || src >= ch0.length) continue
      const o = startOut + i
      if (o < 0 || o >= length) continue
      mix[o] += (ch0[src] + ch1[src]) * 0.5
    }
  }
  return mix
}

function hann(i: number, n: number): number {
  return 0.5 * (1 - Math.cos((2 * Math.PI * i) / (n - 1)))
}

export function chromaFromSamples(samples: Float32Array, sampleRate: number, hop = 2048, size = 4096): { t: number; chroma: number[] }[] {
  const fft = new FFT(size)
  const frames: { t: number; chroma: number[] }[] = []
  const spec = fft.createComplexArray()
  const re = new Array(size).fill(0)
  for (let start = 0; start + size <= samples.length; start += hop) {
    for (let i = 0; i < size; i++) re[i] = samples[start + i] * hann(i, size)
    fft.realTransform(spec, re)
    const chroma = new Array(12).fill(0)
    const bins = size / 2
    for (let k = 1; k < bins; k++) {
      const reK = spec[2 * k] as number
      const imK = spec[2 * k + 1] as number
      const mag = reK * reK + imK * imK
      const freq = (k * sampleRate) / size
      if (freq < 55 || freq > 5000) continue
      const midi = 69 + 12 * Math.log2(freq / 440)
      const pc = ((Math.round(midi) % 12) + 12) % 12
      chroma[pc] += mag
    }
    const sum = chroma.reduce((a, b) => a + b, 0)
    if (sum > 1e-9) {
      for (let i = 0; i < 12; i++) chroma[i] /= sum
    }
    frames.push({ t: start / sampleRate, chroma })
  }
  return frames
}

export function segmentChords(
  frames: { t: number; chroma: number[] }[],
  hopSeconds: number,
  minConfidence = 0.55
): HarmonyChord[] {
  const raw: HarmonyChord[] = []
  for (const frame of frames) {
    const chord = detectChord(frame.chroma)
    if (chord.confidence < minConfidence) continue
    const last = raw[raw.length - 1]
    if (last && last.tonic === chord.tonic && last.quality === chord.quality) {
      last.end = frame.t + hopSeconds
      last.confidence = Math.max(last.confidence, chord.confidence)
    } else {
      raw.push({
        t: frame.t,
        end: frame.t + hopSeconds,
        label: chord.label,
        tonic: chord.tonic,
        quality: chord.quality,
        confidence: chord.confidence
      })
    }
  }
  return raw.filter((c) => c.end - c.t >= hopSeconds * 1.5)
}

export function analyzeHarmony(clips: HarmonyClip[], source: 'mix' | number = 'mix'): HarmonyResult | null {
  if (!clips.length) return null
  const sampleRate = 11025
  const mix = mixClipsMono(clips, sampleRate)
  const energy = mix.reduce((s, v) => s + v * v, 0)
  if (energy < 1e-8) return null
  const hop = 2048
  const frames = chromaFromSamples(mix, sampleRate, hop, 4096)
  if (!frames.length) return null
  const global = new Array(12).fill(0)
  for (const frame of frames) {
    for (let i = 0; i < 12; i++) global[i] += frame.chroma[i]
  }
  const key = detectKey(global)
  const chords = segmentChords(frames, hop / sampleRate)
  return { key: { tonic: key.tonic, mode: key.mode, label: key.label }, chords, source }
}

export function hydrateHarmony(raw: unknown): HarmonyResult | null {
  if (!raw || typeof raw !== 'object') return null
  const rec = raw as { key?: { tonic?: unknown; mode?: unknown; label?: unknown }; chords?: unknown; source?: unknown }
  const tonic = Number(rec.key?.tonic)
  const mode: HarmonyMode = rec.key?.mode === 'minor' ? 'minor' : 'major'
  if (!Number.isFinite(tonic)) return null
  const chords: HarmonyChord[] = []
  if (Array.isArray(rec.chords)) {
    for (const c of rec.chords) {
      if (!c || typeof c !== 'object') continue
      const cr = c as { t?: unknown; end?: unknown; label?: unknown; tonic?: unknown; quality?: unknown; confidence?: unknown }
      const t = Number(cr.t)
      const end = Number(cr.end)
      const ct = Number(cr.tonic)
      if (!Number.isFinite(t) || !Number.isFinite(end) || !Number.isFinite(ct)) continue
      const quality: ChordQuality = cr.quality === 'min' ? 'min' : 'maj'
      chords.push({
        t: Math.max(0, t),
        end: Math.max(t, end),
        label: typeof cr.label === 'string' ? cr.label : chordLabelEs(ct, quality),
        tonic: ((ct % 12) + 12) % 12,
        quality,
        confidence: Number(cr.confidence) || 0
      })
    }
  }
  const source = rec.source === 'mix' || typeof rec.source === 'number' ? rec.source : 'mix'
  return {
    key: { tonic: ((tonic % 12) + 12) % 12, mode, label: typeof rec.key?.label === 'string' ? rec.key.label : keyLabelEs(tonic, mode) },
    chords,
    source
  }
}

export function serializeHarmony(h: HarmonyResult | null): HarmonyResult | null {
  return h ? hydrateHarmony(h) : null
}
