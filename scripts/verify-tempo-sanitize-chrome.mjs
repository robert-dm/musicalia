/**
 * Headless Chromium: an old-style late-start tempo map must not explode
 * into a dense marker mess after 0.0098b sanitizing.
 *
 *   npm run build
 *   node scripts/verify-tempo-sanitize-chrome.mjs
 */
import { createServer } from 'node:http'
import { createReadStream, existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { extname, join, resolve } from 'node:path'

const require = createRequire('/tmp/pw/package.json')
const { chromium } = require('playwright-core')

const ROOT = resolve(process.cwd())
const DIST = join(ROOT, 'dist')
const PORT = Number(process.env.VERIFY_PORT || 4198)
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

  await page.evaluate(() => window.__musicaliaClips.seedAtOrigin(8))
  const bpm = 160
  const period = 60 / bpm
  const injected = await page.evaluate((p) => {
    const times = [1.5, 1.528, 1.556]
    for (let i = 1; i <= 22; i++) times.push(1.5 + i * p)
    return window.__musicaliaMetronome.setTempoMap({
      beats: times.map((time, index) => ({ id: `old-${index}`, time, pinned: false })),
      downbeatIndex: 0,
      globalBpm: 160,
      sourceDuration: 8
    })
  }, period)
  assert(injected === true, 'old-style late-start map is accepted')

  await page.evaluate(() => window.__musicaliaMetronome.setBpm(160))
  await page.waitForTimeout(200)
  await page.waitForSelector('[data-testid="tempo-marker-0"]')

  const measured = await page.evaluate(() => {
    const markers = [...document.querySelectorAll('[data-testid^="tempo-marker-"]')]
    const times = markers.map((el) => Number(el.getAttribute('data-beat-time')))
    const state = window.__musicaliaMetronome.getState()
    return {
      markerCount: markers.length,
      first: times[0],
      last: times[times.length - 1],
      minGap: times.slice(1).reduce((m, t, i) => Math.min(m, t - times[i]), Infinity),
      localBpm: state.localBpm,
      mapUsable: state.mapUsable,
      tempoMapBeats: state.tempoMapBeats,
      followMode: state.followMode
    }
  })
  console.log('measured', measured)
  const expected = 8 * 160 / 60
  const lo = expected * 0.95
  const hi = expected * 1.05
  assert(
    measured.markerCount >= lo && measured.markerCount <= hi + 1,
    `marker count ≈ duration×BPM/60 (${expected.toFixed(1)} ±5%), got ${measured.markerCount}`
  )
  assert(measured.first === 0, `first marker at t=0, got ${measured.first}`)
  assert(measured.minGap >= 0.2 - 1e-6, `no marker gap under 0.2s (min ${measured.minGap})`)
  assert(measured.localBpm >= 140 && measured.localBpm <= 180, `local BPM sane, got ${measured.localBpm}`)
  assert(measured.mapUsable === true, 'sanitized map is usable')

  await page.click('[data-testid="metronome-settings-gear"]')
  await page.waitForSelector('[data-testid="metronome-settings"]')
  const panel = await page.evaluate(() => ({
    local: document.querySelector('[data-testid="local-bpm-readout"]')?.textContent?.trim(),
    reanalyze: !!document.querySelector('[data-testid="reanalyze-tempo"]'),
    reset: !!document.querySelector('[data-testid="reset-tempo"]'),
    notice: document.querySelector('[data-testid="tempo-map-fallback-notice"]')?.textContent?.trim()
  }))
  assert((panel.local || '').includes('BPM'), `local BPM readout, got ${panel.local}`)
  assert(!/2121/.test(panel.local || ''), 'local BPM is not the 2121.4 explosion')
  assert(panel.reanalyze === true, 'Reanalizar tempo is on the Metrónomo settings')
  assert(panel.reset === true, 'Resetear tempo is next to the mode chips')

  mkdirSync(SCREENSHOT_DIR, { recursive: true })
  const panelShot = await page.locator('[data-testid="metronome-settings"]').screenshot()
  writeFileSync(join(SCREENSHOT_DIR, 'tempo_sanitize_settings.png'), panelShot)
  await page.locator('[data-testid="metronome-settings"] .metro-settings-close').click()
  await page.evaluate(() => window.__musicaliaClips.setZoom(2))
  await page.waitForTimeout(120)
  const laneBox = await page.locator('[data-testid="metronome-lane"]').boundingBox()
  const rulerBox = await page.locator('[data-testid="bar-ruler"]').boundingBox()
  if (laneBox && rulerBox) {
    const shot = await page.screenshot({
      clip: {
        x: Math.max(0, rulerBox.x - 8),
        y: Math.max(0, rulerBox.y - 8),
        width: Math.min(1100, 1440 - rulerBox.x),
        height: Math.min(220, laneBox.y + laneBox.height - rulerBox.y + 20)
      }
    })
    writeFileSync(join(SCREENSHOT_DIR, 'tempo_sanitize_grid.png'), shot)
  }

  await page.click('[data-testid="metronome-settings-gear"]')
  await page.waitForSelector('[data-testid="reset-tempo"]')
  await page.click('[data-testid="reset-tempo"]')
  await page.waitForSelector('[data-testid="reset-tempo-dialog"]')
  await page.click('[data-testid="reset-tempo-confirm"]')
  await page.waitForFunction(() => window.__musicaliaMetronome.getState().tempoMapBeats === 0, { timeout: 5000 })
  const afterReset = await page.evaluate(() => {
    const state = window.__musicaliaMetronome.getState()
    return {
      followMode: state.followMode,
      tempoMapBeats: state.tempoMapBeats,
      phaseSeconds: state.phaseSeconds,
      markers: document.querySelectorAll('[data-testid^="tempo-marker-"]').length
    }
  })
  console.log('afterReset', afterReset)
  assert(afterReset.followMode === 'fixed', `Resetear switches to Tempo fijo (got ${afterReset.followMode})`)
  assert(afterReset.tempoMapBeats === 0, `Resetear clears the map (got ${afterReset.tempoMapBeats})`)
  assert(afterReset.phaseSeconds === 0, `Resetear clears phase (got ${afterReset.phaseSeconds})`)
  assert(afterReset.markers === 0, `Resetear removes markers (got ${afterReset.markers})`)
  const closeBtn = page.locator('[data-testid="metronome-settings"] .metro-settings-close')
  if (await closeBtn.count()) await closeBtn.click()
  const resetShot = await page.screenshot({
    clip: { x: 0, y: 0, width: 1440, height: 360 }
  })
  writeFileSync(join(SCREENSHOT_DIR, 'tempo_reset_fixed.png'), resetShot)
  console.log('screenshots', SCREENSHOT_DIR)
} finally {
  await browser.close()
  server.close()
}

if (failed > 0) {
  console.error(`\n${failed} assertion(s) failed`)
  process.exit(1)
}
console.log('\n✅ tempo sanitize Chromium check passed')
