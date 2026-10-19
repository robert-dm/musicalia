import * as Tone from 'tone'
import {
  createClickAudioBuffer,
  scheduledMetronomeClicks,
  type MetronomeClick
} from './metronomeTrack'
import type { ClickSound, MetronomeMeter } from './metronomeMeter'
import type { TempoMap } from './beatTracker'

export interface ScheduledMetronomeEvent extends MetronomeClick {
  transportTime: number
}

export const lastScheduledMetronomeEvents: ScheduledMetronomeEvent[] = []

export function rememberMetronomeSchedule(events: ScheduledMetronomeEvent[]): ScheduledMetronomeEvent[] {
  lastScheduledMetronomeEvents.length = 0
  lastScheduledMetronomeEvents.push(...events)
  if (typeof window !== 'undefined') {
    ;(window as unknown as { __musicaliaMetronomeSchedule?: ScheduledMetronomeEvent[] }).__musicaliaMetronomeSchedule =
      lastScheduledMetronomeEvents
  }
  return lastScheduledMetronomeEvents
}

export class MetronomeEngine {
  private accent: Tone.Player | null = null
  private beat: Tone.Player | null = null
  private dest: Tone.ToneAudioNode | null = null
  private eventIds: number[] = []
  private loaded = false
  private loadedSound: ClickSound | null = null

  ensure(dest: Tone.ToneAudioNode, sound: ClickSound = 'beep'): void {
    if (!this.accent || !this.beat) {
      this.accent = new Tone.Player({ fadeIn: 0.0004, fadeOut: 0.008 })
      this.beat = new Tone.Player({ fadeIn: 0.0004, fadeOut: 0.008 })
    }
    if (this.dest !== dest) {
      try { this.accent.disconnect() } catch { /* first connect */ }
      try { this.beat.disconnect() } catch { /* first connect */ }
      this.accent.connect(dest)
      this.beat.connect(dest)
      this.dest = dest
    }
    if (!this.loaded || this.loadedSound !== sound) {
      const ctx = Tone.getContext()
      const raw = ctx.rawContext as unknown as AudioContext
      this.accent.buffer.set(createClickAudioBuffer(raw, true, sound))
      this.beat.buffer.set(createClickAudioBuffer(raw, false, sound))
      this.loaded = true
      this.loadedSound = sound
    }
  }

  clearSchedule(): void {
    const transport = Tone.getTransport()
    this.eventIds.forEach((id) => {
      try { transport.clear(id) } catch { /* already cleared */ }
    })
    this.eventIds = []
  }

  reschedule(args: {
    enabled: boolean
    destination?: Tone.ToneAudioNode
    bpm: number
    beatsPerBar?: number
    meter?: Partial<MetronomeMeter> | null
    tempoMap?: TempoMap | null
    clickSound?: ClickSound
    songTime: number
    playOriginSong: number
    tempoRate: number
    songEnd: number
    loopStart: number | null
    loopEnd: number | null
    loopEnabled: boolean
    clickOriginSong?: number
    clickPassStart?: number
    clickElapsedSong?: number
  }): ScheduledMetronomeEvent[] {
    this.clearSchedule()
    if (!args.enabled || !args.destination) {
      rememberMetronomeSchedule([])
      return []
    }
    this.ensure(args.destination, args.clickSound ?? args.meter?.clickSound ?? 'beep')
    const events = scheduledMetronomeClicks({
      bpm: args.bpm,
      beatsPerBar: args.beatsPerBar,
      meter: args.meter,
      tempoMap: args.tempoMap,
      songTime: args.songTime,
      playOriginSong: args.playOriginSong,
      tempoRate: args.tempoRate,
      songEnd: args.songEnd,
      loopStart: args.loopStart,
      loopEnd: args.loopEnd,
      loopEnabled: args.loopEnabled,
      clickOriginSong: args.clickOriginSong,
      clickPassStart: args.clickPassStart,
      clickElapsedSong: args.clickElapsedSong
    })
    const transport = Tone.getTransport()
    this.eventIds = events.map((event) =>
      transport.schedule((audioTime) => {
        this.trigger(event.accent, audioTime)
      }, event.transportTime)
    )
    rememberMetronomeSchedule(events)
    return events
  }

  trigger(accent: boolean, time?: number): void {
    const player = accent ? this.accent : this.beat
    if (!player || player.buffer.length === 0) return
    const when = time ?? Tone.now()
    try { player.stop(when) } catch { /* not started */ }
    player.start(when)
  }

  stopAll(): void {
    this.clearSchedule()
    rememberMetronomeSchedule([])
    for (const player of [this.accent, this.beat]) {
      if (!player) continue
      try { player.stop() } catch { /* already */ }
    }
  }

  dispose(): void {
    this.stopAll()
    for (const player of [this.accent, this.beat]) {
      if (!player) continue
      try { player.disconnect() } catch { /* already */ }
      try { player.dispose() } catch { /* already */ }
    }
    this.accent = null
    this.beat = null
    this.dest = null
    this.loaded = false
    this.loadedSound = null
  }

  get destinationIsTrack(): boolean {
    return this.dest != null
  }
}
