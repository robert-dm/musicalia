import { unzip } from 'fflate'
import { uploadPresigned } from '@vercel/blob/client'

export interface ProjectMetadata {
  name: string
  pathname: string
  size: number
  uploadedAt: string
}

export interface User {
  id: string
  username: string
  email: string
}

let authToken: string | null = localStorage.getItem('musicalia_auth_token')
let currentUser: User | null = null

export function setAuthToken(token: string) {
  authToken = token
  localStorage.setItem('musicalia_auth_token', token)
}

export function getAuthToken(): string | null {
  return authToken
}

export function clearAuth() {
  authToken = null
  currentUser = null
  localStorage.removeItem('musicalia_auth_token')
}

export function hasAuth(): boolean {
  return !!authToken
}

export function setCurrentUser(user: User) {
  currentUser = user
}

export function getCurrentUser(): User | null {
  return currentUser
}

export async function register(username: string, email: string, password: string): Promise<{ token: string, user: User }> {
  const response = await fetch('/api/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, email, password })
  })

  if (!response.ok) {
    const error = await response.json()
    throw new Error(error.error || 'Error al registrar usuario')
  }

  const data = await response.json()
  setAuthToken(data.token)
  setCurrentUser(data.user)
  return data
}

export async function login(email: string, password: string): Promise<{ token: string, user: User }> {
  const response = await fetch('/api/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password })
  })

  if (!response.ok) {
    const error = await response.json()
    throw new Error(error.error || 'Error al iniciar sesión')
  }

  const data = await response.json()
  setAuthToken(data.token)
  setCurrentUser(data.user)
  return data
}

export async function verifyAuth(): Promise<User | null> {
  if (!authToken) return null

  try {
    const response = await fetch('/api/me', {
      headers: { 'Authorization': `Bearer ${authToken}` }
    })

    if (!response.ok) {
      clearAuth()
      return null
    }

    const data = await response.json()
    setCurrentUser(data.user)
    return data.user
  } catch (error) {
    clearAuth()
    return null
  }
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

async function probeUploadEndpoint(fileName: string, projectName: string, userId: string): Promise<void> {
  if (!authToken) throw new Error('No autenticado')
  
  const fullPathname = `musicalia-projects/${userId}/${projectName}/${fileName}`
  const probePayload = {
    type: 'blob.generate-presigned-url',
    payload: {
      pathname: fullPathname,
      clientPayload: JSON.stringify({ 
        token: authToken,
        projectName 
      }),
      multipart: false
    }
  }
  
  const probeResponse = await fetch('/api/handle-upload', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(probePayload)
  })
  
  if (!probeResponse.ok) {
    let errorMessage = 'Error al preparar subida'
    try {
      const errorData = await probeResponse.json()
      if (errorData.error) {
        errorMessage = errorData.error
      }
    } catch (e) {
      console.error('Failed to parse error response:', e)
    }
    throw new Error(errorMessage)
  }
}

