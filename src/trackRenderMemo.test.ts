import { clipBufferSignature, laneClipDataEqual, trackHeaderDataEqual, trackLaneDataEqual } from './trackRenderMemo'

let failed = 0
function assert(cond: boolean, msg: string) {
  if (!cond) {
    failed++
    console.error('FAIL:', msg)
  } else {
    console.log('ok:', msg)
  }
}

const headerA = {
  trackIndex: 0,
  name: 'Bateria',
  mute: false,
  solo: false,
  volume: 0.8,
  height: 88,
  canDelete: true,
  isRenaming: false,
  renameDraft: '',
  recordArmed: false
}

assert(trackHeaderDataEqual(headerA, { ...headerA }), 'identical header skips render')
assert(
  !trackHeaderDataEqual(headerA, { ...headerA, volume: 0.5 }),
  'volume change re-renders that header'
)
assert(
  trackHeaderDataEqual(headerA, { ...headerA, renameDraft: 'x' }),
  'rename draft on a non-renaming header does not re-render'
)
assert(
  !trackHeaderDataEqual(
    { ...headerA, isRenaming: true, renameDraft: 'a' },
    { ...headerA, isRenaming: true, renameDraft: 'b' }
  ),
  'rename draft re-renders the header being renamed'
)
assert(
  trackHeaderDataEqual(headerA, { ...headerA, volume: 0.8 }),
  'other-track volume-identical header skips render'
)
assert(
  !trackHeaderDataEqual(headerA, { ...headerA, recordArmed: true }),
  'record-arm change re-renders that header'
)
assert(
  !trackHeaderDataEqual(headerA, { ...headerA, fxOpen: true }),
  'FX panel open re-renders that header'
)
assert(
  !trackHeaderDataEqual(headerA, { ...headerA, autoOpen: true }),
  'automation open re-renders that header'
)

const clips = [{ id: 'c1' }]
const selected = new Set(['c1'])
const laneA = {
  trackIndex: 1,
  hasClips: true,
  isAnyClipPlaying: false,
  height: 88,
  maxDur: 100,
  clips,
  selectedClipIds: selected,
  isLoopEnabled: false,
  isDraggingLoopEdge: false,
  loopStart: null,
  loopEnd: null,
  tempLoopStart: null,
  tempLoopEnd: null
}

assert(trackLaneDataEqual(laneA, { ...laneA }), 'identical lane skips render')
assert(
  trackLaneDataEqual(laneA, { ...laneA, clips }),
  'same clips reference skips render even if sibling volume changed'
)
assert(
  !trackLaneDataEqual(laneA, { ...laneA, clips: [{ id: 'c1' }] }),
  'new clips array re-renders that lane'
)
assert(
  !trackLaneDataEqual(laneA, { ...laneA, isRecordingLane: true, recordingStartOffset: 1 }),
  'recording overlay re-renders that lane'
)

const clipView = {
  trackIndex: 0,
  maxDur: 100,
  selected: false,
  clip: { id: 'c1', fileName: 'a.wav', offsetSeconds: 1, duration: 2, sourceStart: 0, buffer: clips }
}
assert(laneClipDataEqual(clipView, { ...clipView, clip: { ...clipView.clip } }), 'identical clip view skips render')
assert(
  !laneClipDataEqual(clipView, { ...clipView, clip: { ...clipView.clip, duration: 3 } }),
  'duration change re-renders that clip'
)

const tracks = [
  { clips: [{ id: 'a', buffer: { length: 10, sampleRate: 44100 } }] },
  { clips: [{ id: 'b', buffer: { length: 20, sampleRate: 44100 } }] }
]
assert(
  clipBufferSignature(tracks) === clipBufferSignature(tracks),
  'buffer signature stable when clips unchanged'
)
assert(
  clipBufferSignature(tracks) !==
    clipBufferSignature([
      tracks[0],
      { clips: [{ id: 'b', buffer: { length: 21, sampleRate: 44100 } }] }
    ]),
  'buffer signature changes when a buffer changes'
)

if (failed > 0) {
  console.error(`\n${failed} assertion(s) failed`)
  process.exit(1)
}
console.log('\n✅ track render memo unit tests passed')
