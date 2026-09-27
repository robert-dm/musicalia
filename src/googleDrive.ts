import { zip, unzip } from 'fflate'
import type { ProjectState } from './projectManager'
import { encodeWAV } from './projectManager'

const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file'
const FOLDER_NAME = 'Musicalia'

let accessToken: string | null = null
let tokenClient: any = null
let musicaliaFolderId: string | null = null

export function isGoogleDriveEnabled(): boolean {
  return !!(import.meta as any).env.VITE_GOOGLE_CLIENT_ID
}

export function initGoogleDrive() {
  if (!isGoogleDriveEnabled()) return
  
  const script = document.createElement('script')
  script.src = 'https://accounts.google.com/gsi/client'
  script.async = true
  script.defer = true
  document.body.appendChild(script)
}

export function connectGoogleDrive(): Promise<void> {
  return new Promise((resolve, reject) => {
    if (!isGoogleDriveEnabled()) {
      return reject(new Error('Google Drive no configurado'))
    }
    
    if (!tokenClient) {
      tokenClient = (window as any).google.accounts.oauth2.initTokenClient({
        client_id: (import.meta as any).env.VITE_GOOGLE_CLIENT_ID,
        scope: DRIVE_SCOPE,
        callback: (response: any) => {
          if (response.error) {
            reject(new Error(`Error de autenticación: ${response.error}`))
            return
          }
          accessToken = response.access_token
          resolve()
        }
      })
    }
    
    tokenClient.requestAccessToken()
  })
}

export function isConnected(): boolean {
  return !!accessToken
}

async function ensureMusicaliFolder(): Promise<string> {
  if (musicaliaFolderId) return musicaliaFolderId!
  
  // Search for existing folder
  const searchResponse = await fetch(
    `https://www.googleapis.com/drive/v3/files?q=name='${FOLDER_NAME}' and mimeType='application/vnd.google-apps.folder' and trashed=false`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  )
  
  if (!searchResponse.ok) {
    throw new Error('Error al buscar carpeta Musicalia')
  }
  
  const searchData = await searchResponse.json()
  
  if (searchData.files && searchData.files.length > 0) {
    musicaliaFolderId = searchData.files[0].id as string
    return musicaliaFolderId!
  }
  
  // Create folder
  const createResponse = await fetch('https://www.googleapis.com/drive/v3/files', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      name: FOLDER_NAME,
      mimeType: 'application/vnd.google-apps.folder'
    })
  })
  
  if (!createResponse.ok) {
    throw new Error('Error al crear carpeta Musicalia')
  }
  
  const createData = await createResponse.json()
  musicaliaFolderId = createData.id as string
  return musicaliaFolderId!
}

async function compressAudio(left: Float32Array, right: Float32Array, sampleRate: number): Promise<Uint8Array> {
  // Try WebCodecs Opus/WebM (placeholder for future implementation)
  // Full WebCodecs implementation is complex, using WAV for now
  
  // Fallback: 16-bit WAV
  return encodeWAV([left, right], sampleRate)
}

