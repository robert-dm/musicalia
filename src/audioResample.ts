/** Linear interpolation resampler. Returns a copy even when rates match. */
export function resampleChannel(input: Float32Array, fromRate: number, toRate: number): Float32Array {
  if (fromRate <= 0 || toRate <= 0) {
    throw new Error('Sample rate inválida')
  }
  if (fromRate === toRate) return new Float32Array(input)
  const outLength = Math.max(1, Math.round(input.length * toRate / fromRate))
  return resampleToLength(input, outLength)
}

export function resampleToLength(input: Float32Array, outLength: number): Float32Array {
  const length = Math.max(0, Math.floor(outLength))
  const out = new Float32Array(length)
  if (length === 0) return out
  if (input.length === 0) return out
  if (length === 1) {
    out[0] = input[0]
    return out
  }
  if (input.length === 1) {
    out.fill(input[0])
    return out
  }
  const ratio = (input.length - 1) / (length - 1)
  for (let i = 0; i < length; i++) {
    const srcIndex = i * ratio
    const i0 = Math.floor(srcIndex)
    const i1 = Math.min(i0 + 1, input.length - 1)
    const frac = srcIndex - i0
    out[i] = input[i0] * (1 - frac) + input[i1] * frac
  }
  return out
}
