import {
  UNTITLED_PROJECT_NAME,
  baseNameFromMusicalia,
  commitProjectName,
  displayProjectName,
  isUntitledProjectName,
  projectTabTitle,
  suggestedMusicaliaFileName
} from './projectTitle'

let failed = 0
function assert(cond: boolean, msg: string) {
  if (!cond) {
    failed++
    console.error('FAIL:', msg)
  } else {
    console.log('ok:', msg)
  }
}

assert(isUntitledProjectName(''), 'empty is untitled')
assert(isUntitledProjectName('Sin título'), 'Sin título is untitled')
assert(isUntitledProjectName('Proyecto sin título'), 'legacy untitled is untitled')
assert(!isUntitledProjectName('Demo'), 'a real name is not untitled')

assert(baseNameFromMusicalia('Tema.musicalia') === 'Tema', 'strips .musicalia')
assert(baseNameFromMusicalia('  Mix Final.MUSICALIA  ') === 'Mix Final', 'strips suffix case-insensitively')
assert(baseNameFromMusicalia('') === null, 'blank file name is missing')

assert(displayProjectName('  Demo  ') === 'Demo', 'uses the project name')
assert(displayProjectName('Sin título', 'Tema.musicalia') === 'Tema', 'untitled falls back to the file basename')
assert(displayProjectName('Proyecto sin título', 'live.musicalia') === 'live', 'legacy untitled also falls back to the file')
assert(displayProjectName('', null) === UNTITLED_PROJECT_NAME, 'new project is Sin título')
assert(displayProjectName('Sin título') === UNTITLED_PROJECT_NAME, 'stays Sin título without a file')

assert(projectTabTitle('Demo', false) === 'Demo — Musicalia', 'clean tab title')
assert(projectTabTitle('Demo', true) === '• Demo — Musicalia', 'dirty tab title prefixes a dot')
assert(projectTabTitle('', false) === 'Sin título — Musicalia', 'empty display still names the tab')

assert(commitProjectName('  Noche  ', 'Demo') === 'Noche', 'rename trims')
assert(commitProjectName('   ', 'Demo') === 'Demo', 'empty rename keeps the previous name')
assert(commitProjectName('', '') === UNTITLED_PROJECT_NAME, 'empty previous falls back to Sin título')

assert(suggestedMusicaliaFileName('Tema demo') === 'Tema demo.musicalia', 'default save file follows the project name')
assert(suggestedMusicaliaFileName('a/b:c') === 'a_b_c.musicalia', 'strips illegal filename characters')

if (failed > 0) {
  console.error(`\n${failed} assertion(s) failed`)
  process.exit(1)
}
console.log('\n✅ project title unit tests passed')
