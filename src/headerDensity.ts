export type HeaderDensity = 'tall' | 'medium' | 'compact'
export type ClipLabelMode = 'full' | 'compact' | 'hidden'

/** Two control rows still fit (default 88px lane). */
export const HEADER_TALL_MIN_PX = 70
/** One compact row with volume + overflow still fits. */
export const HEADER_MEDIUM_MIN_PX = 48

export function headerDensity(height: number): HeaderDensity {
  if (height >= HEADER_TALL_MIN_PX) return 'tall'
  if (height >= HEADER_MEDIUM_MIN_PX) return 'medium'
  return 'compact'
}

export function clipLabelMode(height: number): ClipLabelMode {
  if (height >= HEADER_TALL_MIN_PX) return 'full'
  if (height >= HEADER_MEDIUM_MIN_PX) return 'compact'
  return 'hidden'
}
