export const AUDIO_EXTENSIONS = new Set([
  'mp3',
  'wav',
  'ogg',
  'oga',
  'm4a',
  'flac',
  'aac',
  'webm',
  'aiff',
  'aif'
])

export function isAudioFile(file: { name: string; type?: string }): boolean {
  const type = (file.type || '').toLowerCase()
  if (type.startsWith('audio/')) return true
  const dot = file.name.lastIndexOf('.')
  if (dot < 0) return false
  return AUDIO_EXTENSIONS.has(file.name.slice(dot + 1).toLowerCase())
}

export function partitionDroppedFiles(files: Iterable<File>): { audio: File[]; ignored: File[] } {
  const audio: File[] = []
  const ignored: File[] = []
  for (const file of files) {
    if (isAudioFile(file)) audio.push(file)
    else ignored.push(file)
  }
  return { audio, ignored }
}

export function ignoredAudioToast(ignoredCount: number): string | null {
  if (ignoredCount <= 0) return null
  if (ignoredCount === 1) return 'Se ignoró un archivo que no es audio'
  return `Se ignoraron ${ignoredCount} archivos que no son audio`
}

export function dropTimeOnLane(
  clientX: number,
  rectLeft: number,
  rectWidth: number,
  layoutMax: number,
  snapEnabled: boolean,
  snapToGrid: (time: number) => number
): number {
  if (rectWidth <= 0 || layoutMax <= 0) return 0
  const percentage = Math.max(0, Math.min(1, (clientX - rectLeft) / rectWidth))
  const raw = percentage * layoutMax
  const t = snapEnabled ? snapToGrid(raw) : raw
  return Math.max(0, t)
}

export interface DropPlacement {
  trackIndex: number
  createNew: boolean
  insertAt?: number
}

/** One file on a hovered lane stays there; several files each get a new track.
 *  insertAt (0..count) creates new tracks at that index instead of appending. */
export function resolveDropPlacement(
  fileCount: number,
  hoverTrackIndex: number | null,
  currentTrackCount: number,
  insertAt?: number | null
): DropPlacement[] {
  if (fileCount <= 0) return []
  if (insertAt != null && insertAt >= 0 && insertAt <= currentTrackCount) {
    return Array.from({ length: fileCount }, (_, i) => ({
      trackIndex: insertAt + i,
      createNew: true,
      insertAt: insertAt + i
    }))
  }
  if (fileCount === 1 && hoverTrackIndex !== null && hoverTrackIndex >= 0 && hoverTrackIndex < currentTrackCount) {
    return [{ trackIndex: hoverTrackIndex, createNew: false }]
  }
  return Array.from({ length: fileCount }, (_, i) => ({
    trackIndex: currentTrackCount + i,
    createNew: true
  }))
}

export function trackIndexFromPoint(clientX: number, clientY: number): number | null {
  if (typeof document === 'undefined') return null
  const el = document.elementFromPoint(clientX, clientY)
  const lane = el?.closest?.('.track-content') as HTMLElement | null
  if (!lane) return null
  const raw = lane.dataset.trackIndex
  if (raw == null || raw === '') return null
  const idx = Number(raw)
  return Number.isInteger(idx) ? idx : null
}

export function dataTransferHasFiles(types: ArrayLike<string> | null | undefined): boolean {
  if (!types) return false
  return Array.from(types as ArrayLike<string>).includes('Files')
}
