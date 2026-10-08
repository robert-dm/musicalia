import { useState } from 'react'
import './StemSplitDialog.css'
import {
  DEFAULT_STEM_QUALITY,
  STEM_QUALITY_OPTIONS,
  isStemQuality,
  stemQualityOption,
  type StemQuality,
} from './stemQuality'
import { formatElapsed } from './stemProgress'

interface StemSplitDialogProps {
  onConfirm: (quality: StemQuality) => void
  onCancel: () => void
}

export function StemSplitDialog({ onConfirm, onCancel }: StemSplitDialogProps) {
  const [quality, setQuality] = useState<StemQuality>(DEFAULT_STEM_QUALITY)
  const selected = stemQualityOption(quality)

  return (
    <div className="modal-overlay">
      <div className="modal-content">
        <h2 className="modal-title">¿Este audio tiene varios instrumentos?</h2>
        <p className="modal-description">
          Se puede separar el audio en pistas individuales (Vocals, Drums, Bass, Other)
          con inteligencia artificial en tu navegador. El audio no sale de tu equipo.
        </p>

        <label className="quality-label" htmlFor="stem-quality">
          Calidad de separación
        </label>
        <select
          id="stem-quality"
          className="quality-select"
          value={quality}
          onChange={(e) => {
            if (isStemQuality(e.target.value)) setQuality(e.target.value)
          }}
        >
          {STEM_QUALITY_OPTIONS.map((option) => (
            <option key={option.id} value={option.id}>
              {option.label}
            </option>
          ))}
        </select>
        <p className="quality-detail">{selected.blurb}</p>

        <p className="modal-note">
          <strong>Básica / Rápida</strong> usa Spleeter (~80 MB, más rápido).
          {' '}<strong>Mejor calidad</strong> usa HT-Demucs (~166 MB, más lento y más memoria).
          La primera vez se descarga el modelo; las siguientes suelen ir desde la caché del navegador.
          <br /><br />
          <strong>Requisitos:</strong> navegador moderno y varios GB de RAM.
          HT-Demucs rinde mejor con WebGPU (Chrome/Edge). En móviles puede fallar; si ocurre, se cargará como pista única.
        </p>
        <div className="modal-buttons">
          <button
            className="modal-button modal-button-primary"
            onClick={() => onConfirm(quality)}
          >
            Sí, separar en pistas
          </button>
          <button
            className="modal-button modal-button-secondary"
            onClick={onCancel}
          >
            No, una sola pista
          </button>
        </div>
      </div>
    </div>
  )
}

interface StemSplitProgressProps {
  progress: number
  stage?: string
  elapsedSeconds?: number
  etaSeconds?: number
  onCancel?: () => void
}

export function StemSplitProgress({
  progress,
  stage,
  elapsedSeconds,
  etaSeconds,
  onCancel,
}: StemSplitProgressProps) {
  const pct = Math.max(0, Math.min(100, Math.round(progress)))
  const stageLabel = stage?.trim() || 'Separando stems…'
  const showEta = etaSeconds != null && Number.isFinite(etaSeconds) && etaSeconds >= 1 && pct < 100

  return (
    <div className="modal-overlay">
      <div className="modal-content">
        <h2 className="modal-title">Separando stems…</h2>
        <p className="progress-stage">{stageLabel}</p>
        <div className="progress-container">
          <div className="progress-bar">
            <div
              className="progress-fill"
              style={{ width: `${pct}%` }}
            />
          </div>
          <div className="progress-text">{pct}%</div>
        </div>
        <p className="progress-meta">
          {elapsedSeconds != null && Number.isFinite(elapsedSeconds)
            ? `Transcurrido: ${formatElapsed(elapsedSeconds)}`
            : 'El porcentaje avanza con la descarga y cada bloque de audio.'}
          {showEta ? ` · Resta aprox. ${formatElapsed(etaSeconds)}` : ''}
        </p>
        <p className="modal-description">
          Este proceso puede tardar varios minutos. No cierres esta ventana.
        </p>
        {onCancel && (
          <div className="modal-buttons">
            <button
              className="modal-button modal-button-secondary"
              onClick={onCancel}
            >
              Cancelar
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
