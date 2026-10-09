import { STARTER_PAD_NAMES } from './drumKit'

type RenderFn = (ctx: OfflineAudioContext) => void

async function render(seconds: number, sampleRate: number, draw: RenderFn): Promise<AudioBuffer> {
  const length = Math.max(1, Math.floor(seconds * sampleRate))
  const ctx = new OfflineAudioContext(1, length, sampleRate)
  draw(ctx)
  return ctx.startRendering()
}

function envGain(ctx: OfflineAudioContext, attack: number, decay: number): GainNode {
  const g = ctx.createGain()
  g.gain.setValueAtTime(0.0001, 0)
  g.gain.exponentialRampToValueAtTime(1, Math.max(0.002, attack))
  g.gain.exponentialRampToValueAtTime(0.0001, Math.max(attack + 0.01, decay))
  return g
}

function noiseBuffer(ctx: OfflineAudioContext, seconds: number): AudioBuffer {
  const length = Math.max(1, Math.floor(seconds * ctx.sampleRate))
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate)
  const data = buffer.getChannelData(0)
  for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1
  return buffer
}

function kick(ctx: OfflineAudioContext) {
  const osc = ctx.createOscillator()
  osc.type = 'sine'
  osc.frequency.setValueAtTime(150, 0)
  osc.frequency.exponentialRampToValueAtTime(42, 0.14)
  const click = ctx.createOscillator()
  click.type = 'square'
  click.frequency.value = 1800
  const body = envGain(ctx, 0.002, 0.32)
  body.gain.setValueAtTime(1, 0)
  const clickG = envGain(ctx, 0.001, 0.018)
  osc.connect(body).connect(ctx.destination)
  click.connect(clickG).connect(ctx.destination)
  osc.start(0)
  osc.stop(0.34)
  click.start(0)
  click.stop(0.02)
}

function snare(ctx: OfflineAudioContext) {
  const osc = ctx.createOscillator()
  osc.type = 'triangle'
  osc.frequency.setValueAtTime(190, 0)
  osc.frequency.exponentialRampToValueAtTime(120, 0.08)
  const body = envGain(ctx, 0.001, 0.12)
  const noise = ctx.createBufferSource()
  noise.buffer = noiseBuffer(ctx, 0.22)
  const hp = ctx.createBiquadFilter()
  hp.type = 'highpass'
  hp.frequency.value = 900
  const ng = envGain(ctx, 0.001, 0.16)
  osc.connect(body).connect(ctx.destination)
  noise.connect(hp).connect(ng).connect(ctx.destination)
  osc.start(0)
  osc.stop(0.14)
  noise.start(0)
}

function clap(ctx: OfflineAudioContext) {
  const bursts = [0, 0.012, 0.026, 0.048]
  bursts.forEach((t, i) => {
    const noise = ctx.createBufferSource()
    noise.buffer = noiseBuffer(ctx, 0.18)
    const bp = ctx.createBiquadFilter()
    bp.type = 'bandpass'
    bp.frequency.value = 1100
    bp.Q.value = 0.8
    const g = ctx.createGain()
    g.gain.setValueAtTime(0.0001, t)
    g.gain.exponentialRampToValueAtTime(i === bursts.length - 1 ? 0.9 : 0.45, t + 0.004)
    g.gain.exponentialRampToValueAtTime(0.0001, t + (i === bursts.length - 1 ? 0.16 : 0.03))
    noise.connect(bp).connect(g).connect(ctx.destination)
    noise.start(t)
    noise.stop(t + 0.18)
  })
}

function hat(ctx: OfflineAudioContext, open: boolean) {
  const noise = ctx.createBufferSource()
  noise.buffer = noiseBuffer(ctx, open ? 0.45 : 0.08)
  const hp = ctx.createBiquadFilter()
  hp.type = 'highpass'
  hp.frequency.value = open ? 7000 : 8500
  const g = envGain(ctx, 0.001, open ? 0.38 : 0.045)
  noise.connect(hp).connect(g).connect(ctx.destination)
  noise.start(0)
}

function tom(ctx: OfflineAudioContext) {
  const osc = ctx.createOscillator()
  osc.type = 'sine'
  osc.frequency.setValueAtTime(220, 0)
  osc.frequency.exponentialRampToValueAtTime(95, 0.22)
  const g = envGain(ctx, 0.003, 0.28)
  osc.connect(g).connect(ctx.destination)
  osc.start(0)
  osc.stop(0.3)
}

function rim(ctx: OfflineAudioContext) {
  const osc = ctx.createOscillator()
  osc.type = 'square'
  osc.frequency.value = 720
  const g = envGain(ctx, 0.001, 0.04)
  const noise = ctx.createBufferSource()
  noise.buffer = noiseBuffer(ctx, 0.05)
  const hp = ctx.createBiquadFilter()
  hp.type = 'highpass'
  hp.frequency.value = 2000
  const ng = envGain(ctx, 0.001, 0.03)
  osc.connect(g).connect(ctx.destination)
  noise.connect(hp).connect(ng).connect(ctx.destination)
  osc.start(0)
  osc.stop(0.05)
  noise.start(0)
}

function perc(ctx: OfflineAudioContext) {
  const osc = ctx.createOscillator()
  osc.type = 'triangle'
  osc.frequency.setValueAtTime(640, 0)
  osc.frequency.exponentialRampToValueAtTime(420, 0.12)
  const g = envGain(ctx, 0.001, 0.14)
  osc.connect(g).connect(ctx.destination)
  osc.start(0)
  osc.stop(0.16)
}

const RENDERERS: Array<{ name: (typeof STARTER_PAD_NAMES)[number]; seconds: number; draw: RenderFn }> = [
  { name: 'Bombo', seconds: 0.36, draw: kick },
  { name: 'Caja', seconds: 0.24, draw: snare },
  { name: 'Palmas', seconds: 0.22, draw: clap },
  { name: 'Charles cerrado', seconds: 0.08, draw: (c) => hat(c, false) },
  { name: 'Charles abierto', seconds: 0.46, draw: (c) => hat(c, true) },
  { name: 'Tom', seconds: 0.32, draw: tom },
  { name: 'Rim', seconds: 0.07, draw: rim },
  { name: 'Perc', seconds: 0.18, draw: perc }
]

export async function synthesizeStarterKit(sampleRate = 44100): Promise<AudioBuffer[]> {
  const buffers: AudioBuffer[] = []
  for (const spec of RENDERERS) {
    buffers.push(await render(spec.seconds, sampleRate, spec.draw))
  }
  return buffers
}

export function reverseAudioBuffer(buffer: AudioBuffer): AudioBuffer {
  const ctxSampleRate = buffer.sampleRate
  const reversed = new AudioBuffer({
    length: buffer.length,
    numberOfChannels: buffer.numberOfChannels,
    sampleRate: ctxSampleRate
  })
  for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
    const src = buffer.getChannelData(ch)
    const dst = reversed.getChannelData(ch)
    for (let i = 0, j = src.length - 1; i < src.length; i++, j--) dst[i] = src[j]
  }
  return reversed
}
