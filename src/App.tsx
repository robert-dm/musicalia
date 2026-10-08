import { useState, useRef, useEffect, useMemo } from 'react'
import * as Tone from 'tone'
import JSZip from 'jszip'
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
  listCloudProjects,
  openProjectFromCloud,
  deleteProjectFromCloud,
  getStorageUsage,
  migrateLegacyProjects,
  getAuthToken,
  hasAuth,
  type ProjectMetadata,
  type User
} from './cloudStorage'
import { detectBPM } from './bpmDetector'

const APP_VERSION = '0.0071b'

interface Clip {
  player: Tone.Player
  fileName: string
  isPlaying: boolean
  buffer: AudioBuffer
  startPosition: number
  offsetSeconds: number
  id: string
  sourceStart: number
  duration: number
  selected?: boolean
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
  const localFileInputRef = useRef<HTMLInputElement>(null)
  const [selectedTrack, setSelectedTrack] = useState<number | null>(null)
  const [showYoutubeDialog, setShowYoutubeDialog] = useState(false)
  const [youtubeUrl, setYoutubeUrl] = useState('')
  const [isLoadingYoutube, setIsLoadingYoutube] = useState(false)
  const [youtubeError, setYoutubeError] = useState<string | null>(null)
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
  const [exportMixed, setExportMixed] = useState(false)
  const [exportIncludeCountIn, setExportIncludeCountIn] = useState(false)
  const [isDraggingClip, setIsDraggingClip] = useState(false)
  const [draggedClipTrack, setDraggedClipTrack] = useState<number | null>(null)
  const [draggedClipId, setDraggedClipId] = useState<string | null>(null)
  const [dragStartX, setDragStartX] = useState<number>(0)
  const [dragStartPosition, setDragStartPosition] = useState<number>(0)
  const [tempDragOffset, setTempDragOffset] = useState<number>(0)
  const [clipboard, setClipboard] = useState<{buffer: AudioBuffer, fileName: string} | null>(null)
  const projectLoadGenRef = useRef<number>(0)
  const [selectedClipIds, setSelectedClipIds] = useState<Set<string>>(new Set())
  const [resizingClip, setResizingClip] = useState<{trackIndex: number, clipId: string, edge: 'left' | 'right'} | null>(null)
  const [resizeStartX, setResizeStartX] = useState<number>(0)
  const [resizeStartValue, setResizeStartValue] = useState<number>(0)
  const [snapEnabled, setSnapEnabled] = useState(true)
  const [dragStartY, setDragStartY] = useState<number>(0)
  const [tempDragTrack, setTempDragTrack] = useState<number | null>(null)
  const [undoStack, setUndoStack] = useState<any[]>([])
  const [redoStack, setRedoStack] = useState<any[]>([])
  const [showHelp, setShowHelp] = useState(false)
  const [scissorsMode, setScissorsMode] = useState(false)
  const [currentFileHandle, setCurrentFileHandle] = useState<any>(null)
  const [cutLinePreview, setCutLinePreview] = useState<{trackIndex: number, time: number} | null>(null)
  const [isDraggingThreshold, setIsDraggingThreshold] = useState(false)
  const [dragDistance, setDragDistance] = useState(0)
  const waveformPeakCache = useRef<Map<AudioBuffer, Float32Array>>(new Map())
  
  const getCountInSeconds = () => {
    const secondsPerBeat = 60 / bpm
    const beatsPerBar = 4
    return countInBars * beatsPerBar * secondsPerBeat
  }

  const snapToGrid = (timeSeconds: number, forceSnap?: boolean): number => {
    if (!snapEnabled && !forceSnap) return timeSeconds
    const secondsPerBeat = 60 / bpm
    const snapInterval = secondsPerBeat / 4
    return Math.round(timeSeconds / snapInterval) * snapInterval
  }

  const saveUndo = () => {
    const state = {
      trackStates: trackStates.map(t => ({
        mute: t.mute,
        solo: t.solo,
        volume: t.volume,
        name: t.name,
        clips: t.clips.map(c => ({
          fileName: c.fileName,
          startPosition: c.startPosition,
          offsetSeconds: c.offsetSeconds,
          sourceStart: c.sourceStart,
          duration: c.duration,
          id: c.id,
          selected: c.selected,
          buffer: c.buffer,
          playerBuffer: c.player.buffer
        }))
      })),
      playheadPosition,
      loopStart,
      loopEnd
    }
    setUndoStack(prev => [...prev.slice(-49), state])
    setRedoStack([])
  }

  const handleUndo = () => {
    if (undoStack.length === 0) return
    const currentState = {
      trackStates: JSON.parse(JSON.stringify(trackStates.map(t => ({
        ...t,
        clips: t.clips.map(c => ({
          fileName: c.fileName,
          startPosition: c.startPosition,
          offsetSeconds: c.offsetSeconds,
          sourceStart: c.sourceStart,
          duration: c.duration,
          id: c.id,
          selected: c.selected
        }))
      })))),
      playheadPosition,
      loopStart,
      loopEnd
    }
    const prevState = undoStack[undoStack.length - 1]
    setUndoStack(prev => prev.slice(0, -1))
    setRedoStack(prev => [...prev, currentState])
    restoreState(prevState)
  }

  const handleRedo = () => {
    if (redoStack.length === 0) return
    const currentState = {
      trackStates: JSON.parse(JSON.stringify(trackStates.map(t => ({
        ...t,
        clips: t.clips.map(c => ({
          fileName: c.fileName,
          startPosition: c.startPosition,
          offsetSeconds: c.offsetSeconds,
          sourceStart: c.sourceStart,
          duration: c.duration,
          id: c.id,
          selected: c.selected
        }))
      })))),
      playheadPosition,
      loopStart,
      loopEnd
    }
    const nextState = redoStack[redoStack.length - 1]
    setRedoStack(prev => prev.slice(0, -1))
    setUndoStack(prev => [...prev, currentState])
    restoreState(nextState)
  }

