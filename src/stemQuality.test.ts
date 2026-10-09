import {
  DEFAULT_STEM_QUALITY,
  STEM_QUALITY_OPTIONS,
  isStemQuality,
  stemQualityOption,
} from './stemQuality'

let failed = 0
function assert(cond: boolean, msg: string) {
  if (!cond) {
    failed++
    console.error('FAIL:', msg)
  } else {
    console.log('ok:', msg)
  }
}

assert(DEFAULT_STEM_QUALITY === 'spleeter', 'default quality is Spleeter')
assert(STEM_QUALITY_OPTIONS[0].id === 'spleeter', 'first option is básica')
assert(STEM_QUALITY_OPTIONS.some((o) => o.id === 'demucs'), 'includes Demucs quality')
assert(STEM_QUALITY_OPTIONS.length === 2, 'two quality options')
assert(isStemQuality('spleeter') && isStemQuality('demucs'), 'accepts known qualities')
assert(!isStemQuality('other'), 'rejects unknown quality')
assert(stemQualityOption('demucs').label.includes('calidad'), 'Demucs label mentions calidad')
assert(STEM_QUALITY_OPTIONS[0].blurb.toLowerCase().includes('spleeter'), 'basic blurb names Spleeter')
assert(STEM_QUALITY_OPTIONS[1].blurb.toLowerCase().includes('6'), 'quality blurb mentions 6 stems')

if (failed > 0) {
  console.error(`\n${failed} assertion(s) failed`)
  process.exit(1)
}
console.log('\n✅ stem quality unit tests passed')
