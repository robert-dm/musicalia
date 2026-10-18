/**
 * Headless Chromium: left-edge trim keeps waveform pixels at a fixed timeline x.
 *
 *   npm run build
 *   node scripts/verify-trim-anchor-chrome.mjs
 */
import { createServer } from 'node:http'
import { createReadStream, existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { extname, join, resolve } from 'node:path'

const require = createRequire('/tmp/pw/package.json')
const { chromium } = require('playwright-core')

const ROOT = resolve(process.cwd())
const DIST = join(ROOT, 'dist')
const PORT = Number(process.env.VERIFY_PORT || 4196)
const ORIGIN = `http://127.0.0.1:${PORT}`
const SCREENSHOT_DIR = process.env.SCREENSHOT_DIR || '/opt/cursor/artifacts/screenshots'
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

let failed = 0
function assert(cond, msg) {
  if (!cond) {
    failed++
    console.error('FAIL:', msg)
  } else {
    console.log('ok:', msg)
  }
}

async function sampleColumn(clientX) {
  return page.evaluate((x) => {
    const tiles = [...document.querySelectorAll('[data-waveform-tile], canvas.waveform-full')]
    for (const canvas of tiles) {
      const box = canvas.getBoundingClientRect()
      if (x < box.left - 0.5 || x >= box.right + 0.5) continue
      const ctx = canvas.getContext('2d')
      if (!ctx) continue
      const col = Math.max(0, Math.min(canvas.width - 1, Math.round((x - box.left) * (canvas.width / box.width))))
      const data = ctx.getImageData(col, 0, 1, canvas.height).data
      const profile = []
      let energy = 0
      for (let y = 0; y < canvas.height; y++) {
        const i = y * 4
        const lum = (data[i] * 0.3 + data[i + 1] * 0.59 + data[i + 2] * 0.11) * (data[i + 3] / 255)
        profile.push(Math.round(lum))
        energy += lum
      }
      return { energy, profile, col, height: canvas.height }
    }
    return null
  }, clientX)
}

function profileDelta(a, b) {
  if (!a || !b || a.profile.length !== b.profile.length) return Infinity
  let err = 0
  for (let i = 0; i < a.profile.length; i++) err += Math.abs(a.profile[i] - b.profile[i])
  return err / a.profile.length
}

try {
  await page.goto(ORIGIN, { waitUntil: 'networkidle', timeout: 60000 })
  await page.waitForFunction(() => window.__musicaliaClips, { timeout: 15000 })
  await page.mouse.click(200, 80)
  const seeded = await page.evaluate(async () => window.__musicaliaClips.seedTrimWave())
  await page.evaluate(() => window.__musicaliaClips.setZoom(1))
  await page.waitForSelector(`[data-clip-id="${seeded.id}"]`)
  await page.waitForTimeout(280)

  const geometry = await page.evaluate((markTime) => {
    const inner = document.querySelector('[data-testid="lanes-scroll-inner"]')
    const clip = document.querySelector('[data-testid="clip-wrapper"]')
    const handle = clip?.querySelector('.clip-trim-handle.left')
    if (!inner || !clip || !handle) throw new Error('missing trim geometry')
    const layout = Number(inner.getAttribute('data-layout-max') || '100')
    const box = inner.getBoundingClientRect()
    const handleBox = handle.getBoundingClientRect()
    return {
      layout,
      markX: box.left + (markTime / layout) * box.width,
      handleX: handleBox.left + handleBox.width / 2,
      handleY: handleBox.top + handleBox.height / 2,
      pxPerSec: box.width / layout,
      clipLeft: clip.getBoundingClientRect().left
    }
  }, seeded.markTime)

  const before = await sampleColumn(geometry.markX)
  assert(!!before && before.energy > 20, `marker column has energy before trim (got ${before?.energy})`)

  mkdirSync(SCREENSHOT_DIR, { recursive: true })
  const clipShot = page.locator('[data-testid="clip-wrapper"]')
  writeFileSync(join(SCREENSHOT_DIR, 'trim-anchor-before.png'), await clipShot.screenshot())

  const dragPx = Math.max(28, geometry.pxPerSec * 0.35)
  const handle = page.locator(`[data-clip-id="${seeded.id}"] .clip-trim-handle.left`)
  const handleBox = await handle.boundingBox()
  if (!handleBox) throw new Error('left trim handle not on screen')
  await handle.hover()
  await page.mouse.down()
  await page.mouse.move(handleBox.x + handleBox.width / 2 + dragPx, handleBox.y + handleBox.height / 2, { steps: 10 })
  await page.waitForTimeout(80)
  const mid = await sampleColumn(geometry.markX)
  writeFileSync(join(SCREENSHOT_DIR, 'trim-anchor-mid.png'), await clipShot.screenshot())
  await page.mouse.up()
  await page.waitForTimeout(250)
  const after = await sampleColumn(geometry.markX)
  writeFileSync(join(SCREENSHOT_DIR, 'trim-anchor-after.png'), await clipShot.screenshot())

  const midErr = profileDelta(before, mid)
  const afterErr = profileDelta(before, after)
  console.log({ energy: { before: before?.energy, mid: mid?.energy, after: after?.energy }, midErr, afterErr, dragPx })
  assert(!!mid, 'sampled the same timeline x mid-drag')
  assert(midErr < 18, `mid-drag column stays put (mean abs ${midErr.toFixed(2)})`)
  assert(!!after, 'sampled the same timeline x after commit')
  assert(afterErr < 18, `committed column stays put (mean abs ${afterErr.toFixed(2)})`)

  const offset = Number(await page.getAttribute('[data-testid="clip-wrapper"]', 'data-clip-offset'))
  assert(offset > 0.4 + 0.15, `left trim moved the clip start (offset ${offset})`)
} finally {
  await browser.close()
  server.close()
}

if (failed > 0) {
  console.error(`\n${failed} assertion(s) failed`)
  process.exit(1)
}
console.log('\n✅ left-trim waveform anchor Chromium check passed')
