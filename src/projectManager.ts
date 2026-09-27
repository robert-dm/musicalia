import { get, set, del } from 'idb-keyval'

interface ProjectState {
  bpm: number
  loopStart: number | null
  loopEnd: number | null
  playheadPosition: number
  tracks: {
    name: string
    mute: boolean
    solo: boolean
    volume: number
    clip: {
      fileName: string
      startPosition: number
      audioData: {
        left: number[]
        right: number[]
        sampleRate: number
      }
    } | null
  }[]
}

let saveTimeout: NodeJS.Timeout | null = null

export async function autosaveProject(state: ProjectState) {
  if (saveTimeout) clearTimeout(saveTimeout)
  
  saveTimeout = setTimeout(async () => {
    try {
      await set('musicalia-project', state)
      console.log('[AUTOSAVE] Saved')
    } catch (err: any) {
      if (err.name === 'QuotaExceededError') {
        alert('Espacio de almacenamiento insuficiente. Guarda el proyecto a un archivo para liberar espacio.')
      }
      console.error('[AUTOSAVE] Failed:', err)
    }
  }, 1000)
}

export async function loadProject(): Promise<ProjectState | null | undefined> {
  try {
    return await get('musicalia-project')
  } catch (err) {
    console.error('[LOAD] Failed:', err)
    return null
  }
}

export async function clearProject() {
  try {
    await del('musicalia-project')
  } catch (err) {
    console.error('[CLEAR] Failed:', err)
  }
}

// --- Internal serialization utilities for future cloud save ---

function encodeWAV(channelData: Float32Array[], sampleRate: number): Uint8Array {
  const numChannels = channelData.length
  const length = channelData[0].length
  const buffer = new ArrayBuffer(44 + length * numChannels * 2)
  const view = new DataView(buffer)
  
  const writeString = (offset: number, string: string) => {
    for (let i = 0; i < string.length; i++) {
      view.setUint8(offset + i, string.charCodeAt(i))
    }
  }
  
  writeString(0, 'RIFF')
  view.setUint32(4, 36 + length * numChannels * 2, true)
  writeString(8, 'WAVE')
  writeString(12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true) // PCM
  view.setUint16(22, numChannels, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * numChannels * 2, true)
  view.setUint16(32, numChannels * 2, true)
  view.setUint16(34, 16, true)
  writeString(36, 'data')
  view.setUint32(40, length * numChannels * 2, true)
  
  let offset = 44
  for (let i = 0; i < length; i++) {
    for (let ch = 0; ch < numChannels; ch++) {
      const sample = Math.max(-1, Math.min(1, channelData[ch][i]))
      view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7FFF, true)
      offset += 2
    }
  }
  
  return new Uint8Array(buffer)
}

function decodeWAV(data: Uint8Array): { channelData: Float32Array[], sampleRate: number } {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
  const numChannels = view.getUint16(22, true)
  const sampleRate = view.getUint32(24, true)
  const dataSize = view.getUint32(40, true)
  const numSamples = dataSize / (numChannels * 2)
  
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

// Serialization utilities exported for future cloud save integration
// These will be used when implementing cloud storage in a later PR
export { encodeWAV, decodeWAV }
export type { ProjectState }
