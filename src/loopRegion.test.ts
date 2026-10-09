import {
  applyLoopSnap,
  displayLoop,
  hitTestLoop,
  loopFromClip,
  loopFromDrag,
  LOOP_HANDLE_PX,
  LOOP_MIN_DURATION,
  moveLoop,
  normalizeLoop,
  resizeLoop,
  rulerCursor
} from './loopRegion'

let failed = 0
function assert(cond: boolean, msg: string) {
  if (!cond) {
    failed++
    console.error('FAIL:', msg)
  } else {
    console.log('ok:', msg)
  }
}

const snapQuarter = (t: number) => Math.round(t / 0.5) * 0.5

const ordered = normalizeLoop(8, 2, 100)
assert(ordered.start === 2 && ordered.end === 8, 'normalize orders start/end')
assert(normalizeLoop(-4, 200, 10).start === 0, 'clamps start to 0')
assert(normalizeLoop(-4, 200, 10).end === 10, 'clamps end to layoutMax')
const tiny = normalizeLoop(5, 5.001, 100)
assert(tiny.end - tiny.start >= LOOP_MIN_DURATION - 1e-9, 'enforces min duration')

assert(applyLoopSnap(5.1, 10, false, snapQuarter) === 5.1, 'snap off leaves raw time')
assert(applyLoopSnap(5.1, 10, true, snapQuarter) === 5, 'snap on quantizes')
assert(applyLoopSnap(-1, 10, false, snapQuarter) === 0, 'snap clamps below 0')

const drag = loopFromDrag(4, 1, 100)
assert(drag.start === 1 && drag.end === 4, 'create-drag orders the range')

const resized = resizeLoop('start', 3, 2, 8, 100)
assert(resized.start === 3 && resized.end === 8, 'resize start edge')
const resizedEnd = resizeLoop('end', 6, 2, 8, 100)
assert(resizedEnd.start === 2 && resizedEnd.end === 6, 'resize end edge')

const moved = moveLoop(10, 20, 5, 100)
assert(moved.start === 15 && moved.end === 25, 'move preserves span')
const leftClamp = moveLoop(2, 6, -10, 100)
assert(leftClamp.start === 0 && leftClamp.end === 4, 'move clamps left')
const rightClamp = moveLoop(90, 98, 20, 100)
assert(rightClamp.end === 100 && rightClamp.start === 92, 'move clamps right')

const clipLoop = loopFromClip(12, 4, 100)
assert(clipLoop.start === 12 && clipLoop.end === 16, 'loop from clip span')

assert(displayLoop(null, null, null, null) === null, 'no loop to display')
assert(displayLoop(1, 4, 2, 5)?.start === 2, 'temp overrides committed loop')

const width = 1000
const max = 100
// start at 20s = 200px, end at 40s = 400px
assert(hitTestLoop(200, 0, width, max, 20, 40) === 'start', 'hits start handle')
assert(hitTestLoop(400, 0, width, max, 20, 40) === 'end', 'hits end handle')
assert(hitTestLoop(300, 0, width, max, 20, 40) === 'body', 'hits loop body')
assert(hitTestLoop(50, 0, width, max, 20, 40) === 'empty', 'outside is empty')
assert(hitTestLoop(50, 0, width, max, null, null) === 'empty', 'no region is empty')
assert(
  hitTestLoop(200 + LOOP_HANDLE_PX, 0, width, max, 20, 40) === 'start',
  'handle hit includes pixel pad'
)

assert(rulerCursor('empty') === 'crosshair', 'empty ruler uses crosshair')
assert(rulerCursor('start') === 'ew-resize', 'start handle uses resize cursor')
assert(rulerCursor('end') === 'ew-resize', 'end handle uses resize cursor')
assert(rulerCursor('body') === 'grab', 'loop body uses grab cursor')

if (failed > 0) {
  console.error(`\n${failed} assertion(s) failed`)
  process.exit(1)
}
console.log('\n✅ loop region unit tests passed')
