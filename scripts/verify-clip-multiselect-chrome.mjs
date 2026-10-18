/**
 * Headless Chromium: marquee selects clips on two tracks,
 * then a group drag moves both by the same time delta.
 *
 *   npm run build
 *   node scripts/verify-clip-multiselect-chrome.mjs
 */
import { createServer } from 'node:http'
import { createReadStream, existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { extname, join, resolve } from 'node:path'

const require = createRequire('/tmp/pw/package.json')
const { chromium } = require('playwright-core')

const ROOT = resolve(process.cwd())
const DIST = join(ROOT, 'dist')
const PORT = Number(process.env.VERIFY_PORT || 4184)
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
  args: ['--no-sandbox', '--disable-setuid-sandbox', '--autoplay-policy=no-user-gesture-required']
})

const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
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
  await page.waitForFunction(() => window.__musicaliaClips, { timeout: 15000 })
  await page.mouse.click(200, 80)

  const seeded = await page.evaluate(async () => {
    return window.__musicaliaClips.seedPair()
  })
  await page.waitForSelector('[data-testid="clip-wrapper"]')
  await page.waitForTimeout(200)
  assert(seeded.ids.length === 2, 'seeded two clips')
  assert(seeded.tracks[0] !== seeded.tracks[1], 'clips sit on different tracks')

  const boxes = await page.$$eval('[data-testid="clip-wrapper"]', (els) =>
    els.map((el) => {
      const r = el.getBoundingClientRect()
      return { id: el.getAttribute('data-clip-id'), left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height }
    })
  )
  assert(boxes.length === 2, 'two clip wrappers rendered')
  console.log('boxes', JSON.stringify(boxes))

  const startX = Math.max(8, boxes[0].left - 24)
  const startY = boxes[0].top + boxes[0].height / 2
  const endX = boxes[1].right + 24
  const endY = boxes[1].bottom - 6
  await page.mouse.move(startX, startY)
  await page.mouse.down()
  await page.mouse.move(endX, endY, { steps: 12 })
  await page.mouse.up()
  await page.waitForTimeout(120)

  const selected = await page.evaluate(() => window.__musicaliaClips.getSelection())
  console.log('selection', selected)
  assert(selected.length === 2, `marquee selected both clips, got ${selected.length}`)
  assert(seeded.ids.every((id) => selected.includes(id)), 'marquee hit both track clips')

  const before = await page.evaluate(() => window.__musicaliaClips.getClips())
  const inner = await page.evaluate(() => {
    const el = document.querySelector('[data-testid="lanes-scroll-inner"]')
    const layout = Number(el?.getAttribute('data-layout-max') || '100')
    const width = el?.getBoundingClientRect().width || 1
    return { layout, width, pxPerSec: width / layout }
  })
  const dragPx = 80
  const body = await page.locator('[data-testid="clip-wrapper"]').first().locator('.clip-body').boundingBox()
  if (!body) throw new Error('missing clip body')
  await page.mouse.move(body.x + body.width / 2, body.y + body.height / 2)
  await page.mouse.down()
  await page.mouse.move(body.x + body.width / 2 + dragPx, body.y + body.height / 2, { steps: 10 })
  await page.mouse.up()
  await page.waitForTimeout(160)

  const after = await page.evaluate(() => window.__musicaliaClips.getClips())
  const d0 = after[0].offsetSeconds - before[0].offsetSeconds
  const d1 = after[1].offsetSeconds - before[1].offsetSeconds
  const expected = dragPx / inner.pxPerSec
  console.log('move', JSON.stringify({ d0, d1, expected, pxPerSec: inner.pxPerSec, before, after }))
  assert(Math.abs(d0 - d1) < 1e-6, `both clips moved by the same delta (${d0} vs ${d1})`)
  assert(Math.abs(d0 - expected) < 0.05, `group delta ~ ${expected.toFixed(3)}s, got ${d0.toFixed(3)}s`)
  assert(after[0].trackIndex === before[0].trackIndex && after[1].trackIndex === before[1].trackIndex, 'clips stayed on their tracks')

  mkdirSync(SCREENSHOT_DIR, { recursive: true })
  const shotPath = join(SCREENSHOT_DIR, 'clip-multiselect-group-move.png')
  await page.screenshot({ path: shotPath, fullPage: false })
  writeFileSync(join(SCREENSHOT_DIR, 'clip-multiselect-group-move.json'), JSON.stringify({ seeded, selected, d0, d1, expected }, null, 2))
  console.log('screenshot', shotPath)
} finally {
  await browser.close()
  server.close()
}

if (failed > 0) {
  console.error(`\n${failed} assertion(s) failed`)
  process.exit(1)
}
console.log('\n✅ clip multi-select Chromium check passed')
