import {
  clampProgress,
  etaFromChunkMs,
  etaSeconds,
  formatElapsed,
  interpolateChunkProgress,
  isMonotonic,
  makeProgressReporter,
  monotonicProgress,
  phaseProgress,
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
assert(phaseProgress('init', 1) === 3, 'init phase ends at 3')
assert(phaseProgress('download', 0) === 3, 'download starts after init')
assert(phaseProgress('infer', 0) === 26 && phaseProgress('infer', 1) === 92, 'infer band is 26–92')
assert(monotonicProgress(40, 12) === 40, 'progress never decreases')
assert(monotonicProgress(40, 55) === 55, 'progress can rise')
assert(isMonotonic([0, 3, 18, 26, 40, 92, 100]), 'typical run is monotonic')
assert(!isMonotonic([20, 40, 12, 50]), 'detects a reset')
assert(typeof etaFromChunkMs(4, 8000) === 'number', 'chunk ETA uses measured time')

const seen: number[] = []
const t0 = Date.now()
const reporter = makeProgressReporter((p) => seen.push(p.progress), t0)
reporter.report({ progress: 24, stage: 'sesión' })
reporter.report({ progress: 3, stage: 'worker restart' })
reporter.report({ progress: 40, stage: 'chunk' })
reporter.stop()
assert(isMonotonic(seen) && seen[seen.length - 1] >= 40, 'reporter swallows worker reset')

if (failed > 0) {
  console.error(`\n${failed} assertion(s) failed`)
  process.exit(1)
}
console.log('\n✅ stem progress unit tests passed')
