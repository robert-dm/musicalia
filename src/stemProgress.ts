export interface StemSeparationProgress {
  progress: number
  stage: string
  elapsedSeconds?: number
  etaSeconds?: number
}

/** Fixed overall weights so no phase can restart at 0%. */
export const DEMUCS_PHASES = {
  init: { start: 0, end: 3 },
  download: { start: 3, end: 18 },
  decode: { start: 18, end: 22 },
  session: { start: 22, end: 26 },
  infer: { start: 26, end: 92 },
  assemble: { start: 92, end: 97 },
  tracks: { start: 97, end: 100 },
} as const

export type DemucsPhase = keyof typeof DEMUCS_PHASES

export function clampProgress(progress: number): number {
  if (!Number.isFinite(progress)) return 0
  return Math.max(0, Math.min(100, progress))
}

export function phaseProgress(phase: DemucsPhase, fraction: number): number {
  const { start, end } = DEMUCS_PHASES[phase]
  const f = Number.isFinite(fraction) ? Math.max(0, Math.min(1, fraction)) : 0
  return start + (end - start) * f
}

export function monotonicProgress(previous: number, next: number): number {
  return Math.max(clampProgress(previous), clampProgress(next))
}

export function etaFromChunkMs(
  remainingChunks: number,
  measuredChunkMs: number,
  extraMs = 0
): number | undefined {
  if (!(measuredChunkMs > 200) || remainingChunks < 0) return undefined
  return (remainingChunks * measuredChunkMs + Math.max(0, extraMs)) / 1000
}

export function formatElapsed(seconds: number): string {
  const total = Math.max(0, Math.round(seconds))
  const minutes = Math.floor(total / 60)
  const rest = total % 60
  if (minutes <= 0) return `${rest} s`
  return `${minutes} min ${rest.toString().padStart(2, '0')} s`
}

export function etaSeconds(elapsedMs: number, progress: number): number | undefined {
  if (!Number.isFinite(elapsedMs) || elapsedMs < 1500) return undefined
  if (progress < 4 || progress >= 99.5) return undefined
  return (elapsedMs * (100 - progress)) / progress / 1000
}

export function interpolateChunkProgress(
  chunkIndex: number,
  totalChunks: number,
  chunkElapsedMs: number,
  estimatedChunkMs: number,
  rangeStart = 0,
  rangeEnd = 100
): number {
  const chunks = Math.max(1, totalChunks)
  const span = (rangeEnd - rangeStart) / chunks
  const estimate = Math.max(estimatedChunkMs, 1)
  const within = Math.min(0.92, Math.max(0, chunkElapsedMs) / estimate)
  return clampProgress(rangeStart + (chunkIndex + within) * span)
}

export function decorateProgress(
  update: { progress: number; stage: string; etaSeconds?: number },
  startTime: number,
  floor = 0
): StemSeparationProgress {
  const progress = monotonicProgress(floor, update.progress)
  const elapsedMs = Date.now() - startTime
  const fromChunks = update.etaSeconds
  const fromOverall = etaSeconds(elapsedMs, progress)
  return {
    progress,
    stage: update.stage,
    elapsedSeconds: elapsedMs / 1000,
    etaSeconds: fromChunks != null && Number.isFinite(fromChunks) ? fromChunks : fromOverall,
  }
}

export const lastProgressLog: number[] = []

export function rememberProgress(progress: number): number {
  const value = clampProgress(progress)
  lastProgressLog.push(value)
  if (typeof window !== 'undefined') {
    ;(window as unknown as { __musicaliaStemProgress?: number[] }).__musicaliaStemProgress = lastProgressLog
  }
  return value
}

export function isMonotonic(values: number[]): boolean {
  for (let i = 1; i < values.length; i++) {
    if (values[i] + 1e-9 < values[i - 1]) return false
  }
  return true
}

export function makeProgressReporter(
  onProgress: ((progress: StemSeparationProgress) => void) | undefined,
  startTime: number
) {
  let last: StemSeparationProgress = { progress: 0, stage: 'Inicializando...' }
  lastProgressLog.length = 0

  const emit = () => {
    onProgress?.(decorateProgress(last, startTime, last.progress))
  }

  const report = (update: StemSeparationProgress) => {
    last = {
      progress: rememberProgress(monotonicProgress(last.progress, update.progress)),
      stage: update.stage,
      etaSeconds: update.etaSeconds,
    }
    emit()
  }

  const interval = setInterval(emit, 400)
  return {
    report,
    stop: () => clearInterval(interval),
  }
}
