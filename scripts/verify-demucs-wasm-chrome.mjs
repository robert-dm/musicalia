/**
 * Headless Chromium: WASM session create + one HT-Demucs chunk.
 * WebGPU is disabled. Uses the production preview and /models/* URLs.
 *
 *   npx vite preview --host 127.0.0.1 --port 4173 --outDir dist
 *   node scripts/verify-demucs-wasm-chrome.mjs
 */
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { createConnection } from 'node:net'
import { writeFile } from 'node:fs/promises'
import { execSync } from 'node:child_process'

const require = createRequire('/tmp/toolbar-tools/package.json')
const { WebSocket } = require('ws')
const CHROME = '/usr/bin/google-chrome-stable'
const ORIGIN = process.env.VERIFY_ORIGIN || 'http://127.0.0.1:4173'
const OUT = '/tmp/demucs-wasm-verify.json'

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms))
}

async function waitPort(port, timeoutMs = 20000) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    const ok = await new Promise((resolve) => {
      const sock = createConnection({ host: '127.0.0.1', port }, () => {
        sock.end()
        resolve(true)
      })
      sock.on('error', () => resolve(false))
    })
    if (ok) return
    await sleep(200)
  }
  throw new Error(`port ${port} not ready`)
}

class Cdp {
  constructor(ws) {
    this.ws = ws
    this.id = 0
    this.pending = new Map()
    ws.on('message', (raw) => {
      const msg = JSON.parse(raw.toString())
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id)
        this.pending.delete(msg.id)
        if (msg.error) reject(new Error(JSON.stringify(msg.error)))
        else resolve(msg.result)
      }
    })
  }
  send(method, params = {}) {
    const id = ++this.id
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      this.ws.send(JSON.stringify({ id, method, params }))
    })
  }
}

const TEST_SRC = `
(async () => {
  const mem = () => {
    const m = performance.memory
    return m ? {
      usedMB: Math.round(m.usedJSHeapSize / 1048576),
      totalMB: Math.round(m.totalJSHeapSize / 1048576),
      limitMB: Math.round(m.jsHeapSizeLimit / 1048576),
    } : null
  }
  const mark = (label, extra = {}) => ({
    label,
    t: Math.round(performance.now()),
    gpu: typeof navigator.gpu,
    mem: mem(),
    ...extra,
  })
  const log = []
  log.push(mark('start'))

  Object.defineProperty(navigator, 'gpu', { configurable: true, get: () => undefined })
  log.push(mark('webgpu_disabled'))

  const ort = await import('https://cdn.jsdelivr.net/npm/onnxruntime-web@1.30.0/+esm')
  const runtime = ort.default ?? ort
  runtime.env.wasm.numThreads = 1
  runtime.env.wasm.proxy = false
  runtime.env.wasm.wasmPaths = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.30.0/dist/'
  log.push(mark('ort_imported'))

  const graphUrl = location.origin + '/models/htdemucs_6s_wasm.onnx'
  const dataUrl = location.origin + '/models/htdemucs_6s_wasm.onnx.data'
  const graphBuf = new Uint8Array(await (await fetch(graphUrl)).arrayBuffer())
  const dataBuf = new Uint8Array(await (await fetch(dataUrl)).arrayBuffer())
  log.push(mark('downloaded', { graph: graphBuf.byteLength, data: dataBuf.byteLength }))

  const t0 = performance.now()
  const session = await runtime.InferenceSession.create(graphBuf, {
    executionProviders: ['wasm'],
    graphOptimizationLevel: 'disabled',
    enableCpuMemArena: false,
    enableMemPattern: false,
    executionMode: 'sequential',
    intraOpNumThreads: 1,
    extra: { session: { disable_prepacking: '1' } },
    externalData: [{ path: 'htdemucs_6s_wasm.onnx.data', data: dataBuf }],
  })
  const sessionMs = Math.round(performance.now() - t0)
  log.push(mark('session_created', {
    sessionMs,
    inputs: session.inputNames,
    outputs: session.outputNames,
  }))

  const n = 343980
  const mix = new Float32Array(2 * n)
  for (let i = 0; i < n; i++) {
    const s = Math.sin(2 * Math.PI * 220 * i / 44100) * 0.2
      + Math.sin(2 * Math.PI * 80 * i / 44100) * 0.15
    mix[i] = s
    mix[n + i] = s * 0.92
  }
  const tensor = new runtime.Tensor('float32', mix, [1, 2, n])
  const t1 = performance.now()
  const results = await session.run({ mix: tensor })
  const inferMs = Math.round(performance.now() - t1)
  const stems = results.stems ?? results[session.outputNames[0]]
  const data = stems.data
  const peaks = []
  for (let row = 0; row < 6; row++) {
    let peak = 0
    const off = row * 2 * n
    for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(data[off + i]))
    peaks.push(Number(peak.toExponential(3)))
  }
  log.push(mark('inferred', { inferMs, dims: stems.dims, peaks }))
  try { session.release() } catch {}
  log.push(mark('done', { ok: stems.dims[1] === 6 && peaks.some((p) => p > 1e-4) }))
  return { ok: true, sessionMs, inferMs, dims: stems.dims, peaks, log }
})()
`

