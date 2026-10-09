export const MODEL_CACHE_NAME = 'musicalia-onnx-v2'

export function downloadFraction(loaded: number, total: number): number {
  if (!Number.isFinite(loaded) || loaded < 0) return 0
  if (!Number.isFinite(total) || total <= 0) return loaded > 0 ? 0.5 : 0
  return Math.min(1, loaded / total)
}

function concatChunks(chunks: Uint8Array[], totalLength: number): Uint8Array {
  const out = new Uint8Array(totalLength)
  let offset = 0
  for (const chunk of chunks) {
    out.set(chunk, offset)
    offset += chunk.byteLength
  }
  return out
}

async function readCache(url: string): Promise<Uint8Array | null> {
  if (typeof caches === 'undefined') return null
  try {
    const cache = await caches.open(MODEL_CACHE_NAME)
    const hit = await cache.match(url)
    if (!hit) return null
    return new Uint8Array(await hit.arrayBuffer())
  } catch {
    return null
  }
}

async function writeCache(url: string, bytes: Uint8Array): Promise<void> {
  if (typeof caches === 'undefined') return
  try {
    const cache = await caches.open(MODEL_CACHE_NAME)
    await cache.put(url, new Response(new Blob([bytes as BlobPart]), {
      headers: { 'Content-Type': 'application/octet-stream' },
    }))
  } catch {
    // Private mode / quota: keep going with the in-memory copy.
  }
}

export async function fetchModelWithProgress(
  url: string,
  expectedBytes: number,
  onProgress: (loaded: number, total: number, cached: boolean) => void,
  signal?: AbortSignal
): Promise<Uint8Array> {
  if (signal?.aborted) throw new Error('Cancelado por el usuario')

  const cached = await readCache(url)
  if (cached && cached.byteLength > 0) {
    onProgress(cached.byteLength, cached.byteLength, true)
    return cached
  }

  const response = await fetch(url, { signal, mode: 'cors' })
  if (!response.ok) {
    throw new Error(`Error al descargar modelo (${response.status}). Verifica tu conexión a internet.`)
  }

  const headerLen = Number(response.headers.get('content-length') || 0)
  const totalHint = headerLen > 0 ? headerLen : expectedBytes
  const reader = response.body?.getReader()

  if (!reader) {
    const buf = new Uint8Array(await response.arrayBuffer())
    onProgress(buf.byteLength, buf.byteLength, false)
    await writeCache(url, buf)
    return buf
  }

  const chunks: Uint8Array[] = []
  let loaded = 0
  while (true) {
    if (signal?.aborted) {
      try { await reader.cancel() } catch { /* ignore */ }
      throw new Error('Cancelado por el usuario')
    }
    const { done, value } = await reader.read()
    if (done) break
    if (!value) continue
    chunks.push(value)
    loaded += value.byteLength
    onProgress(loaded, Math.max(totalHint, loaded), false)
  }

  const buf = concatChunks(chunks, loaded)
  await writeCache(url, buf)
  onProgress(buf.byteLength, buf.byteLength, false)
  return buf
}
