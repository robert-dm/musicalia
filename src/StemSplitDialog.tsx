import './StemSplitDialog.css'

interface StemSplitDialogProps {
  onConfirm: () => void
  onCancel: () => void
}

export function StemSplitDialog({ onConfirm, onCancel }: StemSplitDialogProps) {
  return (
    <div className="modal-overlay">
      <div className="modal-content">
        <h2 className="modal-title">¿Este audio tiene varios instrumentos?</h2>
        <p className="modal-description">
          Se puede separar el audio en pistas individuales (Vocals, Drums, Bass, Other) 
          usando inteligencia artificial directamente en tu navegador con Demucs.
        </p>
        <p className="modal-note">
          <strong>Nota:</strong> La primera vez descargará el modelo Demucs (~80MB). 
          El proceso puede tardar varios minutos dependiendo de la duración del audio.
          <br /><br />
          <strong>Requerimientos:</strong> Navegador moderno con WebGPU (Chrome/Edge 113+) 
          y al menos 2GB RAM disponible.
        </p>
        <div className="modal-buttons">
          <button 
            className="modal-button modal-button-primary"
            onClick={onConfirm}
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
  onCancel?: () => void
}

export function StemSplitProgress({ progress, onCancel }: StemSplitProgressProps) {
  return (
    <div className="modal-overlay">
      <div className="modal-content">
        <h2 className="modal-title">Separando stems...</h2>
        <div className="progress-container">
          <div className="progress-bar">
            <div 
              className="progress-fill" 
              style={{ width: `${progress}%` }}
            />
          </div>
          <div className="progress-text">{Math.round(progress)}%</div>
        </div>
        <p className="modal-description">
          Este proceso puede tardar varios minutos. Por favor, no cierres esta ventana.
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
