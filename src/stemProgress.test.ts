import {
  clampProgress,
  etaSeconds,
  formatElapsed,
  interpolateChunkProgress,
} from './stemProgress'
import { downloadFraction } from './modelDownload'

let failed = 0
function assert(cond: boolean, msg: string) {
  if (!cond) {
    failed++
    console.error('FAIL:', msg)
  } else {
    console.log('ok:', msg)
  }
}

assert(clampProgress(-4) === 0 && clampProgress(140) === 100, 'progress clamped')
assert(formatElapsed(9) === '9 s', 'seconds only')
assert(formatElapsed(75) === '1 min 15 s', 'minutes and seconds')
assert(etaSeconds(1000, 50) === undefined, 'no ETA until enough elapsed')
assert(typeof etaSeconds(4000, 20) === 'number' && (etaSeconds(4000, 20) as number) > 0, 'ETA after progress')
assert(downloadFraction(50, 100) === 0.5, 'download fraction')
assert(downloadFraction(10, 0) === 0.5, 'unknown total is halfway if bytes arrived')

const mid = interpolateChunkProgress(1, 4, 5000, 10000, 0, 100)
assert(mid > 25 && mid < 50, 'chunk progress sits inside its slice')
const capped = interpolateChunkProgress(0, 1, 999999, 1000, 0, 100)
assert(capped <= 92, 'in-flight chunk does not jump to 100%')

if (failed > 0) {
  console.error(`\n${failed} assertion(s) failed`)
  process.exit(1)
}
console.log('\n✅ stem progress unit tests passed')
