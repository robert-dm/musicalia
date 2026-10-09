import {
  destIndexFromInsertBefore,
  fileDropInsertIndex,
  insertIndexFromY,
  insertionLineY,
  liveShiftOffsets,
  moveItem,
  remapHarmonySourceAfterInsert,
  remapHarmonySourceAfterMove,
  remapIndexAfterInsert,
  remapIndexAfterMove,
  remapKeyedRecordAfterInsert,
  remapKeyedRecordAfterMove,
  remapNullableIndexAfterMove,
  remapOpenIndicesAfterInsert,
  remapOpenIndicesAfterMove,
  sameReorderSlot
} from './trackOrder'

let failed = 0
function assert(cond: boolean, msg: string) {
  if (!cond) {
    failed++
    console.error('FAIL:', msg)
  } else {
    console.log('ok:', msg)
  }
}

const names = ['A', 'B', 'C', 'D']
assert(moveItem(names, 0, 2).join('') === 'BCAD', 'move first down to index 2')
assert(moveItem(names, 3, 0).join('') === 'DABC', 'move last to top')
assert(moveItem(names, 1, 1).join('') === 'ABCD', 'no-op same index')
assert(moveItem(names, -1, 2).join('') === 'ABCD', 'invalid from returns copy')
const clips = [{ id: 'v' }, { id: 'd' }, { id: 'b' }]
const movedClips = moveItem(clips, 0, 2)
assert(movedClips[2] === clips[0], 'reorder keeps object identity (playback/fx follow)')
assert(movedClips[0] === clips[1], 'others shift around the moved track')

assert(destIndexFromInsertBefore(0, 3) === 2, 'insert-before after self becomes dest-1')
assert(destIndexFromInsertBefore(3, 0) === 0, 'insert-before 0 is dest 0')
assert(destIndexFromInsertBefore(1, 1) === 1, 'insert-before self dest is self')
assert(sameReorderSlot(1, 1) && sameReorderSlot(1, 2), 'same slot includes from and from+1')
assert(!sameReorderSlot(1, 3), 'later slot is a move')

assert(remapIndexAfterMove(0, 0, 2) === 2, 'moved index follows')
assert(remapIndexAfterMove(1, 0, 2) === 0, 'item after source shifts up')
assert(remapIndexAfterMove(2, 0, 2) === 1, 'dest occupant shifts up')
assert(remapIndexAfterMove(3, 0, 2) === 3, 'below dest stays')
assert(remapIndexAfterMove(0, 3, 0) === 1, 'top shifts down when last moves up')
assert(remapIndexAfterMove(3, 3, 0) === 0, 'moved last lands at 0')
assert(remapNullableIndexAfterMove(null, 0, 2) === null, 'null index stays null')

assert(remapIndexAfterInsert(0, 0) === 1, 'insert at 0 shifts current 0')
assert(remapIndexAfterInsert(2, 0) === 3, 'insert at 0 shifts later')
assert(remapIndexAfterInsert(0, 2) === 0, 'insert below leaves earlier indices')
assert(remapOpenIndicesAfterMove([0, 2], 0, 2).join(',') === '2,1', 'open panels follow move')
assert(remapOpenIndicesAfterInsert([0, 2], 1).join(',') === '0,3', 'open panels follow insert')

const rec = remapKeyedRecordAfterMove({ 0: 'vol', 2: 'pan' }, 0, 2)
assert(rec[2] === 'vol' && rec[1] === 'pan', 'auto param keys follow move')
const recIns = remapKeyedRecordAfterInsert({ 0: 'vol', 1: 'pan' }, 1)
assert(recIns[0] === 'vol' && recIns[2] === 'pan', 'auto param keys follow insert')
assert(remapHarmonySourceAfterMove('mix', 0, 2) === 'mix', 'mix source stays mix')
assert(remapHarmonySourceAfterMove(0, 0, 2) === 2, 'harmony track follows')
assert(remapHarmonySourceAfterInsert(1, 0) === 2, 'harmony track shifts on insert')

const heights = [40, 40, 40, 40]
assert(liveShiftOffsets(0, 1, heights).every((v) => v === 0), 'same slot no shift')
assert(liveShiftOffsets(0, 3, heights).slice(1, 3).every((v) => v === -40), 'moving down shifts middle up')
assert(liveShiftOffsets(0, 3, heights)[3] === 0, 'destination occupant does not shift')
assert(liveShiftOffsets(3, 0, heights).slice(0, 3).every((v) => v === 40), 'moving up shifts earlier down')

const tops = [100, 180, 260]
const bottoms = [180, 260, 340]
assert(insertIndexFromY(90, tops, bottoms) === 0, 'above first inserts at 0')
assert(insertIndexFromY(150, tops, bottoms) === 1, 'below mid of first inserts at 1')
assert(insertIndexFromY(400, tops, bottoms) === 3, 'below last inserts at n')
assert(fileDropInsertIndex(100, tops, bottoms) === 0, 'near first top is a gap insert')
assert(fileDropInsertIndex(180, tops, bottoms) === 1, 'on the 0/1 boundary inserts between')
assert(fileDropInsertIndex(220, tops, bottoms) === null, 'middle of a track is not a gap')
assert(fileDropInsertIndex(340, tops, bottoms) === 3, 'near last bottom appends')

const offsetsDown = liveShiftOffsets(0, 3, [80, 80, 80, 80])
assert(insertionLineY(3, [0, 80, 160, 240], [80, 160, 240, 320], offsetsDown) === 240, 'line sits above dest track')

if (failed > 0) {
  console.error(`\n${failed} assertion(s) failed`)
  process.exit(1)
}
console.log('\n✅ track order unit tests passed')
