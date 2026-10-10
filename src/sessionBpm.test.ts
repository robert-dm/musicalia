import { firstImportOffset, sessionHasAudio, shouldApplyDetectedBpm } from './sessionBpm'

let failed = 0
function assert(cond: boolean, msg: string) {
  if (!cond) {
    failed++
    console.error('FAIL:', msg)
  } else {
    console.log('ok:', msg)
  }
}

assert(!sessionHasAudio([]), 'empty session has no audio')
assert(!sessionHasAudio([{ clips: [] }, { clips: [] }]), 'empty lanes are not audio')
assert(sessionHasAudio([{ clips: [] }, { clips: [{}] }]), 'any clip means the session has audio')

assert(
  shouldApplyDetectedBpm({ hasExistingAudio: false, detectedBpm: 119 }),
  'first import may set detected BPM'
)
assert(
  !shouldApplyDetectedBpm({ hasExistingAudio: true, detectedBpm: 96 }),
  'later import must not overwrite BPM'
)
assert(
  !shouldApplyDetectedBpm({ hasExistingAudio: false, bpmManuallySet: true, detectedBpm: 140 }),
  'manual BPM on an empty session is kept'
)
assert(
  !shouldApplyDetectedBpm({ hasExistingAudio: false, detectedBpm: null }),
  'no detection means no write'
)
assert(
  !shouldApplyDetectedBpm({ hasExistingAudio: true, bpmManuallySet: false, detectedBpm: 88 }),
  'stem split / recording after first track keeps existing BPM'
)
assert(firstImportOffset(false, 70) === 0, 'first song always at 0')
assert(firstImportOffset(false, 81) === 0, 'playhead ~1:21 does not place the first song')
assert(firstImportOffset(false, undefined) === 0, 'first song ignores missing offset')
assert(firstImportOffset(true, 12.5) === 12.5, 'later import keeps drop time')
assert(firstImportOffset(true, undefined) === 0, 'later import without offset is 0')

if (failed > 0) {
  console.error(`\n${failed} assertion(s) failed`)
  process.exit(1)
}
console.log('\n✅ session BPM unit tests passed')
