export type DemucsErrorKind = 'cancel' | 'mobile' | 'oom' | 'download' | 'runtime' | 'other'

export function errorText(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}

export function classifyDemucsError(error: unknown): DemucsErrorKind {
  const msg = errorText(error)
  const lower = msg.toLowerCase()
  if (msg.startsWith('Cancelado')) return 'cancel'
  if (lower.includes('móvil') || lower.includes('movil')) return 'mobile'
  if (
    lower.includes('bad_alloc') ||
    /\boom\b/.test(lower) ||
    lower.includes('out of memory') ||
    lower.includes('cannot enlarge memory') ||
    lower.includes('wasm memory') ||
    (lower.includes('allocate') && lower.includes('memory')) ||
    (lower.includes('insufficient') && lower.includes('memory'))
  ) {
    return 'oom'
  }
  if (
    lower.includes('failed to fetch') ||
    lower.includes('network') ||
    lower.includes('descargar') ||
    lower.includes('load failed') ||
    lower.includes('err_http')
  ) {
    return 'download'
  }
  if (lower.includes('webgpu') || lower.includes('wasm') || lower.includes('onnx')) return 'runtime'
  return 'other'
}

export function formatDemucsError(error: unknown): { kind: DemucsErrorKind; message: string; detail: string } {
  const kind = classifyDemucsError(error)
  const detail = errorText(error)
  const headlines: Record<DemucsErrorKind, string> = {
    cancel: detail,
    mobile: detail,
    oom: 'Memoria insuficiente para HT-Demucs. Puedes reintentar con Básica / Rápida o cargar el audio como pista única.',
    download: 'Error al descargar el modelo HT-Demucs. Verifica tu conexión. Puedes usar Básica / Rápida o una sola pista.',
    runtime: 'No se pudo iniciar HT-Demucs (WebGPU/WASM). Prueba Chrome o Edge, o usa Básica / Rápida.',
    other: `Error en HT-Demucs. Puedes usar Básica / Rápida o una sola pista.`,
  }
  const headline = headlines[kind]
  const alreadyHasDetail = headline.includes(detail) || kind === 'cancel' || kind === 'mobile'
  return {
    kind,
    detail,
    message: alreadyHasDetail ? headline : `${headline} (${detail})`,
  }
}

export function mapDemucsError(error: unknown): Error {
  console.error('[HT-Demucs]', error)
  const mapped = formatDemucsError(error)
  return new Error(mapped.message)
}