  const restoreState = async (state: any) => {
    const currentClipMap = new Map<string, Clip>()
    trackStates.forEach(t => {
      t.clips.forEach(c => currentClipMap.set(c.id, c))
    })
    
    const newTrackStates = await Promise.all(state.trackStates.map(async (t: any, trackIdx: number) => {
      const clips = await Promise.all(t.clips.map(async (clipData: any) => {
        const existingClip = currentClipMap.get(clipData.id)
        if (existingClip) {
          return {
            ...existingClip,
            offsetSeconds: clipData.offsetSeconds,
            sourceStart: clipData.sourceStart,
            duration: clipData.duration,
            selected: clipData.selected
          }
        } else {
          const player = new Tone.Player()
          player.buffer = new Tone.ToneAudioBuffer(clipData.buffer)
          player.loop = false
          if (trackGainsRef.current[trackIdx]) {
            player.connect(trackGainsRef.current[trackIdx])
          }
          return {
            player,
            fileName: clipData.fileName,
            isPlaying: false,
            buffer: clipData.buffer,
            startPosition: clipData.startPosition,
            offsetSeconds: clipData.offsetSeconds,
            id: clipData.id,
            sourceStart: clipData.sourceStart,
            duration: clipData.duration,
            selected: clipData.selected
          }
        }
      }))
      
      const restoredClipIds = new Set(clips.map(c => c.id))
      trackStates[trackIdx]?.clips.forEach(c => {
        if (!restoredClipIds.has(c.id)) {
          c.player.dispose()
        }
      })
      
      return {
        ...t,
        clips: clips.filter(c => c !== null)
      }
    }))
    setTrackStates(newTrackStates as any)
    setPlayheadPosition(state.playheadPosition)
    setLoopStart(state.loopStart)
    setLoopEnd(state.loopEnd)
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
            id: clip.id,
            sourceStart: clip.sourceStart,
            duration: clip.duration
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
    const loadGen = projectLoadGenRef.current
    console.log(`[Mount] Starting local project load, gen=${loadGen}`)
    
    loadProject().then(async (state) => {
      if (!state) {
        console.log(`[Mount] No local project found`)
        return
      }
      
      // Check if a newer load has started (cloud open or new project)
      if (projectLoadGenRef.current !== loadGen) {
        console.log(`[Mount] Aborting stale local load (gen ${loadGen}, current ${projectLoadGenRef.current})`)
        return
      }
      
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
              id: t.clip.id || `clip-${Date.now()}-${i}-${Math.random()}`,
              sourceStart: (t.clip as any).sourceStart ?? 0,
              duration: (t.clip as any).duration ?? buffer.duration
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
            id: clipData.id || `clip-${Date.now()}-${i}-${Math.random()}`,
            sourceStart: clipData.sourceStart ?? 0,
            duration: clipData.duration ?? buffer.duration
          }
        }))
        
        return {
          ...t,
          clips: loadedClips.filter(c => c !== null) as Clip[]
        }
      }))
      
      // Final check before applying state
      if (projectLoadGenRef.current !== loadGen) {
        console.log(`[Mount] Aborting stale local load before setState (gen ${loadGen}, current ${projectLoadGenRef.current})`)
        return
      }
      
      setTrackStates(newTrackStates)
      setToastMessage('Proyecto local cargado')
      setShowToast(true)
      setTimeout(() => setShowToast(false), 3000)
      console.log(`[Mount] Local project loaded successfully`)
    })
  }, [])
  
  const handleNewProject = async () => {
    if (!confirm('¿Crear un nuevo proyecto? Se perderá el trabajo no guardado.')) return
    
    projectLoadGenRef.current++
    console.log(`[New Project] Starting new project, gen=${projectLoadGenRef.current}`)
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

  const handleSaveToLocal = async (saveAs = false) => {
    try {
      const hasAnyAudio = trackStates.some(t => t.clips.length > 0)
      if (!hasAnyAudio) {
        setErrorMessage('No hay audio para guardar. Importa al menos un archivo de audio.')
        setTimeout(() => setErrorMessage(null), 5000)
        return
      }
      
      // If we have a saved file handle and this is not "Save As", reuse it
      if (!saveAs && currentFileHandle) {
        await saveProjectToFileHandle(currentFileHandle, currentProjectName)
        return
      }
      
      // Otherwise, ask for file location FIRST (before any async work)
      // This preserves user activation for showSaveFilePicker
      const fileName = `${currentProjectName.replace(/[^a-z0-9]/gi, '_')}.musicalia`
      
      if ('showSaveFilePicker' in window) {
        try {
          const handle = await (window as any).showSaveFilePicker({
            suggestedName: fileName,
            types: [{
              description: 'Proyecto Musicalia',
              accept: { 'application/x-musicalia': ['.musicalia'] }
            }]
          })
          
          // Extract the project name from the chosen file name
          const savedFileName = handle.name.replace(/\.musicalia$/, '').replace(/_/g, ' ')
          setCurrentProjectName(savedFileName)
          setCurrentFileHandle(handle)
          
          await saveProjectToFileHandle(handle, savedFileName)
        } catch (e: any) {
          if (e.name === 'AbortError') {
            // User cancelled, do nothing
            return
          }
          throw e
        }
      } else {
        // Fallback for browsers without File System Access API
        await saveFallbackDownload(fileName)
      }
    } catch (err: any) {
      console.error('[Save] Error:', err)
      const errorMsg = err.message || 'Error al guardar'
      setErrorMessage(`Error al guardar: ${errorMsg}`)
      setTimeout(() => setErrorMessage(null), 5000)
    }
  }
  
  const saveProjectToFileHandle = async (fileHandle: any, projectName: string) => {
    try {
      setUploadProgress(5)
      setExportProgress('Preparando proyecto...')
      
      const zip = new JSZip()
      
      const projectData = {
        version: APP_VERSION,
        name: projectName,
        bpm,
        loopStart,
        loopEnd,
        playheadPosition,
        metronomeEnabled,
        countInBars,
        tracks: trackStates.map((t, trackIdx) => ({
          name: t.name,
          mute: t.mute,
          solo: t.solo,
          volume: t.volume,
          clips: t.clips.map((clip, clipIdx) => ({
            fileName: clip.fileName,
            startPosition: clip.startPosition,
            offsetSeconds: clip.offsetSeconds,
            id: clip.id,
            sourceStart: clip.sourceStart,
            duration: clip.duration,
            audioFile: `audio_${trackIdx}_${clipIdx}.wav`
          }))
        }))
      }
      
      zip.file('project.json', JSON.stringify(projectData, null, 2))
      
      setExportProgress('Procesando audio...')
      
      const bufferMap = new Map<AudioBuffer, string>()
      
      for (let trackIdx = 0; trackIdx < trackStates.length; trackIdx++) {
        const track = trackStates[trackIdx]
        for (let clipIdx = 0; clipIdx < track.clips.length; clipIdx++) {
          const clip = track.clips[clipIdx]
          
          let audioFileName: string
          if (bufferMap.has(clip.buffer)) {
            audioFileName = bufferMap.get(clip.buffer)!
          } else {
            audioFileName = `audio_${trackIdx}_${clipIdx}.wav`
            bufferMap.set(clip.buffer, audioFileName)
            
            const wavData = encodeWAV(
              [clip.buffer.getChannelData(0), clip.buffer.getChannelData(1)],
              clip.buffer.sampleRate
            )
            // Use STORE (no compression) for WAV files - they're already compressed
            // and DEFLATE is slow and doesn't save much space
            zip.file(audioFileName, wavData.buffer as ArrayBuffer, { compression: 'STORE' })
          }
          
          const progress = 10 + ((trackIdx * track.clips.length + clipIdx + 1) / 
            trackStates.reduce((sum, t) => sum + t.clips.length, 0)) * 80
          setUploadProgress(progress)
        }
      }
      
      setExportProgress('Empaquetando...')
      setUploadProgress(90)
      
      const blob = await zip.generateAsync({ 
        type: 'blob',
        compression: 'DEFLATE',
        compressionOptions: { level: 6 }
      })
      
      setExportProgress('Guardando en tu compu...')
      setUploadProgress(95)
      
      const writable = await fileHandle.createWritable()
      await writable.write(blob)
      await writable.close()
      
      setUploadProgress(100)
      
      setToastMessage(`✅ Proyecto guardado: ${projectName}`)
      setShowToast(true)
      setTimeout(() => setShowToast(false), 3000)
      
      console.log(`[Save] Project saved successfully: ${projectName}`)
    } catch (err: any) {
      console.error('[Save] Error:', err)
      throw err
    } finally {
      setUploadProgress(0)
      setExportProgress('')
    }
  }
  
  const saveFallbackDownload = async (fileName: string) => {
    try {
      setUploadProgress(5)
      setExportProgress('Preparando proyecto...')
      
      const zip = new JSZip()
      
      const projectData = {
        version: APP_VERSION,
        name: currentProjectName,
        bpm,
        loopStart,
        loopEnd,
        playheadPosition,
        metronomeEnabled,
        countInBars,
        tracks: trackStates.map((t, trackIdx) => ({
          name: t.name,
          mute: t.mute,
          solo: t.solo,
          volume: t.volume,
          clips: t.clips.map((clip, clipIdx) => ({
            fileName: clip.fileName,
            startPosition: clip.startPosition,
            offsetSeconds: clip.offsetSeconds,
            id: clip.id,
            sourceStart: clip.sourceStart,
            duration: clip.duration,
            audioFile: `audio_${trackIdx}_${clipIdx}.wav`
          }))
        }))
      }
      
      zip.file('project.json', JSON.stringify(projectData, null, 2))
      
      setExportProgress('Procesando audio...')
      
      const bufferMap = new Map<AudioBuffer, string>()
      
      for (let trackIdx = 0; trackIdx < trackStates.length; trackIdx++) {
        const track = trackStates[trackIdx]
        for (let clipIdx = 0; clipIdx < track.clips.length; clipIdx++) {
          const clip = track.clips[clipIdx]
          
          let audioFileName: string
          if (bufferMap.has(clip.buffer)) {
            audioFileName = bufferMap.get(clip.buffer)!
          } else {
            audioFileName = `audio_${trackIdx}_${clipIdx}.wav`
            bufferMap.set(clip.buffer, audioFileName)
            
            const wavData = encodeWAV(
              [clip.buffer.getChannelData(0), clip.buffer.getChannelData(1)],
              clip.buffer.sampleRate
            )
            zip.file(audioFileName, wavData.buffer as ArrayBuffer, { compression: 'STORE' })
          }
          
          const progress = 10 + ((trackIdx * track.clips.length + clipIdx + 1) / 
            trackStates.reduce((sum, t) => sum + t.clips.length, 0)) * 80
          setUploadProgress(progress)
        }
      }
      
      setExportProgress('Empaquetando...')
      setUploadProgress(90)
      
      const blob = await zip.generateAsync({ 
        type: 'blob',
        compression: 'DEFLATE',
        compressionOptions: { level: 6 }
      })
      
      setExportProgress('Descargando...')
      setUploadProgress(95)
      
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = fileName
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
      
      setUploadProgress(100)
      
      setToastMessage(`✅ Proyecto descargado: ${currentProjectName}`)
      setShowToast(true)
      setTimeout(() => setShowToast(false), 3000)
      
      console.log(`[Save] Project downloaded: ${currentProjectName}`)
    } catch (err: any) {
      console.error('[Save] Error:', err)
      throw err
    } finally {
      setUploadProgress(0)
      setExportProgress('')
    }
  }
  

  const handleOpenFromLocal = async (file: File) => {
    try {
      setExportProgress('Cargando proyecto...')
      setUploadProgress(5)
      
      const zip = new JSZip()
      const contents = await zip.loadAsync(file)
      
      setUploadProgress(10)
      
      const projectFile = contents.file('project.json')
      if (!projectFile) {
        throw new Error('Archivo de proyecto inválido: falta project.json')
      }
      
      const projectJson = await projectFile.async('string')
      const projectData = JSON.parse(projectJson)
      
      setUploadProgress(20)
      setExportProgress('Cargando audio...')
      
      await ensureAudio()
      
      projectLoadGenRef.current++
      const loadGen = projectLoadGenRef.current
      console.log(`[Open Local] Starting load, gen=${loadGen}`)
      
      const audioFiles = new Map<string, AudioBuffer>()
      const audioFileNames = Object.keys(contents.files).filter(name => name.endsWith('.wav'))
      
      for (let i = 0; i < audioFileNames.length; i++) {
        const fileName = audioFileNames[i]
        const file = contents.file(fileName)
        if (file) {
          const arrayBuffer = await file.async('arraybuffer')
          const audioBuffer = await Tone.context.decodeAudioData(arrayBuffer)
          audioFiles.set(fileName, audioBuffer)
          
          const progress = 20 + ((i + 1) / audioFileNames.length) * 60
          setUploadProgress(progress)
        }
      }
      
      setUploadProgress(80)
      setExportProgress('Restaurando proyecto...')
      
      const newTrackStates = await Promise.all(projectData.tracks.map(async (t: any, trackIdx: number) => {
        const clips = await Promise.all((t.clips || []).map(async (clipData: any) => {
          const audioBuffer = audioFiles.get(clipData.audioFile)
          if (!audioBuffer) {
            console.warn(`Audio file not found: ${clipData.audioFile}`)
            return null
          }
          
          const player = new Tone.Player()
          player.buffer = new Tone.ToneAudioBuffer(audioBuffer)
          player.loop = false
          
          if (!trackGainsRef.current[trackIdx]) {
            console.warn(`Track gain ${trackIdx} not available`)
            return null
          }
          player.connect(trackGainsRef.current[trackIdx])
          
          return {
            player,
            fileName: clipData.fileName,
            isPlaying: false,
            buffer: audioBuffer,
            startPosition: clipData.startPosition,
            offsetSeconds: clipData.offsetSeconds,
            id: clipData.id,
            sourceStart: clipData.sourceStart ?? 0,
            duration: clipData.duration ?? audioBuffer.duration
          }
        }))
        
        return {
          name: t.name,
          mute: t.mute,
          solo: t.solo,
          volume: t.volume,
          clips: clips.filter(c => c !== null) as Clip[]
        }
      }))
      
      if (projectLoadGenRef.current !== loadGen) {
        console.log(`[Open Local] Aborted due to newer load, current gen=${projectLoadGenRef.current}`)
        return
      }
      
      setBpm(projectData.bpm || 120)
      Tone.getTransport().bpm.value = projectData.bpm || 120
      setLoopStart(projectData.loopStart ?? null)
      setLoopEnd(projectData.loopEnd ?? null)
      setPlayheadPosition(projectData.playheadPosition || 0)
      setTrackStates(newTrackStates)
      setCurrentProjectName(projectData.name || 'Proyecto sin título')
      
      setUploadProgress(100)
      setToastMessage('Proyecto cargado desde tu computadora')
      setShowToast(true)
      setTimeout(() => setShowToast(false), 3000)
      
      console.log(`[Open Local] Load completed, gen=${loadGen}`)
    } catch (err: any) {
      console.error('Local open error:', err)
      setErrorMessage(err.message || 'Error al abrir proyecto local')
      setTimeout(() => setErrorMessage(null), 5000)
    } finally {
      setUploadProgress(0)
      setExportProgress('')
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
      projectLoadGenRef.current++
      console.log(`[Cloud Open] Starting cloud project load, gen=${projectLoadGenRef.current}`)
      const state = await openProjectFromCloud(pathname)
      
      console.log(`[handleOpenCloudProject] Received state with ${state.tracks.length} tracks`)
      state.tracks.forEach((t: any, i: number) => {
        const clipCount = t.clips?.length || (t.clip ? 1 : 0)
        console.log(`  Track ${i} (${t.name}): ${clipCount} clips`)
      })
      
      await ensureAudio()
      
      setBpm(state.bpm)
      setLoopStart(state.loopStart)
      setLoopEnd(state.loopEnd)
      setPlayheadPosition(state.playheadPosition)
      if (state.metronomeEnabled !== undefined) setMetronomeEnabled(state.metronomeEnabled)
      if (state.isLoopEnabled !== undefined) setIsLoopEnabled(state.isLoopEnabled)
      
      // Ensure trackGainsRef has enough entries for all loaded tracks
      const neededTracks = Math.max(state.tracks.length, 8)
      while (trackGainsRef.current.length < neededTracks) {
        const gain = new Tone.Gain(0.8).toDestination()
        trackGainsRef.current.push(gain)
        console.log(`Created gain node for track ${trackGainsRef.current.length - 1}`)
      }
      
      const loadedTracks = state.tracks.map((t: any, i: number) => {
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
          
          if (!trackGainsRef.current[i]) {
            throw new Error(`Track gain ${i} no disponible. Reinicia la aplicación.`)
          }
          player.connect(trackGainsRef.current[i])
          
          return {
            ...t,
            clips: [{
              player,
              fileName: t.clip.fileName,
              isPlaying: false,
              buffer,
              startPosition: t.clip.startPosition,
              offsetSeconds: t.clip.offsetSeconds ?? getCountInSeconds(),
              id: t.clip.id || `clip-${Date.now()}-${i}-${Math.random()}`,
              sourceStart: (t.clip as any).sourceStart ?? 0,
              duration: (t.clip as any).duration ?? buffer.duration
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
          
          if (!trackGainsRef.current[i]) {
            throw new Error(`Track gain ${i} no disponible. Reinicia la aplicación.`)
          }
          player.connect(trackGainsRef.current[i])
          
          return {
            player,
            fileName: clipData.fileName,
            isPlaying: false,
            buffer,
            startPosition: clipData.startPosition,
            offsetSeconds: clipData.offsetSeconds ?? getCountInSeconds(),
            id: clipData.id || `clip-${Date.now()}-${i}-${Math.random()}`,
            sourceStart: clipData.sourceStart ?? 0,
            duration: clipData.duration ?? buffer.duration
          }
        })
        
        return {
          ...t,
          clips: loadedClips
        }
      })
      
      // Pad to 8 tracks while preserving loaded tracks at correct indices
      const newTrackStates = Array.from({ length: 8 }, (_, i) => {
        if (i < loadedTracks.length) {
          return loadedTracks[i]
        }
        return {
          name: `Track ${i + 1}`,
          mute: false,
          solo: false,
          volume: 0.8,
          clips: []
        }
      })
      
      console.log(`Setting ${loadedTracks.length} loaded tracks, padded to ${newTrackStates.length} total`)
      console.log(`Track 0 clips:`, newTrackStates[0].clips.length)
      console.log(`Track 1 clips:`, newTrackStates[1].clips.length)
      
      setTrackStates(newTrackStates)
      setCurrentProjectName(name)
      setShowCloudProjects(false)
      
      // Verify tracks actually have audio before showing success
      const tracksWithAudio = newTrackStates.filter((t: any) => t.clips && t.clips.length > 0)
      const totalClips = newTrackStates.reduce((sum: number, t: any) => sum + (t.clips?.length || 0), 0)
      
      console.log(`Loaded project "${name}": ${tracksWithAudio.length} tracks with ${totalClips} clips`)
      
      if (totalClips > 0) {
        setToastMessage(`Proyecto abierto: ${totalClips} clips en ${tracksWithAudio.length} pistas`)
        setShowToast(true)
        setTimeout(() => setShowToast(false), 3000)
      } else {
        throw new Error('El proyecto se cargó pero no tiene audio. Los archivos pueden estar corruptos.')
      }
    } catch (err: any) {
      console.error('Failed to open project:', err)
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
      
      const countInSeconds = exportIncludeCountIn ? getCountInSeconds() : 0
      const maxDuration = Math.max(...effectiveIndices.flatMap(i => 
        trackStates[i].clips.map(clip => clip.offsetSeconds + clip.duration)
      ))
      const totalDuration = maxDuration + countInSeconds
      const sampleRate = trackStates[effectiveIndices[0]].clips[0].buffer.sampleRate
      
      if (exportMixed) {
        // Export all tracks mixed into one file
        setExportProgress('Renderizando mezcla...')
        
        const offlineContext = new OfflineAudioContext(2, totalDuration * sampleRate, sampleRate)
        
        // Add metronome count-in if requested
        if (exportIncludeCountIn && metronomePlayerRef.current?.buffer) {
          const beatsPerBar = 4
          const totalBeats = countInBars * beatsPerBar
          const secondsPerBeat = 60 / bpm
          
          for (let beat = 0; beat < totalBeats; beat++) {
            const source = offlineContext.createBufferSource()
            source.buffer = metronomePlayerRef.current.buffer.get() as AudioBuffer
            const gain = offlineContext.createGain()
            gain.gain.value = 0.5
            source.connect(gain)
            gain.connect(offlineContext.destination)
            source.start(beat * secondsPerBeat)
          }
        }
        
        for (const i of effectiveIndices) {
          const track = trackStates[i]
          if (track.mute) continue
          
          const gainNode = offlineContext.createGain()
          gainNode.gain.value = track.volume
          gainNode.connect(offlineContext.destination)
          
          for (const clip of track.clips) {
            const source = offlineContext.createBufferSource()
            source.buffer = clip.buffer
            source.connect(gainNode)
            source.start(clip.offsetSeconds + countInSeconds, clip.sourceStart, clip.duration)
          }
        }
        
        const renderedBuffer = await offlineContext.startRendering()
        
        setExportProgress('Codificando mezcla...')
        
        const wavData = encodeWAV(
          [renderedBuffer.getChannelData(0), renderedBuffer.getChannelData(1)],
          sampleRate
        )
        
        const blob = new Blob([wavData.buffer as ArrayBuffer], { type: 'audio/wav' })
        const url = URL.createObjectURL(blob)
        
        const fileName = sanitizeFilename(`${currentProjectName}.wav`)
        
        const a = document.createElement('a')
        a.href = url
        a.download = fileName
        a.click()
        
        URL.revokeObjectURL(url)
        
      } else {
        // Export tracks separately
        for (let idx = 0; idx < effectiveIndices.length; idx++) {
          const i = effectiveIndices[idx]
          const track = trackStates[i]
          
          setExportProgress(`Renderizando ${idx + 1}/${effectiveIndices.length}...`)
          
          const offlineContext = new OfflineAudioContext(2, totalDuration * sampleRate, sampleRate)
          
          // Add metronome count-in if requested
          if (exportIncludeCountIn && metronomePlayerRef.current?.buffer) {
            const beatsPerBar = 4
            const totalBeats = countInBars * beatsPerBar
            const secondsPerBeat = 60 / bpm
            
            for (let beat = 0; beat < totalBeats; beat++) {
              const source = offlineContext.createBufferSource()
              source.buffer = metronomePlayerRef.current.buffer.get() as AudioBuffer
              const gain = offlineContext.createGain()
              gain.gain.value = 0.5
              source.connect(gain)
              gain.connect(offlineContext.destination)
              source.start(beat * secondsPerBeat)
            }
          }
          
          const gainNode = offlineContext.createGain()
          gainNode.gain.value = track.volume
          gainNode.connect(offlineContext.destination)
          
          for (const clip of track.clips) {
            const source = offlineContext.createBufferSource()
            source.buffer = clip.buffer
            source.connect(gainNode)
            source.start(clip.offsetSeconds + countInSeconds, clip.sourceStart, clip.duration)
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

  const getOrComputePeaks = (buffer: AudioBuffer, peaksPerPixel = 4096): Float32Array => {
    const cache = waveformPeakCache.current
    if (cache.has(buffer)) {
      return cache.get(buffer)!
    }
    
    const data = buffer.getChannelData(0)
    const peakCount = Math.ceil(data.length / peaksPerPixel)
    const peaks = new Float32Array(peakCount * 2)
    
    for (let i = 0; i < peakCount; i++) {
      const start = i * peaksPerPixel
      const end = Math.min(start + peaksPerPixel, data.length)
      let min = 1.0
      let max = -1.0
      
      for (let j = start; j < end; j++) {
        const sample = data[j]
        if (sample < min) min = sample
        if (sample > max) max = sample
      }
      
      peaks[i * 2] = min
      peaks[i * 2 + 1] = max
    }
    
    cache.set(buffer, peaks)
    return peaks
  }

  const drawWaveform = (canvas: HTMLCanvasElement, buffer: AudioBuffer, sourceStart = 0, duration?: number) => {
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const width = canvas.width
    const height = canvas.height
    
    const clipDuration = duration ?? buffer.duration
    const peaksPerPixel = 4096
    const peaks = getOrComputePeaks(buffer, peaksPerPixel)
    
    const startSample = Math.floor(sourceStart * buffer.sampleRate)
    const endSample = Math.floor((sourceStart + clipDuration) * buffer.sampleRate)
    const sampleCount = endSample - startSample
    
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
      const sampleStart = startSample + Math.floor((i / width) * sampleCount)
      const sampleEnd = startSample + Math.floor(((i + 1) / width) * sampleCount)
      
      let min = 1.0
      let max = -1.0
      
      const peakStart = Math.floor(sampleStart / peaksPerPixel)
      const peakEnd = Math.ceil(sampleEnd / peaksPerPixel)
      
      for (let p = peakStart; p < peakEnd && p < peaks.length / 2; p++) {
        const peakMin = peaks[p * 2]
        const peakMax = peaks[p * 2 + 1]
        if (peakMin < min) min = peakMin
        if (peakMax > max) max = peakMax
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
    // Otherwise, start from current playhead position (clicked or paused)
    const startTime = (isLoopEnabled && loopStart !== null) ? loopStart : playheadPosition
    
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
        if (!clip.isPlaying && startTime < clip.offsetSeconds + clip.duration) {
          clip.player.loop = false
          
          const clipStartTime = clip.offsetSeconds
          const clipEndTime = clip.offsetSeconds + clip.duration
          
          let when = Tone.now()
          let offset = 0
          
          if (startTime < clipStartTime) {
            when = Tone.now() + (clipStartTime - startTime)
            offset = clip.sourceStart
          } else if (startTime >= clipStartTime && startTime < clipEndTime) {
            when = Tone.now()
            offset = clip.sourceStart + (startTime - clipStartTime)
          }
          
          if (when >= Tone.now() && offset < clip.buffer.duration) {
            const duration = clip.duration - (offset - clip.sourceStart)
            clip.player.start(when, offset, duration)
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
            trackStates.forEach(track => {
              track.clips.forEach(clip => {
                if (clip.player.state === 'started') {
                  clip.player.stop()
                }
                
                if (loopStart < clip.offsetSeconds + clip.duration) {
                  let when = Tone.now()
                  let offset = clip.sourceStart
                  
                  if (loopStart < clip.offsetSeconds) {
                    when = Tone.now() + (clip.offsetSeconds - loopStart)
                    offset = clip.sourceStart
                  } else if (loopStart >= clip.offsetSeconds) {
                    when = Tone.now()
                    offset = clip.sourceStart + (loopStart - clip.offsetSeconds)
                  }
                  
                  if (offset < clip.buffer.duration) {
                    const duration = clip.duration - (offset - clip.sourceStart)
                    clip.player.start(when, offset, duration)
                  }
                }
              })
            })
          }
        } else if (!isLoopEnabled && maxDuration > 0 && currentTime >= maxDuration) {
          Tone.getTransport().seconds = 0
          trackStates.forEach(track => {
            track.clips.forEach(clip => {
              if (clip.player.state === 'started') {
                clip.player.stop()
              }
              const when = Tone.now() + clip.offsetSeconds
              clip.player.start(when, clip.sourceStart, clip.duration)
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
    // Capture current position before stopping
    const currentPosition = Tone.getTransport().seconds
    
    Tone.getTransport().stop()
    
    if (playheadAnimationRef.current !== null) {
      cancelAnimationFrame(playheadAnimationRef.current)
      playheadAnimationRef.current = null
    }
    
    // Preserve playhead position where playback stopped
    setPlayheadPosition(currentPosition)
    Tone.getTransport().seconds = currentPosition
    
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
    saveUndo()
    
    const splitTime = playheadPosition
    
    const clipToSplit = track.clips.find(clip => 
      splitTime > clip.offsetSeconds && splitTime < clip.offsetSeconds + clip.duration
    )
    
    if (!clipToSplit) {
      setErrorMessage('El playhead debe estar dentro de un clip')
      setTimeout(() => setErrorMessage(null), 3000)
      return
    }
    
    const splitOffset = splitTime - clipToSplit.offsetSeconds
    
    const firstPlayer = new Tone.Player()
    firstPlayer.buffer = clipToSplit.player.buffer
    firstPlayer.loop = false
    firstPlayer.connect(trackGainsRef.current[trackIndex])
    
    const secondPlayer = new Tone.Player()
    secondPlayer.buffer = clipToSplit.player.buffer
    secondPlayer.loop = false
    secondPlayer.connect(trackGainsRef.current[trackIndex])
    
    const newTrackStates = [...trackStates]
    const updatedClips = track.clips.map(clip => {
      if (clip.id === clipToSplit.id) {
        return null
      }
      return clip
    }).filter(c => c !== null) as Clip[]
    
    updatedClips.push({
      player: firstPlayer,
      fileName: clipToSplit.fileName,
      isPlaying: false,
      buffer: clipToSplit.buffer,
      startPosition: clipToSplit.startPosition,
      offsetSeconds: clipToSplit.offsetSeconds,
      id: `${clipToSplit.id}-part1`,
      sourceStart: clipToSplit.sourceStart,
      duration: splitOffset
    })
    
    updatedClips.push({
      player: secondPlayer,
      fileName: clipToSplit.fileName,
      isPlaying: false,
      buffer: clipToSplit.buffer,
      startPosition: 0,
      offsetSeconds: splitTime,
      id: `${clipToSplit.id}-part2`,
      sourceStart: clipToSplit.sourceStart + splitOffset,
      duration: clipToSplit.duration - splitOffset
    })
    
    clipToSplit.player.dispose()
    
    newTrackStates[trackIndex] = {
      ...newTrackStates[trackIndex],
      clips: updatedClips
    }
    
    setTrackStates(newTrackStates)
    setToastMessage('Clip dividido')
    setShowToast(true)
    setTimeout(() => setShowToast(false), 2000)
  }

  const splitClipAt = async (trackIndex: number, splitTime: number) => {
    const track = trackStates[trackIndex]
    if (track.clips.length === 0) return false
    
    await ensureAudio()
    
    const clipToSplit = track.clips.find(clip => 
      splitTime > clip.offsetSeconds && splitTime < clip.offsetSeconds + clip.duration
    )
    
    if (!clipToSplit) return false
    
    saveUndo()
    
    const splitOffset = splitTime - clipToSplit.offsetSeconds
    
    const firstPlayer = new Tone.Player()
    firstPlayer.buffer = clipToSplit.player.buffer
    firstPlayer.loop = false
    firstPlayer.connect(trackGainsRef.current[trackIndex])
    
    const secondPlayer = new Tone.Player()
    secondPlayer.buffer = clipToSplit.player.buffer
    secondPlayer.loop = false
    secondPlayer.connect(trackGainsRef.current[trackIndex])
    
    const newTrackStates = [...trackStates]
    const updatedClips = track.clips.map(clip => {
      if (clip.id === clipToSplit.id) {
        return null
      }
      return clip
    }).filter(c => c !== null) as Clip[]
    
    updatedClips.push({
      player: firstPlayer,
      fileName: clipToSplit.fileName,
      isPlaying: false,
      buffer: clipToSplit.buffer,
      startPosition: clipToSplit.startPosition,
      offsetSeconds: clipToSplit.offsetSeconds,
      id: `${clipToSplit.id}-part1`,
      sourceStart: clipToSplit.sourceStart,
      duration: splitOffset
    })
    
    updatedClips.push({
      player: secondPlayer,
      fileName: clipToSplit.fileName,
      isPlaying: false,
      buffer: clipToSplit.buffer,
      startPosition: 0,
      offsetSeconds: splitTime,
      id: `${clipToSplit.id}-part2`,
      sourceStart: clipToSplit.sourceStart + splitOffset,
      duration: clipToSplit.duration - splitOffset
    })
    
    clipToSplit.player.dispose()
    
    newTrackStates[trackIndex] = {
      ...newTrackStates[trackIndex],
      clips: updatedClips
    }
    
    setTrackStates(newTrackStates)
    setToastMessage('Clip dividido')
    setShowToast(true)
    setTimeout(() => setShowToast(false), 2000)
    return true
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
      id: `clip-${Date.now()}-${Math.random()}`,
      sourceStart: 0,
      duration: clipboard.buffer.duration
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

  const handleClipClick = (e: React.MouseEvent, trackIndex: number, clipId: string) => {
    e.stopPropagation()
    
    const clip = trackStates[trackIndex].clips.find(c => c.id === clipId)
    if (!clip) return
    
    if (scissorsMode || (e.altKey && !e.shiftKey)) {
      const rect = e.currentTarget.getBoundingClientRect()
      const clickX = e.clientX - rect.left
      const percentage = clickX / rect.width
      const clipTime = clip.offsetSeconds + (percentage * clip.duration)
      const splitTime = (scissorsMode && snapEnabled && !e.shiftKey) || (e.altKey && snapEnabled && !e.shiftKey) 
        ? snapToGrid(clipTime) 
        : clipTime
      
      if (splitTime > clip.offsetSeconds && splitTime < clip.offsetSeconds + clip.duration) {
        splitClipAt(trackIndex, splitTime)
      }
      return
    }
    
    if (e.shiftKey) {
      setSelectedClipIds(prev => {
        const newSet = new Set(prev)
        if (newSet.has(clipId)) {
          newSet.delete(clipId)
        } else {
          newSet.add(clipId)
        }
        return newSet
      })
    } else {
      setSelectedClipIds(new Set([clipId]))
    }
  }

  const handleClipDragStart = (e: React.MouseEvent, trackIndex: number, clipId: string) => {
    e.stopPropagation()
    
    if (scissorsMode) return
    
    if (!selectedClipIds.has(clipId)) {
      setSelectedClipIds(new Set([clipId]))
    }
    
    const clip = trackStates[trackIndex].clips.find(c => c.id === clipId)
    if (!clip) return
    
    setIsDraggingThreshold(e.altKey)
    setDragDistance(0)
    setIsDraggingClip(true)
    setDraggedClipTrack(trackIndex)
    setDraggedClipId(clipId)
    setDragStartX(e.clientX)
    setDragStartY(e.clientY)
    setDragStartPosition(clip.offsetSeconds)
    setTempDragOffset(clip.offsetSeconds)
    setTempDragTrack(trackIndex)
  }

  const handleResizeStart = (e: React.MouseEvent, trackIndex: number, clipId: string, edge: 'left' | 'right') => {
    e.stopPropagation()
    
    const clip = trackStates[trackIndex].clips.find(c => c.id === clipId)
    if (!clip) return
    
    saveUndo()
    setResizingClip({ trackIndex, clipId, edge })
    setResizeStartX(e.clientX)
    setResizeStartValue(edge === 'left' ? clip.sourceStart : clip.duration)
  }

  const handleDeleteSelected = () => {
    if (selectedClipIds.size === 0) return
    
    saveUndo()
    const newTrackStates = trackStates.map(track => ({
      ...track,
      clips: track.clips.filter(clip => {
        if (selectedClipIds.has(clip.id)) {
          clip.player.dispose()
          return false
        }
        return true
      })
    }))
    setTrackStates(newTrackStates)
    setSelectedClipIds(new Set())
    setToastMessage('Clip eliminado')
    setShowToast(true)
    setTimeout(() => setShowToast(false), 2000)
  }

  const handleDuplicateSelected = () => {
    if (selectedClipIds.size === 0) return
    
    saveUndo()
    const newTrackStates = [...trackStates]
    const newSelectedIds = new Set<string>()
    
    selectedClipIds.forEach(id => {
      for (let ti = 0; ti < trackStates.length; ti++) {
        const sourceClip = trackStates[ti].clips.find(c => c.id === id)
        if (sourceClip) {
          const player = new Tone.Player()
          player.buffer = sourceClip.player.buffer
          player.loop = false
          player.connect(trackGainsRef.current[ti])
          
          const newClip: Clip = {
            player,
            fileName: sourceClip.fileName,
            isPlaying: false,
            buffer: sourceClip.buffer,
            startPosition: sourceClip.startPosition,
            offsetSeconds: sourceClip.offsetSeconds + sourceClip.duration,
            id: `clip-${Date.now()}-${Math.random()}`,
            sourceStart: sourceClip.sourceStart,
            duration: sourceClip.duration
          }
          newTrackStates[ti].clips.push(newClip)
          newSelectedIds.add(newClip.id)
        }
      }
    })
    
    setTrackStates(newTrackStates)
    setSelectedClipIds(newSelectedIds)
    setToastMessage('Clip duplicado')
    setShowToast(true)
    setTimeout(() => setShowToast(false), 2000)
  }

  useEffect(() => {
    if (!isDraggingClip || draggedClipTrack === null || draggedClipId === null) return

    const handleMouseMove = (e: MouseEvent) => {
      const lanes = document.querySelectorAll('.track-content')
      if (lanes.length === 0) return
      
      const deltaX = e.clientX - dragStartX
      const deltaY = e.clientY - dragStartY
      const distance = Math.sqrt(deltaX * deltaX + deltaY * deltaY)
      
      if (isDraggingThreshold && distance < 5) {
        return
      }
      
      if (isDraggingThreshold && distance >= 5) {
        saveUndo()
        const newTrackStates = [...trackStates]
        selectedClipIds.forEach(id => {
          for (let ti = 0; ti < trackStates.length; ti++) {
            const sourceClip = trackStates[ti].clips.find(c => c.id === id)
            if (sourceClip) {
              const player = new Tone.Player()
              player.buffer = sourceClip.player.buffer
              player.loop = false
              player.connect(trackGainsRef.current[ti])
              
              const newClip: Clip = {
                player,
                fileName: sourceClip.fileName,
                isPlaying: false,
                buffer: sourceClip.buffer,
                startPosition: sourceClip.startPosition,
                offsetSeconds: sourceClip.offsetSeconds + 0.001,
                id: `clip-${Date.now()}-${Math.random()}`,
                sourceStart: sourceClip.sourceStart,
                duration: sourceClip.duration,
                selected: true
              }
              newTrackStates[ti].clips.push(newClip)
              setSelectedClipIds(prev => {
                const newSet = new Set(prev)
                newSet.add(newClip.id)
                return newSet
              })
            }
          }
        })
        setTrackStates(newTrackStates)
        setIsDraggingThreshold(false)
      }
      
      const firstLane = lanes[0] as HTMLElement
      const rect = firstLane.getBoundingClientRect()
      const deltaPercentage = deltaX / rect.width
      const maxDuration = getMaxDuration() || 100
      const deltaTime = deltaPercentage * maxDuration
      
      const rawOffset = Math.max(0, dragStartPosition + deltaTime)
      const newOffset = snapEnabled && !e.shiftKey ? snapToGrid(rawOffset) : rawOffset
      setTempDragOffset(newOffset)
      
      const trackHeight = 88
      const trackDelta = Math.round(deltaY / trackHeight)
      const newTrack = Math.max(0, Math.min(trackStates.length - 1, draggedClipTrack + trackDelta))
      setTempDragTrack(newTrack)
      
      setDragDistance(distance)
    }

    const handleMouseUp = () => {
      if (isDraggingThreshold && dragDistance < 5) {
        setIsDraggingClip(false)
        setDraggedClipTrack(null)
        setDraggedClipId(null)
        setTempDragTrack(null)
        setIsDraggingThreshold(false)
        return
      }
      
      const newTrackStates = [...trackStates]
      const targetTrack = tempDragTrack ?? draggedClipTrack
      
      if (!isDraggingThreshold) {
        saveUndo()
      }
      
      selectedClipIds.forEach(id => {
        for (let ti = 0; ti < trackStates.length; ti++) {
          const clipIndex = trackStates[ti].clips.findIndex(c => c.id === id)
          if (clipIndex !== -1) {
            const clip = trackStates[ti].clips[clipIndex]
            const timeDelta = tempDragOffset - dragStartPosition
            const trackDelta = targetTrack - draggedClipTrack
            
            if (ti === draggedClipTrack && trackDelta !== 0) {
              const movedClip = { ...clip, offsetSeconds: clip.offsetSeconds + timeDelta }
              newTrackStates[ti].clips.splice(clipIndex, 1)
              newTrackStates[targetTrack].clips.push(movedClip)
            } else if (id === draggedClipId || ti !== draggedClipTrack) {
              newTrackStates[ti].clips[clipIndex] = {
                ...clip,
                offsetSeconds: clip.offsetSeconds + timeDelta
              }
            }
          }
        }
      })
      
      setTrackStates(newTrackStates)
      setIsDraggingClip(false)
      setDraggedClipTrack(null)
      setDraggedClipId(null)
      setTempDragTrack(null)
      setIsDraggingThreshold(false)
    }

    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)
    document.body.style.userSelect = 'none'
    document.body.style.cursor = 'move'

    return () => {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
      document.body.style.userSelect = ''
      document.body.style.cursor = ''
    }
  }, [isDraggingClip, draggedClipTrack, draggedClipId, dragStartX, dragStartY, dragStartPosition, tempDragOffset, tempDragTrack, selectedClipIds, snapEnabled, isDraggingThreshold, dragDistance])

  useEffect(() => {
    if (!resizingClip) return

    const handleMouseMove = (e: MouseEvent) => {
      const lanes = document.querySelectorAll('.track-content')
      if (lanes.length === 0) return
      
      const firstLane = lanes[0] as HTMLElement
      const rect = firstLane.getBoundingClientRect()
      const deltaX = e.clientX - resizeStartX
      const deltaPercentage = deltaX / rect.width
      const maxDuration = getMaxDuration() || 100
      const deltaTime = deltaPercentage * maxDuration
      
      const newTrackStates = [...trackStates]
      const clip = newTrackStates[resizingClip.trackIndex].clips.find(c => c.id === resizingClip.clipId)
      if (!clip) return
      
      if (resizingClip.edge === 'left') {
        const newSourceStart = Math.max(0, Math.min(clip.buffer.duration - 0.1, resizeStartValue + deltaTime))
        const sourceDelta = newSourceStart - clip.sourceStart
        clip.sourceStart = newSourceStart
        clip.duration = Math.max(0.1, clip.duration - sourceDelta)
        clip.offsetSeconds = Math.max(0, clip.offsetSeconds + sourceDelta)
      } else {
        const newDuration = Math.max(0.1, Math.min(clip.buffer.duration - clip.sourceStart, resizeStartValue + deltaTime))
        clip.duration = newDuration
      }
      
      setTrackStates(newTrackStates)
    }

    const handleMouseUp = () => {
      setResizingClip(null)
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
  }, [resizingClip, resizeStartX, resizeStartValue])

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return
      
      const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0
      const cmdOrCtrl = isMac ? e.metaKey : e.ctrlKey
      
      if (e.key === 's' && cmdOrCtrl && e.shiftKey) {
        e.preventDefault()
        handleSaveToLocal(true)
      } else if (e.key === 's' && cmdOrCtrl) {
        e.preventDefault()
        handleSaveToLocal(false)
      } else if ((e.key === 'Delete' || e.key === 'Backspace') && selectedClipIds.size > 0) {
        e.preventDefault()
        handleDeleteSelected()
      } else if (e.key === 's' && !cmdOrCtrl && !e.shiftKey) {
        e.preventDefault()
        const trackWithClip = trackStates.findIndex(t => t.clips.some(c => 
          playheadPosition >= c.offsetSeconds && playheadPosition < c.offsetSeconds + c.duration
        ))
        if (trackWithClip !== -1) {
          handleSplitClip(trackWithClip)
        }
      } else if (e.key === 'e' && cmdOrCtrl && selectedClipIds.size === 0) {
        e.preventDefault()
        const trackWithClip = trackStates.findIndex(t => t.clips.some(c => 
          playheadPosition >= c.offsetSeconds && playheadPosition < c.offsetSeconds + c.duration
        ))
        if (trackWithClip !== -1) {
          handleSplitClip(trackWithClip)
        }
      } else if (e.key === 'c' && cmdOrCtrl && selectedClipIds.size > 0) {
        e.preventDefault()
        const clipToCopy = trackStates.flatMap(t => t.clips).find(c => selectedClipIds.has(c.id))
        if (clipToCopy) {
          setClipboard({ buffer: clipToCopy.buffer, fileName: clipToCopy.fileName })
          setToastMessage('Clip copiado')
          setShowToast(true)
          setTimeout(() => setShowToast(false), 2000)
        }
      } else if (e.key === 'v' && cmdOrCtrl && clipboard) {
        e.preventDefault()
        const targetTrack = trackStates.findIndex(t => t.clips.some(c => selectedClipIds.has(c.id)))
        if (targetTrack !== -1) {
          handlePasteClip(targetTrack)
        } else {
          handlePasteClip(0)
        }
      } else if (e.key === 'd' && cmdOrCtrl && selectedClipIds.size > 0) {
        e.preventDefault()
        handleDuplicateSelected()
      } else if (e.key === 'z' && cmdOrCtrl && !e.shiftKey) {
        e.preventDefault()
        handleUndo()
      } else if ((e.key === 'z' && cmdOrCtrl && e.shiftKey) || (e.key === 'y' && cmdOrCtrl)) {
        e.preventDefault()
        handleRedo()
      } else if (e.key === 'a' && cmdOrCtrl) {
        e.preventDefault()
        const allClipIds = new Set(trackStates.flatMap(t => t.clips.map(c => c.id)))
        setSelectedClipIds(allClipIds)
      }
    }
    
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [selectedClipIds, trackStates, playheadPosition, clipboard, undoStack, redoStack])

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
      
      // Show error message via toast/error system instead of alert
      setErrorMessage(`⚠️ Separación de stems no disponible: ${errorMessage}`)
      setTimeout(() => setErrorMessage(null), 5000)
      
      // Fall back to single track import
      try {
        await loadSingleTrack(file, track)
        setToastMessage('Audio cargado como pista única')
        setShowToast(true)
        setTimeout(() => setShowToast(false), 3000)
      } catch (loadError) {
        console.error('Failed to load single track:', loadError)
        setErrorMessage('Error al cargar el archivo de audio.')
        setTimeout(() => setErrorMessage(null), 5000)
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

  const handleYoutubeImport = async () => {
    if (!youtubeUrl.trim()) {
      setYoutubeError('Ingresa una URL de YouTube')
      return
    }

    if (selectedTrack === null) {
      setYoutubeError('Selecciona una pista primero')
      return
    }

    setIsLoadingYoutube(true)
    setYoutubeError(null)

    try {
      // Initial request to check if chunking is needed
      const initialResponse = await fetch('/api/youtube-audio', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${getAuthToken()}`
        },
        body: JSON.stringify({ url: youtubeUrl })
      })

      if (!initialResponse.ok) {
        const error = await initialResponse.json()
        throw new Error(error.error || 'Error al obtener audio de YouTube')
      }

      const contentType = initialResponse.headers.get('Content-Type') || 'audio/mp4'
      
      // Check if response is JSON (chunking metadata) or binary (direct stream)
      let audioBlob: Blob
      let videoTitle = 'YouTube Audio'
      
      if (contentType.includes('application/json')) {
        // Chunked response - fetch all chunks
        const metadata = await initialResponse.json()
        
        if (!metadata.needsChunking) {
          throw new Error('Respuesta inesperada del servidor')
        }
        
        videoTitle = metadata.videoTitle
        const chunks: Uint8Array[] = []
        
        console.log(`[YouTube] Fetching ${metadata.totalChunks} chunks (${(metadata.estimatedSize / 1024 / 1024).toFixed(1)}MB)`)
        
        // Fetch all chunks sequentially
        for (let i = 0; i < metadata.totalChunks; i++) {
          console.log(`[YouTube] Fetching chunk ${i + 1}/${metadata.totalChunks}`)
          
          const chunkResponse = await fetch('/api/youtube-audio', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${getAuthToken()}`
            },
            body: JSON.stringify({ url: youtubeUrl, chunkIndex: i })
          })
          
          if (!chunkResponse.ok) {
            throw new Error(`Error en chunk ${i + 1}: ${chunkResponse.statusText}`)
          }
          
          const chunkData = await chunkResponse.arrayBuffer()
          chunks.push(new Uint8Array(chunkData))
          
          // Optional: Update progress if we want to show it
          // const progress = Math.round(((i + 1) / metadata.totalChunks) * 100)
        }
        
        // Concatenate all chunks
        const totalLength = chunks.reduce((acc, chunk) => acc + chunk.length, 0)
        const combined = new Uint8Array(totalLength)
        let offset = 0
        for (const chunk of chunks) {
          combined.set(chunk, offset)
          offset += chunk.length
        }
        
        audioBlob = new Blob([combined], { type: metadata.mimeType })
        
      } else {
        // Direct streaming response (small file)
        videoTitle = decodeURIComponent(initialResponse.headers.get('X-Video-Title') || 'YouTube Audio')
        audioBlob = await initialResponse.blob()
      }
      
      const file = new File([audioBlob], `${videoTitle}.${contentType.includes('webm') ? 'webm' : 'm4a'}`, { type: contentType })

      // Close dialog
      setShowYoutubeDialog(false)
      setYoutubeUrl('')

      // Check if stem separation is supported
      const { supported, reason } = await isStemSeparationSupported()
      
      if (!supported) {
        console.warn('Stem separation not supported:', reason)
        alert(`Separación de stems no disponible: ${reason}\n\nCargando como pista única.`)
        await loadSingleTrack(file, selectedTrack)
        setSelectedTrack(null)
        return
      }

      // Store the file and show dialog
      pendingFileRef.current = file
      setShowStemDialog(true)

    } catch (error: any) {
      console.error('YouTube import error:', error)
      setYoutubeError(error.message || 'Error al importar desde YouTube')
    } finally {
      setIsLoadingYoutube(false)
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
      id: `clip-${Date.now()}-${Math.random()}`,
      sourceStart: 0,
      duration: buffer.duration
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
    const stemOffset = getCountInSeconds()

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
        offsetSeconds: stemOffset,
        id: `clip-${Date.now()}-${i}-${Math.random()}`,
        sourceStart: 0,
        duration: stemBuffers[i].duration
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
          const clipEndTime = clip.offsetSeconds + clip.duration
          
          if (clampedSeconds >= clipStartTime && clampedSeconds < clipEndTime) {
            const offset = clip.sourceStart + (clampedSeconds - clipStartTime)
            const duration = clip.duration - (clampedSeconds - clipStartTime)
            clip.player.start(Tone.now(), offset, duration)
            clip.isPlaying = true
          } else if (clampedSeconds < clipStartTime) {
            const when = Tone.now() + (clipStartTime - clampedSeconds)
            clip.player.start(when, clip.sourceStart, clip.duration)
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

  const handleLoopToggle = () => {
    if (isLoopEnabled) {
      // Turning loop off - clear the region
      setLoopStart(null)
      setLoopEnd(null)
      setTempLoopStart(null)
      setTempLoopEnd(null)
    }
    setIsLoopEnabled(!isLoopEnabled)
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
      <input
        ref={localFileInputRef}
        type="file"
        accept=".musicalia"
        style={{ display: 'none' }}
        onChange={(e) => {
          const file = e.target.files?.[0]
          if (file) {
            handleOpenFromLocal(file)
          }
          if (localFileInputRef.current) {
            localFileInputRef.current.value = ''
          }
        }}
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
            onClick={() => handleSaveToLocal(false)}
            title="Guardar proyecto (Cmd/Ctrl+S, Shift+Cmd/Ctrl+S para guardar como...)"
          >
            💾 Guardar
          </button>
          <button
            className="header-btn"
            onClick={() => localFileInputRef.current?.click()}
            title="Abrir proyecto"
          >
            📂 Abrir
          </button>
          <button 
            className="header-btn" 
            onClick={handleShowCloudProjects}
            title="Abrir proyectos anteriores guardados en la nube"
            style={{ fontSize: '11px', padding: '8px 10px' }}
          >
            ☁️ Proyectos en la nube (anteriores)
          </button>
          <button 
            className="header-btn" 
            onClick={handleOpenExportDialog}
            title="Exportar pistas seleccionadas"
          >
            🎵 Exportar
          </button>
          <button
            className="header-btn"
            onClick={() => {
              if (!hasAuth()) {
                setErrorMessage('Inicia sesión para importar desde YouTube')
                setTimeout(() => setErrorMessage(null), 3000)
                return
              }
              if (trackStates.some(t => t.clips.length === 0)) {
                setSelectedTrack(trackStates.findIndex(t => t.clips.length === 0))
                setShowYoutubeDialog(true)
              } else {
                setErrorMessage('Todas las pistas están ocupadas')
                setTimeout(() => setErrorMessage(null), 3000)
              }
            }}
            title="Importar desde YouTube"
          >
            📺 YouTube
          </button>
          <button
            className={`header-btn ${snapEnabled ? 'active' : ''}`}
            onClick={() => setSnapEnabled(!snapEnabled)}
            title="Ajuste a cuadrícula (Shift para desactivar temporalmente)"
          >
            🧲 {snapEnabled ? 'Snap ON' : 'Snap OFF'}
          </button>
          <button
            className={`header-btn ${scissorsMode ? 'active' : ''}`}
            onClick={() => setScissorsMode(!scissorsMode)}
            title="Herramienta de corte: click en un clip para dividirlo"
          >
            ✂️ {scissorsMode ? 'Cortar' : 'Cortar'}
          </button>
          <button
            className="header-btn"
            onClick={() => setShowHelp(true)}
            title="Atajos de teclado"
          >
            ❓ Ayuda
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
            onClick={handleLoopToggle}
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
      
      {showYoutubeDialog && (
        <div className="drive-projects-modal">
          <div className="modal-content">
            <h2>Importar desde YouTube</h2>
            <p style={{ fontSize: '13px', color: '#999', marginBottom: '16px' }}>
              Pega la URL de un video de YouTube (máximo 10 minutos)
            </p>
            <input
              type="text"
              placeholder="https://youtube.com/watch?v=..."
              value={youtubeUrl}
              onChange={(e) => setYoutubeUrl(e.target.value)}
              style={{
                width: '100%',
                padding: '8px',
                marginBottom: '12px',
                fontSize: '14px',
                borderRadius: '4px',
                border: '1px solid #444',
                background: '#2a2a2a',
                color: '#fff'
              }}
              disabled={isLoadingYoutube}
            />
            {youtubeError && (
              <div style={{ color: '#ff6b6b', fontSize: '13px', marginBottom: '12px' }}>
                {youtubeError}
              </div>
            )}
            <div style={{ display: 'flex', gap: '8px' }}>
              <button 
                className="modal-close" 
                onClick={handleYoutubeImport}
                disabled={isLoadingYoutube}
              >
                {isLoadingYoutube ? 'Cargando...' : 'Importar'}
              </button>
              <button 
                className="modal-close" 
                onClick={() => {
                  setShowYoutubeDialog(false)
                  setYoutubeUrl('')
                  setYoutubeError(null)
                  setSelectedTrack(null)
                }}
                disabled={isLoadingYoutube}
              >
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}

      {showExportDialog && (
        <div className="drive-projects-modal">
          <div className="modal-content">
            <h2>Exportar proyecto</h2>
            <p style={{ fontSize: '13px', color: '#999', marginBottom: '16px' }}>
              Configura las opciones de exportación
            </p>
            
            <div style={{ marginBottom: '16px', padding: '12px', background: '#2a2a2a', borderRadius: '4px' }}>
              <label style={{ display: 'flex', alignItems: 'center', marginBottom: '8px', cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={exportMixed}
                  onChange={(e) => setExportMixed(e.target.checked)}
                  style={{ marginRight: '8px' }}
                />
                <span>Mezclar todo en un archivo (en vez de pistas separadas)</span>
              </label>
              
              <label style={{ display: 'flex', alignItems: 'center', cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={exportIncludeCountIn}
                  onChange={(e) => setExportIncludeCountIn(e.target.checked)}
                  style={{ marginRight: '8px' }}
                />
                <span>Incluir metrónomo de entrada (2 compases)</span>
              </label>
            </div>
            
            <p style={{ fontSize: '13px', color: '#999', marginBottom: '12px' }}>
              Selecciona las pistas a incluir
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
          <div className="ruler-spacer" style={{ height: '32px', flexShrink: 0, borderBottom: '1px solid #333' }} />
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
          {(() => {
            const maxDur = getMaxDuration() || 100
            return trackStates.map((trackState, trackIndex) => {
              const hasClips = trackState.clips.length > 0
              const isAnyClipPlaying = trackState.clips.some(c => c.isPlaying)
            
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
                    const clipOffset = (isDraggingClip && selectedClipIds.has(clip.id)) 
                      ? (clip.offsetSeconds + (tempDragOffset - dragStartPosition))
                      : clip.offsetSeconds
                    const isSelected = selectedClipIds.has(clip.id)
                    const showOnDifferentTrack = isDraggingClip && tempDragTrack !== null && tempDragTrack !== trackIndex && selectedClipIds.has(clip.id) && draggedClipTrack === trackIndex
                    
                    return (
                      <div 
                        key={clip.id}
                        className={`clip-wrapper ${isSelected ? 'selected' : ''} ${showOnDifferentTrack ? 'moving-away' : ''}`}
                        style={{
                          position: 'absolute',
                          left: `${(clipOffset / maxDur) * 100}%`,
                          width: `${(clip.duration / maxDur) * 100}%`,
                          height: '100%',
                          opacity: showOnDifferentTrack ? 0.3 : 1
                        }}
                        onClick={(e) => handleClipClick(e, trackIndex, clip.id)}
                      >
                        <div 
                          className="clip-trim-handle left"
                          onMouseDown={(e) => handleResizeStart(e, trackIndex, clip.id, 'left')}
                          title="Arrastra para recortar desde el inicio"
                        />
                        <div 
                          className="clip-body"
                          onMouseDown={(e) => handleClipDragStart(e, trackIndex, clip.id)}
                          onMouseMove={(e) => {
                            if (scissorsMode) {
                              const rect = e.currentTarget.getBoundingClientRect()
                              const mouseX = e.clientX - rect.left
                              const percentage = mouseX / rect.width
                              const time = clip.offsetSeconds + (percentage * clip.duration)
                              setCutLinePreview({ trackIndex, time })
                            }
                          }}
                          onMouseLeave={() => {
                            if (scissorsMode) {
                              setCutLinePreview(null)
                            }
                          }}
                          title={scissorsMode ? "Click para dividir el clip" : "Arrastra para mover (Alt+arrastrar para duplicar)"}
                          style={{ cursor: scissorsMode ? 'crosshair' : 'move' }}
                        >
                          <div className="clip-info">
                            <span className="clip-filename">{clip.fileName}</span>
                          </div>
                          <canvas
                            className="waveform-canvas"
                            ref={(el) => {
                              if (el) {
                                el.width = el.offsetWidth * 2
                                el.height = el.offsetHeight * 2
                                drawWaveform(el, clip.buffer, clip.sourceStart, clip.duration)
                              }
                            }}
                          />
                        </div>
                        <div 
                          className="clip-trim-handle right"
                          onMouseDown={(e) => handleResizeStart(e, trackIndex, clip.id, 'right')}
                          title="Arrastra para recortar desde el final"
                        />
                      </div>
                    )
                  })}
                  {isDraggingClip && tempDragTrack !== null && tempDragTrack !== draggedClipTrack && draggedClipTrack !== null && (
                    trackStates[draggedClipTrack].clips
                      .filter((clip: Clip) => selectedClipIds.has(clip.id))
                      .map((clip: Clip) => {
                        const clipOffset = clip.offsetSeconds + (tempDragOffset - dragStartPosition)
                        return trackIndex === tempDragTrack ? (
                          <div
                            key={`ghost-${clip.id}`}
                            className="clip-wrapper ghost"
                            style={{
                              position: 'absolute',
                              left: `${(clipOffset / maxDur) * 100}%`,
                              width: `${(clip.duration / maxDur) * 100}%`,
                              height: '100%',
                              opacity: 0.5,
                              border: '2px dashed #0a5'
                            }}
                          />
                        ) : null
                      })
                  )}
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
                  {cutLinePreview && cutLinePreview.trackIndex === trackIndex && (
                    <div
                      className="cut-line-preview"
                      style={{
                        position: 'absolute',
                        left: `${(cutLinePreview.time / maxDur) * 100}%`,
                        top: 0,
                        bottom: 0,
                        width: '2px',
                        background: '#f00',
                        pointerEvents: 'none',
                        zIndex: 10,
                        boxShadow: '0 0 4px rgba(255, 0, 0, 0.5)'
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
            })
          })()}
        </div>
      </div>

      {showHelp && (
        <div className="drive-projects-modal">
          <div className="modal-content" style={{ maxWidth: '600px' }}>
            <h2>Atajos de teclado y gestos</h2>
            <div style={{ fontSize: '13px', color: '#ccc', lineHeight: '1.8', marginBottom: '16px' }}>
              <h3 style={{ color: '#0a5', marginTop: '12px', marginBottom: '8px' }}>Edición de clips</h3>
              <ul style={{ listStyle: 'none', padding: 0 }}>
                <li>• <strong>Click</strong> - Seleccionar clip</li>
                <li>• <strong>Shift+Click</strong> - Seleccionar múltiples clips</li>
                <li>• <strong>Arrastrar clip</strong> - Mover horizontal y verticalmente</li>
                <li>• <strong>Alt+Click en clip</strong> - Dividir en el punto clickeado</li>
                <li>• <strong>Alt+Arrastrar</strong> - Duplicar clip (después de mover 5px)</li>
                <li>• <strong>Arrastrar borde izquierdo</strong> - Recortar desde el inicio</li>
                <li>• <strong>Arrastrar borde derecho</strong> - Recortar desde el final</li>
                <li>• <strong>Shift al arrastrar</strong> - Desactivar snap temporalmente</li>
                <li>• <strong>Botón ✂️ Cortar</strong> - Activa modo tijeras (click en clip para dividir)</li>
                <li>• <strong>Botón 🧲 Snap</strong> - Activa/desactiva ajuste a cuadrícula</li>
              </ul>
              
              <h3 style={{ color: '#0a5', marginTop: '16px', marginBottom: '8px' }}>Teclado</h3>
              <ul style={{ listStyle: 'none', padding: 0 }}>
                <li>• <strong>Cmd/Ctrl+S</strong> - Guardar proyecto localmente</li>
                <li>• <strong>Shift+Cmd/Ctrl+S</strong> - Guardar como... (nueva ubicación)</li>
                <li>• <strong>S</strong> o <strong>Cmd/Ctrl+E</strong> - Dividir clip en playhead</li>
                <li>• <strong>Cmd/Ctrl+C</strong> - Copiar clip seleccionado</li>
                <li>• <strong>Cmd/Ctrl+V</strong> - Pegar en playhead</li>
                <li>• <strong>Cmd/Ctrl+D</strong> - Duplicar clip después del original</li>
                <li>• <strong>Delete/Backspace</strong> - Eliminar clips seleccionados</li>
                <li>• <strong>Cmd/Ctrl+A</strong> - Seleccionar todos los clips</li>
                <li>• <strong>Cmd/Ctrl+Z</strong> - Deshacer</li>
                <li>• <strong>Cmd/Ctrl+Shift+Z</strong> o <strong>Cmd/Ctrl+Y</strong> - Rehacer</li>
              </ul>
              
              <h3 style={{ color: '#0a5', marginTop: '16px', marginBottom: '8px' }}>Guardar y Abrir</h3>
              <ul style={{ listStyle: 'none', padding: 0 }}>
                <li>• <strong>💾 Guardar</strong> - Guardar proyecto en tu computadora (primera vez elige ubicación, después sobrescribe)</li>
                <li>• <strong>📂 Abrir</strong> - Abrir proyecto .musicalia desde tu computadora</li>
                <li>• Los proyectos incluyen todo el audio y stems sin rehacer separación</li>
                <li>• <strong>☁️ Proyectos en la nube (anteriores)</strong> - Abrir proyectos viejos de la nube</li>
              </ul>
              
              <h3 style={{ color: '#0a5', marginTop: '16px', marginBottom: '8px' }}>Transporte</h3>
              <ul style={{ listStyle: 'none', padding: 0 }}>
                <li>• <strong>Espacio</strong> - Reproducir/Pausar</li>
                <li>• <strong>Click en timeline</strong> - Mover playhead</li>
                <li>• <strong>Arrastrar en ruler</strong> - Marcar región de loop</li>
                <li>• <strong>Shift+Click en ruler</strong> - Marcar loop desde playhead</li>
              </ul>
            </div>
            <button className="modal-close" onClick={() => setShowHelp(false)}>Cerrar</button>
          </div>
        </div>
      )}
    </div>
  )
}

export default App
