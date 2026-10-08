import {
  analyzeHarmony,
  chordLabelEs,
  cosine,
  detectChord,
  detectKey,
  hydrateHarmony,
  keyLabelEs,
  noteNameEs,
  rotate12,
  serializeHarmony
} from './harmony'

let failed = 0
function assert(cond: boolean, msg: string) {
  if (!cond) {
    failed++
    console.error('FAIL:', msg)
  } else {
    console.log('ok:', msg)
  }
}

assert(noteNameEs(9) === 'La' && noteNameEs(0) === 'Do', 'Spanish pitch-class names')
assert(keyLabelEs(9, 'minor') === 'La menor', 'La menor')
assert(keyLabelEs(0, 'major') === 'Do mayor', 'Do mayor')
assert(chordLabelEs(9, 'min') === 'La m' && chordLabelEs(0, 'maj') === 'Do', 'chord labels')
assert(rotate12([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11], 2)[0] === 10, 'rotate wraps chroma')
assert(cosine([1, 0, 0], [1, 0, 0]) > 0.99, 'identical vectors')
assert(cosine([1, 0], [0, 1]) < 0.01, 'orthogonal vectors')

const cMajChroma = [1, 0, 0, 0, 1, 0, 0, 1, 0, 0, 0, 0]
const c = detectChord(cMajChroma)
assert(c.tonic === 0 && c.quality === 'maj' && c.label === 'Do', 'C major triad template')
const amChroma = [1, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0]
const am = detectChord(amChroma)
assert(am.tonic === 9 && am.quality === 'min' && am.label === 'La m', 'A minor triad template')

const keyC = detectKey(cMajChroma)
assert(keyC.tonic === 0 && keyC.mode === 'major' && keyC.label === 'Do mayor', 'key from C chroma')
const keyAm = detectKey(amChroma)
assert(keyAm.tonic === 9 && keyAm.mode === 'minor', 'key from Am chroma')

class FakeBuffer {
  numberOfChannels = 1
  length: number
  sampleRate = 11025
  private data: Float32Array
  constructor(seconds: number, freqs: number[]) {
    this.length = Math.floor(this.sampleRate * seconds)
    this.data = new Float32Array(this.length)
    for (let i = 0; i < this.length; i++) {
      const t = i / this.sampleRate
      let s = 0
      for (const f of freqs) s += Math.sin(2 * Math.PI * f * t)
      this.data[i] = s / freqs.length
    }
  }
  getChannelData(): Float32Array {
    return this.data
  }
}

const cBuf = new FakeBuffer(2.4, [261.63, 329.63, 392.0])
const analyzed = analyzeHarmony([
  { buffer: cBuf, offsetSeconds: 0, sourceStart: 0, duration: 2.4 }
], 'mix')
assert(!!analyzed, 'analyzes a synthetic triad')
assert(analyzed!.key.tonic === 0 && analyzed!.key.mode === 'major', 'synthetic C major → Do mayor')
assert(analyzed!.chords.length >= 1 && analyzed!.chords[0].tonic === 0, 'labels a C chord on the timeline')

const json = serializeHarmony(analyzed)
const loaded = hydrateHarmony(JSON.parse(JSON.stringify(json)))
assert(loaded?.key.label === analyzed!.key.label && loaded?.chords.length === analyzed!.chords.length, 'harmony roundtrips JSON')
assert(hydrateHarmony(undefined) === null, 'legacy projects have no harmony')

if (failed > 0) {
  console.error(`\n${failed} assertion(s) failed`)
  process.exit(1)
}
console.log('\n✅ harmony unit tests passed')
