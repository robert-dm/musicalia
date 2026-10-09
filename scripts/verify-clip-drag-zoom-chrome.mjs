/**
 * Headless Chromium: clip drag of N px → N/pxPerSec seconds at several zooms.
 *
 *   npm run build
 *   node scripts/verify-clip-drag-zoom-chrome.mjs
 */
import { createServer } from 'node:http'
import { createReadStream, existsSync } from 'node:fs'
import { mkdir, writeFile, stat } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { extname, join, resolve } from 'node:path'

const require = createRequire('/tmp/pw/package.json')
const { chromium } = require('playwright-core')

const ROOT = resolve(process.cwd())
const DIST = join(ROOT, 'dist')
const PORT = Number(process.env.VERIFY_PORT || 4178)
const ORIGIN = `http://127.0.0.1:${PORT}`
const SCREENSHOT_DIR = process.env.SCREENSHOT_DIR || '/opt/cursor/artifacts/screenshots'
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.wasm': 'application/wasm',
  '.png': 'image/png'
}

function pcmWav(seconds = 0.4, sampleRate = 44100) {
  const n = Math.floor(sampleRate * seconds)
  const data = Buffer.alloc(n * 2)
  for (let i = 0; i < n; i++) {
    data.writeInt16LE(Math.round(Math.sin((2 * Math.PI * 220 * i) / sampleRate) * 12000), i * 2)
  }
  const header = Buffer.alloc(44)
  header.write('RIFF', 0)
  header.writeUInt32LE(36 + data.length, 4)
  header.write('WAVE', 8)
  header.write('fmt ', 12)
  header.writeUInt32LE(16, 16)
  header.writeUInt16LE(1, 20)
  header.writeUInt16LE(1, 22)
  header.writeUInt32LE(sampleRate, 24)
  header.writeUInt32LE(sampleRate * 2, 28)
  header.writeUInt16LE(2, 32)
  header.writeUInt16LE(16, 34)
  header.write('data', 36)
  header.writeUInt32LE(data.length, 40)
  return Buffer.concat([header, data])
}

async function serveDist() {
  const server = createServer(async (req, res) => {
    const url = new URL(req.url || '/', ORIGIN)
    let filePath = join(DIST, decodeURIComponent(url.pathname))
    if (url.pathname === '/' || !extname(url.pathname)) filePath = join(DIST, 'index.html')
    try {
      const info = await stat(filePath)
      if (!info.isFile()) throw new Error('not a file')
      res.writeHead(200, { 'content-type': MIME[extname(filePath)] || 'application/octet-stream' })
      createReadStream(filePath).pipe(res)
    } catch {
      res.writeHead(404)
      res.end('not found')
    }
  })
  await new Promise((resolve) => server.listen(PORT, '127.0.0.1', resolve))
  return server
}

async function measureAndDrag(page, nPx) {
  const before = await page.evaluate((n) => {
    const inner = document.querySelector('[data-testid="lanes-scroll-inner"]')
    const clip = document.querySelector('[data-testid="clip-wrapper"]')
    const body = clip?.querySelector('.clip-body')
    if (!inner || !clip || !body) throw new Error('missing clip/inner')
    const layout = Number(inner.getAttribute('data-layout-max') || '100')
    const zoom = Number(inner.getAttribute('data-horizontal-zoom') || '1')
    const innerBox = inner.getBoundingClientRect()
    const box = body.getBoundingClientRect()
    return {
      zoom,
      layout,
      innerWidth: innerBox.width,
      pxPerSec: innerBox.width / layout,
      before: Number(clip.getAttribute('data-clip-offset')),
      startX: box.left + Math.min(24, Math.max(8, box.width / 3)),
      startY: box.top + box.height / 2,
      n
    }
  }, nPx)
  await page.mouse.move(before.startX, before.startY)
  await page.mouse.down()
  await page.mouse.move(before.startX + nPx, before.startY, { steps: 8 })
  await page.mouse.up()
  await page.waitForTimeout(120)
  const after = Number(await page.getAttribute('[data-testid="clip-wrapper"]', 'data-clip-offset'))
  return {
    ...before,
    after,
    delta: after - before.before,
    expected: nPx / before.pxPerSec
  }
}

async function main() {
  if (!existsSync(join(DIST, 'index.html'))) throw new Error('dist/ missing')
  const server = await serveDist()
  const browser = await chromium.launch({
    executablePath: process.env.CHROME || '/usr/bin/google-chrome-stable',
    headless: true,
    args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage']
  })
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  page.on('pageerror', (err) => console.error('[pageerror]', err.message))
  await page.goto(ORIGIN, { waitUntil: 'networkidle' })

  const wavPath = join('/tmp', 'clip-drag-tone.wav')
  await writeFile(wavPath, pcmWav())
  await page.locator('input[accept*="audio"]').first().setInputFiles(wavPath)
  await page.getByRole('button', { name: 'No, una sola pista' }).click()
  await page.waitForTimeout(1200)
  await page.getByTestId('clip-wrapper').waitFor({ timeout: 15000 })

  const version = await page.locator('.version-label').innerText()
  const results = []
  const slider = page.locator('.zoom-slider').first()

  const setZoomSlider = async (value) => {
    await slider.evaluate((el, v) => {
      const input = el
      const proto = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')
      proto?.set?.call(input, String(v))
      input.dispatchEvent(new Event('input', { bubbles: true }))
      input.dispatchEvent(new Event('change', { bubbles: true }))
    }, value)
    await page.waitForTimeout(200)
  }

  // zoom 1 (slider mid-ish): default
  results.push(await measureAndDrag(page, 80))

  // zoom ~4 (legacy max). log slider: 0.05→512
  await setZoomSlider(474)
  results.push(await measureAndDrag(page, 80))

  // near new max
  await setZoomSlider(1000)
  const maxZoom = await page.getAttribute('[data-testid="lanes-scroll-inner"]', 'data-horizontal-zoom')
  results.push(await measureAndDrag(page, 40))

  await mkdir(SCREENSHOT_DIR, { recursive: true })
  const shot = join(SCREENSHOT_DIR, 'clip-drag-zoom-max.png')
  await page.screenshot({ path: shot, fullPage: true })

  await browser.close()
  server.close()

  const mismatches = results.filter((r) => Math.abs(r.delta - r.expected) > 0.02)
  const out = {
    ok: mismatches.length === 0,
    version,
    oldZoomRange: { min: 0.5, max: 4 },
    newZoomRange: { min: 0.05, max: 512 },
    measuredMaxZoom: Number(maxZoom),
    screenshot: shot,
    results,
    mismatches
  }
  console.log(JSON.stringify(out, null, 2))
  if (mismatches.length > 0) process.exit(1)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
