/**
 * Headless Chromium: Alt+drag marquee on clips, header, bottom pad,
 * edge auto-scroll, and clip/track selection menu commands.
 *
 *   npm run build
 *   node scripts/verify-marquee-select-chrome.mjs
 */
import { createServer } from 'node:http'
import { createReadStream, existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { extname, join, resolve } from 'node:path'

const require = createRequire('/tmp/pw/package.json')
const { chromium } = require('playwright-core')

const ROOT = resolve(process.cwd())
const DIST = join(ROOT, 'dist')
const PORT = Number(process.env.VERIFY_PORT || 4190)
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

async function drag(from, to, modifiers = []) {
  for (const key of modifiers) await page.keyboard.down(key)
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  await page.mouse.move(to.x, to.y, { steps: 16 })
  await page.mouse.up()
  for (const key of modifiers) await page.keyboard.up(key)
  await page.waitForTimeout(80)
}

try {
  await page.goto(ORIGIN, { waitUntil: 'networkidle', timeout: 60000 })
  await page.waitForFunction(() => window.__musicaliaClips, { timeout: 15000 })
  await page.mouse.click(200, 80)
  const seeded = await page.evaluate(async () => window.__musicaliaClips.seedGrid())
  await page.waitForSelector('[data-testid="clip-wrapper"]')
  await page.waitForTimeout(160)
  assert(seeded.ids.length === 5, 'seeded five clips')

  const first = await clipBodyBox(seeded.ids[0])
  const last = await clipBodyBox(seeded.ids[4])
  const union = await page.evaluate((ids) => {
    const rects = ids.map((id) => {
      const el = document.querySelector(`[data-clip-id="${id}"]`)
      return el?.getBoundingClientRect()
    }).filter(Boolean)
    return {
      left: Math.min(...rects.map((r) => r.left)),
      right: Math.max(...rects.map((r) => r.right)),
      top: Math.min(...rects.map((r) => r.top)),
      bottom: Math.max(...rects.map((r) => r.bottom))
    }
  }, seeded.ids)
  await page.evaluate(() => window.__musicaliaClips.select([], 'replace'))
  await drag(
    { x: first.x + 10, y: first.y + first.height / 2 },
    { x: union.right + 6, y: union.bottom + 6 },
    ['Alt']
  )
  const altOnClips = await page.evaluate(() => window.__musicaliaClips.getSelection())
  console.log('alt-on-clips', altOnClips)
  assert(altOnClips.length === 5, `Alt+drag on clips selected 5, got ${altOnClips.length}`)
  assert(seeded.ids.every((id) => altOnClips.includes(id)), 'Alt+drag on a clip hit every seeded clip')

  await page.evaluate(() => window.__musicaliaClips.select([], 'replace'))
  const header = page.locator(`[data-testid="track-header-${seeded.tracks[0]}"]`)
  const headerBox = await header.boundingBox()
  await drag(
    { x: headerBox.x + headerBox.width - 12, y: headerBox.y + headerBox.height / 2 },
    { x: union.right + 6, y: union.bottom + 6 },
    ['Alt']
  )
  const fromHeader = await page.evaluate(() => window.__musicaliaClips.getSelection())
  console.log('alt-from-header', fromHeader)
  assert(fromHeader.length >= 3, `Alt+drag from header selected several clips, got ${fromHeader.length}`)

  await page.evaluate(() => window.__musicaliaClips.select([], 'replace'))
  await page.locator('[data-testid="lanes-bottom-pad"]').scrollIntoViewIfNeeded()
  await page.waitForTimeout(80)
  const pad = await page.locator('[data-testid="lanes-bottom-pad"]').boundingBox()
  const liveUnion = await page.evaluate((ids) => {
    const rects = ids.map((id) => document.querySelector(`[data-clip-id="${id}"]`)?.getBoundingClientRect()).filter(Boolean)
    return {
      left: Math.min(...rects.map((r) => r.left)),
      right: Math.max(...rects.map((r) => r.right)),
      top: Math.min(...rects.map((r) => r.top))
    }
  }, seeded.ids)
  await drag(
    { x: pad.x + 24, y: pad.y + 16 },
    { x: liveUnion.right + 8, y: liveUnion.top - 8 }
  )
  const fromPad = await page.evaluate(() => window.__musicaliaClips.getSelection())
  console.log('from-bottom-pad', fromPad)
  assert(fromPad.length === 5, `marquee from below the last track selected 5, got ${fromPad.length}`)

  await page.evaluate(() => window.__musicaliaClips.setZoom(12))
  await page.waitForTimeout(80)
  const beforeScroll = await page.evaluate(() => {
    const scroller = document.querySelector('.lanes-scroll-content')
    scroller.scrollLeft = 0
    return { left: scroller.scrollLeft, width: scroller.clientWidth }
  })
  const scrollerBox = await page.locator('.lanes-scroll-content').boundingBox()
  await page.mouse.move(scrollerBox.x + scrollerBox.width - 10, scrollerBox.y + 80)
  await page.mouse.down()
  await page.mouse.move(scrollerBox.x + scrollerBox.width + 20, scrollerBox.y + 80, { steps: 8 })
  await page.waitForTimeout(280)
  const during = await page.evaluate(() => document.querySelector('.lanes-scroll-content')?.scrollLeft || 0)
  await page.mouse.up()
  console.log('autoscroll', { before: beforeScroll.left, during })
  assert(during > beforeScroll.left + 8, `marquee at the right edge auto-scrolls (scrollLeft ${during})`)

  await page.evaluate(() => window.__musicaliaClips.setZoom(1))
  await page.waitForTimeout(80)

  const earliestId = seeded.ids[0]
  await page.locator(`[data-clip-id="${earliestId}"]`).click({ button: 'right' })
  await page.locator('[data-testid="select-from-here"]').click()
  const fromHere = await page.evaluate(() => window.__musicaliaClips.getSelection())
  console.log('from-here', fromHere)
  assert(fromHere.length === 5, 'Seleccionar desde aquí hasta el final from the earliest clip takes all 5')
  assert(seeded.ids.every((id) => fromHere.includes(id)), 'from-here includes every seeded clip')

  await page.locator(`[data-clip-id="${seeded.ids[0]}"]`).click({ button: 'right' })
  await page.locator('[data-testid="select-at-time-all-tracks"]').click()
  const atTime = await page.evaluate(() => window.__musicaliaClips.getSelection())
  console.log('at-time', atTime)
  assert(atTime.length >= 1, 'Seleccionar este punto en todas las pistas selected overlapping clips')
  assert(atTime.every((id) => seeded.ids.includes(id)), 'point select stays on seeded clips')

  const headerIndex = seeded.tracks[0]
  await page.locator(`[data-testid="track-header-${headerIndex}"]`).click({ button: 'right' })
  const trackItem = page.locator('[data-testid="select-track-clips"]')
  assert(await trackItem.count() === 1, 'track menu still has Seleccionar todos los clips de la pista')
  await trackItem.click()
  const onTrack = await page.evaluate(() => window.__musicaliaClips.getSelection())
  const expectedTrack = seeded.ids.filter((_, i) => seeded.tracks[i] === headerIndex)
  console.log('track-menu', { onTrack, expectedTrack })
  assert(expectedTrack.every((id) => onTrack.includes(id)), 'track right-click still selects every clip on that track')
  assert(onTrack.length === expectedTrack.length, 'track right-click does not take clips from other tracks')

  const beforeDup = await page.evaluate(() => window.__musicaliaClips.getClips().filter((c) => c.id.startsWith('clip-grid-')))
  const body = await clipBodyBox(seeded.ids[0])
  await drag(
    { x: body.x + body.width / 2, y: body.y + body.height / 2 },
    { x: body.x + body.width / 2 + 80, y: body.y + body.height / 2 },
    ['Control', 'Alt']
  )
  const afterDup = await page.evaluate(() => window.__musicaliaClips.getClips().length)
  console.log('duplicate', { before: beforeDup.length, after: afterDup })
  assert(afterDup > beforeDup.length, 'Cmd/Ctrl+Alt+drag still duplicates')

  mkdirSync(SCREENSHOT_DIR, { recursive: true })
  const shotPath = join(SCREENSHOT_DIR, 'marquee-select-ux.png')
  await page.screenshot({ path: shotPath, fullPage: false })
  writeFileSync(join(SCREENSHOT_DIR, 'marquee-select-ux.json'), JSON.stringify({
    seeded, altOnClips, fromHeader, fromPad, during, fromHere, atTime, onTrack
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
console.log('\n✅ marquee / selection Chromium check passed')
