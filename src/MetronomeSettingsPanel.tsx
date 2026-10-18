import {
  TIME_SIGNATURE_PRESETS,
  formatTimeSignature,
  isCompoundMeter,
  type ClickSound,
  type MetronomeMeter,
  type MetronomeSubdivision
} from './metronomeMeter'

const SUB_LABELS: Record<MetronomeSubdivision, string> = {
  none: 'Ninguna',
  eighths: '8vos',
  triplets: 'Tresillos',
  sixteenths: '16vos'
}

const SOUND_LABELS: Record<ClickSound, string> = {
  wood: 'Madera',
  beep: 'Beep',
  rim: 'Aro'
}

interface MetronomeSettingsPanelProps {
  meter: MetronomeMeter
  bpm: number
  alignArmed: boolean
  phaseMs: number
  onPatch: (patch: Partial<MetronomeMeter>) => void
  onPhaseMs: (ms: number) => void
  onArmAlign: () => void
  onClose: () => void
}

export function MetronomeSettingsPanel({
  meter,
  bpm,
  alignArmed,
  phaseMs,
  onPatch,
  onPhaseMs,
  onArmAlign,
  onClose
}: MetronomeSettingsPanelProps) {
  const compound = isCompoundMeter(meter.numerator, meter.denominator)
  const presetLabel = formatTimeSignature(meter)
  const isPreset = TIME_SIGNATURE_PRESETS.some(
    (p) => p.numerator === meter.numerator && p.denominator === meter.denominator
  )

  return (
    <div className="metro-settings" data-testid="metronome-settings" role="dialog" aria-label="Ajustes del metrónomo">
      <div className="metro-settings-head">
        <div>
          <div className="metro-settings-kicker">Metrónomo</div>
          <h3>Compás y clic</h3>
        </div>
        <button type="button" className="metro-settings-close" onClick={onClose} aria-label="Cerrar">
          ×
        </button>
      </div>

      <section className="metro-settings-section">
        <div className="metro-settings-label">Compás</div>
        <div className="metro-chip-row" role="group" aria-label="Compás">
          {TIME_SIGNATURE_PRESETS.map((preset) => {
            const active = meter.numerator === preset.numerator && meter.denominator === preset.denominator
            return (
              <button
                key={preset.label}
                type="button"
                className={`metro-chip ${active ? 'active' : ''}`}
                data-testid={`meter-preset-${preset.label.replace('/', '-')}`}
                aria-pressed={active}
                onClick={() => onPatch({ numerator: preset.numerator, denominator: preset.denominator })}
              >
                {preset.label}
              </button>
            )
          })}
        </div>
        <div className="metro-custom-meter">
          <span>Personalizado</span>
          <input
            type="number"
            min={1}
            max={16}
            className="metro-nd"
            data-testid="meter-numerator"
            aria-label="Numerador"
            value={meter.numerator}
            onChange={(e) => onPatch({ numerator: Number(e.target.value) })}
          />
          <span className="metro-nd-slash">/</span>
          <select
            className="metro-nd"
            data-testid="meter-denominator"
            aria-label="Denominador"
            value={meter.denominator}
            onChange={(e) => onPatch({ denominator: Number(e.target.value) })}
          >
            {[1, 2, 4, 8, 16].map((d) => (
              <option key={d} value={d}>{d}</option>
            ))}
          </select>
          <span className="metro-settings-hint">{isPreset ? presetLabel : `${presetLabel} · custom`}</span>
        </div>
        {compound && (
          <div className="metro-chip-row" role="group" aria-label="Pulso compuesto">
            <button
              type="button"
              className={`metro-chip ${meter.compoundPulse === 'dotted-quarter' ? 'active' : ''}`}
              data-testid="compound-dotted"
              aria-pressed={meter.compoundPulse === 'dotted-quarter'}
              onClick={() => onPatch({ compoundPulse: 'dotted-quarter' })}
            >
              Pulso en negra con puntillo
            </button>
            <button
              type="button"
              className={`metro-chip ${meter.compoundPulse === 'eighth' ? 'active' : ''}`}
              data-testid="compound-eighth"
              aria-pressed={meter.compoundPulse === 'eighth'}
              onClick={() => onPatch({ compoundPulse: 'eighth' })}
            >
              Pulso en 8vos
            </button>
          </div>
        )}
      </section>

      <section className="metro-settings-section">
        <label className="metro-toggle">
          <input
            type="checkbox"
            checked={meter.accentDownbeat}
            data-testid="accent-downbeat"
            onChange={(e) => onPatch({ accentDownbeat: e.target.checked })}
          />
          <span>Acentuar el 1</span>
        </label>
      </section>

      <section className="metro-settings-section">
        <div className="metro-settings-label">Subdivisión</div>
        <div className="metro-chip-row" role="group" aria-label="Subdivisión">
          {(['none', 'eighths', 'triplets', 'sixteenths'] as MetronomeSubdivision[]).map((sub) => (
            <button
              key={sub}
              type="button"
              className={`metro-chip ${meter.subdivision === sub ? 'active' : ''}`}
              data-testid={`subdivision-${sub}`}
              aria-pressed={meter.subdivision === sub}
              onClick={() => onPatch({ subdivision: sub })}
            >
              {SUB_LABELS[sub]}
            </button>
          ))}
        </div>
      </section>

      <section className="metro-settings-section">
        <div className="metro-settings-label">Sonido del clic</div>
        <div className="metro-chip-row" role="group" aria-label="Sonido del clic">
          {(['wood', 'beep', 'rim'] as ClickSound[]).map((sound) => (
            <button
              key={sound}
              type="button"
              className={`metro-chip ${meter.clickSound === sound ? 'active' : ''}`}
              data-testid={`click-sound-${sound}`}
              aria-pressed={meter.clickSound === sound}
              onClick={() => onPatch({ clickSound: sound })}
            >
              {SOUND_LABELS[sound]}
            </button>
          ))}
        </div>
      </section>

      <section className="metro-settings-section metro-align-section">
        <div className="metro-settings-label">Alinear metrónomo</div>
        <p className="metro-settings-copy">
          Marcá dónde cae el 1 en la canción, o corre el clic en milisegundos. Tempo actual {bpm} BPM.
        </p>
        <button
          type="button"
          className={`metro-align-btn ${alignArmed ? 'armed' : ''}`}
          data-testid="align-metronome"
          aria-pressed={alignArmed}
          onClick={onArmAlign}
        >
          {alignArmed ? 'Hacé click donde está el 1…' : 'Click donde está el 1'}
        </button>
        <div className="metro-phase-row">
          <span>Fase</span>
          <button
            type="button"
            className="metro-phase-nudge"
            data-testid="phase-minus"
            onClick={() => onPhaseMs(phaseMs - 10)}
          >
            −10 ms
          </button>
          <input
            type="number"
            className="metro-phase-input"
            data-testid="phase-ms"
            aria-label="Fase en milisegundos"
            value={phaseMs}
            onChange={(e) => onPhaseMs(Number(e.target.value) || 0)}
          />
          <button
            type="button"
            className="metro-phase-nudge"
            data-testid="phase-plus"
            onClick={() => onPhaseMs(phaseMs + 10)}
          >
            +10 ms
          </button>
        </div>
      </section>
    </div>
  )
}
