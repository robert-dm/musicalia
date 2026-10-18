/**
 * Headless Chromium: tempo-map mode toggle, beat markers, and follow clicks.
 *
 *   npm run build
 *   node scripts/verify-tempo-map-chrome.mjs
 */
import { createServer } from 'node:http'
import { createReadStream, existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { extname, join, resolve } from 'node:path'

const require = createRequire('/tmp/pw/package.json')
const { chromium } = require('playwright-core')

const ROOT = resolve(process.cwd())
const DIST = join(ROOT, 'dist')
const PORT = Number(process.env.VERIFY_PORT || 4195)
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
  await page.waitForFunction(() => window.__musicaliaMetronome, { timeout: 15000 })

  await page.click('[data-testid="metronome-settings-gear"]')
  await page.waitForSelector('[data-testid="metronome-settings"]')
  const emptyPanel = await page.evaluate(() => ({
    fixed: document.querySelector('[data-testid="tempo-mode-fixed"]')?.textContent?.trim(),
    follow: document.querySelector('[data-testid="tempo-mode-follow"]')?.textContent?.trim(),
    followDisabled: document.querySelector('[data-testid="tempo-mode-follow"]')?.disabled,
    local: !!document.querySelector('[data-testid="local-bpm-readout"]')
  }))
  assert(emptyPanel.fixed === 'Tempo fijo' && emptyPanel.follow === 'Seguir la canción', 'mode chips are present')
  assert(emptyPanel.followDisabled === true, 'Seguir la canción waits for a beat grid')
  assert(emptyPanel.local === false, 'local BPM is hidden until a map exists')

  const injected = await page.evaluate(() => {
    const times = [0, 0.372, 0.76, 1.16, 1.57, 1.99, 2.42]
    return window.__musicaliaMetronome.setTempoMap({
      beats: times.map((time, index) => ({ id: `beat-${index}`, time, pinned: false })),
      downbeatIndex: 0,
      globalBpm: 156,
      sourceDuration: 3
    })
  })
  assert(injected === true, 'debug API accepts a tempo map')

  await page.waitForSelector('[data-testid="tempo-map-overlay"]')
  const afterMap = await page.evaluate(() => {
    const state = window.__musicaliaMetronome.getState()
    const followBtn = document.querySelector('[data-testid="tempo-mode-follow"]')
    return {
      beats: state.tempoMapBeats,
      followMode: state.followMode,
      followDisabled: followBtn?.disabled,
      followPressed: followBtn?.getAttribute('aria-pressed'),
      local: document.querySelector('[data-testid="local-bpm-readout"]')?.textContent?.trim(),
      markers: document.querySelectorAll('[data-testid^="tempo-marker-"]').length,
      waveFollow: document.querySelector('[data-testid="metronome-waveform"]')?.getAttribute('data-follow')
    }
  })
  console.log('afterMap', afterMap)
  assert(afterMap.beats === 7, `grid has 7 beats, got ${afterMap.beats}`)
  assert(afterMap.followMode === 'follow' && afterMap.followPressed === 'true', 'Seguir la canción is default once a grid exists')
  assert(afterMap.followDisabled === false, 'follow chip enables when a grid exists')
  assert((afterMap.local || '').includes('BPM'), `local BPM readout, got ${afterMap.local}`)
  assert(afterMap.markers >= 5, `lane shows tempo markers, got ${afterMap.markers}`)
  assert(afterMap.waveFollow === 'follow', 'waveform is in follow mode')

  await page.evaluate(() => window.__musicaliaMetronome.unmute())
  await page.evaluate(() => window.__musicaliaMetronome.play())
  await page.waitForTimeout(200)
  const followSched = await page.evaluate(() =>
    window.__musicaliaMetronome.getSchedule().slice(0, 4).map((c) => Number(c.songTime.toFixed(3)))
  )
  assert(followSched[0] === 0 && followSched[1] === 0.372, `follow clicks use the grid, got ${followSched}`)

  await page.click('[data-testid="tempo-mode-fixed"]')
  await page.waitForTimeout(80)
  const fixed = await page.evaluate(() => ({
    followMode: window.__musicaliaMetronome.getState().followMode,
    overlay: !!document.querySelector('[data-testid="tempo-map-overlay"]'),
    waveFollow: document.querySelector('[data-testid="metronome-waveform"]')?.getAttribute('data-follow')
  }))
  assert(fixed.followMode === 'fixed' && fixed.overlay === false, 'Tempo fijo hides the map handles')
  assert(fixed.waveFollow === 'fixed', 'waveform switches to fixed')

  await page.click('[data-testid="tempo-mode-follow"]')
  mkdirSync(SCREENSHOT_DIR, { recursive: true })
  const panelShot = await page.locator('[data-testid="metronome-settings"]').screenshot()
  writeFileSync(join(SCREENSHOT_DIR, 'tempo-map-settings.png'), panelShot)

  await page.locator('[data-testid="metronome-settings"] .metro-settings-close').click()
  await page.waitForSelector('[data-testid="metronome-settings"]', { state: 'hidden' })
  await page.evaluate(() => window.__musicaliaClips?.setZoom(48))
  await page.waitForTimeout(120)
  await page.waitForSelector('[data-testid="tempo-marker-1"]')
  await page.locator('[data-testid="tempo-marker-1"]').click({ button: 'right', force: true })
  await page.waitForSelector('[data-testid="tempo-marker-menu"]')
  const menu = await page.evaluate(() =>
    [...document.querySelectorAll('[data-testid="tempo-marker-menu"] button')].map((el) => el.textContent.trim())
  )
  assert(menu.includes('Agregar marca de tempo'), 'context menu can add a mark')
  assert(menu.includes('Borrar marca'), 'context menu can delete a mark')
  assert(menu.includes('Poner el 1 acá'), 'context menu can set the downbeat')

  const menuShot = await page.locator('[data-testid="tempo-marker-menu"]').screenshot()
  writeFileSync(join(SCREENSHOT_DIR, 'tempo-map-marker-menu.png'), menuShot)
  await page.mouse.click(8, 8)
  await page.evaluate(() => window.__musicaliaClips?.setZoom(20))
  await page.waitForTimeout(120)
  const laneBox = await page.locator('[data-testid="metronome-lane"]').boundingBox()
  if (laneBox) {
    const laneShot = await page.screenshot({
      clip: {
        x: Math.max(0, laneBox.x),
        y: Math.max(0, laneBox.y - 28),
        width: Math.min(laneBox.width, 1100),
        height: laneBox.height + 36
      }
    })
    writeFileSync(join(SCREENSHOT_DIR, 'tempo-map-lane.png'), laneShot)
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
console.log('\n✅ tempo map Chromium check passed')
