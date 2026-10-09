import {
  buildRegistryEntry,
  formatRegistryDate,
  handleKey,
  hasFileSystemAccess,
  idsMatch,
  newProjectId,
  patchLocationNote,
  readProjectIdFromJson,
  removeRegistryEntry,
  upsertRegistryEntry
} from './projectRegistry'

let failed = 0
function assert(cond: boolean, msg: string) {
  if (!cond) {
    failed++
    console.error('FAIL:', msg)
  } else {
    console.log('ok:', msg)
  }
}

const id = newProjectId()
assert(typeof id === 'string' && id.length > 8, 'newProjectId returns a stable-looking id')
assert(readProjectIdFromJson({ id: 'abc-1' }) === 'abc-1', 'reads id from project.json')
assert(readProjectIdFromJson({ id: '  ' }) === null, 'blank id is missing')
assert(readProjectIdFromJson({ name: 'x' }) === null, 'legacy project.json has no id')
assert(idsMatch('a', 'a'), 'matching ids')
assert(!idsMatch('a', 'b'), 'mismatch warns')
assert(!idsMatch('a', null), 'missing file id is a mismatch')

const first = buildRegistryEntry({
  id: 'p1',
  name: '  Demo  ',
  fileName: 'Demo',
  bpm: 119.4,
  trackCount: 8
})
assert(first.fileName === 'Demo.musicalia', 'adds .musicalia suffix')
assert(first.name === 'Demo', 'trims name')
assert(first.bpm === 119, 'rounds bpm')
assert(first.locationNote === '', 'location note starts empty')

const listed = upsertRegistryEntry([], first)
assert(listed.length === 1 && listed[0].id === 'p1', 'first save inserts')
const again = upsertRegistryEntry(listed, buildRegistryEntry({
  id: 'p1',
  name: 'Demo',
  fileName: 'Demo.musicalia',
  bpm: 128,
  trackCount: 9,
  locationNote: ''
}))
assert(again.length === 1, 're-save does not duplicate')
assert(again[0].bpm === 128 && again[0].trackCount === 9, 're-save updates metadata')

const withNote = patchLocationNote(again, 'p1', '  Disco SSD / Temas  ')
assert(withNote[0].locationNote === 'Disco SSD / Temas', 'ubicación is editable')
const savedAgain = upsertRegistryEntry(withNote, buildRegistryEntry({
  id: 'p1',
  name: 'Demo',
  fileName: 'Demo.musicalia',
  bpm: 90,
  trackCount: 8,
  locationNote: ''
}))
assert(savedAgain[0].locationNote === 'Disco SSD / Temas', 'empty location on save keeps the note')
assert(savedAgain[0].bpm === 90, 'later save still updates bpm')

const two = upsertRegistryEntry(savedAgain, buildRegistryEntry({
  id: 'p2',
  name: 'Otro',
  fileName: 'Otro.musicalia',
  bpm: 100,
  trackCount: 4
}))
assert(two[0].id === 'p2' && two.length === 2, 'new project prepends')
const removed = removeRegistryEntry(two, 'p2')
assert(removed.length === 1 && removed[0].id === 'p1', 'remove drops only the registry entry')

assert(handleKey('p1') === 'handle:p1', 'handle idb key is per project id')
assert(!hasFileSystemAccess({}), 'no picker APIs → fallback')
assert(hasFileSystemAccess({ showSaveFilePicker: () => {}, showOpenFilePicker: () => {} }), 'both pickers → FS Access')

const formatted = formatRegistryDate('2026-10-09T16:00:00.000Z')
assert(formatted !== '—' && formatted.length > 4, 'formats last-saved date')
assert(formatRegistryDate('nope') === '—', 'bad date is em dash')

if (failed > 0) {
  console.error(`\n${failed} assertion(s) failed`)
  process.exit(1)
}
console.log('\n✅ project registry unit tests passed')
