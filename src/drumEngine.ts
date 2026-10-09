import * as Tone from 'tone'
import type { DrumKit, DrumPad } from './drumKit'
import {
  rememberSchedule,
  scheduledEventsForPlay,
  scheduleHitsOnTransport,
  padPlaybackRate,
  padVoiceGain,
  type PatternClipLike,
  type ScheduledDrumEvent
} from './drumPlayback'

interface Voice {
  player: Tone.Player
  panner: Tone.Panner
}

export class DrumEngine {
  private voices = new Map<string, Voice>()
  private eventIds: number[] = []

  private key(trackIndex: number, padIndex: number): string {
    return `${trackIndex}:${padIndex}`
  }

  ensureVoice(trackIndex: number, padIndex: number, dest: Tone.ToneAudioNode): Voice {
    const key = this.key(trackIndex, padIndex)
    let voice = this.voices.get(key)
    if (!voice) {
      const player = new Tone.Player({ fadeIn: 0.001, fadeOut: 0.02 })
      const panner = new Tone.Panner(0)
      player.connect(panner)
      panner.connect(dest)
      voice = { player, panner }
      this.voices.set(key, voice)
    }
    return voice
  }

  loadPad(trackIndex: number, padIndex: number, buffer: AudioBuffer | null, dest: Tone.ToneAudioNode) {
    const voice = this.ensureVoice(trackIndex, padIndex, dest)
    if (buffer) voice.player.buffer.set(buffer)
  }

  syncKit(trackIndex: number, kit: DrumKit, dest: Tone.ToneAudioNode) {
    kit.pads.forEach((pad, padIndex) => {
      this.loadPad(trackIndex, padIndex, pad.buffer, dest)
    })
  }

  trigger(
    trackIndex: number,
    padIndex: number,
    kit: DrumKit,
    dest: Tone.ToneAudioNode,
    velocity: 1 | 2 | 3,
    time?: number
  ) {
    const pad = kit.pads[padIndex]
    if (!pad?.buffer) return
    if (pad.chokeGroup != null) {
      kit.pads.forEach((other, otherIndex) => {
        if (otherIndex === padIndex || other.chokeGroup !== pad.chokeGroup) return
        this.stopVoice(trackIndex, otherIndex, time)
      })
    }
    const voice = this.ensureVoice(trackIndex, padIndex, dest)
    if (voice.player.buffer.length === 0) voice.player.buffer.set(pad.buffer)
    voice.panner.pan.value = pad.pan
    voice.player.playbackRate = padPlaybackRate(pad)
    voice.player.reverse = pad.reverse
    voice.player.volume.value = Tone.gainToDb(Math.max(0.0001, padVoiceGain(pad, velocity)))
    const when = time ?? Tone.now()
    try {
      voice.player.stop(when)
    } catch {
      /* not started */
    }
    voice.player.start(when)
    const dur = Math.min(pad.decay, Math.max(0.02, pad.buffer.duration))
    voice.player.stop(when + dur)
  }

  private stopVoice(trackIndex: number, padIndex: number, time?: number) {
    const voice = this.voices.get(this.key(trackIndex, padIndex))
    if (!voice) return
    try {
      voice.player.stop(time ?? Tone.now())
    } catch {
      /* already stopped */
    }
  }

  clearSchedule() {
    const transport = Tone.getTransport()
    this.eventIds.forEach((id) => {
      try {
        transport.clear(id)
      } catch {
        /* already cleared */
      }
    })
    this.eventIds = []
  }

  reschedule(args: {
    tracks: Array<{ kind?: string; drum?: DrumKit; clips: PatternClipLike[] }>
    destinations: Array<Tone.ToneAudioNode | undefined>
    bpm: number
    songTime: number
    playOriginSong: number
    tempoRate: number
    loopStart: number | null
    loopEnd: number | null
    loopEnabled: boolean
  }): ScheduledDrumEvent[] {
    this.clearSchedule()
    const all: ScheduledDrumEvent[] = []
    args.tracks.forEach((track, trackIndex) => {
      if (track.kind !== 'drum' || !track.drum) return
      const dest = args.destinations[trackIndex]
      if (!dest) return
      this.syncKit(trackIndex, track.drum, dest)
      const events = scheduledEventsForPlay({
        kit: track.drum,
        clips: track.clips,
        bpm: args.bpm,
        songTime: args.songTime,
        playOriginSong: args.playOriginSong,
        tempoRate: args.tempoRate,
        lookAhead: 32,
        loopStart: args.loopStart,
        loopEnd: args.loopEnd,
        loopEnabled: args.loopEnabled
      })
      all.push(...events)
      const ids = scheduleHitsOnTransport(Tone.getTransport(), events, (event, audioTime) => {
        this.trigger(trackIndex, event.padIndex, track.drum!, dest, event.velocity, audioTime)
      })
      this.eventIds.push(...ids)
    })
    rememberSchedule(all)
    return all
  }

  stopAll() {
    this.clearSchedule()
    this.voices.forEach((voice) => {
      try {
        voice.player.stop()
      } catch {
        /* already */
      }
    })
  }

  disposeTrack(trackIndex: number) {
    for (const [key, voice] of this.voices) {
      if (!key.startsWith(`${trackIndex}:`)) continue
      try {
        voice.player.dispose()
        voice.panner.dispose()
      } catch {
        /* already */
      }
      this.voices.delete(key)
    }
  }
}

export function applyPadToVoice(_pad: DrumPad): void {
  /* documented hook for tests — voices are configured in trigger() */
}
