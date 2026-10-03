import { useState, useRef, useEffect } from 'react'
import * as Tone from 'tone'
import './App.css'
import './AudioDiagnostics.css'
import { StemSplitDialog, StemSplitProgress } from './StemSplitDialog'
import { separateStems, isStemSeparationSupported } from './stemSeparator'
import { autosaveProject, loadProject, clearProject } from './projectManager'
import {
  hasMusicaliKey,
  setMusicaliKey,
  saveProjectToCloud,
  listCloudProjects,
  openProjectFromCloud,
  deleteProjectFromCloud,
  getStorageUsage,
  type ProjectMetadata
} from './cloudStorage'

const APP_VERSION = '0.0029b'

interface Clip {
  player: Tone.Player
  fileName: string
  isPlaying: boolean
  buffer: AudioBuffer
  startPosition: number
}

interface TrackState {
  mute: boolean
  solo: boolean
  volume: number
  clip: Clip | null
  name?: string
}

function App() {
  const [isPlaying, setIsPlaying] = useState(false)
  const [isPaused, setIsPaused] = useState(false)
  const [bpm, setBpm] = useState(120)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [selectedTrack, setSelectedTrack] = useState<number | null>(null)
  const trackGainsRef = useRef<Tone.Gain[]>([])
  const audioInitializedRef = useRef(false)
  const canvasRefs = useRef<(HTMLCanvasElement | null)[]>([])
  const [sidebarWidth, setSidebarWidth] = useState(220)
  const [isResizing, setIsResizing] = useState(false)
  const [playheadPosition, setPlayheadPosition] = useState(0)
  const playheadAnimationRef = useRef<number | null>(null)
  const [loopStart, setLoopStart] = useState<number | null>(null)
  const [loopEnd, setLoopEnd] = useState<number | null>(null)
  const [isDraggingPlayhead, setIsDraggingPlayhead] = useState(false)
  const [showStemDialog, setShowStemDialog] = useState(false)
  const [stemProgress, setStemProgress] = useState<number>(0)
  const [isProcessingStems, setIsProcessingStems] = useState(false)
  const stemAbortControllerRef = useRef<AbortController | null>(null)
  const pendingFileRef = useRef<File | null>(null)
  const [trackStates, setTrackStates] = useState<TrackState[]>(() => 
    Array.from({ length: 8 }, (_, i) => ({
      mute: false,
      solo: false,
      volume: 0.8,
      clip: null,
      name: `Track ${i + 1}`
    }))
  )
  const [audioLevel, setAudioLevel] = useState(0)
  const meterRef = useRef<Tone.Meter | null>(null)
  const [showToast, setShowToast] = useState(false)
  const [hasCloudKey, setHasCloudKey] = useState(hasMusicaliKey())
  const [showCloudProjects, setShowCloudProjects] = useState(false)
  const [cloudProjects, setCloudProjects] = useState<ProjectMetadata[]>([])
  const [currentProjectName, setCurrentProjectName] = useState('Proyecto sin título')
  const [uploadProgress, setUploadProgress] = useState(0)
  const [storageUsage, setStorageUsage] = useState(0)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  
  // Autosave on state changes
  useEffect(() => {
    const state = {
      bpm,
      loopStart,
      loopEnd,
      playheadPosition,
      tracks: trackStates.map(t => ({
        name: t.name || '',
        mute: t.mute,
        solo: t.solo,
        volume: t.volume,
        clip: t.clip ? {
          fileName: t.clip.fileName,
          startPosition: t.clip.startPosition,
          audioData: {
            left: Array.from(t.clip.buffer.getChannelData(0)),
            right: Array.from(t.clip.buffer.getChannelData(1)),
            sampleRate: t.clip.buffer.sampleRate
          }
        } : null
      }))
    }
    autosaveProject(state)
  }, [bpm, loopStart, loopEnd, playheadPosition, trackStates])
  
  // Load project on mount
  useEffect(() => {
    loadProject().then(async (state) => {
      if (!state) return
      
      await ensureAudio()
      
      setBpm(state.bpm)
      setLoopStart(state.loopStart)
      setLoopEnd(state.loopEnd)
      setPlayheadPosition(state.playheadPosition)
      
      const newTrackStates = state.tracks.map((t, i) => {
        if (!t.clip) return { ...t, clip: null }
        
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
        
        setTimeout(() => {
          const canvas = canvasRefs.current[i]
          if (canvas) drawWaveform(canvas, buffer)
        }, 100)
        
        return {
          ...t,
          clip: {
            player,
            fileName: t.clip.fileName,
            isPlaying: false,
            buffer,
            startPosition: t.clip.startPosition
          }
        }
      })
      
      setTrackStates(newTrackStates)
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
  
  const handleSetCloudKey = () => {
    const key = prompt('Introduce la clave de Musicalia:')
    if (!key) return
    
    setMusicaliKey(key)
    setHasCloudKey(true)
    alert('Clave configurada correctamente')
  }
  
  const handleSaveToCloud = async () => {
    if (!hasCloudKey) {
      setErrorMessage('Primero configura la clave de Musicalia')
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
        clip: t.clip ? {
          fileName: t.clip.fileName,
          startPosition: t.clip.startPosition,
          audioFile: `audio_${i}.wav`,
          audioData: {
            left: Array.from(t.clip.buffer.getChannelData(0)),
            right: Array.from(t.clip.buffer.getChannelData(1)),
            sampleRate: t.clip.buffer.sampleRate
          }
        } : null
      }))
    }
    
    try {
      setUploadProgress(0)
      setErrorMessage(null)
      await saveProjectToCloud(projectData, name, setUploadProgress)
      setCurrentProjectName(name)
      setShowToast(true)
      setTimeout(() => setShowToast(false), 3000)
    } catch (err: any) {
      setErrorMessage(err.message || 'Error al guardar proyecto')
    } finally {
      setUploadProgress(0)
    }
  }
  
  const handleShowCloudProjects = async () => {
    if (!hasCloudKey) {
      setErrorMessage('Primero configura la clave de Musicalia')
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
      
      const newTrackStates = state.tracks.map((t: any, i: number) => {
        if (!t.clip) return { ...t, clip: null }
        
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
        
        setTimeout(() => {
          const canvas = canvasRefs.current[i]
          if (canvas) drawWaveform(canvas, buffer)
        }, 100)
        
        return {
          ...t,
          clip: {
            player,
            fileName: t.clip.fileName,
            isPlaying: false,
            buffer,
            startPosition: t.clip.startPosition
          }
        }
      })
      
      setTrackStates(newTrackStates)
      setCurrentProjectName(name)
      setShowCloudProjects(false)
      setShowToast(true)
      setTimeout(() => setShowToast(false), 3000)
    } catch (err: any) {
      setErrorMessage(err.message || 'Error al abrir proyecto')
    }
  }
  
  const handleDeleteCloudProject = async (pathname: string, name: string) => {
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
      
      setShowToast(true)
      setTimeout(() => setShowToast(false), 3000)
    } catch (err: any) {
      setErrorMessage(err.message || 'Error al eliminar proyecto')
    }
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
      
      // Create meter for diagnostics
      if (!meterRef.current) {
        meterRef.current = new Tone.Meter()
        Tone.getDestination().connect(meterRef.current)
        
        // Update level meter
        setInterval(() => {
          if (meterRef.current) {
            setAudioLevel(meterRef.current.getValue() as number)
          }
        }, 100)
      }
      
      audioInitializedRef.current = true
    }
    
    // Resume if suspended (Safari can interrupt context)
    if (Tone.getContext().state !== 'running') {
      console.log('[DEBUG] Context not running, resuming...')
      await Tone.start()
      await Tone.getContext().resume()
    }
    
    // Diagnostic checks
    console.log('[DIAG] Destination mute:', Tone.getDestination().mute)
    console.log('[DIAG] Destination volume:', Tone.getDestination().volume.value)
    console.log('[DIAG] Gains:', trackGainsRef.current.map(g => g.gain.value))
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
      if (track.clip?.buffer.duration) {
        maxDuration = Math.max(maxDuration, track.clip.buffer.duration)
      }
    })
    return maxDuration || 0
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
    // CRITICAL: Call Tone.start() synchronously FIRST (Safari autoplay)
    await Tone.start()
    
    await ensureAudio()
    
    // Ensure context is running (Safari may suspend it)
    if (Tone.getContext().state !== 'running') {
      console.log('[DEBUG] handlePlay: Context not running, resuming...')
      await Tone.start()
      await Tone.getContext().resume()
    }
    
    console.log('[DEBUG] handlePlay: audio initialized, gains:', trackGainsRef.current.length)
    console.log('[DEBUG] trackStates with clips:', trackStates.filter(t => t.clip).length)
    
    Tone.getTransport().bpm.value = bpm
    
    const startTime = isPaused ? playheadPosition : (loopStart ?? 0)
    Tone.getTransport().seconds = startTime
    Tone.getTransport().start()
    
    const maxDuration = getMaxDuration()
    
    // Start players (outside setState to avoid StrictMode double-run)
    const updatedStates = trackStates.map(track => {
      if (track.clip && !track.clip.isPlaying) {
        track.clip.player.loop = true
        const offset = startTime % track.clip.buffer.duration
        console.log('[DEBUG] Starting player:', {
          trackName: track.name,
          bufferLoaded: track.clip.player.loaded,
          bufferDuration: track.clip.player.buffer.duration,
          offset
        })
        track.clip.player.start(Tone.now(), offset)
        return { ...track, clip: { ...track.clip, isPlaying: true } }
      }
      return track
    })
    
    setTrackStates(updatedStates)
    
    setIsPlaying(true)
    setIsPaused(false)
    
    let lastUpdateTime = 0
    const updatePlayhead = (timestamp: number) => {
      if (Tone.getTransport().state === 'started') {
        if (timestamp - lastUpdateTime < 50) {
          playheadAnimationRef.current = requestAnimationFrame(updatePlayhead)
          return
        }
        lastUpdateTime = timestamp
        
        let currentTime = Tone.getTransport().seconds
        
        if (loopStart !== null && loopEnd !== null) {
          if (currentTime >= loopEnd) {
            currentTime = loopStart
            Tone.getTransport().seconds = loopStart
            trackStates.forEach(track => {
              if (track.clip?.isPlaying) {
                track.clip.player.stop()
                const offset = loopStart % track.clip.buffer.duration
                track.clip.player.start(Tone.now(), offset)
              }
            })
          }
        } else if (maxDuration > 0 && currentTime >= maxDuration) {
          currentTime = 0
          Tone.getTransport().seconds = 0
          trackStates.forEach(track => {
            if (track.clip?.isPlaying) {
              track.clip.player.stop()
              track.clip.player.start()
            }
          })
        }
        
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
    
    setTrackStates(prev => prev.map(track => {
      if (track.clip?.isPlaying) {
        track.clip.player.stop()
        track.clip.isPlaying = false
      }
      return { ...track }
    }))
    
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
    
    setTrackStates(prev => prev.map(track => {
      if (track.clip?.isPlaying) {
        track.clip.player.stop()
        track.clip.isPlaying = false
      }
      return { ...track }
    }))
    
    setIsPlaying(false)
    setIsPaused(false)
  }

  const handleBpmChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newBpm = parseInt(e.target.value) || 120
    setBpm(newBpm)
    Tone.getTransport().bpm.value = newBpm
  }

  const handleLaneClick = async (trackIndex: number) => {
    const clip = trackStates[trackIndex].clip

    if (clip) {
      await ensureAudio()
      if (clip.isPlaying) {
        clip.player.stop()
        clip.isPlaying = false
      } else {
        clip.player.start()
        clip.isPlaying = true
      }
      setTrackStates([...trackStates])
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

    const existingClip = trackStates[trackIndex].clip
    if (existingClip) {
      existingClip.player.dispose()
    }

    const url = URL.createObjectURL(file)
    const trackGain = trackGainsRef.current[trackIndex]
    
    const player = new Tone.Player()
    player.loop = true
    player.connect(trackGain)
    
    console.log('[DEBUG] Before load')
    await player.load(url)
    console.log('[DEBUG] After load: player.loaded=', player.loaded, 'duration=', player.buffer.duration)

    const buffer = player.buffer.get() as AudioBuffer

    const newTrackStates = [...trackStates]
    newTrackStates[trackIndex] = {
      ...newTrackStates[trackIndex],
      clip: {
        player,
        fileName: file.name,
        isPlaying: false,
        buffer,
        startPosition: 0
      }
    }
    setTrackStates(newTrackStates)

    setTimeout(() => {
      const canvas = canvasRefs.current[trackIndex]
      if (canvas && buffer) {
        drawWaveform(canvas, buffer)
      }
    }, 100)
  }

  const processStemSeparation = async (file: File, startTrackIndex: number) => {
    await ensureAudio()

    // Create abort controller
    const abortController = new AbortController()
    stemAbortControllerRef.current = abortController

    // Load the audio file
    const url = URL.createObjectURL(file)
    const tempPlayer = new Tone.Player()
    await tempPlayer.load(url)
    const originalBuffer = tempPlayer.buffer.get() as AudioBuffer
    tempPlayer.dispose()

    // Separate stems with cancel support
    const stems = await separateStems(originalBuffer, (progress) => {
      setStemProgress(progress.progress)
    }, abortController.signal)

    // Create clips for each stem
    const stemNames = ['Vocals', 'Drums', 'Bass', 'Other']
    const stemBuffers = [stems.vocals, stems.drums, stems.bass, stems.other]
    
    // Log stem amplitudes for debugging
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

      // Dispose existing clip if any
      if (newTrackStates[targetTrackIndex].clip) {
        newTrackStates[targetTrackIndex].clip!.player.dispose()
      }

      // Create new player for this stem
      const player = new Tone.Player()
      player.loop = true
      
      // Convert native AudioBuffer to ToneAudioBuffer
      const toneBuffer = new Tone.ToneAudioBuffer(stemBuffers[i])
      player.buffer = toneBuffer
      
      player.connect(trackGainsRef.current[targetTrackIndex])

      newTrackStates[targetTrackIndex] = {
        ...newTrackStates[targetTrackIndex],
        name: stemNames[i],
        clip: {
          player,
          fileName: `${file.name} - ${stemNames[i]}`,
          isPlaying: false,
          buffer: stemBuffers[i],
          startPosition: 0
        }
      }

      // Draw waveform
      setTimeout(() => {
        const canvas = canvasRefs.current[targetTrackIndex]
        if (canvas && stemBuffers[i]) {
          drawWaveform(canvas, stemBuffers[i])
        }
      }, 100)
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
    const clampedSeconds = Math.max(0, Math.min(seconds, getMaxDuration()))
    setPlayheadPosition(clampedSeconds)
    Tone.getTransport().seconds = clampedSeconds
    
    trackStates.forEach(track => {
      if (track.clip) {
        const wasPlaying = track.clip.isPlaying
        if (wasPlaying) {
          track.clip.player.stop()
        }
        if (isPlaying) {
          const offset = clampedSeconds % track.clip.buffer.duration
          track.clip.player.start(Tone.now(), offset)
          track.clip.isPlaying = true
        }
      }
    })
  }

  const handleWaveformClick = (e: React.MouseEvent<HTMLDivElement>, trackIndex: number) => {
    const track = trackStates[trackIndex]
    if (!track.clip) {
      handleLaneClick(trackIndex)
      return
    }

    const rect = e.currentTarget.getBoundingClientRect()
    const clickX = e.clientX - rect.left
    const percentage = clickX / rect.width
    const maxDuration = getMaxDuration()
    const clickTime = percentage * maxDuration

    if (e.shiftKey) {
      if (loopStart === null) {
        setLoopStart(clickTime)
      } else if (loopEnd === null) {
        if (clickTime > loopStart) {
          setLoopEnd(clickTime)
        } else {
          setLoopEnd(loopStart)
          setLoopStart(clickTime)
        }
      } else {
        setLoopStart(clickTime)
        setLoopEnd(null)
      }
    } else {
      seekToPosition(clickTime)
      if (!isPlaying && !isPaused) {
        handleLaneClick(trackIndex)
      }
    }
  }

  const clearLoop = () => {
    setLoopStart(null)
    setLoopEnd(null)
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
          <button 
            className="header-btn" 
            onClick={handleSetCloudKey}
            title={hasCloudKey ? 'Clave configurada' : 'Configurar clave'}
          >
            {hasCloudKey ? '✓' : '🔑'} Clave
          </button>
          <button 
            className="header-btn" 
            onClick={handleSaveToCloud}
            disabled={!hasCloudKey}
            title={hasCloudKey ? 'Guardar en la nube' : 'Primero configura la clave'}
          >
            ☁️ Guardar
          </button>
          <button 
            className="header-btn" 
            onClick={handleShowCloudProjects}
            disabled={!hasCloudKey}
            title={hasCloudKey ? 'Mis proyectos' : 'Primero configura la clave'}
          >
            📁 Proyectos
          </button>
          <button
            className={`transport-button ${isPlaying ? 'active' : ''}`}
            onClick={handlePlay}
            disabled={isPlaying}
          >
            Play
          </button>
          <button
            className="transport-button"
            onClick={handlePause}
            disabled={!isPlaying}
          >
            Pause
          </button>
          <button
            className="transport-button"
            onClick={handleStop}
            disabled={!isPlaying && !isPaused}
          >
            Stop
          </button>
        </div>
        <div className="time-display">
          <span className="time-label">Time</span>
          <span className="time-value">
            {formatTime(playheadPosition)} / {formatTime(getMaxDuration())}
          </span>
        </div>
        {(loopStart !== null || loopEnd !== null) && (
          <div className="loop-indicator">
            <span className="loop-label">Loop: {loopStart !== null ? formatTime(loopStart) : '--'} → {loopEnd !== null ? formatTime(loopEnd) : '--'}</span>
            <button className="transport-button clear-loop" onClick={clearLoop}>Clear</button>
          </div>
        )}
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
      
      {showToast && (
        <div className="toast">✓ Operación exitosa</div>
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
      
      {showCloudProjects && (
        <div className="drive-projects-modal">
          <div className="modal-content">
            <h2>Mis proyectos en la nube</h2>
            <div className="storage-info">
              Espacio usado: {(storageUsage / 1024 / 1024).toFixed(2)} MB
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

      <div className="arrangement-view">
        <div className="sidebar-column" style={{ width: `${sidebarWidth}px` }}>
          {trackStates.map((trackState, trackIndex) => (
            <div key={trackIndex} className="track-header">
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
            </div>
          ))}
        </div>
        <div 
          className="resize-handle"
          onMouseDown={() => setIsResizing(true)}
          title="Drag to resize sidebar"
        />
        <div className="lanes-column">
          {trackStates.map((trackState, trackIndex) => (
            <div 
              key={trackIndex}
              className={`track-content ${trackState.clip ? 'has-clip' : ''} ${trackState.clip?.isPlaying ? 'playing' : ''}`}
              onClick={(e) => handleWaveformClick(e, trackIndex)}
            >
              {trackState.clip ? (
                <div className="clip-region">
                  <div 
                    className="clip-wrapper"
                    style={{
                      width: `${(trackState.clip.buffer.duration / getMaxDuration()) * 100}%`
                    }}
                  >
                    <div className="clip-info">
                      <span className="clip-filename">{trackState.clip.fileName}</span>
                      <span className="clip-hint">Shift+Click to set loop region</span>
                    </div>
                    <canvas
                      ref={(el) => {
                        canvasRefs.current[trackIndex] = el
                        if (el && trackState.clip) {
                          el.width = el.offsetWidth * 2
                          el.height = el.offsetHeight * 2
                          drawWaveform(el, trackState.clip.buffer)
                        }
                      }}
                      className="waveform-canvas"
                    />
                  </div>
                  {loopStart !== null && (
                    <div 
                      className="loop-marker loop-start"
                      style={{ 
                        left: `${(loopStart / getMaxDuration()) * 100}%` 
                      }}
                    />
                  )}
                  {loopEnd !== null && (
                    <div 
                      className="loop-marker loop-end"
                      style={{ 
                        left: `${(loopEnd / getMaxDuration()) * 100}%` 
                      }}
                    />
                  )}
                  {loopStart !== null && loopEnd !== null && (
                    <div 
                      className="loop-region"
                      style={{ 
                        left: `${(loopStart / getMaxDuration()) * 100}%`,
                        width: `${((loopEnd - loopStart) / getMaxDuration()) * 100}%`
                      }}
                    />
                  )}
                  {(isPlaying || isPaused) && (
                    <div 
                      className="playhead"
                      style={{ 
                        left: `${Math.min((playheadPosition / getMaxDuration()) * 100, 100)}%` 
                      }}
                      onMouseDown={handlePlayheadMouseDown}
                    />
                  )}
                </div>
              ) : (
                <div className="empty-lane">
                  <span className="import-hint">Click to import audio</span>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

export default App
