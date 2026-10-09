import { useRef, useState } from 'react'
import {
  DRUM_PAD_MAX,
  PAD_KEYS,
  PATTERN_IDS,
  activePatternOf,
  type DrumKit,
  type DrumPad
} from './drumKit'
import type { StepVelocity } from './drumTiming'
import { ParamKnob } from './ParamKnob'
import './DrumEditor.css'

const ACCEPTED = 'audio/wav,audio/mpeg,audio/mp3,audio/ogg,audio/webm,audio/flac,audio/aac,audio/x-m4a,.mp3,.wav,.ogg,.m4a,.flac,.aac'

interface DrumEditorProps {
  kit: DrumKit
  selectedPad: number
  onSelectPad: (index: number) => void
  onChangeKit: (kit: DrumKit) => void
  onAudition: (index: number) => void
  onLoadPadFile: (index: number, file: File) => void
  onExpandPads: () => void
  onPlaceClip: () => void
  onPickFile: (index: number) => void
}

export function DrumEditor({
  kit,
  selectedPad,
  onSelectPad,
  onChangeKit,
  onAudition,
  onLoadPadFile,
  onExpandPads,
  onPlaceClip,
  onPickFile
}: DrumEditorProps) {
  const [menu, setMenu] = useState<{ pad: number; step: number; x: number; y: number } | null>(null)
  const pattern = activePatternOf(kit)
  const pad = kit.pads[selectedPad] ?? kit.pads[0]
  const fileRef = useRef<HTMLInputElement>(null)
  const pickIndex = useRef(0)

  const patchPad = (next: Partial<DrumPad>) => {
    onChangeKit({
      ...kit,
      pads: kit.pads.map((p, i) => (i === selectedPad ? { ...p, ...next } : p))
    })
  }

  const setCell = (padIndex: number, step: number, velocity: StepVelocity) => {
    const rows = pattern.rows.map((row, i) => {
      if (i !== padIndex) return row
      const next = row.slice()
      next[step] = velocity
      return next
    })
    onChangeKit({
      ...kit,
      patterns: { ...kit.patterns, [kit.activePattern]: { ...pattern, rows } }
    })
  }

  return (
    <div className="drum-editor" data-testid="drum-editor">
      <div className="drum-editor-toolbar">
        <div className="drum-pattern-switch" role="group" aria-label="Patrón">
          {PATTERN_IDS.map((id) => (
            <button
              key={id}
              type="button"
              className={`drum-pattern-btn ${kit.activePattern === id ? 'active' : ''}`}
              data-testid={`drum-pattern-${id}`}
              onClick={() => onChangeKit({ ...kit, activePattern: id })}
            >
              {id}
            </button>
          ))}
        </div>
        <div className="drum-step-switch">
          <button
            type="button"
            className={pattern.stepCount === 16 ? 'active' : ''}
            onClick={() => onChangeKit(setSteps(kit, 16))}
          >
            16
          </button>
          <button
            type="button"
            className={pattern.stepCount === 32 ? 'active' : ''}
            data-testid="drum-steps-32"
            onClick={() => onChangeKit(setSteps(kit, 32))}
          >
            32
          </button>
        </div>
        <label className="drum-swing">
          <span>Swing</span>
          <input
            type="range"
            min={0}
            max={0.75}
            step={0.01}
            value={kit.swing}
            aria-label="Swing"
            onChange={(e) => onChangeKit({ ...kit, swing: parseFloat(e.target.value) })}
          />
          <em>{Math.round(kit.swing * 100)}%</em>
        </label>
        <button type="button" className="drum-toolbar-btn" data-testid="drum-place-clip" onClick={onPlaceClip}>
          Colocar patrón
        </button>
        {kit.padCount < DRUM_PAD_MAX && (
          <button type="button" className="drum-toolbar-btn" data-testid="drum-expand-pads" onClick={onExpandPads}>
            16 pads
          </button>
        )}
      </div>

      <div className="drum-editor-body">
        <div className="drum-pads" data-testid="drum-pads">
          {kit.pads.slice(0, kit.padCount).map((item, index) => (
            <button
              key={item.id}
              type="button"
              className={`drum-pad ${selectedPad === index ? 'selected' : ''} ${item.buffer ? 'loaded' : ''}`}
              data-testid={`drum-pad-${index}`}
              onClick={() => {
                onSelectPad(index)
                onAudition(index)
              }}
              onDragOver={(e) => {
                e.preventDefault()
                e.stopPropagation()
              }}
              onDrop={(e) => {
                e.preventDefault()
                e.stopPropagation()
                const file = e.dataTransfer.files?.[0]
                if (file) onLoadPadFile(index, file)
              }}
            >
              <span className="drum-pad-key">{PAD_KEYS[index]?.toUpperCase() ?? ''}</span>
              <span className="drum-pad-name">{item.name}</span>
            </button>
          ))}
        </div>

        {pad && (
          <div className="drum-pad-detail">
            <input
              className="drum-pad-title"
              value={pad.name}
              aria-label="Nombre del pad"
              onChange={(e) => patchPad({ name: e.target.value })}
            />
            <div className="drum-pad-knobs">
              <ParamKnob
                label="Vol"
                value={pad.volume}
                min={0}
                max={1}
                step={0.01}
                onLive={(v) => patchPad({ volume: v })}
                onCommit={(v) => patchPad({ volume: v })}
              />
              <ParamKnob
                label="Pan"
                value={pad.pan}
                min={-1}
                max={1}
                step={0.01}
                onLive={(v) => patchPad({ pan: v })}
                onCommit={(v) => patchPad({ pan: v })}
              />
              <ParamKnob
                label="Tono"
                value={pad.pitchSemitones}
                min={-12}
                max={12}
                step={0.5}
                onLive={(v) => patchPad({ pitchSemitones: v })}
                onCommit={(v) => patchPad({ pitchSemitones: v })}
              />
              <ParamKnob
                label="Decay"
                value={pad.decay}
                min={0.04}
                max={2}
                step={0.01}
                unit="s"
                onLive={(v) => patchPad({ decay: v })}
                onCommit={(v) => patchPad({ decay: v })}
              />
            </div>
            <div className="drum-pad-flags">
              <label>
                <input
                  type="checkbox"
                  checked={pad.reverse}
                  onChange={(e) => patchPad({ reverse: e.target.checked })}
                />
                Reverse
              </label>
              <label>
                Choke
                <select
                  value={pad.chokeGroup ?? ''}
                  onChange={(e) =>
                    patchPad({ chokeGroup: e.target.value ? Number(e.target.value) : null })
                  }
                >
                  <option value="">No</option>
                  <option value="1">1</option>
                  <option value="2">2</option>
                  <option value="3">3</option>
                  <option value="4">4</option>
                </select>
              </label>
              <button
                type="button"
                className="drum-toolbar-btn"
                onClick={() => {
                  pickIndex.current = selectedPad
                  onPickFile(selectedPad)
                  fileRef.current?.click()
                }}
              >
                Cargar sample
              </button>
            </div>
          </div>
        )}

        <div className="drum-grid-wrap">
          <div
            className="drum-grid"
            data-testid="drum-grid"
            style={{ gridTemplateColumns: `88px repeat(${pattern.stepCount}, minmax(16px, 1fr))` }}
          >
            {kit.pads.slice(0, kit.padCount).map((item, padIndex) => (
              <div key={item.id} className="drum-grid-row">
                <button
                  type="button"
                  className={`drum-grid-label ${selectedPad === padIndex ? 'selected' : ''}`}
                  onClick={() => {
                    onSelectPad(padIndex)
                    onAudition(padIndex)
                  }}
                >
                  {item.name}
                </button>
                {Array.from({ length: pattern.stepCount }, (_, step) => {
                  const vel = (pattern.rows[padIndex]?.[step] ?? 0) as StepVelocity
                  return (
                    <button
                      key={step}
                      type="button"
                      className={`drum-step v${vel} ${step % 4 === 0 ? 'beat' : ''}`}
                      data-testid={`drum-step-${padIndex}-${step}`}
                      data-velocity={vel}
                      onClick={() => setCell(padIndex, step, cycle(vel))}
                      onContextMenu={(e) => {
                        e.preventDefault()
                        setMenu({ pad: padIndex, step, x: e.clientX, y: e.clientY })
                      }}
                    />
                  )
                })}
              </div>
            ))}
          </div>
        </div>
      </div>

      <input
        ref={fileRef}
        type="file"
        accept={ACCEPTED}
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0]
          if (file) onLoadPadFile(pickIndex.current, file)
          e.currentTarget.value = ''
        }}
      />

      {menu && (
        <div className="drum-vel-menu" style={{ left: menu.x, top: menu.y }} data-testid="drum-vel-menu">
          {([
            [2, 'Media'],
            [3, 'Fuerte'],
            [1, 'Suave'],
            [0, 'Quitar']
          ] as const).map(([vel, label]) => (
            <button
              key={vel}
              type="button"
              onClick={() => {
                setCell(menu.pad, menu.step, vel)
                setMenu(null)
              }}
            >
              {label}
            </button>
          ))}
        </div>
      )}
      {menu && <div className="drum-vel-backdrop" onMouseDown={() => setMenu(null)} />}
    </div>
  )
}

function cycle(current: StepVelocity): StepVelocity {
  if (current <= 0) return 2
  if (current === 2) return 3
  if (current === 3) return 1
  return 0
}

function setSteps(kit: DrumKit, stepCount: 16 | 32): DrumKit {
  const patterns = { ...kit.patterns }
  for (const id of PATTERN_IDS) {
    const pattern = patterns[id]
    const rows = pattern.rows.map((row) => {
      const next = row.slice(0, stepCount)
      while (next.length < stepCount) next.push(0)
      return next
    })
    patterns[id] = { ...pattern, stepCount, rows }
  }
  return { ...kit, patterns }
}
