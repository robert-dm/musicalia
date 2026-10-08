/**
 * PCM WAV encode/decode and AudioBuffer channel helpers.
 * Never assumes stereo: channel count always comes from the data.
 */

export interface SerializedAudioData {
  left: number[]
  right?: number[]
  sampleRate: number
  numberOfChannels: number
}

export function getAudioBufferChannels(buffer: AudioBuffer): Float32Array[] {
  const channels: Float32Array[] = []
  for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
    channels.push(buffer.getChannelData(ch))
  }
  return channels
}

export function encodeWAV(channelData: Float32Array[], sampleRate: number): Uint8Array {
  if (!channelData.length || !channelData[0]) {
    throw new Error('No hay canales de audio para codificar')
  }

  const numChannels = channelData.length
  const length = channelData[0].length
  const bytesPerSample = 2
  const dataLength = length * numChannels * bytesPerSample
  const buffer = new ArrayBuffer(44 + dataLength)
  const view = new DataView(buffer)

  const writeString = (offset: number, string: string) => {
    for (let i = 0; i < string.length; i++) {
      view.setUint8(offset + i, string.charCodeAt(i))
    }
  }

  writeString(0, 'RIFF')
  view.setUint32(4, 36 + dataLength, true)
  writeString(8, 'WAVE')
  writeString(12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true) // PCM
  view.setUint16(22, numChannels, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * numChannels * bytesPerSample, true)
  view.setUint16(32, numChannels * bytesPerSample, true)
  view.setUint16(34, bytesPerSample * 8, true)
  writeString(36, 'data')
  view.setUint32(40, dataLength, true)

  let offset = 44
  for (let i = 0; i < length; i++) {
    for (let ch = 0; ch < numChannels; ch++) {
      const sample = Math.max(-1, Math.min(1, channelData[ch][i] ?? 0))
      view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7FFF, true)
      offset += 2
    }
  }

  return new Uint8Array(buffer)
}

export function encodeAudioBufferWAV(buffer: AudioBuffer): Uint8Array {
  return encodeWAV(getAudioBufferChannels(buffer), buffer.sampleRate)
}

export function decodeWAV(data: Uint8Array): { channelData: Float32Array[], sampleRate: number } {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
  const numChannels = view.getUint16(22, true)
  const sampleRate = view.getUint32(24, true)
  const dataSize = view.getUint32(40, true)
  const bytesPerSample = 2
  const numSamples = dataSize / (numChannels * bytesPerSample)

  const channelData: Float32Array[] = []
  for (let ch = 0; ch < numChannels; ch++) {
    channelData.push(new Float32Array(numSamples))
  }

  let offset = 44
  for (let i = 0; i < numSamples; i++) {
    for (let ch = 0; ch < numChannels; ch++) {
      const int16 = view.getInt16(offset, true)
      channelData[ch][i] = int16 / (int16 < 0 ? 0x8000 : 0x7FFF)
      offset += 2
    }
  }

  return { channelData, sampleRate }
}

export function serializeAudioBuffer(buffer: AudioBuffer): SerializedAudioData {
  const channels = getAudioBufferChannels(buffer)
  const serialized: SerializedAudioData = {
    left: Array.from(channels[0]),
    sampleRate: buffer.sampleRate,
    numberOfChannels: buffer.numberOfChannels
  }
  if (channels.length > 1) {
    serialized.right = Array.from(channels[1])
  }
  return serialized
}

export function channelsFromSerialized(audioData: {
  left: ArrayLike<number>
  right?: ArrayLike<number>
  numberOfChannels?: number
}): Float32Array[] {
  const left = new Float32Array(audioData.left)
  const hasRight = !!(audioData.right && audioData.right.length > 0)
  const numberOfChannels = audioData.numberOfChannels ?? (hasRight ? 2 : 1)
  const channels: Float32Array[] = [left]
  for (let ch = 1; ch < numberOfChannels; ch++) {
    if (ch === 1 && hasRight) {
      channels.push(new Float32Array(audioData.right as ArrayLike<number>))
    } else {
      channels.push(left)
    }
  }
  return channels
}

export function audioBufferFromSerialized(audioData: {
  left: ArrayLike<number>
  right?: ArrayLike<number>
  sampleRate: number
  numberOfChannels?: number
}): AudioBuffer {
  const channels = channelsFromSerialized(audioData)
  const buffer = new AudioBuffer({
    numberOfChannels: channels.length,
    length: channels[0].length,
    sampleRate: audioData.sampleRate
  })
  for (let ch = 0; ch < channels.length; ch++) {
    buffer.getChannelData(ch).set(channels[ch])
  }
  return buffer
}
