export interface StemSeparationProgress {
  progress: number
  stage: string
  elapsedSeconds?: number
  etaSeconds?: number
}

export function clampProgress(progress: number): number {
  if (!Number.isFinite(progress)) return 0
  return Math.max(0, Math.min(100, progress))
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
  update: { progress: number; stage: string },
  startTime: number
): StemSeparationProgress {
  const progress = clampProgress(update.progress)
  const elapsedMs = Date.now() - startTime
  return {
    progress,
    stage: update.stage,
    elapsedSeconds: elapsedMs / 1000,
    etaSeconds: etaSeconds(elapsedMs, progress),
  }
}

export function makeProgressReporter(
  onProgress: ((progress: StemSeparationProgress) => void) | undefined,
  startTime: number
) {
  let last: StemSeparationProgress = { progress: 0, stage: 'Inicializando...' }

  const emit = () => {
    onProgress?.(decorateProgress(last, startTime))
  }

  const report = (update: StemSeparationProgress) => {
    last = { progress: clampProgress(update.progress), stage: update.stage }
    emit()
  }

  const interval = setInterval(emit, 400)
  return {
    report,
    stop: () => clearInterval(interval),
  }
}
