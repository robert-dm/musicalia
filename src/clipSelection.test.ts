import {
  clampGroupTimeDelta,
  clampGroupTrackDelta,
  clientRectsIntersect,
  deleteTrackFromList,
  marqueeClientRect,
  mergeSelection,
  packClipboard,
  pastePlacement
} from './clipSelection'

let failed = 0
function assert(cond: boolean, msg: string) {
  if (!cond) {
    failed++
    console.error('FAIL:', msg)
  } else {
    console.log('ok:', msg)
  }
}

assert(clientRectsIntersect({ left: 0, top: 0, right: 10, bottom: 10 }, { left: 5, top: 5, right: 15, bottom: 15 }), 'overlapping rects intersect')
assert(!clientRectsIntersect({ left: 0, top: 0, right: 10, bottom: 10 }, { left: 11, top: 0, right: 20, bottom: 10 }), 'separated rects do not intersect')
assert(clientRectsIntersect({ left: 0, top: 0, right: 10, bottom: 10 }, { left: 10, top: 0, right: 20, bottom: 10 }), 'edge-touching clip is selected')

const band = marqueeClientRect(100, 80, 40, 20)
assert(band.left === 40 && band.top === 20 && band.right === 100 && band.bottom === 80, 'marquee normalizes inverted drag')

assert(clampGroupTimeDelta(2, -5) === -2, 'group cannot move left of 0')
assert(clampGroupTimeDelta(2, 3) === 3, 'positive group delta unchanged')
assert(clampGroupTimeDelta(0, -1) === 0, 'leftmost at 0 cannot move left')

assert(clampGroupTrackDelta(1, 3, -2, 8) === -1, 'group cannot leave top')
assert(clampGroupTrackDelta(1, 3, 10, 8) === 4, 'group cannot leave bottom')
assert(clampGroupTrackDelta(0, 1, 1, 4) === 1, 'in-range track delta unchanged')

const packed = packClipboard([
  { id: 'a', offsetSeconds: 4, trackIndex: 2 },
  { id: 'b', offsetSeconds: 1, trackIndex: 5 }
])
assert(packed[0].relTime === 3 && packed[0].relTrack === 0, 'earliest time is origin; min track is origin')
assert(packed[1].relTime === 0 && packed[1].relTrack === 3, 'later clip keeps relative time and track')

const placed = pastePlacement(3, 2, 10, 1, 8)
assert(placed.offsetSeconds === 13 && placed.trackIndex === 3, 'paste is relative to origin time/track')
assert(pastePlacement(0, 9, 0, 0, 4).trackIndex === 3, 'paste track clamps to last lane')

const replaced = mergeSelection(new Set(['a']), ['b', 'c'], 'replace')
assert(replaced.has('b') && replaced.has('c') && !replaced.has('a'), 'replace selection')
const added = mergeSelection(new Set(['a']), ['b'], 'add')
assert(added.has('a') && added.has('b'), 'shift-add keeps existing')
const toggled = mergeSelection(new Set(['a', 'b']), ['b', 'c'], 'toggle')
assert(toggled.has('a') && !toggled.has('b') && toggled.has('c'), 'ctrl-toggle adds and removes')

const del = deleteTrackFromList(
  [
    { clips: [{ id: 'a' }] },
    { clips: [{ id: 'b' }, { id: 'c' }] },
    { clips: [{ id: 'd' }] }
  ],
  1,
  new Set(['a', 'b', 'd'])
)
assert(!!del && del.tracks.length === 2, 'deleting a track leaves the others')
assert(!!del && del.tracks[1].clips[0].id === 'd', 'later tracks shift down')
assert(!!del && del.selectedIds.has('a') && del.selectedIds.has('d') && !del.selectedIds.has('b'), 'selection drops clips from the removed track')
assert(deleteTrackFromList([{ clips: [] }], 0, new Set()) === null, 'cannot delete the last track')

if (failed > 0) {
  console.error(`\n${failed} assertion(s) failed`)
  process.exit(1)
}
console.log('\n✅ clip selection unit tests passed')
