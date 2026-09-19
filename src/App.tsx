import { useState, useRef } from 'react'
import * as Tone from 'tone'
import './App.css'

interface Clip {
  player: Tone.Player
  fileName: string
  isPlaying: boolean
}

type ClipGrid = Map<string, Clip>

function App() {
  const [isPlaying, setIsPlaying] = useState(false)
  const [bpm, setBpm] = useState(120)
  const [clips, setClips] = useState<ClipGrid>(new Map())
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [selectedCell, setSelectedCell] = useState<{ track: number; scene: number } | null>(null)

  const handlePlay = async () => {
    await Tone.start()
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
      await Tone.start()
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

    const cellKey = getCellKey(selectedCell.track, selectedCell.scene)
    const existingClip = clips.get(cellKey)
    if (existingClip) {
      existingClip.player.dispose()
    }

    const url = URL.createObjectURL(file)
    const player = new Tone.Player(url).toDestination()
    player.loop = true

    await Tone.loaded()

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
            </>
          ))}
        </div>
      </div>
    </div>
  )
}

export default App
