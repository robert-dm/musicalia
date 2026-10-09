/** HT-Demucs 6-stem ONNX graph is fixed at 7.8 s of 44.1 kHz stereo. */
export const DEMUCS_SAMPLE_RATE = 44100
export const DEMUCS_SEGMENT_S = 7.8
export const DEMUCS_N_SAMPLES = Math.round(DEMUCS_SEGMENT_S * DEMUCS_SAMPLE_RATE)
export const DEMUCS_OVERLAP = Math.floor(DEMUCS_N_SAMPLES / 4)
export const DEMUCS_STRIDE = DEMUCS_N_SAMPLES - DEMUCS_OVERLAP

/** Output rows in StemSplitio htdemucs_6s ONNX: (1, 6, 2, 343980). */
export const DEMUCS_STEM_ROWS = ['drums', 'bass', 'other', 'vocals', 'guitar', 'piano'] as const
export type DemucsStemId = (typeof DEMUCS_STEM_ROWS)[number]

/** Linear fade matching StemSplitio infer.py `np.linspace(0, 1, overlap)`. */
export function makeTransitionWindow(seg: number, overlap: number): Float32Array {
  const w = new Float32Array(seg)
  w.fill(1)
  if (overlap <= 1 || seg <= 0) return w
  const fadeDenom = overlap - 1
  for (let i = 0; i < overlap; i++) {
    const fade = fadeDenom === 0 ? 1 : i / fadeDenom
    w[i] = fade
    w[seg - overlap + i] = 1 - fade
  }
  return w
}

export function demucsChunkCount(totalSamples: number, stride = DEMUCS_STRIDE): number {
  if (totalSamples <= 0) return 1
  return Math.max(1, Math.ceil(totalSamples / stride))
}

export function packStereoChunk(
  left: Float32Array,
  right: Float32Array,
  start: number,
  end: number,
  nSamples = DEMUCS_N_SAMPLES
): Float32Array {
  const chunk = new Float32Array(2 * nSamples)
  const clen = Math.max(0, end - start)
  const copy = Math.min(clen, nSamples)
  if (copy > 0) {
    chunk.set(left.subarray(start, start + copy), 0)
    chunk.set(right.subarray(start, start + copy), nSamples)
  }
  return chunk
}

/**
 * Accumulate one stem/channel from a flattened `(1, 6, 2, N)` output tensor
 * into overlap-add buffers.
 */
export function accumulateStemChannel(
  stemsData: Float32Array,
  nSamples: number,
  stemRow: number,
  channel: number,
  start: number,
  clen: number,
  window: Float32Array,
  out: Float32Array,
  weight?: Float32Array
): void {
  const rowOffset = (stemRow * 2 + channel) * nSamples
  const copy = Math.min(clen, nSamples, out.length - start)
  for (let s = 0; s < copy; s++) {
    const w = window[s]
    out[start + s] += stemsData[rowOffset + s] * w
    if (weight) weight[start + s] += w
  }
}

export function normalizeOverlapAdd(channels: Float32Array[], weight: Float32Array): void {
  for (let i = 0; i < weight.length; i++) {
    const w = weight[i] > 1e-8 ? weight[i] : 1e-8
    for (const ch of channels) {
      const v = ch[i] / w
      ch[i] = Number.isFinite(v) ? v : 0
    }
  }
}
