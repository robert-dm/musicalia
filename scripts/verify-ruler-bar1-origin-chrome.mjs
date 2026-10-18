/**
 * Headless Chromium: for a clip that starts on the beat, ruler "1",
 * the clip left edge, and the first metronome marker share the same x.
 *
 *   npm run build
 *   node scripts/verify-ruler-bar1-origin-chrome.mjs
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
  await page.waitForFunction(() => window.__musicaliaMetronome && window.__musicaliaClips, { timeout: 15000 })

  const seeded = await page.evaluate(() => window.__musicaliaClips.seedAtOrigin())
  assert(seeded.offsetSeconds === 0, `seeded clip starts at t=0, got ${seeded.offsetSeconds}`)

  const bpm = 160.2
  const period = 60 / bpm
  const injected = await page.evaluate((periodSec) => {
    const times = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((i) => i * periodSec)
    return window.__musicaliaMetronome.setTempoMap({
      beats: times.map((time, index) => ({ id: `beat-${index}`, time, pinned: false })),
      downbeatIndex: 0,
      globalBpm: 160.2,
      sourceDuration: 8
    })
  }, period)
  assert(injected === true, 'debug API accepts a late-start Sidewinder-like tempo map')

  await page.evaluate(() => window.__musicaliaMetronome.setBpm(160.2))
  await page.evaluate(() => window.__musicaliaClips.setZoom(3))
  await page.waitForTimeout(200)
  await page.waitForSelector('[data-testid="ruler-bar-1"]')
  await page.waitForSelector('[data-testid="clip-wrapper"]')
  await page.waitForSelector('[data-testid="tempo-marker-0"]')

  await page.evaluate(() => window.__musicaliaMetronome.unmute())
  await page.evaluate(() => window.__musicaliaMetronome.play())
  await page.waitForTimeout(200)

  const measured = await page.evaluate(() => {
    const clip = document.querySelector('[data-testid="clip-wrapper"]')
    const bar1 = document.querySelector('[data-testid="ruler-bar-1"]')
    const marker = document.querySelector('[data-testid="tempo-marker-0"]')
    const clipRect = clip?.getBoundingClientRect()
    const barRect = bar1?.getBoundingClientRect()
    const markerRect = marker?.getBoundingClientRect()
    const state = window.__musicaliaMetronome.getState()
    const scheduled = window.__musicaliaMetronome.getSchedule()
    const clips = window.__musicaliaClips.getClips()
    return {
      clipOffset: clips[0]?.offsetSeconds,
      clipLeft: clipRect?.left ?? null,
      bar1Left: barRect?.left ?? null,
      bar1Time: bar1 ? Number(bar1.getAttribute('data-t')) : null,
      markerCenter: markerRect ? markerRect.left + markerRect.width / 2 : null,
      markerTime: marker ? Number(marker.getAttribute('data-beat-time')) : null,
      markerDownbeat: marker?.getAttribute('data-downbeat'),
      firstClick: scheduled[0]?.songTime ?? null,
      firstAccent: scheduled[0]?.accent ?? null,
      followMode: state.followMode,
      tempoMapBeats: state.tempoMapBeats
    }
  })
  console.log('measured', measured)

  assert(measured.clipOffset === 0, `clip offset is 0, got ${measured.clipOffset}`)
  assert(measured.bar1Time === 0, `ruler 1 time is 0, got ${measured.bar1Time}`)
  assert(measured.markerTime === 0, `first metronome marker time is 0, got ${measured.markerTime}`)
  assert(measured.markerDownbeat === '1', 'first metronome marker is the downbeat')
  assert(measured.firstClick === 0, `first scheduled click is 0, got ${measured.firstClick}`)
  assert(measured.firstAccent === true, 'first scheduled click is the bar-1 accent')
  assert(measured.followMode === 'follow', 'follow mode is on')
  assert(measured.tempoMapBeats >= 13, `origin beat was prepended, got ${measured.tempoMapBeats} beats`)

  const clipLeft = measured.clipLeft
  const bar1Left = measured.bar1Left
  const markerCenter = measured.markerCenter
  assert(clipLeft != null && bar1Left != null && markerCenter != null, 'all three x positions resolved')
  const barVsClip = Math.abs(bar1Left - clipLeft)
  const markerVsClip = Math.abs(markerCenter - clipLeft)
  const markerVsBar = Math.abs(markerCenter - bar1Left)
  console.log('x delta px', { barVsClip, markerVsClip, markerVsBar })
  assert(barVsClip <= 4, `ruler 1 x == clip start x (Δ ${barVsClip.toFixed(2)}px)`)
  assert(markerVsClip <= 6, `first metronome marker x == clip start x (Δ ${markerVsClip.toFixed(2)}px)`)
  assert(markerVsBar <= 6, `first metronome marker x == ruler 1 x (Δ ${markerVsBar.toFixed(2)}px)`)

  mkdirSync(SCREENSHOT_DIR, { recursive: true })
  const laneBox = await page.locator('[data-testid="metronome-lane"]').boundingBox()
  const clipBox = await page.locator('[data-testid="clip-wrapper"]').first().boundingBox()
  const rulerBox = await page.locator('[data-testid="bar-ruler"]').boundingBox()
  if (laneBox && rulerBox) {
    const bottom = Math.max(laneBox.y + laneBox.height, (clipBox?.y ?? 0) + (clipBox?.height ?? 0))
    const x = Math.max(0, Math.min(rulerBox.x, laneBox.x, clipBox?.x ?? laneBox.x) - 12)
    const y = Math.max(0, rulerBox.y - 8)
    const width = Math.min(1100, 1440 - x)
    const height = Math.min(320, bottom - y + 16)
    const shot = await page.screenshot({ clip: { x, y, width, height } })
    writeFileSync(join(SCREENSHOT_DIR, 'ruler_bar1_clip_metro_aligned.png'), shot)
  }
  const full = await page.screenshot({ fullPage: false })
  writeFileSync(join(SCREENSHOT_DIR, 'ruler_bar1_origin_session.png'), full)
  console.log('screenshots', SCREENSHOT_DIR)

  await page.evaluate(() => window.__musicaliaMetronome.setMeter({ followMode: 'fixed' }))
  await page.waitForTimeout(80)
  await page.evaluate(() => window.__musicaliaMetronome.play())
  await page.waitForTimeout(160)
  const periodSec = 60 / 160.2
  const fixed = await page.evaluate(() => {
    const clicks = window.__musicaliaMetronome.getSchedule().slice(0, 6).map((c) => Number(c.songTime))
    return { clicks, followMode: window.__musicaliaMetronome.getState().followMode }
  })
  assert(fixed.followMode === 'fixed', 'Tempo fijo is active')
  const onLattice = fixed.clicks.length >= 3 && fixed.clicks.every((t) => {
    const n = Math.round(t / periodSec)
    return n >= 0 && Math.abs(t - n * periodSec) < 0.002
  })
  assert(onLattice, `fixed clicks at t=0+n*beat, got ${fixed.clicks.map((t) => t.toFixed(4))}`)
} finally {
  await browser.close()
  server.close()
}

if (failed > 0) {
  console.error(`\n${failed} assertion(s) failed`)
  process.exit(1)
}
console.log('\n✅ ruler bar-1 origin Chromium check passed')
