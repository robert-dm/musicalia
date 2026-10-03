import { unzip } from 'fflate'

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
  
  onProgress?.(5)
  
  const audioFiles: Array<{ index: number, wavData: Uint8Array }> = []
  
  for (let i = 0; i < projectData.tracks.length; i++) {
    const track = projectData.tracks[i]
    if (track.clip?.audioData) {
      const left = new Float32Array(track.clip.audioData.left)
      const right = new Float32Array(track.clip.audioData.right)
      const wavData = await compressAudio(left, right, track.clip.audioData.sampleRate)
      audioFiles.push({ index: i, wavData })
      onProgress?.(5 + (i / projectData.tracks.length) * 40)
    }
  }
  
  onProgress?.(45)
  
  const uploadedAudioFiles: Record<number, string> = {}
  for (let i = 0; i < audioFiles.length; i++) {
    const { index, wavData } = audioFiles[i]
    const fileName = `audio_${index}.wav`
    
    const blob = new Blob([wavData.buffer as ArrayBuffer], { type: 'audio/wav' })
    
    const response = await fetch('/api/upload-audio', {
      method: 'POST',
      headers: {
        'x-musicalia-key': musicaliaKey,
        'x-project-name': encodeURIComponent(projectName),
        'x-file-name': fileName
      },
      body: blob
    })
    
    if (!response.ok) {
      let errorMessage = 'Error al subir audio'
      
      const contentType = response.headers.get('content-type')
      if (contentType?.includes('application/json')) {
        try {
          const error = await response.json()
          errorMessage = error.error || errorMessage
        } catch {
          errorMessage = 'Error al subir audio'
        }
      } else {
        if (response.status === 413) {
          errorMessage = 'Archivo de audio demasiado grande'
        } else {
          const text = await response.text().catch(() => '')
          errorMessage = text || `Error ${response.status}`
        }
      }
      
      throw new Error(errorMessage)
    }
    
    await response.json()
    uploadedAudioFiles[index] = fileName
    
    onProgress?.(45 + ((i + 1) / audioFiles.length) * 40)
  }
  
  onProgress?.(85)
  
  const metadataOnly = {
    ...projectData,
    tracks: projectData.tracks.map((t: any, i: number) => ({
      name: t.name,
      mute: t.mute,
      solo: t.solo,
      volume: t.volume,
      clip: t.clip ? {
        fileName: t.clip.fileName,
        startPosition: t.clip.startPosition,
        audioFile: uploadedAudioFiles[i] || null
      } : null
    }))
  }
  
  const metadataBlob = new Blob(
    [JSON.stringify(metadataOnly, null, 2)], 
    { type: 'application/json' }
  )
  
  const metadataResponse = await fetch('/api/upload-audio', {
    method: 'POST',
    headers: {
      'x-musicalia-key': musicaliaKey,
      'x-project-name': encodeURIComponent(projectName),
      'x-file-name': 'project.json'
    },
    body: metadataBlob
  })
  
  onProgress?.(95)
  
  if (!metadataResponse.ok) {
    let errorMessage = 'Error al guardar proyecto'
    
    const contentType = metadataResponse.headers.get('content-type')
    if (contentType?.includes('application/json')) {
      try {
        const error = await metadataResponse.json()
        errorMessage = error.error || errorMessage
      } catch {
        errorMessage = 'Error al guardar proyecto'
      }
    } else {
      const text = await metadataResponse.text().catch(() => '')
      errorMessage = text || `Error ${metadataResponse.status}`
    }
    
    throw new Error(errorMessage)
  }
  
  onProgress?.(100)
}

export async function listCloudProjects(): Promise<ProjectMetadata[]> {
  if (!musicaliaKey) throw new Error('Clave de Musicalia no configurada')
  
  const response = await fetch('/api/list', {
    headers: { 'x-musicalia-key': musicaliaKey }
  })
  
  if (!response.ok) {
    let errorMessage = 'Error al listar proyectos'
    const contentType = response.headers.get('content-type')
    if (contentType?.includes('application/json')) {
      try {
        const error = await response.json()
        errorMessage = error.error || errorMessage
      } catch {
        errorMessage = 'Error al listar proyectos'
      }
    }
    throw new Error(errorMessage)
  }
  
  return response.json()
}

export async function openProjectFromCloud(pathname: string): Promise<any> {
  if (!musicaliaKey) throw new Error('Clave de Musicalia no configurada')
  
  const metadataResponse = await fetch(`/api/download?path=${encodeURIComponent(`${pathname}/project.json`)}`, {
    headers: { 'x-musicalia-key': musicaliaKey }
  })
  
  if (!metadataResponse.ok) {
    const oldFormatResponse = await fetch(`/api/download?path=${encodeURIComponent(`${pathname}.musicalia`)}`, {
      headers: { 'x-musicalia-key': musicaliaKey }
    })
    
    if (!oldFormatResponse.ok) {
      throw new Error('Error al abrir proyecto')
    }
    
    const buffer = await oldFormatResponse.arrayBuffer()
    
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
  
  const projectJson = await metadataResponse.json()
  
  const tracks = await Promise.all(projectJson.tracks.map(async (t: any) => {
    if (!t.clip || !t.clip.audioFile) return { ...t, clip: null }
    
    const audioResponse = await fetch(`/api/download?path=${encodeURIComponent(`${pathname}/${t.clip.audioFile}`)}`, {
      headers: { 'x-musicalia-key': musicaliaKey! }
    })
    
    if (!audioResponse.ok) {
      console.error('Failed to load audio for track:', t.name)
      return { ...t, clip: null }
    }
    
    const audioBuffer = await new AudioContext().decodeAudioData(await audioResponse.arrayBuffer())
    
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
  
  return {
    bpm: projectJson.bpm,
    loopStart: projectJson.loopStart,
    loopEnd: projectJson.loopEnd,
    playheadPosition: projectJson.playheadPosition,
    tracks
  }
}

export async function deleteProjectFromCloud(pathname: string): Promise<void> {
  if (!musicaliaKey) throw new Error('Clave de Musicalia no configurada')
  
  const response = await fetch('/api/delete-folder', {
    method: 'DELETE',
    headers: {
      'x-musicalia-key': musicaliaKey,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ pathname })
  })
  
  if (!response.ok) {
    let errorMessage = 'Error al eliminar proyecto'
    const contentType = response.headers.get('content-type')
    if (contentType?.includes('application/json')) {
      try {
        const error = await response.json()
        errorMessage = error.error || errorMessage
      } catch {
        errorMessage = 'Error al eliminar proyecto'
      }
    }
    throw new Error(errorMessage)
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
