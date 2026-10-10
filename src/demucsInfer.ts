import type * as OrtNS from 'onnxruntime-web'
import {
  accumulateStemChannel,
  DEMUCS_N_SAMPLES,
  DEMUCS_OVERLAP,
  DEMUCS_SAMPLE_RATE,
  DEMUCS_STEM_ROWS,
  DEMUCS_STRIDE,
  demucsChunkCount,
  edgeAwareWindow,
  makeTransitionWindow,
  normalizeOverlapAdd,
  packStereoChunk,
} from './demucsChunking'
import { etaFromChunkMs, interpolateChunkProgress, phaseProgress, type StemSeparationProgress } from './stemProgress'

export type DemucsChannelPair = readonly [Float32Array, Float32Array]

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new Error('Cancelado por el usuario')
}

function disposeTensor(tensor: { dispose?: () => void } | undefined): void {
  try {
    tensor?.dispose?.()
  } catch {
    /* ignore */
  }
}

export async function inferDemucsChunks(
  ort: typeof OrtNS,
  session: OrtNS.InferenceSession,
  left: Float32Array,
  right: Float32Array,
  onProgress?: (progress: StemSeparationProgress) => void,
  signal?: AbortSignal
): Promise<DemucsChannelPair[]> {
  const total = left.length
  const nChunks = demucsChunkCount(total)
  const baseWindow = makeTransitionWindow(DEMUCS_N_SAMPLES, DEMUCS_OVERLAP)
  const outs: DemucsChannelPair[] = DEMUCS_STEM_ROWS.map(
    () => [new Float32Array(total), new Float32Array(total)] as const
  )
  const weight = new Float32Array(total)
  let estimatedChunkMs = 12_000

  for (let i = 0; i < nChunks; i++) {
    throwIfAborted(signal)
    const start = i * DEMUCS_STRIDE
    const end = Math.min(start + DEMUCS_N_SAMPLES, total)
    const clen = end - start
    const chunkStart = Date.now()
    const window = edgeAwareWindow(baseWindow, i, nChunks)
    const inferStart = phaseProgress('infer', 0)
    const inferEnd = phaseProgress('infer', 1)

    const pulse = setInterval(() => {
      onProgress?.({
        progress: interpolateChunkProgress(i, nChunks, Date.now() - chunkStart, estimatedChunkMs, inferStart, inferEnd),
        stage: `Procesando bloque ${i + 1}/${nChunks}…`,
        etaSeconds: etaFromChunkMs(nChunks - i, estimatedChunkMs),
      })
    }, 400)

    let mix: OrtNS.Tensor | undefined
    let stemsTensor: OrtNS.Tensor | undefined
    try {
      const chunkBuf = packStereoChunk(left, right, start, end)
      mix = new ort.Tensor('float32', chunkBuf, [1, 2, DEMUCS_N_SAMPLES])
      const results = await session.run({ mix })
      stemsTensor = results.stems ?? results[session.outputNames[0]]
      if (!stemsTensor) throw new Error('El modelo HT-Demucs no devolvió stems')
      const dims = stemsTensor.dims
      if (dims.length < 4 || dims[1] !== 6 || dims[2] !== 2 || dims[3] !== DEMUCS_N_SAMPLES) {
        throw new Error(`Forma de salida inesperada: [${dims.join(', ')}]`)
      }
      const stemsData = stemsTensor.data as Float32Array
      for (let row = 0; row < DEMUCS_STEM_ROWS.length; row++) {
        accumulateStemChannel(
          stemsData, DEMUCS_N_SAMPLES, row, 0, start, clen, window, outs[row][0],
          row === 0 ? weight : undefined
        )
        accumulateStemChannel(stemsData, DEMUCS_N_SAMPLES, row, 1, start, clen, window, outs[row][1])
      }
    } finally {
      clearInterval(pulse)
      disposeTensor(mix)
      disposeTensor(stemsTensor)
    }

    estimatedChunkMs = Date.now() - chunkStart
    onProgress?.({
      progress: interpolateChunkProgress(i + 1, nChunks, estimatedChunkMs, estimatedChunkMs, inferStart, inferEnd),
      stage: `Procesando bloque ${i + 1}/${nChunks}…`,
      etaSeconds: etaFromChunkMs(nChunks - i - 1, estimatedChunkMs),
    })
    await new Promise((r) => setTimeout(r, 0))
  }

  onProgress?.({ progress: phaseProgress('assemble', 0.4), stage: 'Reconstruyendo pistas…' })
  normalizeOverlapAdd(outs.flatMap(([l, r]) => [l, r]), weight)
  return outs
}

export function channelsAtDemucsRate(
  left: Float32Array,
  right: Float32Array,
  sampleRate: number,
  resample: (input: Float32Array, from: number, to: number) => Float32Array
): { left: Float32Array; right: Float32Array } {
  if (sampleRate === DEMUCS_SAMPLE_RATE) return { left, right }
  return {
    left: resample(left, sampleRate, DEMUCS_SAMPLE_RATE),
    right: resample(right, sampleRate, DEMUCS_SAMPLE_RATE),
  }
}
