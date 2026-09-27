import { zip, unzip } from 'fflate'

export interface ProjectMetadata {
  name: string
  pathname: string
  size: number
  uploadedAt: string
}

let musicaliaKey: string | null = localStorage.getItem('musicalia_key')

export function setMusicaliKey(key: string) {
  musicaliaKey = key
  localStorage.setItem('musicalia_key', key)
}

export function getMusicaliKey(): string | null {
  return musicaliaKey
}

export function hasMusicaliKey(): boolean {
  return !!musicaliaKey
}

async function compressAudio(left: Float32Array, right: Float32Array, sampleRate: number): Promise<Uint8Array> {
  // Try WebCodecs Opus
  if ('AudioEncoder' in window && 'AudioData' in window) {
    try {
      const config = {
        codec: 'opus',
        sampleRate,
        numberOfChannels: 2,
        bitrate: 96000
      }
      
      const supported = await (window as any).AudioEncoder.isConfigSupported(config)
      if (supported.supported) {
        // WebCodecs Opus encoding would go here
        // For now, fallback to WAV
      }
    } catch (e) {
      console.warn('WebCodecs not available:', e)
    }
  }
  
  // Fallback: 16-bit WAV
  return encodeWAV([left, right], sampleRate)
}

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
  view.setUint16(20, 1, true)
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

export async function saveProjectToCloud(
  projectData: any,
  projectName: string,
  onProgress?: (progress: number) => void
): Promise<void> {
  if (!musicaliaKey) throw new Error('Clave de Musicalia no configurada')
  
  onProgress?.(10)
  
  const files: Record<string, Uint8Array> = {
    'project.json': new TextEncoder().encode(JSON.stringify(projectData, null, 2))
  }
  
  for (let i = 0; i < projectData.tracks.length; i++) {
    const track = projectData.tracks[i]
    if (track.clip) {
      const left = new Float32Array(track.clip.audioData.left)
      const right = new Float32Array(track.clip.audioData.right)
      files[`audio_${i}.wav`] = await compressAudio(left, right, track.clip.audioData.sampleRate)
      onProgress?.(10 + (i / projectData.tracks.length) * 40)
    }
  }
  
  onProgress?.(50)
  
  const zipped = await new Promise<Uint8Array>((resolve, reject) => {
    zip(files, { level: 6 }, (err: Error | null, data: Uint8Array) => {
      if (err) reject(err)
      else resolve(data)
    })
  })
  
  onProgress?.(70)
  
  const blob = new Blob([zipped as any], { type: 'application/octet-stream' })
  
  const response = await fetch('/api/upload', {
    method: 'POST',
    headers: {
      'x-musicalia-key': musicaliaKey,
      'x-project-name': encodeURIComponent(projectName)
    },
    body: blob
  })
  
  onProgress?.(90)
  
  if (!response.ok) {
    const error = await response.json()
    throw new Error(error.error || 'Error al guardar proyecto')
  }
  
  onProgress?.(100)
}

export async function listCloudProjects(): Promise<ProjectMetadata[]> {
  if (!musicaliaKey) throw new Error('Clave de Musicalia no configurada')
  
  const response = await fetch('/api/list', {
    headers: { 'x-musicalia-key': musicaliaKey }
  })
  
  if (!response.ok) {
    const error = await response.json()
    throw new Error(error.error || 'Error al listar proyectos')
  }
  
  return response.json()
}

export async function openProjectFromCloud(pathname: string): Promise<any> {
  if (!musicaliaKey) throw new Error('Clave de Musicalia no configurada')
  
  const response = await fetch(`/api/download?path=${encodeURIComponent(pathname)}`, {
    headers: { 'x-musicalia-key': musicaliaKey }
  })
  
  if (!response.ok) {
    throw new Error('Error al abrir proyecto')
  }
  
  const buffer = await response.arrayBuffer()
  
  return new Promise((resolve, reject) => {
    unzip(new Uint8Array(buffer), async (err: Error | null, unzipped: any) => {
      if (err) return reject(err)
      
      const projectJson = JSON.parse(new TextDecoder().decode(unzipped['project.json']))
      
      const tracks = await Promise.all(projectJson.tracks.map(async (t: any) => {
        if (!t.clip) return { ...t, clip: null }
        
        const audioData = unzipped[t.clip.audioFile]
        const audioBuffer = await new AudioContext().decodeAudioData(
          audioData.buffer.slice(audioData.byteOffset, audioData.byteOffset + audioData.byteLength)
        )
        
        return {
          name: t.name,
          mute: t.mute,
          solo: t.solo,
          volume: t.volume,
          clip: {
            fileName: t.clip.fileName,
            startPosition: t.clip.startPosition,
            audioData: {
              left: Array.from(audioBuffer.getChannelData(0)),
              right: Array.from(audioBuffer.getChannelData(1)),
              sampleRate: audioBuffer.sampleRate
            }
          }
        }
      }))
      
      resolve({
        bpm: projectJson.bpm,
        loopStart: projectJson.loopStart,
        loopEnd: projectJson.loopEnd,
        playheadPosition: projectJson.playheadPosition,
        tracks
      })
    })
  })
}

export async function deleteProjectFromCloud(pathname: string): Promise<void> {
  if (!musicaliaKey) throw new Error('Clave de Musicalia no configurada')
  
  const response = await fetch('/api/delete', {
    method: 'DELETE',
    headers: {
      'x-musicalia-key': musicaliaKey,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ pathname })
  })
  
  if (!response.ok) {
    const error = await response.json()
    throw new Error(error.error || 'Error al eliminar proyecto')
  }
}

export async function getStorageUsage(): Promise<number> {
  if (!musicaliaKey) return 0
  
  try {
    const projects = await listCloudProjects()
    return projects.reduce((sum, p) => sum + p.size, 0)
  } catch {
    return 0
  }
}