export async function saveProjectToDrive(
  state: ProjectState,
  projectName: string,
  existingFileId?: string,
  onProgress?: (progress: number) => void
): Promise<string> {
  if (!accessToken) throw new Error('No autenticado en Google Drive')
  
  onProgress?.(10)
  
  const folderId = await ensureMusicaliFolder()
  onProgress?.(20)
  
  // Compress audio files
  const files: Record<string, Uint8Array> = {
    'project.json': new TextEncoder().encode(JSON.stringify({
      name: projectName,
      bpm: state.bpm,
      loopStart: state.loopStart,
      loopEnd: state.loopEnd,
      playheadPosition: state.playheadPosition,
      tracks: state.tracks.map((t, i) => ({
        name: t.name,
        mute: t.mute,
        solo: t.solo,
        volume: t.volume,
        clip: t.clip ? {
          fileName: t.clip.fileName,
          startPosition: t.clip.startPosition,
          audioFile: `audio_${i}.wav`
        } : null
      }))
    }, null, 2))
  }
  
  for (let i = 0; i < state.tracks.length; i++) {
    const track = state.tracks[i]
    if (track.clip) {
      const left = new Float32Array(track.clip.audioData.left)
      const right = new Float32Array(track.clip.audioData.right)
      files[`audio_${i}.wav`] = await compressAudio(left, right, track.clip.audioData.sampleRate)
      onProgress?.(20 + (i / state.tracks.length) * 30)
    }
  }
  
  const zipped = await new Promise<Uint8Array>((resolve, reject) => {
    zip(files, { level: 6 }, (err, data) => {
      if (err) reject(err)
      else resolve(data)
    })
  })
  
  onProgress?.(60)
  
  const metadata = {
    name: `${projectName}.musicalia`,
    ...(existingFileId ? {} : { parents: [folderId] })
  }
  
  const form = new FormData()
  form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }))
  form.append('file', new Blob([zipped as any], { type: 'application/octet-stream' }))
  
  const url = existingFileId
    ? `https://www.googleapis.com/upload/drive/v3/files/${existingFileId}?uploadType=multipart`
    : 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart'
  
  const response = await fetch(url, {
    method: existingFileId ? 'PATCH' : 'POST',
    headers: { Authorization: `Bearer ${accessToken}` },
    body: form
  })
  
  onProgress?.(90)
  
  if (!response.ok) {
    const error = await response.json()
    throw new Error(`Error al guardar: ${error.error?.message || 'Desconocido'}`)
  }
  
  const result = await response.json()
  onProgress?.(100)
  
  return result.id
}

export interface DriveProject {
  id: string
  name: string
  size: number
  modifiedTime: string
}

export async function listDriveProjects(): Promise<DriveProject[]> {
  if (!accessToken) throw new Error('No autenticado en Google Drive')
  
  const folderId = await ensureMusicaliFolder()
  
  const response = await fetch(
    `https://www.googleapis.com/drive/v3/files?q='${folderId}' in parents and trashed=false&fields=files(id,name,size,modifiedTime)&orderBy=modifiedTime desc`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  )
  
  if (!response.ok) {
    throw new Error('Error al listar proyectos')
  }
  
  const data = await response.json()
  return data.files || []
}

export async function openProjectFromDrive(fileId: string): Promise<ProjectState> {
  if (!accessToken) throw new Error('No autenticado en Google Drive')
  
  const response = await fetch(
    `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  )
  
  if (!response.ok) {
    throw new Error('Error al abrir proyecto')
  }
  
  const buffer = await response.arrayBuffer()
  
  return new Promise((resolve, reject) => {
    unzip(new Uint8Array(buffer), async (err, unzipped) => {
      if (err) return reject(err)
      
      const projectJson = JSON.parse(new TextDecoder().decode(unzipped['project.json']))
      
      const tracks = await Promise.all(projectJson.tracks.map(async (t: any) => {
        if (!t.clip) return { ...t, clip: null }
        
        const audioData = unzipped[t.clip.audioFile]
        const audioBuffer = await new AudioContext().decodeAudioData(audioData.buffer.slice(audioData.byteOffset, audioData.byteOffset + audioData.byteLength))
        
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

export async function deleteProjectFromDrive(fileId: string): Promise<void> {
  if (!accessToken) throw new Error('No autenticado en Google Drive')
  
  const response = await fetch(
    `https://www.googleapis.com/drive/v3/files/${fileId}`,
    {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${accessToken}` }
    }
  )
  
  if (!response.ok) {
    throw new Error('Error al eliminar proyecto')
  }
}

export async function getMusicaliStorageUsage(): Promise<number> {
  if (!accessToken) return 0
  
  try {
    const folderId = await ensureMusicaliFolder()
    const response = await fetch(
      `https://www.googleapis.com/drive/v3/files?q='${folderId}' in parents and trashed=false&fields=files(size)`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    )
    
    if (!response.ok) return 0
    
    const data = await response.json()
    return (data.files || []).reduce((sum: number, f: any) => sum + parseInt(f.size || '0'), 0)
  } catch {
    return 0
  }
}
