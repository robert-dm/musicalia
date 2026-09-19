import { useState } from 'react'
import * as Tone from 'tone'
import './App.css'

function App() {
  const [isPlaying, setIsPlaying] = useState(false)
  const [bpm, setBpm] = useState(120)

  const handlePlay = async () => {
    await Tone.start()
    Tone.getTransport().bpm.value = bpm
    Tone.getTransport().start()
    setIsPlaying(true)
  }

  const handleStop = () => {
    Tone.getTransport().stop()
    setIsPlaying(false)
  }

  const handleBpmChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newBpm = parseInt(e.target.value) || 120
    setBpm(newBpm)
    Tone.getTransport().bpm.value = newBpm
  }

  const tracks = Array.from({ length: 8 }, (_, i) => `Track ${i + 1}`)
  const scenes = Array.from({ length: 4 }, (_, i) => `Scene ${i + 1}`)

  return (
    <div className="app">
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
          
          {tracks.map((track) => (
            <>
              <div key={track} className="track-label">
                {track}
              </div>
              {scenes.map((scene) => (
                <div
                  key={`${track}-${scene}`}
                  className="clip-cell"
                />
              ))}
            </>
          ))}
        </div>
      </div>
    </div>
  )
}

export default App
