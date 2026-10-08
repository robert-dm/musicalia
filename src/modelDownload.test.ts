import { downloadFraction, fetchModelWithProgress } from './modelDownload'

let failed = 0
function assert(cond: boolean, msg: string) {
  if (!cond) {
    failed++
    console.error('FAIL:', msg)
  } else {
    console.log('ok:', msg)
  }
}

assert(downloadFraction(0, 100) === 0, 'zero loaded')
assert(downloadFraction(100, 100) === 1, 'complete')
assert(downloadFraction(200, 100) === 1, 'loaded beyond total caps')

async function run() {
  const payload = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8])
  const originalFetch = globalThis.fetch
  globalThis.fetch = (async () => ({
    ok: true,
    headers: { get: () => String(payload.byteLength) },
    body: {
      getReader() {
        let sent = false
        return {
          async read() {
            if (sent) return { done: true as const, value: undefined }
            sent = true
            return { done: false as const, value: payload }
          },
          async cancel() {},
        }
      },
    },
  })) as unknown as typeof fetch

  const seen: number[] = []
  const bytes = await fetchModelWithProgress('https://example.test/model.onnx', 8, (loaded, total) => {
    seen.push(Math.round((loaded / total) * 100))
  })
  assert(bytes.byteLength === 8 && bytes[0] === 1 && bytes[7] === 8, 'assembled model bytes')
  assert(seen.some((p) => p > 0), 'reported download progress')

  const abort = new AbortController()
  abort.abort()
  let cancelled = false
  try {
    await fetchModelWithProgress('https://example.test/model.onnx', 8, () => {}, abort.signal)
  } catch (error) {
    cancelled = error instanceof Error && error.message.includes('Cancelado')
  }
  assert(cancelled, 'aborted fetch throws Spanish cancel error')

  globalThis.fetch = originalFetch
}

run().then(() => {
  if (failed > 0) {
    console.error(`\n${failed} assertion(s) failed`)
    process.exit(1)
  }
  console.log('\n✅ model download unit tests passed')
}).catch((error) => {
  console.error(error)
  process.exit(1)
})
