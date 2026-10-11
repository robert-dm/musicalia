/**
 * Headless Chromium: loopback click lands within ~5 ms of transport time.
 *
 *   npm run build
 *   node scripts/verify-record-latency-chrome.mjs
 */
import { createServer } from 'node:http'
import { createReadStream, existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { extname, join, resolve } from 'node:path'

const require = createRequire('/tmp/pw/package.json')
const { chromium } = require('playwright-core')

const ROOT = resolve(process.cwd())
const DIST = join(ROOT, 'dist')
const PORT = Number(process.env.VERIFY_PORT || 4181)
const ORIGIN = `http://127.0.0.1:${PORT}`
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.wasm': 'application/wasm'
}

if (!existsSync(join(DIST, 'index.html'))) {
  throw new Error('dist/ missing — run npm run build first')
}

const server = createServer((req, res) => {
  const url = new URL(req.url || '/', ORIGIN)
  let file = url.pathname === '/' ? '/index.html' : url.pathname
  const path = join(DIST, file)
  const stream = createReadStream(path)
  stream.on('error', () => {
    res.statusCode = 404
    res.end('not found')
  })
  stream.on('open', () => {
    res.setHeader('Content-Type', MIME[extname(path)] || 'application/octet-stream')
    stream.pipe(res)
  })
})

await new Promise((resolve) => server.listen(PORT, resolve))

const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome',
  args: [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--autoplay-policy=no-user-gesture-required',
    '--use-fake-ui-for-media-stream',
    '--use-fake-device-for-media-stream',
    '--allow-file-access-from-files'
  ]
})

const page = await browser.newPage()
page.on('pageerror', (err) => console.error('PAGEERROR', err.message))

let failed = 0
function assert(cond, msg) {
  if (!cond) {
    failed++
    console.error('FAIL:', msg)
  } else {
    console.log('ok:', msg)
  }
}

try {
  await page.goto(ORIGIN, { waitUntil: 'networkidle', timeout: 60000 })
  await page.waitForFunction(() => window.__musicaliaRecord, { timeout: 15000 })

  const panel = await page.evaluate(async () => {
    document.querySelector('[data-testid="record-latency-button"]')?.click()
    await new Promise((r) => setTimeout(r, 50))
    return !!document.querySelector('[data-testid="record-latency-panel"]')
  })
  assert(panel, 'latency panel opens from the record-menu clock')

  const result = await page.evaluate(async () => {
    const api = window.__musicaliaRecord
    if (!api) throw new Error('record API missing')
    return api.loopbackClick(0.2)
  })
  console.log('loopback', JSON.stringify(result))
  assert(typeof result.got === 'number' && typeof result.expected === 'number', 'loopback returned times')
  assert(Math.abs(result.errorMs) <= 5, `click within 5 ms of transport (error ${result.errorMs?.toFixed?.(2)} ms)`)
  assert(result.firstContextTime != null, 'first captured frame has an AudioContext timestamp')
} finally {
  await browser.close()
  server.close()
}

if (failed > 0) {
  console.error(`\n${failed} assertion(s) failed`)
  process.exit(1)
}
console.log('\n✅ record latency Chromium check passed')
