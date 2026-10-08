export type StemQuality = 'spleeter' | 'demucs'

export interface StemQualityOption {
  id: StemQuality
  label: string
  blurb: string
}

export const DEFAULT_STEM_QUALITY: StemQuality = 'spleeter'

export const STEM_QUALITY_OPTIONS: StemQualityOption[] = [
  {
    id: 'spleeter',
    label: 'Básica / Rápida',
    blurb:
      'Spleeter 4 pistas (vocals, drums, bass, other). Descarga ~80 MB la primera vez. Más rápida; calidad básica.',
  },
  {
    id: 'demucs',
    label: 'Mejor calidad',
    blurb:
      'HT-Demucs 4 pistas (~166 MB). Tarda más, pero suele separar mejor. Usa WebGPU si está disponible; si no, WASM. Recomendado en ordenador.',
  },
]

export function stemQualityOption(id: StemQuality): StemQualityOption {
  return STEM_QUALITY_OPTIONS.find((option) => option.id === id) ?? STEM_QUALITY_OPTIONS[0]
}

export function isStemQuality(value: string): value is StemQuality {
  return value === 'spleeter' || value === 'demucs'
}
