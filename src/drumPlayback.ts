import type { DrumKit, DrumPad, PatternId } from './drumKit'
import { activePatternOf } from './drumKit'
import {
  hitsInWindow,
  transportTimeForHit,
  VELOCITY_GAIN,
  type DrumHit
} from './drumTiming'

export interface PatternClipLike {
  offsetSeconds: number
  duration: number
  patternId?: PatternId | string
  kind?: string
}

export interface ScheduledDrumEvent {
  padIndex: number
  songTime: number
  transportTime: number
  velocity: 1 | 2 | 3
}

export function collectClipHits(args: {
  kit: DrumKit
  clips: PatternClipLike[]
  bpm: number
  windowStart: number
  windowEnd: number
}): DrumHit[] {
  const hits: DrumHit[] = []
  for (const clip of args.clips) {
    if (clip.kind && clip.kind !== 'pattern') continue
    const patternId = (clip.patternId ?? args.kit.activePattern) as PatternId
    const pattern = args.kit.patterns[patternId] ?? activePatternOf(args.kit)
    hits.push(
      ...hitsInWindow({
        rows: pattern.rows,
        stepCount: pattern.stepCount,
        bpm: args.bpm,
        swing: args.kit.swing,
        clipStart: clip.offsetSeconds,
        clipDuration: clip.duration,
        windowStart: args.windowStart,
        windowEnd: args.windowEnd
      })
    )
  }
  hits.sort((a, b) => a.songTime - b.songTime)
  return hits
}

export function scheduledEventsForPlay(args: {
  kit: DrumKit
  clips: PatternClipLike[]
  bpm: number
  songTime: number
  playOriginSong: number
  tempoRate: number
  lookAhead: number
  loopStart?: number | null
  loopEnd?: number | null
  loopEnabled?: boolean
}): ScheduledDrumEvent[] {
  let windowStart = args.songTime
  let windowEnd = args.songTime + args.lookAhead
  if (args.loopEnabled && args.loopStart != null && args.loopEnd != null && args.loopEnd > args.loopStart) {
    windowEnd = Math.min(windowEnd, args.loopEnd)
    windowStart = Math.max(windowStart, args.loopStart)
  }
  return collectClipHits({
    kit: args.kit,
    clips: args.clips,
    bpm: args.bpm,
    windowStart,
    windowEnd
  }).map((hit) => ({
    padIndex: hit.padIndex,
    songTime: hit.songTime,
    transportTime: transportTimeForHit(hit.songTime, args.playOriginSong, args.tempoRate),
    velocity: hit.velocity
  }))
}

export function padPlaybackRate(pad: DrumPad): number {
  return 2 ** (pad.pitchSemitones / 12)
}

export function padVoiceGain(pad: DrumPad, velocity: 1 | 2 | 3): number {
  return Math.max(0, Math.min(1, pad.volume * VELOCITY_GAIN[velocity]))
}

export interface TransportLike {
  schedule: (callback: (time: number) => void, time: number) => number
  clear: (id: number) => void
}

export function scheduleHitsOnTransport(
  transport: TransportLike,
  events: ScheduledDrumEvent[],
  trigger: (event: ScheduledDrumEvent, audioTime: number) => void
): number[] {
  return events.map((event) =>
    transport.schedule((audioTime) => {
      trigger(event, audioTime)
    }, event.transportTime)
  )
}

export const lastScheduledDrumEvents: ScheduledDrumEvent[] = []

export function rememberSchedule(events: ScheduledDrumEvent[]): ScheduledDrumEvent[] {
  lastScheduledDrumEvents.length = 0
  lastScheduledDrumEvents.push(...events)
  if (typeof window !== 'undefined') {
    ;(window as unknown as { __musicaliaDrumSchedule?: ScheduledDrumEvent[] }).__musicaliaDrumSchedule = lastScheduledDrumEvents
  }
  return lastScheduledDrumEvents
}
