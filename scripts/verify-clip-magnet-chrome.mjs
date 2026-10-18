/**
 * Headless Chromium: Imán snaps a clip end to another clip start
 * and Alinear inicios matches the earliest start.
 *
 *   npm run build
 *   node scripts/verify-clip-magnet-chrome.mjs
 */
import { createServer } from 'node:http'
import { createReadStream, existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { extname, join, resolve } from 'node:path'

const require = createRequire('/tmp/pw/package.json')
const { chromium } = require('playwright-core')

const ROOT = resolve(process.cwd())
const DIST = join(ROOT, 'dist')
const PORT = Number(process.env.VERIFY_PORT || 4185)
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

  const magnetBtn = page.locator('[data-testid="magnet-toggle"]')
  await magnetBtn.waitFor()
  const pressed = await magnetBtn.getAttribute('aria-pressed')
  assert(pressed === 'false', 'Imán starts OFF')
  const defaultMagnet = await page.evaluate(() => window.__musicaliaClips.getMagnet())
  assert(defaultMagnet === false, 'session magnet defaults off')

  await magnetBtn.click()
  await page.waitForFunction(() => window.__musicaliaClips.getMagnet() === true)
  assert(await magnetBtn.getAttribute('aria-pressed') === 'true', 'toolbar Imán toggles on')

  const seeded = await page.evaluate(async () => window.__musicaliaClips.seedPair())
  await page.waitForSelector('[data-testid="clip-wrapper"]')
  await page.waitForTimeout(200)
  assert(seeded.ids.length === 2, 'seeded two clips')

  const inner = await page.evaluate(() => {
    const el = document.querySelector('[data-testid="lanes-scroll-inner"]')
    const layout = Number(el?.getAttribute('data-layout-max') || '100')
    const width = el?.getBoundingClientRect().width || 1
    return { layout, width, pxPerSec: width / layout }
  })
  const clips = await page.evaluate(() => window.__musicaliaClips.getClips())
  const moving = clips.find((c) => c.id === seeded.ids[0])
  const other = clips.find((c) => c.id === seeded.ids[1])
  const needDelta = other.offsetSeconds - (moving.offsetSeconds + moving.duration)
  const dragPx = needDelta * inner.pxPerSec - 4
  console.log('snap plan', JSON.stringify({ inner, moving, other, needDelta, dragPx }))
  assert(dragPx > 20, 'zoom is large enough to drag toward the other edge')

  const body = await page.locator(`[data-clip-id="${seeded.ids[0]}"] .clip-body`).boundingBox()
  if (!body) throw new Error('missing clip body')
  await page.mouse.move(body.x + body.width / 2, body.y + body.height / 2)
  await page.mouse.down()
  await page.mouse.move(body.x + body.width / 2 + dragPx, body.y + body.height / 2, { steps: 16 })
  await page.waitForTimeout(80)
  const guide = await page.evaluate(() => window.__musicaliaClips.magnetGuide())
  const guideVisible = await page.locator('[data-testid="magnet-guide"]').evaluate((el) => !el.hidden)
  console.log('guide', { guide, guideVisible })
  assert(guideVisible, 'vertical magnet guide is visible while snapped')
  assert(guide != null && Math.abs(guide - other.offsetSeconds) < 1e-6, 'guide sits on the target start')

  mkdirSync(SCREENSHOT_DIR, { recursive: true })
  const shotPath = join(SCREENSHOT_DIR, 'clip-magnet-snap-guide.png')
  await page.screenshot({ path: shotPath, fullPage: false })
  console.log('screenshot', shotPath)

  await page.mouse.up()
  await page.waitForTimeout(160)

  const afterSnap = await page.evaluate(() => window.__musicaliaClips.getClips())
  const moved = afterSnap.find((c) => c.id === seeded.ids[0])
  const stayed = afterSnap.find((c) => c.id === seeded.ids[1])
  const expectedStart = other.offsetSeconds - moving.duration
  console.log('after snap', JSON.stringify({ moved, stayed, expectedStart }))
  assert(Math.abs(moved.offsetSeconds - expectedStart) < 0.02, `moving clip snapped to ${expectedStart}, got ${moved.offsetSeconds}`)
  assert(Math.abs(stayed.offsetSeconds - other.offsetSeconds) < 1e-6, 'target clip did not move')

  await page.evaluate((ids) => window.__musicaliaClips.select(ids, 'replace'), seeded.ids)
  await page.evaluate(() => window.__musicaliaClips.alignStarts())
  await page.waitForTimeout(80)
  const aligned = await page.evaluate(() => window.__musicaliaClips.getClips())
  const a0 = aligned.find((c) => c.id === seeded.ids[0])
  const a1 = aligned.find((c) => c.id === seeded.ids[1])
  assert(Math.abs(a0.offsetSeconds - a1.offsetSeconds) < 1e-6, 'Alinear inicios matches both starts')
  assert(Math.abs(a0.offsetSeconds - expectedStart) < 0.02, 'aligned to the earliest start')

  writeFileSync(join(SCREENSHOT_DIR, 'clip-magnet-snap-guide.json'), JSON.stringify({
    seeded, inner, needDelta, dragPx, guide, expectedStart, afterSnap, aligned
  }, null, 2))
} finally {
  await browser.close()
  server.close()
}

if (failed > 0) {
  console.error(`\n${failed} assertion(s) failed`)
  process.exit(1)
}
console.log('\n✅ clip magnet Chromium check passed')
