import { useState, useRef, useEffect } from 'react'
import * as Tone from 'tone'
import './App.css'

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
}

function App() {
  const [isPlaying, setIsPlaying] = useState(false)
  const [bpm, setBpm] = useState(120)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [selectedTrack, setSelectedTrack] = useState<number | null>(null)
  const trackGainsRef = useRef<Tone.Gain[]>([])
  const audioInitializedRef = useRef(false)
  const canvasRefs = useRef<(HTMLCanvasElement | null)[]>([])
  const [trackStates, setTrackStates] = useState<TrackState[]>(() => 
    Array.from({ length: 8 }, () => ({
      mute: false,
      solo: false,
      volume: 0.8,
      clip: null
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
    const amp = height / 2

    ctx.fillStyle = '#1a1a1a'
    ctx.fillRect(0, 0, width, height)

    ctx.strokeStyle = '#0a5'
    ctx.lineWidth = 1
    ctx.beginPath()

    for (let i = 0; i < width; i++) {
      let min = 1.0
      let max = -1.0
      
      for (let j = 0; j < step; j++) {
        const datum = data[(i * step) + j]
        if (datum < min) min = datum
        if (datum > max) max = datum
      }
      
      const yMin = (1 + min) * amp
      const yMax = (1 + max) * amp
      
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
    Tone.getTransport().start()
    setIsPlaying(true)
  }

  const handleStop = () => {
    Tone.getTransport().stop()
    setTrackStates(prev => prev.map(track => {
      if (track.clip?.isPlaying) {
        track.clip.player.stop()
        track.clip.isPlaying = false
      }
      return { ...track }
    }))
    setIsPlaying(false)
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

    await ensureAudio()

    const existingClip = trackStates[selectedTrack].clip
    if (existingClip) {
      existingClip.player.dispose()
    }

    const url = URL.createObjectURL(file)
    const trackGain = trackGainsRef.current[selectedTrack]
    
    const player = new Tone.Player()
    player.loop = true
    player.connect(trackGain)
    
    await player.load(url)

    const buffer = player.buffer.get() as AudioBuffer

    const newTrackStates = [...trackStates]
    newTrackStates[selectedTrack] = {
      ...newTrackStates[selectedTrack],
      clip: {
        player,
        fileName: file.name,
        isPlaying: false,
        buffer,
        startPosition: 0
      }
    }
    setTrackStates(newTrackStates)
    setSelectedTrack(null)

    if (fileInputRef.current) {
      fileInputRef.current.value = ''
    }

    setTimeout(() => {
      const canvas = canvasRefs.current[selectedTrack!]
      if (canvas && buffer) {
        drawWaveform(canvas, buffer)
      }
    }, 100)
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
            onClick={handleStop}
            disabled={!isPlaying}
          >
            Stop
          </button>
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
      </div>

      <div className="arrangement-view">
        {trackStates.map((trackState, trackIndex) => (
          <div key={trackIndex} className="track-lane">
            <div className="track-header">
              <div className="track-name">Track {trackIndex + 1}</div>
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
            <div 
              className={`track-content ${trackState.clip ? 'has-clip' : ''} ${trackState.clip?.isPlaying ? 'playing' : ''}`}
              onClick={() => handleLaneClick(trackIndex)}
            >
              {trackState.clip ? (
                <div className="clip-region">
                  <div className="clip-info">
                    <span className="clip-filename">{trackState.clip.fileName}</span>
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
              ) : (
                <div className="empty-lane">
                  <span className="import-hint">Click to import audio</span>
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

export default App