async function main() {
  const debugPort = 9335
  const chrome = spawn(CHROME, [
    `--remote-debugging-port=${debugPort}`,
    '--user-data-dir=/tmp/chrome-demucs-wasm',
    '--headless=new',
    '--disable-gpu',
    '--disable-features=Vulkan,WebGPU',
    '--no-first-run',
    '--hide-scrollbars',
    '--disable-dev-shm-usage',
    `--window-size=1200,800`,
    'about:blank',
  ], { stdio: 'ignore' })

  try {
    await waitPort(debugPort)
    await sleep(400)
    const pages = await (await fetch(`http://127.0.0.1:${debugPort}/json`)).json()
    const page = pages.find((p) => p.type === 'page') || pages[0]
    const ws = new WebSocket(page.webSocketDebuggerUrl)
    await new Promise((resolve, reject) => {
      ws.once('open', resolve)
      ws.once('error', reject)
    })
    const cdp = new Cdp(ws)
    await cdp.send('Page.enable')
    await cdp.send('Runtime.enable')
    await cdp.send('Page.addScriptToEvaluateOnNewDocument', {
      source: 'Object.defineProperty(navigator, "gpu", { configurable: true, get: () => undefined });',
    })
    await cdp.send('Page.navigate', { url: ORIGIN + '/' })
    await sleep(2500)

    const rssSamples = []
    const rssTimer = setInterval(() => {
      try {
        const out = execSync(`ps -o rss= --ppid ${chrome.pid} && ps -o rss= -p ${chrome.pid}`, { encoding: 'utf8' })
        const kb = out.split(/\s+/).filter(Boolean).map(Number).reduce((a, b) => a + b, 0)
        rssSamples.push(Math.round(kb / 1024))
      } catch {
        /* chrome exited */
      }
    }, 400)

    const result = await cdp.send('Runtime.evaluate', {
      expression: TEST_SRC,
      awaitPromise: true,
      returnByValue: true,
      timeout: 300000,
    })
    if (result.exceptionDetails) {
      throw new Error(JSON.stringify(result.exceptionDetails, null, 2))
    }
    clearInterval(rssTimer)
    const value = result.result.value
    value.chromeRssMB = {
      samples: rssSamples,
      peakMB: rssSamples.length ? Math.max(...rssSamples) : null,
    }
    await writeFile(OUT, JSON.stringify(value, null, 2))
    console.log(JSON.stringify(value, null, 2))
    if (!value?.ok) throw new Error('verify failed')
    cdp.ws.close()
  } finally {
    chrome.kill('SIGKILL')
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
