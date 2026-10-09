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
      'Spleeter 4 pistas (Vocals, Drums, Bass, Other). Descarga ~80 MB la primera vez. Más rápida; calidad básica.',
  },
  {
    id: 'demucs',
    label: 'Mejor calidad',
    blurb:
      'HT-Demucs 6 pistas (Voz, Batería, Bajo, Guitarra, Piano, Otros). ~136 MB. Tarda más y usa más memoria. Las pistas casi silenciosas se omiten.',
  },
]

export function stemQualityOption(id: StemQuality): StemQualityOption {
  return STEM_QUALITY_OPTIONS.find((option) => option.id === id) ?? STEM_QUALITY_OPTIONS[0]
}

export function isStemQuality(value: string): value is StemQuality {
  return value === 'spleeter' || value === 'demucs'
}
