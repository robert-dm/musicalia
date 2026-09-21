import { useState, useRef, useEffect } from 'react'
import * as Tone from 'tone'
import './App.css'
import { StemSplitDialog, StemSplitProgress } from './StemSplitDialog'
import { separateStems, isStemSeparationSupported } from './stemSeparator'

const APP_VERSION = '0.0014b'

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

  const ensureAudio = async () => {
    if (!audioInitializedRef.current) {
      await Tone.start()
      
      if (trackGainsRef.current.length === 0) {
        trackGainsRef.current = Array.from({ length: 8 }, () => 
          new Tone.Gain(0.8).toDestination()
        )
      }
      
      audioInitializedRef.current = true
    }
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
    await ensureAudio()
    Tone.getTransport().bpm.value = bpm
    
    const startTime = isPaused ? playheadPosition : (loopStart ?? 0)
    Tone.getTransport().seconds = startTime
    Tone.getTransport().start()
    
    const maxDuration = getMaxDuration()
    
    setTrackStates(prev => prev.map(track => {
      if (track.clip && !track.clip.isPlaying) {
        track.clip.player.loop = true
        const offset = startTime % track.clip.buffer.duration
        track.clip.player.start(Tone.now(), offset)
        track.clip.isPlaying = true
      }
      return { ...track }
    }))
    
    setIsPlaying(true)
    setIsPaused(false)
    
    const updatePlayhead = () => {
      if (Tone.getTransport().state === 'started') {
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
    updatePlayhead()
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
      pendingFileRef.current = null
      setSelectedTrack(null)
      
      if (fileInputRef.current) {
        fileInputRef.current.value = ''
      }
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

    const existingClip = trackStates[trackIndex].clip
    if (existingClip) {
      existingClip.player.dispose()
    }

    const url = URL.createObjectURL(file)
    const trackGain = trackGainsRef.current[trackIndex]
    
    const player = new Tone.Player()
    player.loop = true
    player.connect(trackGain)
    
    await player.load(url)

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

    // Load the audio file
    const url = URL.createObjectURL(file)
    const tempPlayer = new Tone.Player()
    await tempPlayer.load(url)
    const originalBuffer = tempPlayer.buffer.get() as AudioBuffer
    tempPlayer.dispose()

    // Separate stems
    const stems = await separateStems(originalBuffer, (progress) => {
      setStemProgress(progress.progress)
    })

    // Create clips for each stem
    const stemNames = ['Vocals', 'Drums', 'Bass', 'Other']
    const stemBuffers = [stems.vocals, stems.drums, stems.bass, stems.other]
    
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
      player.buffer.set(stemBuffers[i])
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
        <div className="version-badge">
          <span className="version-label">v{APP_VERSION}</span>
        </div>
      </div>

      {showStemDialog && (
        <StemSplitDialog
          onConfirm={handleStemDialogConfirm}
          onCancel={handleStemDialogCancel}
        />
      )}

      {isProcessingStems && (
        <StemSplitProgress progress={stemProgress} />
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
