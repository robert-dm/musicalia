import {
  dataTransferHasFiles,
  dropTimeOnLane,
  ignoredAudioToast,
  isAudioFile,
  partitionDroppedFiles,
  resolveDropPlacement
} from './audioImport'

let failed = 0
function assert(cond: boolean, msg: string) {
  if (!cond) {
    failed++
    console.error('FAIL:', msg)
  } else {
    console.log('ok:', msg)
  }
}

assert(isAudioFile({ name: 'beat.mp3', type: 'audio/mpeg' }), 'mp3 by mime')
assert(isAudioFile({ name: 'loop.WAV', type: '' }), 'wav by extension case-insensitive')
assert(isAudioFile({ name: 'vox.m4a' }), 'm4a by extension')
assert(isAudioFile({ name: 'pad.flac' }), 'flac by extension')
assert(isAudioFile({ name: 'hit.aac' }), 'aac by extension')
assert(isAudioFile({ name: 'room.ogg' }), 'ogg by extension')
assert(!isAudioFile({ name: 'notes.txt', type: 'text/plain' }), 'rejects text')
assert(!isAudioFile({ name: 'song.musicalia' }), 'rejects project files')
assert(!isAudioFile({ name: 'cover.png', type: 'image/png' }), 'rejects images')

const mixed = partitionDroppedFiles([
  new File(['x'], 'a.mp3', { type: 'audio/mpeg' }),
  new File(['x'], 'b.png', { type: 'image/png' }),
  new File(['x'], 'c.wav')
])
assert(mixed.audio.length === 2, 'keeps two audio files')
assert(mixed.ignored.length === 1, 'ignores one non-audio')
assert(ignoredAudioToast(0) === null, 'no toast when nothing ignored')
assert(ignoredAudioToast(1) === 'Se ignoró un archivo que no es audio', 'singular Spanish toast')
assert(ignoredAudioToast(3) === 'Se ignoraron 3 archivos que no son audio', 'plural Spanish toast')

const snap = (t: number) => Math.round(t / 0.5) * 0.5
assert(dropTimeOnLane(50, 0, 100, 10, false, snap) === 5, 'mid lane unsapped')
assert(dropTimeOnLane(51, 0, 100, 10, true, snap) === 5, 'mid lane snaps')
assert(dropTimeOnLane(-10, 0, 100, 10, false, snap) === 0, 'clamps left')

const onLane = resolveDropPlacement(1, 2, 8)
assert(onLane.length === 1 && onLane[0].trackIndex === 2 && !onLane[0].createNew, 'single file stays on hovered track')
const elsewhere = resolveDropPlacement(1, null, 8)
assert(elsewhere[0].trackIndex === 8 && elsewhere[0].createNew, 'single file elsewhere makes a new track')
const many = resolveDropPlacement(3, 1, 8)
assert(many.length === 3 && many.every((p) => p.createNew), 'several files each get a new track')
assert(many[0].trackIndex === 8 && many[2].trackIndex === 10, 'new tracks append after current count')
assert(resolveDropPlacement(0, 0, 8).length === 0, 'zero files')

assert(dataTransferHasFiles(['Files', 'text/plain']), 'detects Files type')
assert(!dataTransferHasFiles(['text/plain']), 'ignores non-file drags')

if (failed > 0) {
  console.error(`\n${failed} assertion(s) failed`)
  process.exit(1)
}
console.log('\n✅ audio import unit tests passed')
