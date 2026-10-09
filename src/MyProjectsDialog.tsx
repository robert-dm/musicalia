import { useState } from 'react'
import {
  formatRegistryDate,
  type ProjectRegistryEntry
} from './projectRegistry'
import { IconFolderOpen, IconTrash } from './uiIcons'

interface MyProjectsDialogProps {
  entries: ProjectRegistryEntry[]
  loading: boolean
  error: string | null
  hint: string | null
  onClose: () => void
  onOpen: (entry: ProjectRegistryEntry) => void
  onRemove: (entry: ProjectRegistryEntry) => void
  onLocationNote: (id: string, note: string) => void
}

export function MyProjectsDialog({
  entries,
  loading,
  error,
  hint,
  onClose,
  onOpen,
  onRemove,
  onLocationNote
}: MyProjectsDialogProps) {
  const [drafts, setDrafts] = useState<Record<string, string>>({})

  return (
    <div className="drive-projects-modal" data-testid="my-projects-modal" onMouseDown={(e) => {
      if (e.target === e.currentTarget) onClose()
    }}>
      <div className="modal-content my-projects-modal">
        <h2>Mis proyectos</h2>
        <p>
          Solo metadatos en la nube. El audio vive en tu archivo <strong>.musicalia</strong> local.
          Quitar de la lista no borra el archivo.
        </p>
        {hint && <p className="my-projects-hint" data-testid="my-projects-hint">{hint}</p>}
        {error && <p className="my-projects-error">{error}</p>}
        {loading ? (
          <p>Cargando…</p>
        ) : entries.length === 0 ? (
          <p data-testid="my-projects-empty">Todavía no hay proyectos en la lista. Guardá uno con sesión iniciada.</p>
        ) : (
          <div className="my-projects-list" data-testid="my-projects-list">
            {entries.map((entry) => {
              const note = drafts[entry.id] ?? entry.locationNote
              return (
                <article key={entry.id} className="my-projects-row" data-testid="my-projects-row" data-project-id={entry.id}>
                  <div className="my-projects-main">
                    <strong className="my-projects-name">{entry.name}</strong>
                    <span className="my-projects-file">{entry.fileName}</span>
                    <span className="my-projects-meta">
                      {formatRegistryDate(entry.savedAt)} · {entry.bpm} BPM · {entry.trackCount} pistas
                    </span>
                    <label className="my-projects-location">
                      Ubicación
                      <input
                        type="text"
                        className="field-input"
                        value={note}
                        placeholder="Carpeta o nota (opcional)"
                        aria-label={`Ubicación de ${entry.name}`}
                        onChange={(e) => setDrafts((prev) => ({ ...prev, [entry.id]: e.target.value }))}
                        onBlur={() => {
                          if (note.trim() !== entry.locationNote) onLocationNote(entry.id, note)
                        }}
                      />
                    </label>
                  </div>
                  <div className="my-projects-actions">
                    <button
                      type="button"
                      className="btn btn-primary"
                      data-testid="my-projects-open"
                      onClick={() => onOpen(entry)}
                    >
                      <IconFolderOpen size={14} />
                      Abrir
                    </button>
                    <button
                      type="button"
                      className="btn btn-ghost"
                      data-testid="my-projects-remove"
                      title="Quitar de la lista (no borra el archivo)"
                      onClick={() => onRemove(entry)}
                    >
                      <IconTrash size={14} />
                      Quitar
                    </button>
                  </div>
                </article>
              )
            })}
          </div>
        )}
        <div className="modal-actions">
          <button type="button" className="btn btn-primary" onClick={onClose}>Cerrar</button>
        </div>
      </div>
    </div>
  )
}
