import { clipLabelMode, headerDensity } from './headerDensity'

let failed = 0
function assert(cond: boolean, msg: string) {
  if (!cond) {
    failed++
    console.error('FAIL:', msg)
  } else {
    console.log('ok:', msg)
  }
}

assert(headerDensity(88) === 'tall', 'default 100% lane is tall (two rows)')
assert(headerDensity(70) === 'tall', '70px still keeps the two-row header')
assert(headerDensity(66) === 'medium', '75% vertical zoom collapses to one row')
assert(headerDensity(48) === 'medium', '48px is the last one-row + volume layout')
assert(headerDensity(44) === 'compact', '50% vertical zoom is name / M / S only')
assert(headerDensity(32) === 'compact', 'very small lanes stay compact')

assert(clipLabelMode(88) === 'full', 'tall lanes keep the clip filename')
assert(clipLabelMode(60) === 'compact', 'medium lanes shrink the clip filename')
assert(clipLabelMode(44) === 'hidden', 'compact lanes hide the clip filename')

if (failed > 0) {
  console.error(`\n${failed} assertion(s) failed`)
  process.exit(1)
}
console.log('\n✅ headerDensity tests passed')
