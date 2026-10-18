/**
 * Headless Chromium: Shift/Meta click-select 5 clips across 3 tracks,
 * selection persists, then group-drag. Also marquee 5 clips.
 *
 *   npm run build
 *   node scripts/verify-clip-modifier-select-chrome.mjs
 */
import { createServer } from 'node:http'
import { createReadStream, existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { extname, join, resolve } from 'node:path'

const require = createRequire('/tmp/pw/package.json')
const { chromium } = require('playwright-core')

const ROOT = resolve(process.cwd())
const DIST = join(ROOT, 'dist')
const PORT = Number(process.env.VERIFY_PORT || 4187)
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

async function clipBodyBox(id) {
  const box = await page.locator(`[data-clip-id="${id}"] .clip-body`).boundingBox()
  if (!box) throw new Error(`missing clip body ${id}`)
  return box
}

async function mouseClickClip(id, modifiers = []) {
  const box = await clipBodyBox(id)
  const x = box.x + box.width / 2
  const y = box.y + box.height / 2
  for (const key of modifiers) await page.keyboard.down(key)
  await page.mouse.move(x, y)
  await page.mouse.down()
  await page.mouse.up()
  for (const key of modifiers) await page.keyboard.up(key)
  await page.waitForTimeout(50)
}

try {
  await page.goto(ORIGIN, { waitUntil: 'networkidle', timeout: 60000 })
  await page.waitForFunction(() => window.__musicaliaClips, { timeout: 15000 })
  await page.mouse.click(200, 80)

  const seeded = await page.evaluate(async () => window.__musicaliaClips.seedGrid())
  await page.waitForSelector('[data-testid="clip-wrapper"]')
  await page.waitForTimeout(200)
  assert(seeded.ids.length === 5, 'seeded five clips')
  assert(new Set(seeded.tracks).size === 3, 'clips sit on three tracks')

  await mouseClickClip(seeded.ids[0])
  await mouseClickClip(seeded.ids[1], ['Meta'])
  await mouseClickClip(seeded.ids[2], ['Meta'])
  await mouseClickClip(seeded.ids[3], ['Shift'])
  await mouseClickClip(seeded.ids[4], ['Shift'])
  await page.waitForTimeout(500)

  const afterClicks = await page.evaluate(() => window.__musicaliaClips.getSelection())
  console.log('after modifier clicks', afterClicks)
  assert(afterClicks.length === 5, `5 clips stay selected after 500ms, got ${afterClicks.length}`)
  assert(seeded.ids.every((id) => afterClicks.includes(id)), 'Meta/Shift clicks kept all five ids')

  const before = await page.evaluate(() => window.__musicaliaClips.getClips().filter((c) => c.id.startsWith('clip-grid-')))
  const inner = await page.evaluate(() => {
    const el = document.querySelector('[data-testid="lanes-scroll-inner"]')
    const layout = Number(el?.getAttribute('data-layout-max') || '100')
    const width = el?.getBoundingClientRect().width || 1
    return { layout, width, pxPerSec: width / layout }
  })
  const dragPx = 70
  const body = await clipBodyBox(seeded.ids[0])
  await page.mouse.move(body.x + body.width / 2, body.y + body.height / 2)
  await page.mouse.down()
  await page.mouse.move(body.x + body.width / 2 + dragPx, body.y + body.height / 2, { steps: 10 })
  await page.mouse.up()
  await page.waitForTimeout(160)

  const afterDrag = await page.evaluate(() => window.__musicaliaClips.getClips().filter((c) => c.id.startsWith('clip-grid-')))
  const deltas = afterDrag.map((clip, i) => clip.offsetSeconds - before[i].offsetSeconds)
  const expected = dragPx / inner.pxPerSec
  console.log('group drag', { deltas, expected })
  assert(deltas.every((d) => Math.abs(d - deltas[0]) < 1e-6), 'group drag uses one shared delta')
  assert(Math.abs(deltas[0] - expected) < 0.05, `group delta ~ ${expected.toFixed(3)}s, got ${deltas[0].toFixed(3)}s`)
  assert(afterDrag.every((clip, i) => clip.trackIndex === before[i].trackIndex), 'clips stayed on their tracks')

  await page.evaluate(() => window.__musicaliaClips.select([], 'replace'))
  await page.waitForTimeout(80)
  const boxes = await page.$$eval('[data-testid="clip-wrapper"]', (els) =>
    els.filter((el) => (el.getAttribute('data-clip-id') || '').startsWith('clip-grid-')).map((el) => {
      const r = el.getBoundingClientRect()
      return { left: r.left, right: r.right, top: r.top, bottom: r.bottom }
    })
  )
  const startX = Math.min(...boxes.map((b) => b.left)) - 20
  const startY = Math.min(...boxes.map((b) => b.top)) - 8
  const endX = Math.max(...boxes.map((b) => b.right)) + 20
  const endY = Math.max(...boxes.map((b) => b.bottom)) + 8
  await page.mouse.move(startX, startY)
  await page.mouse.down()
  await page.mouse.move(endX, endY, { steps: 14 })
  await page.mouse.up()
  await page.waitForTimeout(160)
  const marquee = await page.evaluate(() => window.__musicaliaClips.getSelection())
  console.log('marquee', marquee)
  assert(marquee.length === 5, `marquee selected 5 clips, got ${marquee.length}`)
  assert(seeded.ids.every((id) => marquee.includes(id)), 'marquee hit every seeded clip')

  mkdirSync(SCREENSHOT_DIR, { recursive: true })
  const shotPath = join(SCREENSHOT_DIR, 'clip-modifier-select-five.png')
  await page.screenshot({ path: shotPath, fullPage: false })
  writeFileSync(join(SCREENSHOT_DIR, 'clip-modifier-select-five.json'), JSON.stringify({
    seeded, afterClicks, deltas, expected, marquee
  }, null, 2))
  console.log('screenshot', shotPath)
} finally {
  await browser.close()
  server.close()
}

if (failed > 0) {
  console.error(`\n${failed} assertion(s) failed`)
  process.exit(1)
}
console.log('\n✅ clip modifier-select Chromium check passed')
