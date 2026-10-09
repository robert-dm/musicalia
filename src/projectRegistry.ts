import { createStore, del, get, set } from 'idb-keyval'

export const PROJECT_REGISTRY_API = '/api/project-registry'
export const HANDLE_DB = 'musicalia-file-handles'
export const HANDLE_STORE = 'handles'

export interface ProjectRegistryEntry {
  id: string
  name: string
  fileName: string
  locationNote: string
  savedAt: string
  bpm: number
  trackCount: number
}

export interface ProjectIdJson {
  id?: unknown
  name?: unknown
}

const handleStore = createStore(HANDLE_DB, HANDLE_STORE)

export function newProjectId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `p-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

export function readProjectIdFromJson(data: unknown): string | null {
  if (!data || typeof data !== 'object') return null
  const id = (data as ProjectIdJson).id
  if (typeof id !== 'string') return null
  const trimmed = id.trim()
  return trimmed.length > 0 ? trimmed : null
}

export function idsMatch(entryId: string, fileId: string | null): boolean {
  if (!fileId) return false
  return entryId === fileId
}

type PickerWindow = {
  showSaveFilePicker?: unknown
  showOpenFilePicker?: unknown
}

export function hasFileSystemAccess(win: PickerWindow = window as PickerWindow): boolean {
  return typeof win.showSaveFilePicker === 'function' && typeof win.showOpenFilePicker === 'function'
}

export function musicaliaFilePickerTypes() {
  return [{
    description: 'Proyecto Musicalia',
    accept: { 'application/x-musicalia': ['.musicalia'] }
  }]
}

export function buildRegistryEntry(input: {
  id: string
  name: string
  fileName: string
  locationNote?: string
  savedAt?: string
  bpm: number
  trackCount: number
}): ProjectRegistryEntry {
  const fileName = input.fileName.endsWith('.musicalia')
    ? input.fileName
    : `${input.fileName.replace(/\.+$/, '')}.musicalia`
  return {
    id: input.id,
    name: input.name.trim() || 'Proyecto sin título',
    fileName,
    locationNote: (input.locationNote ?? '').trim(),
    savedAt: input.savedAt ?? new Date().toISOString(),
    bpm: Number.isFinite(input.bpm) ? Math.round(input.bpm) : 120,
    trackCount: Math.max(0, Math.floor(input.trackCount))
  }
}

export function upsertRegistryEntry(
  entries: ProjectRegistryEntry[],
  incoming: ProjectRegistryEntry
): ProjectRegistryEntry[] {
  const index = entries.findIndex((entry) => entry.id === incoming.id)
  if (index < 0) return [incoming, ...entries]
  const previous = entries[index]
  const merged: ProjectRegistryEntry = {
    ...previous,
    ...incoming,
    locationNote: incoming.locationNote !== '' ? incoming.locationNote : previous.locationNote
  }
  const next = entries.slice()
  next.splice(index, 1)
  return [merged, ...next]
}

export function removeRegistryEntry(entries: ProjectRegistryEntry[], id: string): ProjectRegistryEntry[] {
  return entries.filter((entry) => entry.id !== id)
}

export function patchLocationNote(
  entries: ProjectRegistryEntry[],
  id: string,
  locationNote: string
): ProjectRegistryEntry[] {
  return entries.map((entry) => (
    entry.id === id ? { ...entry, locationNote: locationNote.trim() } : entry
  ))
}

export function formatRegistryDate(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleString('es', { dateStyle: 'short', timeStyle: 'short' })
}

export function handleKey(projectId: string): string {
  return `handle:${projectId}`
}

export async function persistFileHandle(projectId: string, handle: FileSystemFileHandle): Promise<void> {
  try {
    await set(handleKey(projectId), handle, handleStore)
  } catch {
    // Fake handles / private mode / unsupported clone
  }
}

export async function loadFileHandle(projectId: string): Promise<FileSystemFileHandle | null> {
  try {
    const handle = await get(handleKey(projectId), handleStore)
    return handle ?? null
  } catch {
    return null
  }
}

export async function deleteFileHandle(projectId: string): Promise<void> {
  try {
    await del(handleKey(projectId), handleStore)
  } catch {
    /* ignore */
  }
}

function authHeaders(): HeadersInit {
  let token: string | null = null
  try {
    token = typeof localStorage !== 'undefined' ? localStorage.getItem('musicalia_auth_token') : null
  } catch {
    token = null
  }
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (token) headers.Authorization = `Bearer ${token}`
  return headers
}

async function parseError(response: Response, fallback: string): Promise<string> {
  try {
    const data = await response.json() as { error?: string }
    return data.error || fallback
  } catch {
    return fallback
  }
}

export async function listProjectRegistry(): Promise<ProjectRegistryEntry[]> {
  const response = await fetch(PROJECT_REGISTRY_API, { headers: authHeaders() })
  if (response.status === 401) return []
  if (!response.ok) throw new Error(await parseError(response, 'Error al listar proyectos'))
  const data = await response.json() as { entries?: ProjectRegistryEntry[] }
  return Array.isArray(data.entries) ? data.entries : []
}

export async function upsertProjectRegistry(entry: ProjectRegistryEntry): Promise<ProjectRegistryEntry[]> {
  const response = await fetch(PROJECT_REGISTRY_API, {
    method: 'PUT',
    headers: authHeaders(),
    body: JSON.stringify(entry)
  })
  if (!response.ok) throw new Error(await parseError(response, 'Error al registrar el proyecto'))
  const data = await response.json() as { entries?: ProjectRegistryEntry[] }
  return Array.isArray(data.entries) ? data.entries : []
}

export async function updateProjectLocationNote(id: string, locationNote: string): Promise<ProjectRegistryEntry[]> {
  const response = await fetch(PROJECT_REGISTRY_API, {
    method: 'PATCH',
    headers: authHeaders(),
    body: JSON.stringify({ id, locationNote })
  })
  if (!response.ok) throw new Error(await parseError(response, 'Error al guardar la ubicación'))
  const data = await response.json() as { entries?: ProjectRegistryEntry[] }
  return Array.isArray(data.entries) ? data.entries : []
}

export async function removeProjectRegistry(id: string): Promise<ProjectRegistryEntry[]> {
  const response = await fetch(`${PROJECT_REGISTRY_API}?id=${encodeURIComponent(id)}`, {
    method: 'DELETE',
    headers: authHeaders()
  })
  if (!response.ok) throw new Error(await parseError(response, 'Error al quitar el proyecto de la lista'))
  const data = await response.json() as { entries?: ProjectRegistryEntry[] }
  return Array.isArray(data.entries) ? data.entries : []
}

export async function pickMusicaliaFile(): Promise<{ file: File; handle: FileSystemFileHandle | null }> {
  const win = window as Window & {
    showOpenFilePicker?: (opts: unknown) => Promise<FileSystemFileHandle[]>
  }
  if (typeof win.showOpenFilePicker === 'function') {
    const [handle] = await win.showOpenFilePicker({
      multiple: false,
      types: musicaliaFilePickerTypes()
    })
    const file = await handle.getFile()
    return { file, handle }
  }
  return new Promise((resolve, reject) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.musicalia,application/x-musicalia'
    input.style.display = 'none'
    input.addEventListener('change', () => {
      const file = input.files?.[0]
      input.remove()
      if (!file) reject(Object.assign(new Error('cancelled'), { name: 'AbortError' }))
      else resolve({ file, handle: null })
    })
    document.body.appendChild(input)
    input.click()
  })
}

type HandlePermissionMode = 'read' | 'readwrite'

export async function queryHandlePermission(
  handle: FileSystemFileHandle,
  mode: HandlePermissionMode = 'read'
): Promise<PermissionState | 'unknown'> {
  const withPerm = handle as FileSystemFileHandle & {
    queryPermission?: (opts: { mode: HandlePermissionMode }) => Promise<PermissionState>
  }
  if (typeof withPerm.queryPermission !== 'function') return 'unknown'
  try {
    return await withPerm.queryPermission({ mode })
  } catch {
    return 'unknown'
  }
}

export async function ensureHandlePermission(
  handle: FileSystemFileHandle,
  mode: HandlePermissionMode = 'read'
): Promise<boolean> {
  const status = await queryHandlePermission(handle, mode)
  if (status === 'granted' || status === 'unknown') return true
  const withPerm = handle as FileSystemFileHandle & {
    requestPermission?: (opts: { mode: HandlePermissionMode }) => Promise<PermissionState>
  }
  if (typeof withPerm.requestPermission !== 'function') return false
  try {
    return (await withPerm.requestPermission({ mode })) === 'granted'
  } catch {
    return false
  }
}
