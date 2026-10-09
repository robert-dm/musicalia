export interface StemLane {
  id: string
  name: string
  buffer: AudioBuffer
}

export interface DemucsStemBuffers {
  drums: AudioBuffer
  bass: AudioBuffer
  other: AudioBuffer
  vocals: AudioBuffer
  guitar: AudioBuffer
  piano: AudioBuffer
}

export interface SpleeterStemBuffers {
  vocals: AudioBuffer
  drums: AudioBuffer
  bass: AudioBuffer
  other: AudioBuffer
}

/** Display order for HT-Demucs 6-stem (Spanish names). */
export const DEMUCS_LANE_ORDER: Array<{ id: keyof DemucsStemBuffers; name: string }> = [
  { id: 'vocals', name: 'Voz' },
  { id: 'drums', name: 'Batería' },
  { id: 'bass', name: 'Bajo' },
  { id: 'guitar', name: 'Guitarra' },
  { id: 'piano', name: 'Piano' },
  { id: 'other', name: 'Otros' },
]

/** Existing Básica 4-stem names — keep unchanged. */
export const SPLEETER_LANE_ORDER: Array<{ id: keyof SpleeterStemBuffers; name: string }> = [
  { id: 'vocals', name: 'Vocals' },
  { id: 'drums', name: 'Drums' },
  { id: 'bass', name: 'Bass' },
  { id: 'other', name: 'Other' },
]

export const NEAR_SILENT_PEAK = 0.004
export const NEAR_SILENT_RMS = 0.0004

export function stemPeakRms(buffer: AudioBuffer): { peak: number; rms: number } {
  let peak = 0
  let sumSq = 0
  let count = 0
  for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
    const data = buffer.getChannelData(ch)
    for (let i = 0; i < data.length; i++) {
      const v = data[i]
      peak = Math.max(peak, Math.abs(v))
      sumSq += v * v
      count++
    }
  }
  return { peak, rms: count > 0 ? Math.sqrt(sumSq / count) : 0 }
}

export function isNearSilent(buffer: AudioBuffer): boolean {
  const { peak, rms } = stemPeakRms(buffer)
  return peak < NEAR_SILENT_PEAK && rms < NEAR_SILENT_RMS
}

export function spleeterLanes(stems: SpleeterStemBuffers): StemLane[] {
  return SPLEETER_LANE_ORDER.map((lane) => ({
    id: lane.id,
    name: lane.name,
    buffer: stems[lane.id],
  }))
}

export function demucsLanes(stems: DemucsStemBuffers): StemLane[] {
  return DEMUCS_LANE_ORDER.map((lane) => ({
    id: lane.id,
    name: lane.name,
    buffer: stems[lane.id],
  }))
}

export function selectAudibleStems(lanes: StemLane[]): { kept: StemLane[]; skipped: StemLane[] } {
  const kept: StemLane[] = []
  const skipped: StemLane[] = []
  for (const lane of lanes) {
    if (isNearSilent(lane.buffer)) skipped.push(lane)
    else kept.push(lane)
  }
  return { kept, skipped }
}

export function skippedStemNote(skipped: StemLane[]): string | null {
  if (skipped.length === 0) return null
  const names = skipped.map((lane) => lane.name).join(', ')
  return skipped.length === 1
    ? `Pista casi silenciosa omitida: ${names}`
    : `Pistas casi silenciosas omitidas: ${names}`
}
