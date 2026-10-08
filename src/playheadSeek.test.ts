import { applySeekSnap, clickTimeFromX, isClickGesture } from './playheadSeek'

function snapQuarter(time: number): number {
  const interval = 0.5
  return Math.round(time / interval) * interval
}

let failed = 0
function assert(cond: boolean, msg: string) {
  if (!cond) {
    failed++
    console.error('FAIL:', msg)
  } else {
    console.log('ok:', msg)
  }
}

assert(isClickGesture(0), '0px is a click')
assert(isClickGesture(3.9), '3.9px is a click')
assert(!isClickGesture(4), '4px is a drag')
assert(!isClickGesture(20), '20px is a drag')

assert(clickTimeFromX(50, 0, 100, 10) === 5, 'midpoint maps to half of layoutMax')
assert(clickTimeFromX(0, 0, 100, 10) === 0, 'left edge is 0')
assert(clickTimeFromX(100, 0, 100, 10) === 10, 'right edge is layoutMax')
assert(clickTimeFromX(50, 0, 100, 0) === 0, 'layoutMax 0 yields 0')

assert(applySeekSnap(5.1, 10, true, false, snapQuarter) === 5, 'snap on without shift')
assert(applySeekSnap(5.1, 10, true, true, snapQuarter) === 5.1, 'shift disables snap')
assert(applySeekSnap(5.1, 10, false, false, snapQuarter) === 5.1, 'snap off leaves raw time')
assert(applySeekSnap(-1, 10, false, false, snapQuarter) === 0, 'clamps below 0')
assert(applySeekSnap(99, 10, false, false, snapQuarter) === 10, 'clamps to layoutMax')

// Empty project uses layoutMax 100, not clip duration 0 — otherwise every click maps to 0
const emptyProjectTime = clickTimeFromX(250, 0, 500, 100)
assert(emptyProjectTime === 50, 'empty timeline (layoutMax 100) maps mid-click to 50s')
assert(applySeekSnap(emptyProjectTime, 100, true, false, snapQuarter) === 50, 'empty-timeline seek snaps')
assert(applySeekSnap(emptyProjectTime, 100, true, true, snapQuarter) === 50, 'shift click keeps unsnapped 50s')

// Click-vs-drag: clip body mouseup under 4px is a seek; 4px+ is a move
assert(isClickGesture(Math.hypot(3, 0)), 'horizontal 3px on a clip is still a click-seek')
assert(!isClickGesture(Math.hypot(4, 0)), 'horizontal 4px on a clip is a drag, not a seek')

if (failed > 0) {
  console.error(`\n${failed} assertion(s) failed`)
  process.exit(1)
}
console.log('\n✅ playhead seek unit tests passed')
