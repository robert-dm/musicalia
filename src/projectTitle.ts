export const UNTITLED_PROJECT_NAME = 'Sin título'
export const LEGACY_UNTITLED_PROJECT_NAME = 'Proyecto sin título'

const UNTITLED_ALIASES = new Set([
  UNTITLED_PROJECT_NAME.toLowerCase(),
  LEGACY_UNTITLED_PROJECT_NAME.toLowerCase(),
  'sin titulo',
  'proyecto sin titulo'
])

export function isUntitledProjectName(name: string | null | undefined): boolean {
  const trimmed = String(name ?? '').trim()
  if (!trimmed) return true
  return UNTITLED_ALIASES.has(trimmed.toLowerCase())
}

export function baseNameFromMusicalia(fileName: string | null | undefined): string | null {
  if (!fileName) return null
  const base = String(fileName).trim().replace(/\.musicalia$/i, '').trim()
  return base.length > 0 ? base : null
}

/** Project name, else the .musicalia basename, else "Sin título". */
export function displayProjectName(
  name: string | null | undefined,
  fileName?: string | null
): string {
  const trimmed = String(name ?? '').trim()
  if (trimmed && !isUntitledProjectName(trimmed)) return trimmed
  const fromFile = baseNameFromMusicalia(fileName)
  if (fromFile && !isUntitledProjectName(fromFile)) return fromFile
  return UNTITLED_PROJECT_NAME
}

export function projectTabTitle(displayName: string, dirty: boolean): string {
  const name = displayName.trim() || UNTITLED_PROJECT_NAME
  return dirty ? `• ${name} — Musicalia` : `${name} — Musicalia`
}

export function commitProjectName(draft: string, previous: string): string {
  const trimmed = draft.trim()
  return trimmed.length > 0 ? trimmed : (previous.trim() || UNTITLED_PROJECT_NAME)
}

export function suggestedMusicaliaFileName(displayName: string): string {
  const safe = displayName.replace(/[<>:"/\\|?*]/g, '_').replace(/\s+/g, ' ').trim()
  const base = safe || 'proyecto'
  return base.toLowerCase().endsWith('.musicalia') ? base : `${base}.musicalia`
}
