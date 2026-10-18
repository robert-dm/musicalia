export type HandlePermissionMode = 'read' | 'readwrite'

export type WritableLike = {
  write: (data: Blob | BufferSource | string) => Promise<void>
  close: () => Promise<void>
  abort?: () => Promise<void>
}

export type FileHandleLike = {
  name?: string
  queryPermission?: (opts: { mode: HandlePermissionMode }) => Promise<PermissionState>
  requestPermission?: (opts: { mode: HandlePermissionMode }) => Promise<PermissionState>
  createWritable?: (opts?: { keepExistingData?: boolean }) => Promise<WritableLike>
}

export type SaveHandleResult =
  | { ok: true }
  | { ok: false; reason: 'denied' | 'activation'; error?: unknown }

export const MUSICALIA_SAVE_TYPES = [{
  description: 'Proyecto Musicalia',
  accept: { 'application/x-musicalia': ['.musicalia'] }
}]

export function isActivationError(err: unknown): boolean {
  if (!err) return false
  const name = typeof err === 'object' && err && 'name' in err ? String((err as { name: unknown }).name) : ''
  const message = err instanceof Error ? err.message : String(err)
  return name === 'NotAllowedError'
    || name === 'SecurityError'
    || /user activation is required/i.test(message)
    || /failed to execute 'createwritable'/i.test(message)
}

/** Starts requestPermission immediately. Do not await anything else first. */
export function requestWritePermission(handle: FileHandleLike): Promise<PermissionState | 'unknown'> {
  if (typeof handle.requestPermission !== 'function') return Promise.resolve('unknown')
  try {
    return handle.requestPermission({ mode: 'readwrite' })
  } catch (err) {
    if (isActivationError(err)) return Promise.reject(err)
    return Promise.resolve('denied')
  }
}

export function queryWritePermission(handle: FileHandleLike): Promise<PermissionState | 'unknown'> {
  if (typeof handle.queryPermission !== 'function') return Promise.resolve('unknown')
  try {
    return handle.queryPermission({ mode: 'readwrite' }).catch(() => 'unknown' as const)
  } catch {
    return Promise.resolve('unknown')
  }
}

export async function writeAndClose(writable: WritableLike, blob: Blob): Promise<void> {
  try {
    await writable.write(blob)
    await writable.close()
  } catch (err) {
    try { await writable.abort?.() } catch { /* keep the original throw */ }
    throw err
  }
}

/**
 * Gesture-backed overwrite. Invokes requestPermission synchronously, then
 * opens createWritable before any project serialization.
 */
export async function saveHandleAfterGesture(
  handle: FileHandleLike,
  serialize: () => Promise<Blob>
): Promise<SaveHandleResult> {
  const permissionPromise = requestWritePermission(handle)
  let writable: WritableLike | null = null
  try {
    const status = await permissionPromise
    if (status !== 'granted' && status !== 'unknown') {
      return { ok: false, reason: 'denied' }
    }
    if (typeof handle.createWritable !== 'function') {
      return { ok: false, reason: 'denied' }
    }
    writable = await handle.createWritable()
    const blob = await serialize()
    await writeAndClose(writable, blob)
    writable = null
    return { ok: true }
  } catch (err) {
    try { await writable?.abort?.() } catch { /* ignore */ }
    if (isActivationError(err)) return { ok: false, reason: 'activation', error: err }
    throw err
  }
}

/**
 * Autosave / background write. Never calls requestPermission.
 * If the handle is not already granted, skip and let the caller mark unsaved.
 */
export async function silentSaveIfGranted(
  handle: FileHandleLike,
  serialize: () => Promise<Blob>
): Promise<'saved' | 'skipped'> {
  const status = await queryWritePermission(handle)
  if (status !== 'granted') return 'skipped'
  if (typeof handle.createWritable !== 'function') return 'skipped'
  const writable = await handle.createWritable()
  const blob = await serialize()
  await writeAndClose(writable, blob)
  return 'saved'
}

export type SaveFilePickerFn = (opts: {
  suggestedName: string
  types: typeof MUSICALIA_SAVE_TYPES
}) => Promise<FileHandleLike>

export function pickSaveFileHandle(
  suggestedName: string,
  picker: SaveFilePickerFn
): Promise<FileHandleLike> {
  return picker({
    suggestedName,
    types: MUSICALIA_SAVE_TYPES
  })
}
