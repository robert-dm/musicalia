import {
  armedIndexAfterDelete,
  compensatedRecordOffset,
  micConstraints,
  micErrorMessage,
  nativeAudioContext,
  nextGrabacionName,
  nextGrabacionNumber,
  pcmChunksToAudioBuffer,
  recordLatencySeconds,
  resolveRecordTrack
} from './audioRecord'

let failed = 0
function assert(cond: boolean, msg: string) {
  if (!cond) {
    failed++
    console.error('FAIL:', msg)
  } else {
    console.log('ok:', msg)
  }
}

assert(nextGrabacionNumber([], 0) === 1, 'first grabación is 1')
assert(nextGrabacionName(['Pista 1'], 1) === 'Grabación 1', 'ignores Pista names')
assert(nextGrabacionName(['Grabación 1', 'Grabacion 3'], 2) === 'Grabación 4', 'uses highest Grabación N')
assert(nextGrabacionName(['grabación 2'], 1) === 'Grabación 3', 'accent-insensitive')

assert(resolveRecordTrack(2, 0, 8).trackIndex === 2 && !resolveRecordTrack(2, 0, 8).createNew, 'armed track wins')
assert(resolveRecordTrack(null, 4, 8).trackIndex === 4 && !resolveRecordTrack(null, 4, 8).createNew, 'falls back to selected')
assert(resolveRecordTrack(null, null, 8).createNew && resolveRecordTrack(null, null, 8).trackIndex === 8, 'else new track')
assert(resolveRecordTrack(99, 1, 8).trackIndex === 1, 'invalid armed falls back to selected')
assert(armedIndexAfterDelete(null, 0) === null, 'no arm stays empty')
assert(armedIndexAfterDelete(2, 2) === null, 'deleting armed track clears arm')
assert(armedIndexAfterDelete(3, 1) === 2, 'arm index shifts after a track above is removed')
assert(armedIndexAfterDelete(1, 3) === 1, 'arm below the deleted track stays')

assert(recordLatencySeconds({}) === 0, 'missing latency is 0')
assert(Math.abs(recordLatencySeconds({ baseLatency: 0.01, outputLatency: 0.02 }) - 0.03) < 1e-9, 'sums latencies')
assert(compensatedRecordOffset(1.2, 0.03) === 1.17, 'shifts clip earlier by latency')
assert(compensatedRecordOffset(0.01, 0.05) === 0, 'does not go below 0')

const denied = new Error('denied')
denied.name = 'NotAllowedError'
assert(micErrorMessage(denied) === 'Permiso de micrófono denegado', 'denied toast')
const missing = new Error('missing')
missing.name = 'NotFoundError'
assert(micErrorMessage(missing) === 'No se encontró un micrófono', 'no device toast')
assert(micErrorMessage(new Error('x')) === 'No se pudo acceder al micrófono', 'generic toast')

const constraints = micConstraints('abc')
const audio = constraints.audio as MediaTrackConstraints
assert(audio.echoCancellation === false && audio.noiseSuppression === false && audio.autoGainControl === false, 'music mic constraints')
assert((audio.deviceId as ConstrainDOMStringParameters).exact === 'abc', 'pins stored device')

function fakeCtx(sampleRate = 48000) {
  return {
    sampleRate,
    createBuffer(channels: number, length: number, sr: number) {
      const chans = Array.from({ length: channels }, () => new Float32Array(length))
      return {
        numberOfChannels: channels,
        length,
        sampleRate: sr,
        duration: length / sr,
        getChannelData: (i: number) => chans[i]
      } as AudioBuffer
    }
  }
}

const merged = pcmChunksToAudioBuffer(fakeCtx(), [
  [new Float32Array([0.1, 0.2]), new Float32Array([0.3, 0.4])],
  [new Float32Array([0.5]), new Float32Array([0.6])]
], 48000)
assert(merged.numberOfChannels === 2, 'keeps stereo')
assert(merged.length === 3, 'concatenates frames')
assert(
  Math.abs(merged.getChannelData(0)[2] - 0.5) < 1e-6 &&
    Math.abs(merged.getChannelData(1)[1] - 0.4) < 1e-6,
  'interleaves channels in order'
)

const empty = pcmChunksToAudioBuffer(fakeCtx(), [], 44100)
assert(empty.length === 1 && empty.numberOfChannels === 1, 'empty capture still yields a buffer')

const native = { createScriptProcessor() {}, createMediaStreamSource() {} }
assert(nativeAudioContext(native) === (native as unknown as AudioContext), 'uses a context that already has capture APIs')
assert(
  nativeAudioContext({ _nativeContext: native, rawContext: {} }) === (native as unknown as AudioContext),
  'unwraps Tone/standardized-audio-context'
)

if (failed > 0) {
  console.error(`\n${failed} assertion(s) failed`)
  process.exit(1)
}
console.log('\n✅ audio record unit tests passed')