export async function saveProjectToCloud(
  projectData: any,
  projectName: string,
  onProgress?: (progress: number) => void
): Promise<void> {
  if (!authToken) throw new Error('Debe iniciar sesión para guardar')
  if (!currentUser) throw new Error('Usuario no encontrado')
  
  onProgress?.(5)
  
  const audioFiles: Array<{ trackIndex: number, clipIndex: number, wavData: Uint8Array }> = []
  
  for (let i = 0; i < projectData.tracks.length; i++) {
    const track = projectData.tracks[i]
    
    if (track.clips && Array.isArray(track.clips)) {
      for (let clipIdx = 0; clipIdx < track.clips.length; clipIdx++) {
        const clip = track.clips[clipIdx]
        if (clip.audioData) {
          const left = new Float32Array(clip.audioData.left)
          const right = new Float32Array(clip.audioData.right)
          const wavData = await compressAudio(left, right, clip.audioData.sampleRate)
          audioFiles.push({ trackIndex: i, clipIndex: clipIdx, wavData })
        }
      }
    } else if (track.clip?.audioData) {
      const left = new Float32Array(track.clip.audioData.left)
      const right = new Float32Array(track.clip.audioData.right)
      const wavData = await compressAudio(left, right, track.clip.audioData.sampleRate)
      audioFiles.push({ trackIndex: i, clipIndex: 0, wavData })
    }
    
    onProgress?.(5 + ((i + 1) / projectData.tracks.length) * 40)
  }
  
  onProgress?.(45)
  
  const uploadedAudioFiles: Record<string, string> = {}
  for (let i = 0; i < audioFiles.length; i++) {
    const { trackIndex, clipIndex, wavData } = audioFiles[i]
    const fileName = `audio_${trackIndex}_${clipIndex}.wav`
    
    try {
      await probeUploadEndpoint(fileName, projectName, currentUser.id)
      
      const blob = new Blob([wavData.buffer as ArrayBuffer], { type: 'audio/wav' })
      const file = new File([blob], fileName, { type: 'audio/wav' })
      
      const fullPathname = `musicalia-projects/${currentUser.id}/${projectName}/${fileName}`
      await uploadPresigned(fullPathname, file, {
        access: 'public',
        handleUploadUrl: '/api/handle-upload',
        clientPayload: JSON.stringify({ 
          token: authToken,
          projectName 
        })
      })
      
      uploadedAudioFiles[`${trackIndex}_${clipIndex}`] = fileName
      onProgress?.(45 + ((i + 1) / audioFiles.length) * 40)
    } catch (err: any) {
      console.error('Upload error:', err)
      throw new Error(err.message || 'Error al subir audio')
    }
  }
  
  onProgress?.(85)
  
  const metadataOnly = {
    ...projectData,
    tracks: projectData.tracks.map((t: any, i: number) => {
      if (t.clips && Array.isArray(t.clips)) {
        return {
          name: t.name,
          mute: t.mute,
          solo: t.solo,
          volume: t.volume,
          clips: t.clips.map((clip: any, clipIdx: number) => ({
            fileName: clip.fileName,
            startPosition: clip.startPosition,
            offsetSeconds: clip.offsetSeconds,
            id: clip.id,
            audioFile: uploadedAudioFiles[`${i}_${clipIdx}`] || null
          }))
        }
      } else {
        return {
          name: t.name,
          mute: t.mute,
          solo: t.solo,
          volume: t.volume,
          clip: t.clip ? {
            fileName: t.clip.fileName,
            startPosition: t.clip.startPosition,
            audioFile: uploadedAudioFiles[`${i}_0`] || null
          } : null
        }
      }
    })
  }
  
  try {
    await probeUploadEndpoint('project.json', projectName, currentUser.id)
    
    const metadataJson = JSON.stringify(metadataOnly, null, 2)
    const metadataBlob = new Blob([metadataJson], { type: 'application/json' })
    const metadataFile = new File([metadataBlob], 'project.json', { type: 'application/json' })
    
    const fullPathname = `musicalia-projects/${currentUser.id}/${projectName}/project.json`
    await uploadPresigned(fullPathname, metadataFile, {
      access: 'public',
      handleUploadUrl: '/api/handle-upload',
      clientPayload: JSON.stringify({ 
        token: authToken,
        projectName 
      })
    })
    
    onProgress?.(100)
  } catch (err: any) {
    console.error('Metadata upload error:', err)
    throw new Error(err.message || 'Error al guardar proyecto')
  }
}

