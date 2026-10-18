/**
 * Headless Chromium: Snap and Imán stay visible at 1280 and 1440, magnet guide works.
 *
 *   npm run build
 *   node scripts/verify-toolbar-toggles-chrome.mjs
 */
import { createServer } from 'node:http'
import { createReadStream, existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { extname, join, resolve } from 'node:path'

const require = createRequire('/tmp/pw/package.json')
const { chromium } = require('playwright-core')

const ROOT = resolve(process.cwd())
const DIST = join(ROOT, 'dist')
const PORT = Number(process.env.VERIFY_PORT || 4197)
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

let failed = 0
function assert(cond, msg) {
  if (!cond) {
    failed++
    console.error('FAIL:', msg)
  } else {
    console.log('ok:', msg)
  }
}

async function visibleToggles(page, width) {
  await page.setViewportSize({ width, height: 900 })
  await page.waitForTimeout(80)
  return page.evaluate((viewW) => {
    const ids = ['snap-toggle', 'magnet-toggle', 'loop-toggle', 'metronome-toolbar']
    const items = {}
    for (const id of ids) {
      const el = document.querySelector(`[data-testid="${id}"]`)
      if (!el) {
        items[id] = { present: false }
        continue
      }
      const box = el.getBoundingClientRect()
      const style = getComputedStyle(el)
      items[id] = {
        present: true,
        visible:
          style.display !== 'none' &&
          style.visibility !== 'hidden' &&
          box.width > 4 &&
          box.height > 4 &&
          box.right > 2 &&
          box.left < viewW - 2 &&
          box.bottom > 0,
        left: box.left,
        right: box.right,
        pressed: el.getAttribute('aria-pressed')
      }
    }
    return items
  }, width)
}

try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  page.on('pageerror', (err) => console.error('PAGEERROR', err.message))
  await page.goto(ORIGIN, { waitUntil: 'networkidle', timeout: 60000 })
  await page.waitForFunction(() => window.__musicaliaClips && window.__musicaliaMetronome, { timeout: 15000 })

  mkdirSync(SCREENSHOT_DIR, { recursive: true })

  for (const width of [1440, 1280]) {
    const items = await visibleToggles(page, width)
    console.log(width, items)
    assert(items['snap-toggle']?.visible, `Snap visible at ${width}px`)
    assert(items['magnet-toggle']?.visible, `Imán visible at ${width}px`)
    assert(items['loop-toggle']?.visible, `Loop visible at ${width}px`)
    assert(items['snap-toggle']?.pressed === 'false', `Snap starts OFF at ${width}px`)
    assert(items['magnet-toggle']?.pressed === 'false', `Imán starts OFF at ${width}px`)
    writeFileSync(
      join(SCREENSHOT_DIR, `toolbar-toggles-${width}.png`),
      await page.locator('.transport-bar').screenshot()
    )
  }

  await page.setViewportSize({ width: 1440, height: 900 })
  await page.locator('[data-testid="magnet-toggle"]').click()
  await page.waitForFunction(() => window.__musicaliaClips.getMagnet() === true)
  const seeded = await page.evaluate(async () => window.__musicaliaClips.seedPair())
  await page.waitForSelector('[data-testid="clip-wrapper"]')
  await page.waitForTimeout(200)
  const plan = await page.evaluate((ids) => {
    const inner = document.querySelector('[data-testid="lanes-scroll-inner"]')
    const layout = Number(inner?.getAttribute('data-layout-max') || '100')
    const width = inner?.getBoundingClientRect().width || 1
    const clips = window.__musicaliaClips.getClips()
    const moving = clips.find((c) => c.id === ids[0])
    const other = clips.find((c) => c.id === ids[1])
    const needDelta = other.offsetSeconds - (moving.offsetSeconds + moving.duration)
    return {
      pxPerSec: width / layout,
      dragPx: needDelta * (width / layout) - 4,
      target: other.offsetSeconds
    }
  }, seeded.ids)
  const body = await page.locator(`[data-clip-id="${seeded.ids[0]}"] .clip-body`).boundingBox()
  if (!body) throw new Error('missing clip body')
  await page.mouse.move(body.x + body.width / 2, body.y + body.height / 2)
  await page.mouse.down()
  await page.mouse.move(body.x + body.width / 2 + plan.dragPx, body.y + body.height / 2, { steps: 16 })
  await page.waitForTimeout(80)
  const guide = await page.evaluate(() => ({
    hidden: document.querySelector('[data-testid="magnet-guide"]')?.hidden,
    snapTime: window.__musicaliaClips.magnetGuide()
  }))
  console.log('magnet guide', guide, plan)
  writeFileSync(join(SCREENSHOT_DIR, 'magnet-guide.png'), await page.screenshot())
  await page.mouse.up()
  assert(guide.hidden === false, 'magnet guide is shown while snapping')
  assert(guide.snapTime != null && Math.abs(guide.snapTime - plan.target) < 1e-6, `guide sits on the target start (got ${guide.snapTime})`)
  await page.close()
} finally {
  await browser.close()
  server.close()
}

if (failed > 0) {
  console.error(`\n${failed} assertion(s) failed`)
  process.exit(1)
}
console.log('\n✅ toolbar toggle Chromium check passed')
