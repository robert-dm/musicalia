/**
 * Headless Chromium: 10-minute follow-mode map + 5 tracks must stay interactive.
 *
 *   npm run build
 *   node scripts/verify-tempo-perf-chrome.mjs
 */
import { createServer } from 'node:http'
import { createReadStream, existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { extname, join, resolve } from 'node:path'

const require = createRequire('/tmp/pw/package.json')
const { chromium } = require('playwright-core')

const ROOT = resolve(process.cwd())
const DIST = join(ROOT, 'dist')
const PORT = Number(process.env.VERIFY_PORT || 4199)
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

  const seeded = await page.evaluate(async () => {
    const t0 = performance.now()
    const info = await window.__musicaliaClips.seedPerfSession(600, 5, 160)
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
    const markers = document.querySelectorAll('[data-testid^="tempo-marker-"]').length
    const state = window.__musicaliaMetronome.getState()
    return {
      ...info,
      seedMs: performance.now() - t0,
      markers,
      tempoMapBeats: state.tempoMapBeats,
      followMode: state.followMode,
      version: document.querySelector('.version-label')?.textContent
    }
  })
  console.log('seeded', seeded)
  assert(seeded.beats >= 1500, `10-minute 160 BPM map (~1600 beats), got ${seeded.beats}`)
  assert(seeded.tracks >= 5, `5 tracks, got ${seeded.tracks}`)
  assert(seeded.followMode === 'follow', `follow mode, got ${seeded.followMode}`)
  assert((seeded.version || '').includes('0.0099b'), `UI is 0.0099b, got ${seeded.version}`)
  assert(seeded.markers > 4, `visible markers render, got ${seeded.markers}`)
  assert(seeded.markers <= 48, `idle marker lane stays capped (got ${seeded.markers}; 0.0098b mounted ~1600, first 0.0099b pass 229)`)
  console.log(`seed+first paint ${seeded.seedMs.toFixed(1)}ms (0.0098b marker pass alone was ~1900ms)`)

  const idle = await page.evaluate(async () => {
    window.__musicaliaMetronome.resetRenderStats()
    await new Promise((r) => setTimeout(r, 2000))
    const stats = window.__musicaliaMetronome.getRenderStats()
    return {
      app: stats.app,
      markers: stats.markers,
      appPerSec: stats.app / 2,
      markersPerSec: stats.markers / 2,
      markerNodes: document.querySelectorAll('[data-testid^="tempo-marker-"]').length
    }
  })
  console.log('idle renders/2s', idle)
  assert(idle.appPerSec < 2, `idle App renders/sec stay near zero (got ${idle.appPerSec}; a loop would be tens/sec)`)
  assert(idle.markersPerSec < 1, `idle marker lane does not re-render (got ${idle.markersPerSec}/sec)`)
  assert(idle.markerNodes <= 48, `idle DOM markers stay capped (got ${idle.markerNodes})`)

  await page.evaluate(() => window.__musicaliaMetronome.unmute())
  await page.waitForTimeout(200)
  const playStats = await page.evaluate(async () => {
    window.__musicaliaMetronome.play()
    await new Promise((r) => setTimeout(r, 250))
    const longTasks = []
    let observer
    try {
      observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          if (entry.duration > 50) longTasks.push(entry.duration)
        }
      })
      observer.observe({ type: 'longtask' })
    } catch {
      observer = null
    }
    const frames = []
    const t0 = performance.now()
    await new Promise((resolve) => {
      let last = performance.now()
      function tick(now) {
        frames.push(now - last)
        last = now
        if (now - t0 < 1600) requestAnimationFrame(tick)
        else resolve()
      }
      requestAnimationFrame(tick)
    })
    observer?.disconnect()
    const scheduled = (window.__musicaliaMetronomeSchedule || window.__musicaliaMetronome.getState().scheduled || [])
    const avg = frames.reduce((s, v) => s + v, 0) / Math.max(1, frames.length)
    const max = Math.max(...frames)
    return {
      frames: frames.length,
      avg,
      max,
      longTasks: longTasks.slice(),
      scheduled: scheduled.length,
      lastSong: scheduled[scheduled.length - 1]?.songTime ?? null
    }
  })
  console.log('playback', playStats)
  assert(playStats.avg < 16.7, `average frame < 16ms (got ${playStats.avg.toFixed(2)}ms; 0.0098b marker pass was ~1900ms)`)
  assert(playStats.max < 80, `no monstrous frame (max ${playStats.max.toFixed(1)}ms)`)
  assert(playStats.longTasks.length === 0, `no long tasks > 50ms (got ${playStats.longTasks.join(',') || 'none'})`)
  assert(playStats.scheduled > 4, 'lookahead still schedules opening clicks')
  assert(playStats.scheduled < 80, `does not schedule the whole 10-minute grid (got ${playStats.scheduled})`)
  if (playStats.lastSong != null) {
    assert(playStats.lastSong <= 10, `scheduled window stays near the playhead (last ${playStats.lastSong})`)
  }

  mkdirSync(SCREENSHOT_DIR, { recursive: true })
  const laneBox = await page.locator('[data-testid="metronome-lane"]').boundingBox()
  const rulerBox = await page.locator('[data-testid="bar-ruler"]').boundingBox()
  if (laneBox && rulerBox) {
    const shot = await page.screenshot({
      clip: {
        x: Math.max(0, rulerBox.x - 8),
        y: Math.max(0, rulerBox.y - 8),
        width: Math.min(1100, 1440 - rulerBox.x),
        height: Math.min(260, laneBox.y + laneBox.height - rulerBox.y + 24)
      }
    })
    writeFileSync(join(SCREENSHOT_DIR, 'tempo_perf_follow.png'), shot)
  }
  console.log('screenshots', SCREENSHOT_DIR)
} finally {
  await browser.close()
  server.close()
}

if (failed > 0) {
  console.error(`\n${failed} assertion(s) failed`)
  process.exit(1)
}
console.log('\n✅ tempo map perf Chromium check passed')
