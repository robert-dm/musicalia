import { get, list, put } from '@vercel/blob'
import { getVercelOidcToken } from '@vercel/oidc'
import { getSessionFromRequest } from './_lib/auth-utils.js'

interface RegistryEntry {
  id: string
  name: string
  fileName: string
  locationNote: string
  savedAt: string
  bpm: number
  trackCount: number
}

function registryPath(userId: string): string {
  return `musicalia-registry/${userId}.json`
}

function sanitizeEntry(raw: unknown): RegistryEntry | null {
  if (!raw || typeof raw !== 'object') return null
  const rec = raw as Record<string, unknown>
  if (typeof rec.id !== 'string' || rec.id.trim() === '') return null
  return {
    id: rec.id.trim(),
    name: typeof rec.name === 'string' && rec.name.trim() ? rec.name.trim() : 'Proyecto sin título',
    fileName: typeof rec.fileName === 'string' && rec.fileName.trim() ? rec.fileName.trim() : 'proyecto.musicalia',
    locationNote: typeof rec.locationNote === 'string' ? rec.locationNote.trim() : '',
    savedAt: typeof rec.savedAt === 'string' ? rec.savedAt : new Date().toISOString(),
    bpm: typeof rec.bpm === 'number' && Number.isFinite(rec.bpm) ? Math.round(rec.bpm) : 120,
    trackCount: typeof rec.trackCount === 'number' && Number.isFinite(rec.trackCount)
      ? Math.max(0, Math.floor(rec.trackCount))
      : 0
  }
}

async function blobCreds() {
  const storeId = process.env.MUSICALIA_STORE_ID
  if (!storeId) throw new Error('MUSICALIA_STORE_ID no configurado')
  const oidcToken = await getVercelOidcToken()
  if (!oidcToken) {
    throw new Error('En el Blob store, pestaña Projects, conecta este proyecto o elige Upgrade to OIDC')
  }
  return { storeId, oidcToken }
}

async function readBlobText(pathname: string, storeId: string, oidcToken: string): Promise<string | null> {
  try {
    const result = await get(pathname, { access: 'private', storeId, oidcToken })
    if (!result?.stream) return null
    const chunks: Uint8Array[] = []
    for await (const chunk of result.stream) {
      chunks.push(chunk)
    }
    return Buffer.concat(chunks).toString('utf-8')
  } catch {
    return null
  }
}

async function loadEntries(userId: string): Promise<RegistryEntry[]> {
  const { storeId, oidcToken } = await blobCreds()
  const pathname = registryPath(userId)
  let text = await readBlobText(pathname, storeId, oidcToken)
  if (!text) {
    const { blobs } = await list({ prefix: `musicalia-registry/${userId}`, storeId, oidcToken })
    const blob = blobs.find((item) => item.pathname === pathname) || blobs[0]
    if (blob) text = await readBlobText(blob.pathname, storeId, oidcToken)
  }
  if (!text) return []
  try {
    const parsed = JSON.parse(text) as { entries?: unknown }
    const list = Array.isArray(parsed.entries) ? parsed.entries : Array.isArray(parsed) ? parsed : []
    return list.map(sanitizeEntry).filter((entry): entry is RegistryEntry => entry !== null)
  } catch {
    return []
  }
}

async function saveEntries(userId: string, entries: RegistryEntry[]): Promise<void> {
  const { storeId, oidcToken } = await blobCreds()
  const body = new Blob([JSON.stringify({ entries }, null, 2)], { type: 'application/json' })
  await put(registryPath(userId), body, {
    access: 'private',
    storeId,
    oidcToken,
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: 'application/json'
  })
}

function upsert(entries: RegistryEntry[], incoming: RegistryEntry): RegistryEntry[] {
  const index = entries.findIndex((entry) => entry.id === incoming.id)
  if (index < 0) return [incoming, ...entries]
  const previous = entries[index]
  const merged: RegistryEntry = {
    ...previous,
    ...incoming,
    locationNote: incoming.locationNote !== '' ? incoming.locationNote : previous.locationNote
  }
  const next = entries.slice()
  next.splice(index, 1)
  return [merged, ...next]
}

export async function GET(request: Request) {
  try {
    const session = await getSessionFromRequest(request)
    if (!session) return Response.json({ error: 'No autenticado' }, { status: 401 })
    const entries = await loadEntries(session.userId)
    return Response.json({ entries })
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Error al listar proyectos'
    return Response.json({ error: message }, { status: 500 })
  }
}

export async function PUT(request: Request) {
  try {
    const session = await getSessionFromRequest(request)
    if (!session) return Response.json({ error: 'No autenticado' }, { status: 401 })
    const incoming = sanitizeEntry(await request.json())
    if (!incoming) return Response.json({ error: 'Metadatos inválidos' }, { status: 400 })
    const entries = upsert(await loadEntries(session.userId), incoming)
    await saveEntries(session.userId, entries)
    return Response.json({ entries })
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Error al registrar el proyecto'
    return Response.json({ error: message }, { status: 500 })
  }
}

export async function PATCH(request: Request) {
  try {
    const session = await getSessionFromRequest(request)
    if (!session) return Response.json({ error: 'No autenticado' }, { status: 401 })
    const body = await request.json() as { id?: unknown; locationNote?: unknown }
    if (typeof body.id !== 'string' || !body.id.trim()) {
      return Response.json({ error: 'id requerido' }, { status: 400 })
    }
    const note = typeof body.locationNote === 'string' ? body.locationNote.trim() : ''
    const entries = (await loadEntries(session.userId)).map((entry) => (
      entry.id === body.id.trim() ? { ...entry, locationNote: note } : entry
    ))
    await saveEntries(session.userId, entries)
    return Response.json({ entries })
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Error al guardar la ubicación'
    return Response.json({ error: message }, { status: 500 })
  }
}

export async function DELETE(request: Request) {
  try {
    const session = await getSessionFromRequest(request)
    if (!session) return Response.json({ error: 'No autenticado' }, { status: 401 })
    const id = new URL(request.url).searchParams.get('id')?.trim()
    if (!id) return Response.json({ error: 'id requerido' }, { status: 400 })
    const entries = (await loadEntries(session.userId)).filter((entry) => entry.id !== id)
    await saveEntries(session.userId, entries)
    return Response.json({ entries })
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Error al quitar el proyecto de la lista'
    return Response.json({ error: message }, { status: 500 })
  }
}
