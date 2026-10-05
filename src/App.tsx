import { useState, useRef, useEffect, useMemo } from 'react'
import * as Tone from 'tone'
import './App.css'
import './AudioDiagnostics.css'
import { StemSplitDialog, StemSplitProgress } from './StemSplitDialog'
import { separateStems, isStemSeparationSupported } from './stemSeparator'
import { autosaveProject, loadProject, clearProject, saveAudioBuffer, loadAudioBuffer } from './projectManager'
import {
  register,
  login,
  verifyAuth,
  clearAuth,
  saveProjectToCloud,
  listCloudProjects,
  openProjectFromCloud,
  deleteProjectFromCloud,
  getStorageUsage,
  migrateLegacyProjects,
  type ProjectMetadata,
  type User
} from './cloudStorage'
import { detectBPM } from './bpmDetector'

const APP_VERSION = '0.0059b'

interface Clip {
  player: Tone.Player
  fileName: string
  isPlaying: boolean
  buffer: AudioBuffer
  startPosition: number
  offsetSeconds: number
  id: string
}

interface TrackState {
  mute: boolean
  solo: boolean
  volume: number
  clips: Clip[]
  name?: string
}

function App() {
  const [isPlaying, setIsPlaying] = useState(false)
  const [isPaused, setIsPaused] = useState(false)
  const [bpm, setBpm] = useState(120)
  const [metronomeEnabled, setMetronomeEnabled] = useState(true)
  const [isLoopEnabled, setIsLoopEnabled] = useState(false)
  const [countInBars, _setCountInBars] = useState(2)
  const [isDraggingLoop, setIsDraggingLoop] = useState(false)
  const [isDraggingLoopEdge, setIsDraggingLoopEdge] = useState<'start' | 'end' | null>(null)
  const [loopDragStart, setLoopDragStart] = useState<number | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [selectedTrack, setSelectedTrack] = useState<number | null>(null)
  const trackGainsRef = useRef<Tone.Gain[]>([])
  const audioInitializedRef = useRef(false)
  const [sidebarWidth, setSidebarWidth] = useState(220)
  const [isResizing, setIsResizing] = useState(false)
  const [playheadPosition, setPlayheadPosition] = useState(0)
  const playheadAnimationRef = useRef<number | null>(null)
  const [loopStart, setLoopStart] = useState<number | null>(null)
  const [loopEnd, setLoopEnd] = useState<number | null>(null)
  const [isDraggingPlayhead, setIsDraggingPlayhead] = useState(false)
  const [tempLoopStart, setTempLoopStart] = useState<number | null>(null)
  const [tempLoopEnd, setTempLoopEnd] = useState<number | null>(null)
  const [horizontalZoom, setHorizontalZoom] = useState(1)
  const [verticalZoom, setVerticalZoom] = useState(1)
  const lanesColumnRef = useRef<HTMLDivElement>(null)
  const [showStemDialog, setShowStemDialog] = useState(false)
  const [stemProgress, setStemProgress] = useState<number>(0)
  const [isProcessingStems, setIsProcessingStems] = useState(false)
  const stemAbortControllerRef = useRef<AbortController | null>(null)
  const pendingFileRef = useRef<File | null>(null)
  const metronomePlayerRef = useRef<Tone.Player | null>(null)
  const [trackStates, setTrackStates] = useState<TrackState[]>(() => 
    Array.from({ length: 8 }, (_, i) => ({
      mute: false,
      solo: false,
      volume: 0.8,
      clips: [],
      name: `Track ${i + 1}`
    }))
  )
  const [audioLevel, setAudioLevel] = useState(0)
  const meterRef = useRef<Tone.Meter | null>(null)
  const [showToast, setShowToast] = useState(false)
  const [currentUser, setCurrentUser] = useState<User | null>(null)
  const [showAuth, setShowAuth] = useState(false)
  const [authMode, setAuthMode] = useState<'login' | 'register'>('login')
  const [authLoading, setAuthLoading] = useState(false)
  const [showCloudProjects, setShowCloudProjects] = useState(false)
  const [cloudProjects, setCloudProjects] = useState<ProjectMetadata[]>([])
  const [currentProjectName, setCurrentProjectName] = useState('Proyecto sin título')
  const [uploadProgress, setUploadProgress] = useState(0)
  const [storageUsage, setStorageUsage] = useState(0)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [toastMessage, setToastMessage] = useState<string>('')
  const [showExportDialog, setShowExportDialog] = useState(false)
  const [exportTracks, setExportTracks] = useState<boolean[]>([])
  const [isExporting, setIsExporting] = useState(false)
  const [exportProgress, setExportProgress] = useState('')
  const [isDraggingClip, setIsDraggingClip] = useState(false)
  const [draggedClipTrack, setDraggedClipTrack] = useState<number | null>(null)
  const [draggedClipId, setDraggedClipId] = useState<string | null>(null)
  const [dragStartX, setDragStartX] = useState<number>(0)
  const [dragStartPosition, setDragStartPosition] = useState<number>(0)
  const [tempDragOffset, setTempDragOffset] = useState<number>(0)
  const [clipboard, setClipboard] = useState<{buffer: AudioBuffer, fileName: string} | null>(null)
  
  const getCountInSeconds = () => {
    const secondsPerBeat = 60 / bpm
    const beatsPerBar = 4
    return countInBars * beatsPerBar * secondsPerBeat
  }

  // Verify authentication on mount
  useEffect(() => {
    const checkAuth = async () => {
      const user = await verifyAuth()
      if (user) {
        setCurrentUser(user)
      }
    }
    checkAuth()
  }, [])
  
  // Autosave on state changes (excluding playheadPosition to avoid copying audio on every tick)
  useEffect(() => {
    const saveState = async () => {
      const tracks = await Promise.all(trackStates.map(async (t, i) => {
        const savedClips = await Promise.all(t.clips.map(async (clip, clipIdx) => {
          const bufferKey = `audio-buffer-${i}-${clipIdx}`
          await saveAudioBuffer(bufferKey, clip.buffer)
          return {
            fileName: clip.fileName,
            startPosition: clip.startPosition,
            audioBufferKey: bufferKey,
            offsetSeconds: clip.offsetSeconds,
            id: clip.id
          }
        }))
        
        return {
          name: t.name || '',
          mute: t.mute,
          solo: t.solo,
          volume: t.volume,
          clips: savedClips
        }
      }))
      
      const state = {
        bpm,
        loopStart,
        loopEnd,
        playheadPosition,
        tracks,
        metronomeEnabled,
        isLoopEnabled
      }
      autosaveProject(state)
    }
    
    saveState()
  }, [bpm, loopStart, loopEnd, trackStates, metronomeEnabled, isLoopEnabled])

  useEffect(() => {
    const handleGlobalMouseUp = () => {
      if (isDraggingLoop || isDraggingLoopEdge) {
        handleLoopMouseUp()
      }
    }
    
    window.addEventListener('mouseup', handleGlobalMouseUp)
    return () => window.removeEventListener('mouseup', handleGlobalMouseUp)
  }, [isDraggingLoop, isDraggingLoopEdge])

  useEffect(() => {
    const handleWheel = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault()
        const delta = e.deltaY > 0 ? -0.1 : 0.1
        setHorizontalZoom(prev => Math.max(0.5, Math.min(4, prev + delta)))
      } else if (e.shiftKey) {
        e.preventDefault()
        const delta = e.deltaY > 0 ? -0.1 : 0.1
        setVerticalZoom(prev => Math.max(0.5, Math.min(3, prev + delta)))
      }
    }

    const lanesColumn = lanesColumnRef.current
    if (lanesColumn) {
      lanesColumn.addEventListener('wheel', handleWheel, { passive: false })
      return () => lanesColumn.removeEventListener('wheel', handleWheel)
    }
  }, [])

  // Update Transport loop when loop settings change during playback
  useEffect(() => {
    if (isPlaying) {
      if (isLoopEnabled && loopStart !== null && loopEnd !== null) {
        Tone.getTransport().loop = true
        Tone.getTransport().loopStart = loopStart
        Tone.getTransport().loopEnd = loopEnd
      } else {
        Tone.getTransport().loop = false
      }
    }
  }, [isPlaying, isLoopEnabled, loopStart, loopEnd])
  
  // Load project on mount
  useEffect(() => {
    loadProject().then(async (state) => {
      if (!state) return
      
      await ensureAudio()
      
      setBpm(state.bpm)
      setLoopStart(state.loopStart)
      setLoopEnd(state.loopEnd)
      setPlayheadPosition(state.playheadPosition)
      if (state.metronomeEnabled !== undefined) setMetronomeEnabled(state.metronomeEnabled)
      if (state.isLoopEnabled !== undefined) setIsLoopEnabled(state.isLoopEnabled)
      
      const newTrackStates = await Promise.all(state.tracks.map(async (t, i) => {
        // Handle old format with single clip
        if (t.clip) {
          const buffer = await loadAudioBuffer(t.clip.audioBufferKey)
          if (!buffer) return { ...t, clips: [] }
          
          const toneBuffer = new Tone.ToneAudioBuffer(buffer)
          const player = new Tone.Player()
          player.buffer = toneBuffer
          player.loop = true
          player.connect(trackGainsRef.current[i])
          
          return {
            ...t,
            clips: [{
              player,
              fileName: t.clip.fileName,
              isPlaying: false,
              buffer,
              startPosition: t.clip.startPosition,
              offsetSeconds: t.clip.offsetSeconds || getCountInSeconds(),
              id: t.clip.id || `clip-${Date.now()}-${i}-${Math.random()}`
            }]
          }
        }
        
        // Handle new format with clips array
        const loadedClips = await Promise.all((t.clips || []).map(async (clipData: any) => {
          const buffer = await loadAudioBuffer(clipData.audioBufferKey)
          if (!buffer) return null
          
          const toneBuffer = new Tone.ToneAudioBuffer(buffer)
          const player = new Tone.Player()
          player.buffer = toneBuffer
          player.loop = true
          player.connect(trackGainsRef.current[i])
          
          return {
            player,
            fileName: clipData.fileName,
            isPlaying: false,
            buffer,
            startPosition: clipData.startPosition,
            offsetSeconds: clipData.offsetSeconds || getCountInSeconds(),
            id: clipData.id || `clip-${Date.now()}-${i}-${Math.random()}`
          }
        }))
        
        return {
          ...t,
          clips: loadedClips.filter(c => c !== null) as Clip[]
        }
      }))
      
      setTrackStates(newTrackStates)
      setToastMessage('Proyecto cargado')
      setShowToast(true)
      setTimeout(() => setShowToast(false), 3000)
    })
  }, [])
  
  const handleNewProject = async () => {
    if (!confirm('¿Crear un nuevo proyecto? Se perderá el trabajo no guardado.')) return
    
    await clearProject()
    setCurrentProjectName('Proyecto sin título')
    window.location.reload()
  }
  
  const handleLogin = async (email: string, password: string) => {
    setAuthLoading(true)
    setErrorMessage(null)
    try {
      const { user } = await login(email, password)
      setCurrentUser(user)
      setShowAuth(false)
      setToastMessage(`Bienvenido, ${user.username}`)
      setShowToast(true)
      setTimeout(() => setShowToast(false), 3000)
    } catch (error: any) {
      console.error('Login error:', error)
      setErrorMessage(error.message || 'Error al iniciar sesión')
    } finally {
      setAuthLoading(false)
    }
  }

  const handleRegister = async (username: string, email: string, password: string) => {
    setAuthLoading(true)
    setErrorMessage(null)
    try {
      const { user } = await register(username, email, password)
      setCurrentUser(user)
      setShowAuth(false)
      setToastMessage(`Cuenta creada. Bienvenido, ${user.username}`)
      setShowToast(true)
      setTimeout(() => setShowToast(false), 3000)
    } catch (error: any) {
      console.error('Register error:', error)
      setErrorMessage(error.message || 'Error al crear cuenta')
    } finally {
      setAuthLoading(false)
    }
  }

  const handleLogout = () => {
    clearAuth()
    setCurrentUser(null)
    setToastMessage('Sesión cerrada')
    setShowToast(true)
    setTimeout(() => setShowToast(false), 3000)
  }
  
  const handleSaveToCloud = async () => {
    if (!currentUser) {
      setShowAuth(true)
      setAuthMode('login')
      setErrorMessage('Inicia sesión para guardar en la nube')
      return
    }
    
    const name = prompt('Nombre del proyecto:', currentProjectName)
    if (!name) return
    
    const projectData = {
      name,
      bpm,
      loopStart,
      loopEnd,
      playheadPosition,
      tracks: trackStates.map((t, i) => ({
        name: t.name,
        mute: t.mute,
        solo: t.solo,
        volume: t.volume,
        clips: t.clips.map((clip, clipIdx) => ({
          fileName: clip.fileName,
          startPosition: clip.startPosition,
          offsetSeconds: clip.offsetSeconds,
          id: clip.id,
          audioFile: `audio_${i}_${clipIdx}.wav`,
          audioData: {
            left: Array.from(clip.buffer.getChannelData(0)),
            right: Array.from(clip.buffer.getChannelData(1)),
            sampleRate: clip.buffer.sampleRate
          }
        }))
      }))
    }
    
    try {
      setUploadProgress(0)
      setErrorMessage(null)
      await saveProjectToCloud(projectData, name, setUploadProgress)
      setCurrentProjectName(name)
      setToastMessage('Proyecto guardado en la nube')
      setShowToast(true)
      setTimeout(() => setShowToast(false), 3000)
    } catch (err: any) {
      setErrorMessage(err.message || 'Error al guardar proyecto')
    } finally {
      setUploadProgress(0)
    }
  }
  
  const handleMigrateLegacyProjects = async () => {
    try {
      const result = await migrateLegacyProjects()
      setToastMessage(result.message)
      setShowToast(true)
      setTimeout(() => setShowToast(false), 3000)
      
      // Refresh project list after migration
      const projects = await listCloudProjects()
      setCloudProjects(projects)
      const usage = await getStorageUsage()
      setStorageUsage(usage)
    } catch (err: any) {
      setErrorMessage(err.message || 'Error al migrar proyectos')
    }
  }

  const handleShowCloudProjects = async () => {
    if (!currentUser) {
      setShowAuth(true)
      setAuthMode('login')
      setErrorMessage('Inicia sesión para ver tus proyectos')
      return
    }
    
    try {
      setErrorMessage(null)
      const projects = await listCloudProjects()
      setCloudProjects(projects)
      const usage = await getStorageUsage()
      setStorageUsage(usage)
      setShowCloudProjects(true)
    } catch (err: any) {
      setErrorMessage(err.message || 'Error al listar proyectos')
    }
  }
  
  const handleOpenCloudProject = async (pathname: string, name: string) => {
    try {
      setErrorMessage(null)
      const state = await openProjectFromCloud(pathname)
      
      await ensureAudio()
      
      setBpm(state.bpm)
      setLoopStart(state.loopStart)
      setLoopEnd(state.loopEnd)
      setPlayheadPosition(state.playheadPosition)
      if (state.metronomeEnabled !== undefined) setMetronomeEnabled(state.metronomeEnabled)
      if (state.isLoopEnabled !== undefined) setIsLoopEnabled(state.isLoopEnabled)
      
      const newTrackStates = state.tracks.map((t: any, i: number) => {
        // Handle old format with single clip
        if (t.clip) {
          const buffer = new AudioBuffer({
            numberOfChannels: 2,
            length: t.clip.audioData.left.length,
            sampleRate: t.clip.audioData.sampleRate
          })
          buffer.getChannelData(0).set(new Float32Array(t.clip.audioData.left))
          buffer.getChannelData(1).set(new Float32Array(t.clip.audioData.right))
          
          const toneBuffer = new Tone.ToneAudioBuffer(buffer)
          const player = new Tone.Player()
          player.buffer = toneBuffer
          player.loop = true
          player.connect(trackGainsRef.current[i])
          
          return {
            ...t,
            clips: [{
              player,
              fileName: t.clip.fileName,
              isPlaying: false,
              buffer,
              startPosition: t.clip.startPosition,
              offsetSeconds: t.clip.offsetSeconds || getCountInSeconds(),
              id: t.clip.id || `clip-${Date.now()}-${i}-${Math.random()}`
            }]
          }
        }
        
        // Handle new format with clips array
        const loadedClips = (t.clips || []).map((clipData: any) => {
          const buffer = new AudioBuffer({
            numberOfChannels: 2,
            length: clipData.audioData.left.length,
            sampleRate: clipData.audioData.sampleRate
          })
          buffer.getChannelData(0).set(new Float32Array(clipData.audioData.left))
          buffer.getChannelData(1).set(new Float32Array(clipData.audioData.right))
          
          const toneBuffer = new Tone.ToneAudioBuffer(buffer)
          const player = new Tone.Player()
          player.buffer = toneBuffer
          player.loop = true
          player.connect(trackGainsRef.current[i])
          
          return {
            player,
            fileName: clipData.fileName,
            isPlaying: false,
            buffer,
            startPosition: clipData.startPosition,
            offsetSeconds: clipData.offsetSeconds || getCountInSeconds(),
            id: clipData.id || `clip-${Date.now()}-${i}-${Math.random()}`
          }
        })
        
        return {
          ...t,
          clips: loadedClips
        }
      })
      
      setTrackStates(newTrackStates)
      setCurrentProjectName(name)
      setShowCloudProjects(false)
      setToastMessage('Proyecto abierto')
      setShowToast(true)
      setTimeout(() => setShowToast(false), 3000)
    } catch (err: any) {
      setErrorMessage(err.message || 'Error al abrir proyecto')
    }
  }
  
  const handleDeleteCloudProject = async (pathname: string, name: string) => {
    if (!currentUser) {
      setErrorMessage('Inicia sesión para eliminar proyectos')
      return
    }

    if (!confirm(`¿Eliminar permanentemente "${name}"?`)) return
    
    try {
      setErrorMessage(null)
      await deleteProjectFromCloud(pathname)
      
      if (currentProjectName === name) {
        await clearProject()
        setCurrentProjectName('Proyecto sin título')
      }
      
      const projects = await listCloudProjects()
      setCloudProjects(projects)
      const usage = await getStorageUsage()
      setStorageUsage(usage)
      
      setToastMessage('Proyecto eliminado')
      setShowToast(true)
      setTimeout(() => setShowToast(false), 3000)
    } catch (err: any) {
      setErrorMessage(err.message || 'Error al eliminar proyecto')
    }
  }

  const handleOpenExportDialog = () => {
    const tracksWithAudio = trackStates.map(t => t.clips.length > 0 && !t.mute)
    setExportTracks(tracksWithAudio)
    setShowExportDialog(true)
  }

  const sanitizeFilename = (name: string): string => {
    return name.replace(/[<>:"/\\|?*]/g, '_').replace(/\s+/g, ' ').trim()
  }

  const handleExport = async () => {
    try {
      setShowExportDialog(false)
      setIsExporting(true)
      setExportProgress('Preparando...')
      setErrorMessage(null)
      
      const selectedIndices = exportTracks
        .map((selected, i) => selected ? i : -1)
        .filter(i => i >= 0 && trackStates[i].clips.length > 0)
      
      if (selectedIndices.length === 0) {
        setErrorMessage('Selecciona al menos una pista para exportar')
        setIsExporting(false)
        return
      }
      
      const anySolo = selectedIndices.some(i => trackStates[i].solo)
      const effectiveIndices = anySolo 
        ? selectedIndices.filter(i => trackStates[i].solo)
        : selectedIndices
      
      if (effectiveIndices.length === 0) {
        setErrorMessage('No hay pistas soloed seleccionadas')
        setIsExporting(false)
        return
      }
      
      const maxDuration = Math.max(...effectiveIndices.flatMap(i => 
        trackStates[i].clips.map(clip => clip.offsetSeconds + clip.buffer.duration)
      ))
      const sampleRate = trackStates[effectiveIndices[0]].clips[0].buffer.sampleRate
      
      for (let idx = 0; idx < effectiveIndices.length; idx++) {
        const i = effectiveIndices[idx]
        const track = trackStates[i]
        
        setExportProgress(`Renderizando ${idx + 1}/${effectiveIndices.length}...`)
        
        const offlineContext = new OfflineAudioContext(2, maxDuration * sampleRate, sampleRate)
        const gainNode = offlineContext.createGain()
        gainNode.gain.value = track.volume
        gainNode.connect(offlineContext.destination)
        
        // Render all clips on this track
        for (const clip of track.clips) {
          const source = offlineContext.createBufferSource()
          source.buffer = clip.buffer
          source.connect(gainNode)
          source.start(clip.offsetSeconds)
        }
        
        const renderedBuffer = await offlineContext.startRendering()
        
        setExportProgress(`Codificando ${idx + 1}/${effectiveIndices.length}...`)
        
        const wavData = encodeWAV(
          [renderedBuffer.getChannelData(0), renderedBuffer.getChannelData(1)],
          sampleRate
        )
        
        const blob = new Blob([wavData.buffer as ArrayBuffer], { type: 'audio/wav' })
        const url = URL.createObjectURL(blob)
        
        const trackName = track.name || `Pista ${i + 1}`
        const fileName = sanitizeFilename(`${currentProjectName} - ${trackName}.wav`)
        
        const a = document.createElement('a')
        a.href = url
        a.download = fileName
        a.click()
        
        URL.revokeObjectURL(url)
        
        await new Promise(resolve => setTimeout(resolve, 100))
      }
      
      setToastMessage('Exportación completada')
      setShowToast(true)
      setTimeout(() => setShowToast(false), 3000)
    } catch (err: any) {
      console.error('Export error:', err)
      setErrorMessage(err.message || 'Error al exportar')
    } finally {
      setIsExporting(false)
      setExportProgress('')
    }
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

  const ensureAudio = async () => {
    const contextState = Tone.getContext().state
    console.log('[DEBUG] ensureAudio: Tone context state=', contextState)
    
    if (!audioInitializedRef.current) {
      await Tone.start()
      
      if (trackGainsRef.current.length === 0) {
        trackGainsRef.current = Array.from({ length: 8 }, () => 
          new Tone.Gain(0.8).toDestination()
        )
      }
      
      if (!metronomePlayerRef.current) {
        const clickBuffer = createClickSound()
        metronomePlayerRef.current = new Tone.Player(clickBuffer).toDestination()
        metronomePlayerRef.current.volume.value = -6
      }
      
      if (!meterRef.current) {
        meterRef.current = new Tone.Meter()
        Tone.getDestination().connect(meterRef.current)
        
        setInterval(() => {
          if (meterRef.current) {
            setAudioLevel(meterRef.current.getValue() as number)
          }
        }, 100)
      }
      
      audioInitializedRef.current = true
    }
    
    if (Tone.getContext().state !== 'running') {
      console.log('[DEBUG] Context not running, resuming...')
      await Tone.start()
      await Tone.getContext().resume()
    }
    
    console.log('[DIAG] Destination mute:', Tone.getDestination().mute)
    console.log('[DIAG] Destination volume:', Tone.getDestination().volume.value)
    console.log('[DIAG] Gains:', trackGainsRef.current.map(g => g.gain.value))
  }

  const createClickSound = (): Tone.ToneAudioBuffer => {
    const sampleRate = Tone.getContext().sampleRate
    const duration = 0.05
    const length = Math.floor(sampleRate * duration)
    const audioBuffer = Tone.getContext().createBuffer(2, length, sampleRate)
    
    const freq = 1000
    for (let ch = 0; ch < 2; ch++) {
      const channel = audioBuffer.getChannelData(ch)
      for (let i = 0; i < length; i++) {
        const t = i / sampleRate
        const envelope = Math.exp(-t * 20)
        channel[i] = Math.sin(2 * Math.PI * freq * t) * envelope * 0.3
      }
    }
    
    return new Tone.ToneAudioBuffer(audioBuffer)
  }

  const playTestTone = async () => {
    await Tone.start()
    const osc = new Tone.Oscillator(440, 'sine').toDestination()
    osc.start()
    osc.stop('+0.5')
    setTimeout(() => osc.dispose(), 600)
  }

  const formatTime = (seconds: number): string => {
    const mins = Math.floor(seconds / 60)
    const secs = Math.floor(seconds % 60)
    return `${mins}:${secs.toString().padStart(2, '0')}`
  }

  const getMaxDuration = (): number => {
    let maxDuration = 0
    trackStates.forEach(track => {
      track.clips.forEach(clip => {
        const clipEnd = clip.offsetSeconds + clip.buffer.duration
        maxDuration = Math.max(maxDuration, clipEnd)
      })
    })
    return maxDuration > 0 ? maxDuration : 0
  }

  useEffect(() => {
    const anySolo = trackStates.some(ts => ts.solo)
    
    trackStates.forEach((trackState, index) => {
      const gainNode = trackGainsRef.current[index]
      if (!gainNode) return
      
      let gain = trackState.volume
      
      if (trackState.mute) {
        gain = 0
      } else if (anySolo && !trackState.solo) {
        gain = 0
      }
      
      gainNode.gain.value = gain
    })
  }, [trackStates])

  const drawWaveform = (canvas: HTMLCanvasElement, buffer: AudioBuffer) => {
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const width = canvas.width
    const height = canvas.height
    const data = buffer.getChannelData(0)
    const step = Math.ceil(data.length / width)
    
    const topPadding = 48
    const bottomPadding = 16
    const waveformHeight = height - topPadding - bottomPadding
    const amp = waveformHeight / 2
    const centerY = topPadding + waveformHeight / 2

    ctx.fillStyle = '#1a1a1a'
    ctx.fillRect(0, 0, width, height)

    ctx.strokeStyle = '#0a5'
    ctx.lineWidth = 1.5
    ctx.beginPath()

    for (let i = 0; i < width; i++) {
      let min = 1.0
      let max = -1.0
      
      for (let j = 0; j < step; j++) {
        const datum = data[(i * step) + j]
        if (datum < min) min = datum
        if (datum > max) max = datum
      }
      
      const yMin = centerY + (min * amp)
      const yMax = centerY + (max * amp)
      
      if (i === 0) {
        ctx.moveTo(i, yMin)
      }
      
      ctx.lineTo(i, yMin)
      ctx.lineTo(i, yMax)
    }

    ctx.stroke()
  }

  const handlePlay = async () => {
    await Tone.start()
    await ensureAudio()
    
    if (Tone.getContext().state !== 'running') {
      console.log('[DEBUG] handlePlay: Context not running, resuming...')
      await Tone.start()
      await Tone.getContext().resume()
    }
    
    console.log('[DEBUG] handlePlay: audio initialized, gains:', trackGainsRef.current.length)
    console.log('[DEBUG] trackStates with clips:', trackStates.filter(t => t.clips.length > 0).length)
    
    Tone.getTransport().bpm.value = bpm
    
    const countInSeconds = getCountInSeconds()
    // When loop is enabled and marked, always start from loop start
    // Otherwise, resume from playhead if paused, or start from beginning
    const startTime = (isLoopEnabled && loopStart !== null) ? loopStart : (isPaused ? playheadPosition : 0)
    
    // Configure Transport loop
    if (isLoopEnabled && loopStart !== null && loopEnd !== null) {
      Tone.getTransport().loop = true
      Tone.getTransport().loopStart = loopStart
      Tone.getTransport().loopEnd = loopEnd
    } else {
      Tone.getTransport().loop = false
    }
    
    Tone.getTransport().seconds = startTime
    Tone.getTransport().start()
    
    const startingInsideGap = startTime < countInSeconds
    
    if (metronomeEnabled && startingInsideGap && metronomePlayerRef.current) {
      const beatsPerBar = 4
      const totalBeats = countInBars * beatsPerBar
      const secondsPerBeat = 60 / bpm
      const clicksNeeded = Math.ceil((countInSeconds - startTime) / secondsPerBeat)
      
      for (let beat = 0; beat < Math.min(clicksNeeded, totalBeats); beat++) {
        const time = Tone.now() + beat * secondsPerBeat
        metronomePlayerRef.current.start(time)
      }
    }
    
    const maxDuration = getMaxDuration()
    
    const updatedStates = trackStates.map(track => {
      const updatedClips = track.clips.map(clip => {
        if (!clip.isPlaying && startTime < clip.offsetSeconds + clip.buffer.duration) {
          clip.player.loop = false
          
          const clipStartTime = clip.offsetSeconds
          const clipEndTime = clip.offsetSeconds + clip.buffer.duration
          
          // Determine when to play this clip and what offset to use
          let when = Tone.now()
          let offset = 0
          
          if (startTime < clipStartTime) {
            // Playhead is before clip starts - schedule for later
            when = Tone.now() + (clipStartTime - startTime)
            offset = 0
          } else if (startTime >= clipStartTime && startTime < clipEndTime) {
            // Playhead is inside clip - start immediately with offset
            when = Tone.now()
            offset = startTime - clipStartTime
          }
          
          if (when >= Tone.now() && offset < clip.buffer.duration) {
            clip.player.start(when, offset)
            return { ...clip, isPlaying: true }
          }
        }
        return clip
      })
      return { ...track, clips: updatedClips }
    })
    
    setTrackStates(updatedStates)
    setIsPlaying(true)
    setIsPaused(false)
    
    let lastUpdateTime = 0
    let lastLoopCheck = startTime
    const updatePlayhead = (timestamp: number) => {
      if (Tone.getTransport().state === 'started') {
        if (timestamp - lastUpdateTime < 50) {
          playheadAnimationRef.current = requestAnimationFrame(updatePlayhead)
          return
        }
        lastUpdateTime = timestamp
        
        const currentTime = Tone.getTransport().seconds
        
        // Detect loop: if current time jumped backwards, restart players
        if (isLoopEnabled && loopStart !== null && loopEnd !== null) {
          if (currentTime < lastLoopCheck && lastLoopCheck > loopStart) {
            // Transport looped, restart players at loop start
            trackStates.forEach(track => {
              track.clips.forEach(clip => {
                if (clip.player.state === 'started') {
                  clip.player.stop()
                }
                
                // Restart clips that overlap with loop region
                if (loopStart < clip.offsetSeconds + clip.buffer.duration) {
                  let when = Tone.now()
                  let offset = 0
                  
                  if (loopStart < clip.offsetSeconds) {
                    when = Tone.now() + (clip.offsetSeconds - loopStart)
                    offset = 0
                  } else if (loopStart >= clip.offsetSeconds) {
                    when = Tone.now()
                    offset = loopStart - clip.offsetSeconds
                  }
                  
                  if (offset < clip.buffer.duration) {
                    clip.player.start(when, offset)
                  }
                }
              })
            })
          }
        } else if (!isLoopEnabled && maxDuration > 0 && currentTime >= maxDuration) {
          // End of timeline, restart from beginning
          Tone.getTransport().seconds = 0
          trackStates.forEach(track => {
            track.clips.forEach(clip => {
              if (clip.player.state === 'started') {
                clip.player.stop()
              }
              const when = Tone.now() + clip.offsetSeconds
              clip.player.start(when, 0)
            })
          })
        }
        
        lastLoopCheck = currentTime
        setPlayheadPosition(currentTime)
        playheadAnimationRef.current = requestAnimationFrame(updatePlayhead)
      }
    }
    playheadAnimationRef.current = requestAnimationFrame(updatePlayhead)
  }

  const handlePause = () => {
    Tone.getTransport().pause()
    
    if (playheadAnimationRef.current !== null) {
      cancelAnimationFrame(playheadAnimationRef.current)
      playheadAnimationRef.current = null
    }
    
    setTrackStates(prev => prev.map(track => ({
      ...track,
      clips: track.clips.map(clip => {
        if (clip.isPlaying) {
          clip.player.stop()
        }
        return { ...clip, isPlaying: false }
      })
    })))
    
    setIsPlaying(false)
    setIsPaused(true)
  }

  const handleStop = () => {
    Tone.getTransport().stop()
    Tone.getTransport().seconds = 0
    
    if (playheadAnimationRef.current !== null) {
      cancelAnimationFrame(playheadAnimationRef.current)
      playheadAnimationRef.current = null
    }
    
    setPlayheadPosition(0)
    
    setTrackStates(prev => prev.map(track => ({
      ...track,
      clips: track.clips.map(clip => {
        if (clip.isPlaying) {
          clip.player.stop()
        }
        return { ...clip, isPlaying: false }
      })
    })))
    
    setIsPlaying(false)
    setIsPaused(false)
  }

  const handleJumpToStart = () => {
    seekToPosition(0)
    if (!isPlaying) {
      setPlayheadPosition(0)
      Tone.getTransport().seconds = 0
    }
  }

  const handleSplitClip = async (trackIndex: number) => {
    const track = trackStates[trackIndex]
    if (track.clips.length === 0) return
    
    await ensureAudio()
    
    const splitTime = playheadPosition
    
    // Find the clip that contains the playhead
    const clipToSplit = track.clips.find(clip => 
      splitTime > clip.offsetSeconds && splitTime < clip.offsetSeconds + clip.buffer.duration
    )
    
    if (!clipToSplit) {
      setErrorMessage('El playhead debe estar dentro de un clip')
      setTimeout(() => setErrorMessage(null), 3000)
      return
    }
    
    const splitOffset = splitTime - clipToSplit.offsetSeconds
    const originalBuffer = clipToSplit.buffer
    const sampleRate = originalBuffer.sampleRate
    
    const firstPartLength = Math.floor(splitOffset * sampleRate)
    const secondPartLength = originalBuffer.length - firstPartLength
    
    const firstBuffer = new AudioBuffer({
      numberOfChannels: originalBuffer.numberOfChannels,
      length: firstPartLength,
      sampleRate: sampleRate
    })
    
    const secondBuffer = new AudioBuffer({
      numberOfChannels: originalBuffer.numberOfChannels,
      length: secondPartLength,
      sampleRate: sampleRate
    })
    
    for (let ch = 0; ch < originalBuffer.numberOfChannels; ch++) {
      const originalData = originalBuffer.getChannelData(ch)
      firstBuffer.getChannelData(ch).set(originalData.slice(0, firstPartLength))
      secondBuffer.getChannelData(ch).set(originalData.slice(firstPartLength))
    }
    
    clipToSplit.player.dispose()
    
    const firstPlayer = new Tone.Player()
    firstPlayer.buffer = new Tone.ToneAudioBuffer(firstBuffer)
    firstPlayer.loop = false
    firstPlayer.connect(trackGainsRef.current[trackIndex])
    
    const secondPlayer = new Tone.Player()
    secondPlayer.buffer = new Tone.ToneAudioBuffer(secondBuffer)
    secondPlayer.loop = false
    secondPlayer.connect(trackGainsRef.current[trackIndex])
    
    const newTrackStates = [...trackStates]
    const updatedClips = track.clips.map(clip => {
      if (clip.id === clipToSplit.id) {
        return null // Will be replaced with two clips
      }
      return clip
    }).filter(c => c !== null) as Clip[]
    
    // Add the two new clips
    updatedClips.push({
      player: firstPlayer,
      fileName: clipToSplit.fileName,
      isPlaying: false,
      buffer: firstBuffer,
      startPosition: clipToSplit.startPosition,
      offsetSeconds: clipToSplit.offsetSeconds,
      id: `${clipToSplit.id}-part1`
    })
    
    updatedClips.push({
      player: secondPlayer,
      fileName: clipToSplit.fileName,
      isPlaying: false,
      buffer: secondBuffer,
      startPosition: 0,
      offsetSeconds: splitTime,
      id: `${clipToSplit.id}-part2`
    })
    
    newTrackStates[trackIndex] = {
      ...newTrackStates[trackIndex],
      clips: updatedClips
    }
    
    setTrackStates(newTrackStates)
    setToastMessage('Audio importado')
    setShowToast(true)
    setTimeout(() => setShowToast(false), 2000)
  }

  const handleCopyClip = (trackIndex: number) => {
    const track = trackStates[trackIndex]
    if (track.clips.length === 0) return
    
    // Find clip under playhead, or use first clip
    const clipToCopy = track.clips.find(clip =>
      playheadPosition >= clip.offsetSeconds && 
      playheadPosition < clip.offsetSeconds + clip.buffer.duration
    ) || track.clips[0]
    
    setClipboard({
      buffer: clipToCopy.buffer,
      fileName: clipToCopy.fileName
    })
    
    setToastMessage('Clip dividido')
    setShowToast(true)
    setTimeout(() => setShowToast(false), 2000)
  }

  const handlePasteClip = async (trackIndex: number) => {
    if (!clipboard) {
      setErrorMessage('No hay clip copiado')
      setTimeout(() => setErrorMessage(null), 2000)
      return
    }
    
    await ensureAudio()
    
    const player = new Tone.Player()
    player.buffer = new Tone.ToneAudioBuffer(clipboard.buffer)
    player.loop = false
    player.connect(trackGainsRef.current[trackIndex])
    
    const newClip: Clip = {
      player,
      fileName: clipboard.fileName,
      isPlaying: false,
      buffer: clipboard.buffer,
      startPosition: 0,
      offsetSeconds: playheadPosition,
      id: `clip-${Date.now()}-${Math.random()}`
    }
    
    const newTrackStates = [...trackStates]
    newTrackStates[trackIndex] = {
      ...newTrackStates[trackIndex],
      clips: [...newTrackStates[trackIndex].clips, newClip]
    }
    setTrackStates(newTrackStates)
    
    setToastMessage('Clip copiado')
    setShowToast(true)
    setTimeout(() => setShowToast(false), 2000)
  }

  const handleClipDragStart = (e: React.MouseEvent, trackIndex: number, clipId: string) => {
    e.stopPropagation()
    
    const clip = trackStates[trackIndex].clips.find(c => c.id === clipId)
    if (!clip) return
    
    setIsDraggingClip(true)
    setDraggedClipTrack(trackIndex)
    setDraggedClipId(clipId)
    setDragStartX(e.clientX)
    setDragStartPosition(clip.offsetSeconds)
    setTempDragOffset(clip.offsetSeconds)
  }

  useEffect(() => {
    if (!isDraggingClip || draggedClipTrack === null || draggedClipId === null) return

    const handleMouseMove = (e: MouseEvent) => {
      const lanes = document.querySelectorAll('.track-content')
      if (lanes.length === 0) return
      
      const firstLane = lanes[0] as HTMLElement
      const rect = firstLane.getBoundingClientRect()
      const deltaX = e.clientX - dragStartX
      const deltaPercentage = deltaX / rect.width
      const maxDuration = getMaxDuration() || 100
      const deltaTime = deltaPercentage * maxDuration
      
      const newOffset = Math.max(0, dragStartPosition + deltaTime)
      setTempDragOffset(newOffset)
    }

    const handleMouseUp = () => {
      // Update the actual state only on mouseup
      const newTrackStates = [...trackStates]
      const track = newTrackStates[draggedClipTrack]
      const updatedClips = track.clips.map(clip => {
        if (clip.id === draggedClipId) {
          return { ...clip, offsetSeconds: tempDragOffset }
        }
        return clip
      })
      newTrackStates[draggedClipTrack] = {
        ...track,
        clips: updatedClips
      }
      setTrackStates(newTrackStates)
      
      setIsDraggingClip(false)
      setDraggedClipTrack(null)
      setDraggedClipId(null)
    }

    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)
    document.body.style.userSelect = 'none'
    document.body.style.cursor = 'ew-resize'

    return () => {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
      document.body.style.userSelect = ''
      document.body.style.cursor = ''
    }
  }, [isDraggingClip, draggedClipTrack, draggedClipId, dragStartX, dragStartPosition, tempDragOffset])

  const handleBpmChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newBpm = parseInt(e.target.value) || 120
    setBpm(newBpm)
    Tone.getTransport().bpm.value = newBpm
  }

  const handleLaneClick = async (trackIndex: number) => {
    const track = trackStates[trackIndex]

    if (track.clips.length > 0) {
      // If track has clips, do nothing on empty space click
      return
    } else {
      setSelectedTrack(trackIndex)
      fileInputRef.current?.click()
    }
  }

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file || selectedTrack === null) return

    // Check if stem separation is supported
    const { supported, reason } = isStemSeparationSupported()
    
    if (!supported) {
      console.warn('Stem separation not supported:', reason)
      alert(`Separación de stems no disponible: ${reason}\n\nCargando como pista única.`)
      await loadSingleTrack(file, selectedTrack)
      setSelectedTrack(null)
      if (fileInputRef.current) {
        fileInputRef.current.value = ''
      }
      return
    }

    // Store the file and show dialog
    pendingFileRef.current = file
    setShowStemDialog(true)
  }

  const handleStemDialogConfirm = async () => {
    setShowStemDialog(false)
    if (!pendingFileRef.current || selectedTrack === null) return

    setIsProcessingStems(true)
    setStemProgress(0)

    const file = pendingFileRef.current
    const track = selectedTrack

    try {
      await processStemSeparation(file, track)
    } catch (error) {
      console.error('Stem separation failed:', error)
      const errorMessage = error instanceof Error ? error.message : 'Error desconocido'
      alert(`Error al separar stems: ${errorMessage}\n\nCargando como una sola pista.`)
      
      // Fall back to single track import
      try {
        await loadSingleTrack(file, track)
      } catch (loadError) {
        console.error('Failed to load single track:', loadError)
        alert('Error al cargar el archivo de audio.')
      }
    } finally {
      setIsProcessingStems(false)
      stemAbortControllerRef.current = null
      pendingFileRef.current = null
      setSelectedTrack(null)
      
      if (fileInputRef.current) {
        fileInputRef.current.value = ''
      }
    }
  }

  const handleCancelStemSeparation = () => {
    if (stemAbortControllerRef.current) {
      stemAbortControllerRef.current.abort()
    }
    setShowStemDialog(false)
    setIsProcessingStems(false)
    setStemProgress(0)
    
    // Fall back to single track
    if (pendingFileRef.current && selectedTrack !== null) {
      loadSingleTrack(pendingFileRef.current, selectedTrack).catch(console.error)
    }
    
    pendingFileRef.current = null
    setSelectedTrack(null)
    if (fileInputRef.current) {
      fileInputRef.current.value = ''
    }
  }

  const handleStemDialogCancel = async () => {
    setShowStemDialog(false)
    if (!pendingFileRef.current || selectedTrack === null) return

    await loadSingleTrack(pendingFileRef.current, selectedTrack)
    
    pendingFileRef.current = null
    setSelectedTrack(null)
    
    if (fileInputRef.current) {
      fileInputRef.current.value = ''
    }
  }

  const loadSingleTrack = async (file: File, trackIndex: number) => {
    await ensureAudio()
    console.log('[DEBUG] loadSingleTrack: trackIndex=', trackIndex, 'gain exists=', !!trackGainsRef.current[trackIndex])

    const url = URL.createObjectURL(file)
    const trackGain = trackGainsRef.current[trackIndex]
    
    const player = new Tone.Player()
    player.loop = false
    player.connect(trackGain)
    
    console.log('[DEBUG] Before load')
    await player.load(url)
    console.log('[DEBUG] After load: player.loaded=', player.loaded, 'duration=', player.buffer.duration)

    const buffer = player.buffer.get() as AudioBuffer

    const bpmResult = await detectBPM(buffer)
    if (bpmResult.bpm) {
      console.log('[BPM] Detected:', bpmResult.bpm)
      setBpm(bpmResult.bpm)
      Tone.getTransport().bpm.value = bpmResult.bpm
      setErrorMessage(`Tempo: ${bpmResult.bpm}`)
      setTimeout(() => setErrorMessage(null), 3000)
    } else {
      console.log('[BPM] Detection failed, keeping current BPM')
      setErrorMessage('No se pudo detectar el tempo')
      setTimeout(() => setErrorMessage(null), 3000)
    }

    const newClip: Clip = {
      player,
      fileName: file.name,
      isPlaying: false,
      buffer,
      startPosition: 0,
      offsetSeconds: getCountInSeconds(),
      id: `clip-${Date.now()}-${Math.random()}`
    }

    const newTrackStates = [...trackStates]
    newTrackStates[trackIndex] = {
      ...newTrackStates[trackIndex],
      clips: [...newTrackStates[trackIndex].clips, newClip]
    }
    setTrackStates(newTrackStates)
  }

  const processStemSeparation = async (file: File, startTrackIndex: number) => {
    await ensureAudio()

    const abortController = new AbortController()
    stemAbortControllerRef.current = abortController

    const url = URL.createObjectURL(file)
    const tempPlayer = new Tone.Player()
    await tempPlayer.load(url)
    const originalBuffer = tempPlayer.buffer.get() as AudioBuffer
    tempPlayer.dispose()

    const bpmResult = await detectBPM(originalBuffer)
    if (bpmResult.bpm) {
      console.log('[BPM] Detected:', bpmResult.bpm)
      setBpm(bpmResult.bpm)
      Tone.getTransport().bpm.value = bpmResult.bpm
      setErrorMessage(`Tempo: ${bpmResult.bpm}`)
      setTimeout(() => setErrorMessage(null), 3000)
    } else {
      console.log('[BPM] Detection failed, keeping current BPM')
      setErrorMessage('No se pudo detectar el tempo')
      setTimeout(() => setErrorMessage(null), 3000)
    }

    const stems = await separateStems(originalBuffer, (progress) => {
      setStemProgress(progress.progress)
    }, abortController.signal)

    const stemNames = ['Vocals', 'Drums', 'Bass', 'Other']
    const stemBuffers = [stems.vocals, stems.drums, stems.bass, stems.other]
    
    console.log('Stem amplitude check:')
    stemBuffers.forEach((buffer, i) => {
      const data = buffer.getChannelData(0)
      let peak = 0
      let rms = 0
      for (let j = 0; j < data.length; j++) {
        peak = Math.max(peak, Math.abs(data[j]))
        rms += data[j] * data[j]
      }
      rms = Math.sqrt(rms / data.length)
      console.log(`  ${stemNames[i]}: peak=${peak.toFixed(4)}, rms=${rms.toFixed(4)}, rms_dB=${(20 * Math.log10(rms)).toFixed(1)}`)
    })
    
    const newTrackStates = [...trackStates]

    for (let i = 0; i < stemBuffers.length; i++) {
      const targetTrackIndex = startTrackIndex + i
      if (targetTrackIndex >= trackStates.length) break

      const player = new Tone.Player()
      player.loop = false
      
      const toneBuffer = new Tone.ToneAudioBuffer(stemBuffers[i])
      player.buffer = toneBuffer
      
      player.connect(trackGainsRef.current[targetTrackIndex])

      const newClip: Clip = {
        player,
        fileName: `${file.name} - ${stemNames[i]}`,
        isPlaying: false,
        buffer: stemBuffers[i],
        startPosition: 0,
        offsetSeconds: getCountInSeconds(),
        id: `clip-${Date.now()}-${i}-${Math.random()}`
      }

      newTrackStates[targetTrackIndex] = {
        ...newTrackStates[targetTrackIndex],
        name: stemNames[i],
        clips: [...newTrackStates[targetTrackIndex].clips, newClip]
      }
    }

    setTrackStates(newTrackStates)
  }

  const handleMuteToggle = (trackIndex: number) => {
    setTrackStates(prev => {
      const newStates = [...prev]
      newStates[trackIndex] = {
        ...newStates[trackIndex],
        mute: !newStates[trackIndex].mute
      }
      return newStates
    })
  }

  const handleSoloToggle = (trackIndex: number) => {
    setTrackStates(prev => {
      const newStates = [...prev]
      newStates[trackIndex] = {
        ...newStates[trackIndex],
        solo: !newStates[trackIndex].solo
      }
      return newStates
    })
  }

  const handleVolumeChange = (trackIndex: number, volume: number) => {
    setTrackStates(prev => {
      const newStates = [...prev]
      newStates[trackIndex] = {
        ...newStates[trackIndex],
        volume
      }
      return newStates
    })
  }

  const handlePlayheadMouseDown = (e: React.MouseEvent) => {
    e.stopPropagation()
    setIsDraggingPlayhead(true)
  }

  const seekToPosition = (seconds: number) => {
    const maxDuration = getMaxDuration()
    const clampedSeconds = Math.max(0, Math.min(seconds, maxDuration))
    setPlayheadPosition(clampedSeconds)
    Tone.getTransport().seconds = clampedSeconds
    
    trackStates.forEach(track => {
      track.clips.forEach(clip => {
        const wasPlaying = clip.isPlaying
        if (wasPlaying) {
          clip.player.stop()
        }
        if (isPlaying) {
          const clipStartTime = clip.offsetSeconds
          const clipEndTime = clip.offsetSeconds + clip.buffer.duration
          
          if (clampedSeconds >= clipStartTime && clampedSeconds < clipEndTime) {
            const offset = clampedSeconds - clipStartTime
            clip.player.start(Tone.now(), offset)
            clip.isPlaying = true
          } else if (clampedSeconds < clipStartTime) {
            // Will be scheduled later by the normal playback logic
            const when = Tone.now() + (clipStartTime - clampedSeconds)
            clip.player.start(when, 0)
            clip.isPlaying = true
          }
        }
      })
    })
  }

  const handleWaveformClick = (e: React.MouseEvent<HTMLDivElement>, trackIndex: number) => {
    const track = trackStates[trackIndex]
    if (track.clips.length === 0) {
      handleLaneClick(trackIndex)
      return
    }

    if (isDraggingLoop || isDraggingLoopEdge || isDraggingClip) {
      return
    }

    const rect = e.currentTarget.getBoundingClientRect()
    const clickX = e.clientX - rect.left
    const percentage = clickX / rect.width
    const maxDuration = getMaxDuration()
    const clickTime = percentage * maxDuration

    seekToPosition(clickTime)
  }

  const clearLoop = () => {
    setLoopStart(null)
    setLoopEnd(null)
    setIsLoopEnabled(false)
    setIsDraggingLoop(false)
    setIsDraggingLoopEdge(null)
    setLoopDragStart(null)
    setTempLoopStart(null)
    setTempLoopEnd(null)
    
    // If currently playing, disable Transport loop immediately
    if (isPlaying) {
      Tone.getTransport().loop = false
    }
  }

  const handleLoopMouseDown = (e: React.MouseEvent<HTMLDivElement>, edge?: 'start' | 'end') => {
    if (!isLoopEnabled) return
    
    if (edge) {
      e.stopPropagation()
      setIsDraggingLoopEdge(edge)
      setTempLoopStart(loopStart)
      setTempLoopEnd(loopEnd)
    } else {
      const rect = e.currentTarget.getBoundingClientRect()
      const clickX = e.clientX - rect.left
      const percentage = clickX / rect.width
      const clickTime = percentage * getMaxDuration()
      
      setIsDraggingLoop(true)
      setLoopDragStart(clickTime)
      setTempLoopStart(clickTime)
      setTempLoopEnd(clickTime)
    }
  }

  const handleLoopMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!isLoopEnabled) return
    if (!isDraggingLoop && !isDraggingLoopEdge) return
    
    const rect = e.currentTarget.getBoundingClientRect()
    const clickX = e.clientX - rect.left
    const percentage = Math.max(0, Math.min(1, clickX / rect.width))
    const currentTime = percentage * getMaxDuration()
    
    if (isDraggingLoop && loopDragStart !== null) {
      if (currentTime < loopDragStart) {
        setTempLoopStart(currentTime)
        setTempLoopEnd(loopDragStart)
      } else {
        setTempLoopStart(loopDragStart)
        setTempLoopEnd(currentTime)
      }
    } else if (isDraggingLoopEdge === 'start') {
      const currentEnd = tempLoopEnd ?? loopEnd
      if (currentEnd === null || currentTime < currentEnd) {
        setTempLoopStart(currentTime)
      }
    } else if (isDraggingLoopEdge === 'end') {
      const currentStart = tempLoopStart ?? loopStart
      if (currentStart === null || currentTime > currentStart) {
        setTempLoopEnd(currentTime)
      }
    }
  }

  const handleLoopMouseUp = () => {
    if (isDraggingLoop || isDraggingLoopEdge) {
      // Commit temporary values to actual state
      if (tempLoopStart !== null) setLoopStart(tempLoopStart)
      if (tempLoopEnd !== null) setLoopEnd(tempLoopEnd)
      setTempLoopStart(null)
      setTempLoopEnd(null)
    }
    setIsDraggingLoop(false)
    setIsDraggingLoopEdge(null)
    setLoopDragStart(null)
  }

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isResizing) return
      e.preventDefault()
      const newWidth = Math.min(420, Math.max(160, e.clientX))
      setSidebarWidth(newWidth)
    }
    
    const handleMouseUp = () => {
      setIsResizing(false)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
    
    if (isResizing) {
      document.body.style.cursor = 'col-resize'
      document.body.style.userSelect = 'none'
      document.addEventListener('mousemove', handleMouseMove)
      document.addEventListener('mouseup', handleMouseUp)
      return () => {
        document.removeEventListener('mousemove', handleMouseMove)
        document.removeEventListener('mouseup', handleMouseUp)
        document.body.style.cursor = ''
        document.body.style.userSelect = ''
      }
    }
  }, [isResizing])

  useEffect(() => {
    if (!isDraggingPlayhead) return

    const handleMouseMove = (e: MouseEvent) => {
      const lanes = document.querySelectorAll('.track-content')
      if (lanes.length === 0) return
      
      const firstLane = lanes[0] as HTMLElement
      const rect = firstLane.getBoundingClientRect()
      const clickX = e.clientX - rect.left
      const percentage = Math.max(0, Math.min(1, clickX / rect.width))
      const maxDuration = getMaxDuration()
      const newTime = percentage * maxDuration
      
      seekToPosition(newTime)
    }

    const handleMouseUp = () => {
      setIsDraggingPlayhead(false)
    }

    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)
    document.body.style.userSelect = 'none'
    document.body.style.cursor = 'ew-resize'

    return () => {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
      document.body.style.userSelect = ''
      document.body.style.cursor = ''
    }
  }, [isDraggingPlayhead, trackStates, isPlaying])

  const rulerBars = useMemo(() => {
    const maxDuration = getMaxDuration()
    if (maxDuration === 0) return null
    
    const secondsPerBeat = 60 / bpm
    const beatsPerBar = 4
    const secondsPerBar = secondsPerBeat * beatsPerBar
    const totalBars = Math.ceil(maxDuration / secondsPerBar)
    const bars = []
    
    for (let bar = 0; bar <= totalBars; bar++) {
      const barTime = bar * secondsPerBar
      const position = (barTime / maxDuration) * 100
      
      if (position <= 100) {
        bars.push(
          <div key={bar} className="bar-marker" style={{ left: `${position}%` }}>
            <span className="bar-number">{bar + 1}</span>
          </div>
        )
        
        for (let beat = 1; beat < beatsPerBar; beat++) {
          const beatTime = barTime + beat * secondsPerBeat
          const beatPosition = (beatTime / maxDuration) * 100
          if (beatPosition <= 100) {
            bars.push(
              <div key={`${bar}-${beat}`} className="beat-marker" style={{ left: `${beatPosition}%` }} />
            )
          }
        }
      }
    }
    
    return bars
  }, [bpm, trackStates])

  return (
    <div className="app">
      <input
        ref={fileInputRef}
        type="file"
        accept="audio/wav,audio/mpeg,audio/mp3,audio/ogg,audio/webm,audio/*"
        style={{ display: 'none' }}
        onChange={handleFileSelect}
      />
      
      <div className="transport-bar">
        <div className="transport-controls">
          <button className="header-btn" onClick={handleNewProject} title="Nuevo proyecto">🆕</button>
          {currentUser ? (
            <button 
              className="header-btn" 
              onClick={handleLogout}
              title={`Sesión: ${currentUser.username}`}
            >
              👤 {currentUser.username}
            </button>
          ) : (
            <button 
              className="header-btn" 
              onClick={() => { setShowAuth(true); setAuthMode('login') }}
              title="Iniciar sesión"
            >
              🔑 Iniciar sesión
            </button>
          )}
          <button 
            className="header-btn" 
            onClick={handleSaveToCloud}
            title="Guardar en la nube"
          >
            ☁️ Guardar
          </button>
          <button 
            className="header-btn" 
            onClick={handleShowCloudProjects}
            title="Mis proyectos en la nube"
          >
            📁 Proyectos
          </button>
          <button 
            className="header-btn" 
            onClick={handleOpenExportDialog}
            title="Exportar pistas seleccionadas"
          >
            💾 Exportar
          </button>
        </div>
        <div className="transport-playback">
          <button
            className="transport-button icon-btn"
            onClick={handleJumpToStart}
            title="Ir al inicio"
          >
            ⏮
          </button>
          <button
            className={`transport-button icon-btn ${isPlaying ? 'active' : ''}`}
            onClick={handlePlay}
            disabled={isPlaying}
            title="Reproducir"
          >
            ▶
          </button>
          <button
            className="transport-button icon-btn"
            onClick={handlePause}
            disabled={!isPlaying}
            title="Pausar"
          >
            ⏸
          </button>
          <button
            className="transport-button icon-btn"
            onClick={handleStop}
            disabled={!isPlaying && !isPaused}
            title="Detener"
          >
            ⏹
          </button>
          <button
            className={`transport-button ${metronomeEnabled ? 'active' : ''}`}
            onClick={() => setMetronomeEnabled(!metronomeEnabled)}
            title="Metrónomo (cuenta 2 compases antes)"
          >
            🎵
          </button>
          <button
            className={`transport-button ${isLoopEnabled ? 'active' : ''}`}
            onClick={() => setIsLoopEnabled(!isLoopEnabled)}
            title="Activar loop - arrastra en el timeline para marcar zona"
          >
            🔁
          </button>
        </div>
        <div className="time-display">
          <span className="time-label">Time</span>
          <span className="time-value">
            {formatTime(playheadPosition)} / {formatTime(getMaxDuration())}
          </span>
        </div>
        {isLoopEnabled && (loopStart !== null || loopEnd !== null) && (
          <div className="loop-indicator">
            <span className="loop-label">Loop: {loopStart !== null ? formatTime(loopStart) : '--'} → {loopEnd !== null ? formatTime(loopEnd) : '--'}</span>
            <button className="transport-button clear-loop" onClick={clearLoop} title="Limpiar loop">Limpiar</button>
          </div>
        )}
        <div className="zoom-controls">
          <span className="zoom-label" title="Zoom horizontal (Ctrl+Rueda)">⬌</span>
          <input
            type="range"
            className="zoom-slider"
            min="0.5"
            max="4"
            step="0.1"
            value={horizontalZoom}
            onChange={(e) => setHorizontalZoom(parseFloat(e.target.value))}
            title={`Zoom horizontal: ${(horizontalZoom * 100).toFixed(0)}%`}
          />
          <span className="zoom-label" title="Zoom vertical (Shift+Rueda)">⬍</span>
          <input
            type="range"
            className="zoom-slider"
            min="0.5"
            max="3"
            step="0.1"
            value={verticalZoom}
            onChange={(e) => setVerticalZoom(parseFloat(e.target.value))}
            title={`Zoom vertical: ${(verticalZoom * 100).toFixed(0)}%`}
          />
        </div>
        <div className="bpm-control">
          <span className="bpm-label">BPM</span>
          <input
            type="number"
            className="bpm-input"
            value={bpm}
            onChange={handleBpmChange}
            min="20"
            max="300"
          />
        </div>
        <div className="header-info">
          <div className="audio-diagnostics">
            <span title="Context State">{Tone.getContext().state}</span>
            <span title="Sample Rate">{Tone.getContext().sampleRate}Hz</span>
            <span title="Output Level" className={audioLevel > -60 ? 'level-active' : 'level-inactive'}>
              {audioLevel > -100 ? `${audioLevel.toFixed(0)}dB` : '-∞'}
            </span>
            <button className="test-tone-btn" onClick={playTestTone} title="Test Tone (440Hz)">🔊</button>
          </div>
          <div className="version-badge">
            <span className="version-label">v{APP_VERSION}</span>
          </div>
        </div>
      </div>

      {showStemDialog && (
        <StemSplitDialog
          onConfirm={handleStemDialogConfirm}
          onCancel={handleStemDialogCancel}
        />
      )}

      {isProcessingStems && (
        <StemSplitProgress progress={stemProgress} onCancel={handleCancelStemSeparation} />
      )}
      
      {showToast && toastMessage && (
        <div className="toast">✓ {toastMessage}</div>
      )}
      
      {errorMessage && (
        <div className="error-toast">
          {errorMessage}
          <button onClick={() => setErrorMessage(null)}>×</button>
        </div>
      )}
      
      {uploadProgress > 0 && uploadProgress < 100 && (
        <div className="upload-progress">
          <div className="upload-bar" style={{ width: `${uploadProgress}%` }}></div>
          <span>{uploadProgress}% subiendo...</span>
        </div>
      )}
      
      {showExportDialog && (
        <div className="drive-projects-modal">
          <div className="modal-content">
            <h2>Exportar proyecto</h2>
            <p style={{ fontSize: '13px', color: '#999', marginBottom: '16px' }}>
              Selecciona las pistas a incluir en el archivo exportado
            </p>
            <div className="export-tracks-list">
              {trackStates.map((track, i) => (
                track.clips.length > 0 && (
                  <label key={i} className="export-track-item">
                    <input
                      type="checkbox"
                      checked={exportTracks[i] || false}
                      onChange={(e) => {
                        const newTracks = [...exportTracks]
                        newTracks[i] = e.target.checked
                        setExportTracks(newTracks)
                      }}
                    />
                    <span className="track-name">{track.name}</span>
                    {track.solo && <span className="track-badge solo">S</span>}
                    {track.mute && <span className="track-badge mute">M</span>}
                  </label>
                )
              ))}
            </div>
            <div style={{ display: 'flex', gap: '8px', marginTop: '20px' }}>
              <button className="modal-close" onClick={handleExport}>Exportar</button>
              <button className="modal-close" onClick={() => setShowExportDialog(false)}>Cancelar</button>
            </div>
          </div>
        </div>
      )}

      {showAuth && (
        <div className="drive-projects-modal">
          <div className="modal-content">
            <h2>{authMode === 'login' ? 'Iniciar sesión' : 'Crear cuenta'}</h2>
            {authMode === 'login' ? (
              <form onSubmit={(e) => {
                e.preventDefault()
                if (authLoading) return
                const formData = new FormData(e.currentTarget)
                handleLogin(
                  formData.get('email') as string,
                  formData.get('password') as string
                )
              }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  <input
                    type="email"
                    name="email"
                    placeholder="Email"
                    required
                    disabled={authLoading}
                    style={{ padding: '8px', fontSize: '14px' }}
                  />
                  <input
                    type="password"
                    name="password"
                    placeholder="Contraseña"
                    required
                    disabled={authLoading}
                    style={{ padding: '8px', fontSize: '14px' }}
                  />
                  <button type="submit" disabled={authLoading} style={{ padding: '8px' }}>
                    {authLoading ? 'Iniciando sesión...' : 'Iniciar sesión'}
                  </button>
                  <button
                    type="button"
                    onClick={() => { setAuthMode('register'); setErrorMessage(null) }}
                    disabled={authLoading}
                    style={{ padding: '8px', background: '#444' }}
                  >
                    ¿No tienes cuenta? Crear una
                  </button>
                </div>
              </form>
            ) : (
              <form onSubmit={(e) => {
                e.preventDefault()
                if (authLoading) return
                const formData = new FormData(e.currentTarget)
                handleRegister(
                  formData.get('username') as string,
                  formData.get('email') as string,
                  formData.get('password') as string
                )
              }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  <input
                    type="text"
                    name="username"
                    placeholder="Usuario"
                    required
                    minLength={3}
                    disabled={authLoading}
                    style={{ padding: '8px', fontSize: '14px' }}
                  />
                  <input
                    type="email"
                    name="email"
                    placeholder="Email"
                    required
                    disabled={authLoading}
                    style={{ padding: '8px', fontSize: '14px' }}
                  />
                  <input
                    type="password"
                    name="password"
                    placeholder="Contraseña (mínimo 6 caracteres)"
                    required
                    minLength={6}
                    disabled={authLoading}
                    style={{ padding: '8px', fontSize: '14px' }}
                  />
                  <button type="submit" disabled={authLoading} style={{ padding: '8px' }}>
                    {authLoading ? 'Creando cuenta...' : 'Crear cuenta'}
                  </button>
                  <button
                    type="button"
                    onClick={() => { setAuthMode('login'); setErrorMessage(null) }}
                    disabled={authLoading}
                    style={{ padding: '8px', background: '#444' }}
                  >
                    ¿Ya tienes cuenta? Iniciar sesión
                  </button>
                </div>
              </form>
            )}
            <button className="modal-close" onClick={() => { setShowAuth(false); setErrorMessage(null); setAuthLoading(false) }}>Cerrar</button>
          </div>
        </div>
      )}

      {showCloudProjects && (
        <div className="drive-projects-modal">
          <div className="modal-content">
            <h2>Mis proyectos en la nube</h2>
            <div className="storage-info">
              Espacio usado: {(storageUsage / 1024 / 1024).toFixed(2)} MB
              <button 
                onClick={handleMigrateLegacyProjects}
                style={{ marginLeft: '10px', padding: '4px 8px', fontSize: '12px' }}
                title="Copiar proyectos compartidos antiguos a tu cuenta (no elimina los originales)"
              >
                📦 Copiar proyectos compartidos
              </button>
            </div>
            <div className="projects-list">
              {cloudProjects.length === 0 ? (
                <p>No hay proyectos guardados</p>
              ) : (
                cloudProjects.map(project => (
                  <div key={project.pathname} className="project-item">
                    <div className="project-info">
                      <div className="project-name">{project.name}</div>
                      <div className="project-meta">
                        {new Date(project.uploadedAt).toLocaleDateString()} · {(project.size / 1024 / 1024).toFixed(2)} MB
                      </div>
                    </div>
                    <div className="project-actions">
                      <button onClick={() => handleOpenCloudProject(project.pathname, project.name)}>Abrir</button>
                      <button onClick={() => handleDeleteCloudProject(project.pathname, project.name)} className="delete-btn">Eliminar</button>
                    </div>
                  </div>
                ))
              )}
            </div>
            <button className="modal-close" onClick={() => setShowCloudProjects(false)}>Cerrar</button>
          </div>
        </div>
      )}
      
      {isExporting && exportProgress && (
        <div className="export-progress-toast">
          {exportProgress}
        </div>
      )}

      <div className="arrangement-view">
        <div className="sidebar-column" style={{ width: `${sidebarWidth}px` }}>
          {trackStates.map((trackState, trackIndex) => (
            <div key={trackIndex} className="track-header" style={{ height: `${88 * verticalZoom}px` }}>
              <div className="track-name">{trackState.name || `Track ${trackIndex + 1}`}</div>
              <div className="track-controls">
                <button
                  className={`control-button mute-button ${trackState.mute ? 'active' : ''}`}
                  onClick={() => handleMuteToggle(trackIndex)}
                  title="Mute"
                >
                  M
                </button>
                <button
                  className={`control-button solo-button ${trackState.solo ? 'active' : ''}`}
                  onClick={() => handleSoloToggle(trackIndex)}
                  title="Solo"
                >
                  S
                </button>
                <input
                  type="range"
                  className="volume-slider"
                  min="0"
                  max="1"
                  step="0.01"
                  value={trackState.volume}
                  onChange={(e) => handleVolumeChange(trackIndex, parseFloat(e.target.value))}
                  title={`Volume: ${Math.round(trackState.volume * 100)}%`}
                />
              </div>
              {trackState.clips.length > 0 && (
                <div className="track-actions">
                  <button
                    className="action-button"
                    onClick={() => handleSplitClip(trackIndex)}
                    title="Dividir clip en el playhead"
                  >
                    ✂️
                  </button>
                  <button
                    className="action-button"
                    onClick={() => handleCopyClip(trackIndex)}
                    title="Copiar clip"
                  >
                    📋
                  </button>
                  <button
                    className="action-button"
                    onClick={() => handlePasteClip(trackIndex)}
                    title="Pegar clip"
                  >
                    📄
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
        <div 
          className="resize-handle"
          onMouseDown={() => setIsResizing(true)}
          title="Drag to resize sidebar"
        />
        <div className="lanes-column" ref={lanesColumnRef} style={{ minWidth: `${100 * horizontalZoom}%` }}>
          <div className="bar-ruler">
            {rulerBars}
          </div>
          {trackStates.map((trackState, trackIndex) => {
            const hasClips = trackState.clips.length > 0
            const isAnyClipPlaying = trackState.clips.some(c => c.isPlaying)
            const maxDur = getMaxDuration() || 100
            
            return (
            <div 
              key={trackIndex}
              className={`track-content ${hasClips ? 'has-clip' : ''} ${isAnyClipPlaying ? 'playing' : ''}`}
              style={{ height: `${88 * verticalZoom}px` }}
              onClick={(e) => handleWaveformClick(e, trackIndex)}
            >
              {hasClips ? (
                <div 
                  className="clip-region"
                  onMouseDown={(e) => {
                    if (isLoopEnabled && e.button === 0 && !isDraggingLoopEdge && !isDraggingClip) {
                      handleLoopMouseDown(e)
                    }
                  }}
                  onMouseMove={handleLoopMouseMove}
                  onMouseUp={handleLoopMouseUp}
                >
                  {trackState.clips.map((clip) => {
                    const clipOffset = (isDraggingClip && draggedClipTrack === trackIndex && draggedClipId === clip.id) 
                      ? tempDragOffset 
                      : clip.offsetSeconds
                    
                    return (
                      <div 
                        key={clip.id}
                        className="clip-wrapper"
                        style={{
                          position: 'absolute',
                          left: `${(clipOffset / maxDur) * 100}%`,
                          width: `${(clip.buffer.duration / maxDur) * 100}%`,
                          height: '100%'
                        }}
                      >
                        <div 
                          className="clip-drag-handle"
                          onMouseDown={(e) => handleClipDragStart(e, trackIndex, clip.id)}
                          title="Arrastra para mover el clip en el tiempo"
                        >
                          <span className="drag-icon">↔</span>
                        </div>
                        <div className="clip-info">
                          <span className="clip-filename">{clip.fileName}</span>
                        </div>
                        <canvas
                          className="waveform-canvas"
                          ref={(el) => {
                            if (el && !el.dataset.drawn) {
                              el.width = el.offsetWidth * 2
                              el.height = el.offsetHeight * 2
                              drawWaveform(el, clip.buffer)
                              el.dataset.drawn = 'true'
                            }
                          }}
                        />
                      </div>
                    )
                  })}
                  {(loopStart !== null || tempLoopStart !== null) && (
                    <div 
                      className="loop-marker loop-start draggable"
                      style={{ 
                        left: `${((tempLoopStart ?? loopStart)! / maxDur) * 100}%` 
                      }}
                      onMouseDown={(e) => handleLoopMouseDown(e, 'start')}
                      title="Arrastra para ajustar inicio"
                    />
                  )}
                  {(loopEnd !== null || tempLoopEnd !== null) && (
                    <div 
                      className="loop-marker loop-end draggable"
                      style={{ 
                        left: `${((tempLoopEnd ?? loopEnd)! / maxDur) * 100}%` 
                      }}
                      onMouseDown={(e) => handleLoopMouseDown(e, 'end')}
                      title="Arrastra para ajustar fin"
                    />
                  )}
                  {((loopStart !== null && loopEnd !== null) || (tempLoopStart !== null && tempLoopEnd !== null)) && (
                    <div 
                      className="loop-region"
                      style={{ 
                        left: `${((tempLoopStart ?? loopStart)! / maxDur) * 100}%`,
                        width: `${(((tempLoopEnd ?? loopEnd)! - (tempLoopStart ?? loopStart)!) / maxDur) * 100}%`
                      }}
                    />
                  )}
                  {(isPlaying || isPaused) && (
                    <div 
                      className="playhead"
                      style={{ 
                        left: `${Math.min((playheadPosition / maxDur) * 100, 100)}%` 
                      }}
                      onMouseDown={handlePlayheadMouseDown}
                    />
                  )}
                </div>
              ) : (
                <div className="empty-lane">
                  <span className="import-hint">Click para importar audio</span>
                </div>
              )}
            </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

export default App