export async function listCloudProjects(): Promise<ProjectMetadata[]> {
  if (!authToken) throw new Error('Debe iniciar sesión')
  
  const response = await fetch('/api/list', {
    headers: { 'Authorization': `Bearer ${authToken}` }
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
  if (!authToken) throw new Error('Debe iniciar sesión')
  
  // First check for legacy .musicalia format
  if (pathname.endsWith('.musicalia')) {
    const metadataResponse = await fetch(`/api/download?path=${encodeURIComponent(pathname)}`, {
      headers: { 'Authorization': `Bearer ${authToken}` }
    })
    
    if (!metadataResponse.ok) {
      throw new Error('El proyecto no existe en la nube')
    }
    
    const buffer = await metadataResponse.arrayBuffer()
    
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
  
  // For folder-based projects, list blobs with the project prefix
  const listResponse = await fetch(`/api/list-project-blobs?prefix=${encodeURIComponent(pathname)}`, {
    headers: { 'Authorization': `Bearer ${authToken}` }
  })
  
  if (!listResponse.ok) {
    // Surface the actual API error instead of swallowing it
    const contentType = listResponse.headers.get('content-type')
    if (contentType?.includes('application/json')) {
      try {
        const errorData = await listResponse.json()
        throw new Error(errorData.error || 'Error al buscar archivos del proyecto')
      } catch (e) {
        if (e instanceof Error && e.message !== 'Error al buscar archivos del proyecto') {
          throw e
        }
      }
    }
    throw new Error('Error al buscar archivos del proyecto')
  }
  
  const blobs = await listResponse.json()
  
  // Find the project.json blob (may have suffix like project-abc.json)
  const projectJsonBlob = blobs.find((b: any) => 
    b.pathname.endsWith('/project.json') || b.pathname.match(/\/project[^/]*\.json$/)
  )
  
  if (!projectJsonBlob) {
    if (blobs.length > 0) {
      // Project folder exists but no project.json
      console.error('No project.json found. Blobs:', blobs.map((b: any) => b.pathname))
      throw new Error('Proyecto encontrado pero sin project.json. Puede estar corrupto.')
    }
    throw new Error('El proyecto no existe en la nube')
  }
  
  // Download project.json using its exact pathname from list()
  const metadataResponse = await fetch(`/api/download?path=${encodeURIComponent(projectJsonBlob.pathname)}`, {
    headers: { 'Authorization': `Bearer ${authToken}` }
  })
  
  if (!metadataResponse.ok) {
    // Surface the real API error from download endpoint
    const contentType = metadataResponse.headers.get('content-type')
    if (contentType?.includes('application/json')) {
      try {
        const errorData = await metadataResponse.json()
        throw new Error(errorData.error || 'Error al descargar project.json')
      } catch (e) {
        if (e instanceof Error && e.message !== 'Error al descargar project.json') {
          throw e
        }
      }
    }
    throw new Error('Error al descargar project.json')
  }
  
  const projectJson = await metadataResponse.json()
  
  const tracks = await Promise.all(projectJson.tracks.map(async (t: any) => {
    if (t.clips && Array.isArray(t.clips)) {
      const loadedClips = await Promise.all(t.clips.map(async (clip: any) => {
        if (!clip.audioFile) return null
        
        const audioBlob = blobs.find((b: any) => 
          b.pathname.endsWith(`/${clip.audioFile}`) || b.pathname.endsWith(clip.audioFile)
        )
        
        if (!audioBlob) {
          console.error(`Audio no encontrado para ${t.name}: ${clip.audioFile}`)
          throw new Error(`Audio no encontrado para ${t.name}`)
        }
        
        const audioResponse = await fetch(`/api/download?path=${encodeURIComponent(audioBlob.pathname)}`, {
          headers: { 'Authorization': `Bearer ${authToken!}` }
        })
        
        if (!audioResponse.ok) {
          const text = await audioResponse.text()
          if (text.includes('does not exist') || text.includes('not found')) {
            throw new Error(`Audio no encontrado para ${t.name}`)
          }
          console.error(`Audio no encontrado para ${t.name} en ${audioBlob.pathname}`)
          throw new Error(`Audio no encontrado para ${t.name}`)
        }
        
        const audioBuffer = await new AudioContext().decodeAudioData(await audioResponse.arrayBuffer())
        
        return {
          fileName: clip.fileName,
          startPosition: clip.startPosition,
          offsetSeconds: clip.offsetSeconds,
          id: clip.id,
          audioData: {
            left: Array.from(audioBuffer.getChannelData(0)),
            right: Array.from(audioBuffer.getChannelData(1)),
            sampleRate: audioBuffer.sampleRate
          }
        }
      }))
      
      return {
        name: t.name,
        mute: t.mute,
        solo: t.solo,
        volume: t.volume,
        clips: loadedClips.filter(c => c !== null)
      }
    } else if (t.clip) {
      if (!t.clip.audioFile) {
        return { ...t, clips: [] }
      }
      
      const audioBlob = blobs.find((b: any) => 
        b.pathname.endsWith(`/${t.clip.audioFile}`) || b.pathname.endsWith(t.clip.audioFile)
      )
      
      if (!audioBlob) {
        console.error(`Audio no encontrado para ${t.name}: ${t.clip.audioFile}`)
        throw new Error(`Audio no encontrado para ${t.name}`)
      }
      
      const audioResponse = await fetch(`/api/download?path=${encodeURIComponent(audioBlob.pathname)}`, {
        headers: { 'Authorization': `Bearer ${authToken!}` }
      })
      
      if (!audioResponse.ok) {
        const text = await audioResponse.text()
        if (text.includes('does not exist') || text.includes('not found')) {
          throw new Error(`Audio no encontrado para ${t.name}`)
        }
        console.error(`Audio no encontrado para ${t.name} en ${audioBlob.pathname}`)
        throw new Error(`Audio no encontrado para ${t.name}`)
      }
      
      const audioBuffer = await new AudioContext().decodeAudioData(await audioResponse.arrayBuffer())
      
      return {
        name: t.name,
        mute: t.mute,
        solo: t.solo,
        volume: t.volume,
        clips: [{
          fileName: t.clip.fileName,
          startPosition: t.clip.startPosition,
          offsetSeconds: t.clip.offsetSeconds || 0,
          id: t.clip.id || `clip-${Date.now()}`,
          audioData: {
            left: Array.from(audioBuffer.getChannelData(0)),
            right: Array.from(audioBuffer.getChannelData(1)),
            sampleRate: audioBuffer.sampleRate
          }
        }]
      }
    } else {
      return {
        name: t.name,
        mute: t.mute,
        solo: t.solo,
        volume: t.volume,
        clips: []
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
  if (!authToken) throw new Error('Debe iniciar sesión')
  
  const response = await fetch('/api/delete-folder', {
    method: 'DELETE',
    headers: {
      'Authorization': `Bearer ${authToken}`,
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
  if (!authToken) return 0
  
  try {
    const projects = await listCloudProjects()
    return projects.reduce((sum, p) => sum + p.size, 0)
  } catch {
    return 0
  }
}

export async function migrateLegacyProjects(): Promise<{ message: string, migratedCount: number }> {
  if (!authToken) throw new Error('Debe iniciar sesión')

  const response = await fetch('/api/migrate-legacy-projects', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${authToken}` }
  })

  if (!response.ok) {
    const error = await response.json()
    throw new Error(error.error || 'Error al migrar proyectos')
  }

  return response.json()
}

// Legacy migration function - not exposed to UI
export function hasMusicaliKey(): boolean {
  return false
}
