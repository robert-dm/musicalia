import { useState, useRef, useEffect } from 'react'
import * as Tone from 'tone'
import './App.css'

interface Clip {
  player: Tone.Player
  fileName: string
  isPlaying: boolean
}

type ClipGrid = Map<string, Clip>

interface TrackState {
  mute: boolean
  solo: boolean
  volume: number
}

function App() {
  const [isPlaying, setIsPlaying] = useState(false)
  const [bpm, setBpm] = useState(120)
  const [clips, setClips] = useState<ClipGrid>(new Map())
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [selectedCell, setSelectedCell] = useState<{ track: number; scene: number } | null>(null)
  const [activeScene, setActiveScene] = useState<number | null>(null)
  const trackGainsRef = useRef<Tone.Gain[]>([])
  const audioInitializedRef = useRef(false)
  const [trackStates, setTrackStates] = useState<TrackState[]>(() => 
    Array.from({ length: 8 }, () => ({
      mute: false,
      solo: false,
      volume: 0.8
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

  const handlePlay = async () => {
    await ensureAudio()
    Tone.getTransport().bpm.value = bpm
    Tone.getTransport().start()
    setIsPlaying(true)
  }

  const handleStop = () => {
    Tone.getTransport().stop()
    clips.forEach((clip) => {
      clip.player.stop()
      clip.isPlaying = false
    })
    setClips(new Map(clips))
    setIsPlaying(false)
    setActiveScene(null)
  }

  const handleBpmChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newBpm = parseInt(e.target.value) || 120
    setBpm(newBpm)
    Tone.getTransport().bpm.value = newBpm
  }

  const getCellKey = (trackIndex: number, sceneIndex: number) => `${trackIndex}-${sceneIndex}`

  const handleCellClick = async (trackIndex: number, sceneIndex: number) => {
    const cellKey = getCellKey(trackIndex, sceneIndex)
    const clip = clips.get(cellKey)

    if (clip) {
      await ensureAudio()
      if (clip.isPlaying) {
        clip.player.stop()
        clip.isPlaying = false
      } else {
        clip.player.start()
        clip.isPlaying = true
      }
      setClips(new Map(clips))
    } else {
      setSelectedCell({ track: trackIndex, scene: sceneIndex })
      fileInputRef.current?.click()
    }
  }

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file || !selectedCell) return

    await ensureAudio()

    const cellKey = getCellKey(selectedCell.track, selectedCell.scene)
    const existingClip = clips.get(cellKey)
    if (existingClip) {
      existingClip.player.dispose()
    }

    const url = URL.createObjectURL(file)
    const trackGain = trackGainsRef.current[selectedCell.track]
    
    const player = new Tone.Player()
    player.loop = true
    player.connect(trackGain)
    
    await player.load(url)

    const newClips = new Map(clips)
    newClips.set(cellKey, {
      player,
      fileName: file.name,
      isPlaying: false,
    })
    setClips(newClips)
    setSelectedCell(null)

    if (fileInputRef.current) {
      fileInputRef.current.value = ''
    }
  }

  const handleSceneLaunch = async (sceneIndex: number) => {
    await ensureAudio()
    const updatedClips = new Map(clips)
    
    // For each track, stop any playing clip and start the clip in this scene if it exists
    for (let trackIndex = 0; trackIndex < 8; trackIndex++) {
      // Stop all clips on this track
      for (let si = 0; si < 4; si++) {
        const cellKey = getCellKey(trackIndex, si)
        const clip = updatedClips.get(cellKey)
        if (clip && clip.isPlaying) {
          clip.player.stop()
          clip.isPlaying = false
        }
      }
      
      // Start the clip in the launched scene if it exists
      const sceneClipKey = getCellKey(trackIndex, sceneIndex)
      const sceneClip = updatedClips.get(sceneClipKey)
      if (sceneClip) {
        sceneClip.player.start()
        sceneClip.isPlaying = true
      }
    }
    
    setClips(updatedClips)
    setActiveScene(sceneIndex)
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

  const tracks = Array.from({ length: 8 }, (_, i) => `Track ${i + 1}`)
  const scenes = Array.from({ length: 4 }, (_, i) => `Scene ${i + 1}`)

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

      <div className="session-view">
        <div className="session-grid">
          <div className="corner-spacer"></div>
          {scenes.map((scene) => (
            <div key={scene} className="scene-header">
              {scene}
            </div>
          ))}
          <div className="controls-header">Controls</div>
          
          <div className="corner-spacer"></div>
          {scenes.map((_, sceneIndex) => (
            <button
              key={`launch-${sceneIndex}`}
              className={`scene-launch-button ${activeScene === sceneIndex ? 'active' : ''}`}
              onClick={() => handleSceneLaunch(sceneIndex)}
            >
              ▶
            </button>
          ))}
          <div className="corner-spacer"></div>
          
          {tracks.map((track, trackIndex) => (
            <>
              <div key={track} className="track-label">
                {track}
              </div>
              {scenes.map((_, sceneIndex) => {
                const cellKey = getCellKey(trackIndex, sceneIndex)
                const clip = clips.get(cellKey)
                
                return (
                  <div
                    key={cellKey}
                    className={`clip-cell ${clip ? 'clip-filled' : ''} ${clip?.isPlaying ? 'clip-playing' : ''}`}
                    onClick={() => handleCellClick(trackIndex, sceneIndex)}
                  >
                    {clip && (
                      <span className="clip-name">
                        {clip.fileName.length > 15 
                          ? clip.fileName.substring(0, 15) + '...' 
                          : clip.fileName}
                      </span>
                    )}
                  </div>
                )
              })}
              <div key={`controls-${trackIndex}`} className="track-controls">
                <button
                  className={`control-button mute-button ${trackStates[trackIndex].mute ? 'active' : ''}`}
                  onClick={() => handleMuteToggle(trackIndex)}
                  title="Mute"
                >
                  M
                </button>
                <button
                  className={`control-button solo-button ${trackStates[trackIndex].solo ? 'active' : ''}`}
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
                  value={trackStates[trackIndex].volume}
                  onChange={(e) => handleVolumeChange(trackIndex, parseFloat(e.target.value))}
                  title={`Volume: ${Math.round(trackStates[trackIndex].volume * 100)}%`}
                />
              </div>
            </>
          ))}
        </div>
      </div>
    </div>
  )
}

export default App
