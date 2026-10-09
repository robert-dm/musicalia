import {
  commitTimeDelta,
  dragPreviewDx,
  measurePxPerSec,
  snappedDragTimeDelta,
  timeDeltaFromPx
} from './clipDrag'

let failed = 0
function assert(cond: boolean, msg: string) {
  if (!cond) {
    failed++
    console.error('FAIL:', msg)
  } else {
    console.log('ok:', msg)
  }
}

const identity = (t: number) => t
const quarter = (t: number) => Math.round(t / 0.5) * 0.5

for (const zoomLane of [200, 800, 4000]) {
  const layoutMax = 10
  const pps = measurePxPerSec(zoomLane, layoutMax)
  const n = 80
  const dt = timeDeltaFromPx(n, pps)
  assert(Math.abs(dt - n / pps) < 1e-12, `N px at lane ${zoomLane} → N/pxPerSec`)
  const preview = dragPreviewDx(100 + n, 100, pps, null)
  assert(preview === n, `unsnapped preview follows ${n}px exactly`)
}

assert(dragPreviewDx(150, 100, 20, 1) === 20, 'snapped preview uses time * pxPerSec')

const commit = commitTimeDelta({
  clientX: 180,
  startX: 100,
  pxPerSec: 40,
  startOffset: 2,
  minOffset: 2,
  snapEnabled: false,
  shiftKey: false,
  snapToGrid: quarter
})
assert(Math.abs(commit - 2) < 1e-12, '80px / 40pxPerSec = +2s, snap off')

const snapped = snappedDragTimeDelta({
  clientX: 180,
  startX: 100,
  pxPerSec: 40,
  startOffset: 2,
  minOffset: 2,
  snapEnabled: true,
  shiftKey: false,
  snapToGrid: quarter
})
assert(snapped === 2, 'snap on still lands on 0.5s grid here')

const noSnap = snappedDragTimeDelta({
  clientX: 180,
  startX: 100,
  pxPerSec: 40,
  startOffset: 2,
  minOffset: 2,
  snapEnabled: false,
  shiftKey: false,
  snapToGrid: quarter
})
assert(noSnap === null, 'snap off → no snapped preview')

const clamped = commitTimeDelta({
  clientX: 0,
  startX: 100,
  pxPerSec: 40,
  startOffset: 1,
  minOffset: 1,
  snapEnabled: false,
  shiftKey: false,
  snapToGrid: identity
})
assert(clamped === -1, 'cannot drag the group left of 0')

if (failed > 0) {
  console.error(`\n${failed} assertion(s) failed`)
  process.exit(1)
}
console.log('\n✅ clip drag unit tests passed')
