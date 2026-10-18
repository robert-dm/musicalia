import {
  MAGNET_THRESHOLD_PX,
  alignClipStarts,
  collectMagnetTargets,
  collectMovingEdges,
  earliestStart,
  magnetThresholdSeconds,
  magnetTimeDelta,
  resolveMagnetDrag
} from './clipMagnet'

let failed = 0
function assert(cond: boolean, msg: string) {
  if (!cond) {
    failed++
    console.error('FAIL:', msg)
  } else {
    console.log('ok:', msg)
  }
}

assert(MAGNET_THRESHOLD_PX === 8, 'snap window is 8 px')
assert(Math.abs(magnetThresholdSeconds(40) - 0.2) < 1e-12, '8 px at 40 px/s is 0.2 s')
assert(magnetThresholdSeconds(0) === 0, 'zero zoom has no window')

const clips = [
  { id: 'a', offsetSeconds: 1, duration: 0.6 },
  { id: 'b', offsetSeconds: 2.5, duration: 0.6 },
  { id: 'c', offsetSeconds: 4, duration: 1 }
]
const targets = collectMagnetTargets(clips, ['a'])
assert(targets.includes(0), '0 is always a target')
assert(targets.includes(2.5) && targets.includes(3.1), 'other clip start/end are targets')
assert(targets.includes(4) && targets.includes(5), 'any-track edges are targets')
assert(!targets.includes(1) && !targets.includes(1.6), 'moving clip edges are excluded')

const moving = collectMovingEdges(clips, ['a', 'b'])
assert(moving.starts.join(',') === '1,2.5', 'group moving starts')
assert(moving.ends.join(',') === '1.6,3.1', 'group moving ends')

const snapStart = magnetTimeDelta({
  movingStarts: [1],
  movingEnds: [1.6],
  targets: [0, 2.5, 3.1],
  rawDelta: 1.48,
  pxPerSec: 40,
  magnetEnabled: true,
  altHeld: false
})
assert(snapStart.snapTime === 2.5 && Math.abs(snapStart.delta - 1.5) < 1e-12, 'start snaps to another start within 8 px')

const snapEnd = magnetTimeDelta({
  movingStarts: [1],
  movingEnds: [1.6],
  targets: [0, 2.5, 3.1],
  rawDelta: 0.88,
  pxPerSec: 40,
  magnetEnabled: true,
  altHeld: false
})
assert(snapEnd.snapTime === 2.5 && Math.abs(snapEnd.delta - 0.9) < 1e-12, 'end snaps to another start within 8 px')

const snapZero = magnetTimeDelta({
  movingStarts: [0.15],
  movingEnds: [0.75],
  targets: [0, 2.5],
  rawDelta: -0.1,
  pxPerSec: 40,
  magnetEnabled: true,
  altHeld: false
})
assert(snapZero.snapTime === 0 && Math.abs(snapZero.delta + 0.15) < 1e-12, 'start snaps to 0')

const tooFar = magnetTimeDelta({
  movingStarts: [1],
  movingEnds: [1.6],
  targets: [0, 2.5],
  rawDelta: 0.4,
  pxPerSec: 40,
  magnetEnabled: true,
  altHeld: false
})
assert(tooFar.snapTime == null && tooFar.delta === 0.4, 'outside the 8 px window stays free')

const altOff = magnetTimeDelta({
  movingStarts: [1],
  movingEnds: [1.6],
  targets: [0, 2.5],
  rawDelta: 0.88,
  pxPerSec: 40,
  magnetEnabled: true,
  altHeld: true
})
assert(altOff.snapTime == null && altOff.delta === 0.88, 'Alt disables magnet')

const magnetOff = magnetTimeDelta({
  movingStarts: [1],
  movingEnds: [1.6],
  targets: [0, 2.5],
  rawDelta: 0.88,
  pxPerSec: 40,
  magnetEnabled: false,
  altHeld: false
})
assert(magnetOff.snapTime == null && magnetOff.delta === 0.88, 'Imán off does not snap')

const group = magnetTimeDelta({
  movingStarts: [1, 2.1],
  movingEnds: [1.5, 2.6],
  targets: [0, 5],
  rawDelta: -0.95,
  pxPerSec: 40,
  magnetEnabled: true,
  altHeld: false
})
assert(group.snapTime === 0 && Math.abs(group.delta + 1) < 1e-12, 'group uses the closest-edge delta')

const closest = magnetTimeDelta({
  movingStarts: [1],
  movingEnds: [2],
  targets: [0, 3.05],
  rawDelta: 1,
  pxPerSec: 40,
  magnetEnabled: true,
  altHeld: false
})
assert(closest.snapTime === 3.05 && Math.abs(closest.delta - 1.05) < 1e-12, 'closest of several candidate edges wins')

const aligned = alignClipStarts([2, 0.5, 3])
assert(aligned.join(',') === '0.5,0.5,0.5', 'Alinear inicios uses the earliest start')
assert(earliestStart([2, 0.5, 3]) === 0.5, 'earliest start helper')
assert(alignClipStarts([]).length === 0, 'align of empty is empty')

const clamped = resolveMagnetDrag({
  movingStarts: [2],
  movingEnds: [3],
  targets: [0.5],
  rawDelta: -2.55,
  pxPerSec: 40,
  magnetEnabled: true,
  altHeld: false,
  minOffset: 2
})
assert(clamped.delta === -2 && clamped.snapTime == null, 'clamp past 0 drops a guide that no longer hits')

const snapAndClamp = resolveMagnetDrag({
  movingStarts: [0.12],
  movingEnds: [0.72],
  targets: [0],
  rawDelta: -0.08,
  pxPerSec: 40,
  magnetEnabled: true,
  altHeld: false,
  minOffset: 0.12
})
assert(snapAndClamp.snapTime === 0 && Math.abs(snapAndClamp.delta + 0.12) < 1e-12, 'snap to 0 survives clamp')

if (failed > 0) {
  console.error(`\n${failed} assertion(s) failed`)
  process.exit(1)
}
console.log('\n✅ clip magnet unit tests passed')
