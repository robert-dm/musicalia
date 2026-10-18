/**
 * Headless Chromium, DPR 2: waveform screenshots at 3 zoom levels.
 *
 *   LABEL=before node scripts/verify-waveform-quality-chrome.mjs
 *   LABEL=after  node scripts/verify-waveform-quality-chrome.mjs
 */
import { createServer } from 'node:http'
import { createReadStream, existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { extname, join, resolve } from 'node:path'

const require = createRequire('/tmp/pw/package.json')
const { chromium } = require('playwright-core')

const ROOT = resolve(process.cwd())
const DIST = join(ROOT, 'dist')
const PORT = Number(process.env.VERIFY_PORT || 4188)
const ORIGIN = `http://127.0.0.1:${PORT}`
const SCREENSHOT_DIR = process.env.SCREENSHOT_DIR || '/opt/cursor/artifacts/screenshots'
const LABEL = (process.env.LABEL || 'after').replace(/[^a-z0-9_-]/gi, '')
const ZOOMS = [1, 8, 48]
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
  const file = url.pathname === '/' ? '/index.html' : url.pathname
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
  executablePath: process.env.CHROME_PATH || process.env.CHROME || '/usr/bin/google-chrome',
  args: ['--no-sandbox', '--disable-setuid-sandbox']
})

const page = await browser.newPage({
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 2
})
page.on('pageerror', (err) => console.error('PAGEERROR', err.message))

try {
  await page.goto(ORIGIN, { waitUntil: 'networkidle', timeout: 60000 })
  await page.waitForFunction(() => window.__musicaliaClips, { timeout: 15000 })
  await page.mouse.click(200, 80)
  const seeded = await page.evaluate(async () => window.__musicaliaClips.seedWaveform())
  await page.waitForSelector(`[data-clip-id="${seeded.id}"]`)
  await page.waitForTimeout(250)

  mkdirSync(SCREENSHOT_DIR, { recursive: true })
  const shots = []
  for (const zoom of ZOOMS) {
    await page.evaluate((z) => window.__musicaliaClips.setZoom(z), zoom)
    await page.waitForFunction((z) => {
      const el = document.querySelector('[data-testid="lanes-scroll-inner"]')
      return Math.abs(Number(el?.getAttribute('data-horizontal-zoom') || '0') - z) < 1e-6
    }, zoom)
    const view = await page.evaluate((id) => {
      const el = document.querySelector(`[data-clip-id="${id}"]`)
      const scroller = document.querySelector('.lanes-scroll-content')
      if (!el || !scroller) throw new Error('clip or scroller missing')
      const frac = 0.28
      scroller.scrollLeft = Math.max(0, el.offsetLeft + el.offsetWidth * frac - 48)
      const host = el.getBoundingClientRect()
      const port = scroller.getBoundingClientRect()
      const left = Math.max(host.left, port.left)
      const right = Math.min(host.right, port.right)
      const top = Math.max(host.top, port.top)
      const bottom = Math.min(host.bottom, port.bottom)
      return {
        x: left,
        y: top,
        width: Math.max(1, right - left),
        height: Math.max(1, bottom - top),
        scrollLeft: scroller.scrollLeft,
        clipWidth: host.width
      }
    }, seeded.id)
    await page.waitForFunction((id) => {
      const host = document.querySelector(`[data-clip-id="${id}"] [data-waveform-host]`)
      const canvas = host?.querySelector('canvas')
      return !!canvas && Number(host?.getAttribute('data-waveform-tiles') || '0') > 0
    }, seeded.id)
    await page.waitForTimeout(160)
    const name = `waveform-${LABEL}-zoom${zoom}-dpr2.png`
    const path = join(SCREENSHOT_DIR, name)
    await page.screenshot({
      path,
      clip: {
        x: Math.max(0, view.x),
        y: Math.max(0, view.y),
        width: Math.min(1440, view.width),
        height: Math.min(200, view.height)
      }
    })
    shots.push({ zoom, path, view })
    console.log('shot', name, JSON.stringify(view))
  }
  writeFileSync(join(SCREENSHOT_DIR, `waveform-${LABEL}-dpr2.json`), JSON.stringify({ seeded, shots }, null, 2))
} finally {
  await browser.close()
  server.close()
}

console.log(`\n✅ waveform ${LABEL} screenshots (DPR 2) written`)
