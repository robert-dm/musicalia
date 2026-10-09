import { get, set, del } from 'idb-keyval'
import { encodeWAV, decodeWAV } from './wav'

interface ProjectState {
  id?: string
  name?: string
  bpm: number
  loopStart: number | null
  loopEnd: number | null
  playheadPosition: number
  metronomeEnabled?: boolean
  isLoopEnabled?: boolean
  tracks: {
    name: string
    mute: boolean
    solo: boolean
    volume: number
    clip?: {
      fileName: string
      startPosition: number
      audioBufferKey: string
      offsetSeconds?: number
      id?: string
    } | null
    clips?: {
      fileName: string
      startPosition: number
      audioBufferKey: string
      offsetSeconds: number
      id: string
    }[]
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
        console.warn('[AUTOSAVE] QuotaExceeded - proyecto muy grande')
      } else {
        console.error('[AUTOSAVE] Failed:', err)
      }
    }
  }, 1000)
}

export async function saveAudioBuffer(key: string, buffer: AudioBuffer): Promise<void> {
  const numberOfChannels = buffer.numberOfChannels
  const length = buffer.length
  const sampleRate = buffer.sampleRate
  
  const channelData: Float32Array[] = []
  for (let i = 0; i < numberOfChannels; i++) {
    channelData.push(buffer.getChannelData(i))
  }
  
  const audioData = {
    numberOfChannels,
    length,
    sampleRate,
    channelData
  }
  
  await set(key, audioData)
}

export async function loadAudioBuffer(key: string): Promise<AudioBuffer | null> {
  try {
    const data = await get(key)
    if (!data) return null
    
    const buffer = new AudioBuffer({
      numberOfChannels: data.numberOfChannels,
      length: data.length,
      sampleRate: data.sampleRate
    })
    
    for (let i = 0; i < data.numberOfChannels; i++) {
      buffer.getChannelData(i).set(data.channelData[i])
    }
    
    return buffer
  } catch (err) {
    console.error('[LOAD] Failed to load audio buffer:', err)
    return null
  }
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

export { encodeWAV, decodeWAV }
export type { ProjectState }
