/**
 * Headless Chromium: permanent Metrónomo track is muted by default,
 * unmuting schedules clicks on the beats, and only one click source exists.
 *
 *   npm run build
 *   node scripts/verify-metronome-track-chrome.mjs
 */
import { createServer } from 'node:http'
import { createReadStream, existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { extname, join, resolve } from 'node:path'

const require = createRequire('/tmp/pw/package.json')
const { chromium } = require('playwright-core')

const ROOT = resolve(process.cwd())
const DIST = join(ROOT, 'dist')
const PORT = Number(process.env.VERIFY_PORT || 4183)
const ORIGIN = `http://127.0.0.1:${PORT}`
const SCREENSHOT_DIR = '/opt/cursor/artifacts/screenshots'
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
  let file = url.pathname === '/' ? '/index.html' : url.pathname
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
  executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome',
  args: [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--autoplay-policy=no-user-gesture-required',
    '--allow-file-access-from-files'
  ]
})

const page = await browser.newPage({ viewport: { width: 1400, height: 900 } })
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

  const before = await page.evaluate(() => {
    const header = document.querySelector('[data-track-kind="metronome"]')
    const lane = document.querySelector('[data-testid="metronome-lane"]')
    const wave = document.querySelector('[data-testid="metronome-waveform"]')
    const mute = header?.querySelector('.mute-button')
    return {
      headerKind: header?.getAttribute('data-track-kind'),
      name: header?.querySelector('.track-name')?.textContent?.trim(),
      mutePressed: mute?.getAttribute('aria-pressed'),
      lane: !!lane,
      waveform: !!wave,
      waveBpm: wave?.getAttribute('data-bpm'),
      state: window.__musicaliaMetronome.getState()
    }
  })
  console.log('before', JSON.stringify(before))
  assert(before.headerKind === 'metronome', 'metronome track lane exists')
  assert(before.name === 'Metrónomo', 'track is named Metrónomo')
  assert(before.mutePressed === 'true', 'M button is pressed (muted) by default')
  assert(before.state.mute === true, 'API reports muted by default')
  assert(before.state.toolbarOn === false, 'toolbar is off while muted')
  assert(before.state.overlayPlayer === false, 'no separate overlay click player')
  assert(before.state.clickSource === 'none', 'no click source while muted')
  assert(before.lane && before.waveform, 'waveform canvas is drawn on the lane')

  await page.evaluate(async () => {
    window.__musicaliaMetronome.unmute()
    await window.__musicaliaMetronome.play()
    await new Promise((r) => setTimeout(r, 250))
  })

  const playing = await page.evaluate(() => window.__musicaliaMetronome.getState())
  console.log('playing', JSON.stringify({
    mute: playing.mute,
    toolbarOn: playing.toolbarOn,
    clickSource: playing.clickSource,
    scheduled: playing.scheduled.slice(0, 8)
  }))
  assert(playing.mute === false && playing.toolbarOn === true, 'unmuting turns the toolbar on')
  assert(playing.clickSource === 'track', 'the only click source is the track')
  assert(playing.overlayPlayer === false, 'overlay player stays absent after play')
  assert(playing.scheduled.length >= 4, 'clicks are scheduled across the song')
  const first = playing.scheduled.slice(0, 4).map((c) => Number(c.songTime.toFixed(4)))
  assert(first[0] === 0 && first[1] === 0.5 && first[2] === 1 && first[3] === 1.5, `clicks on 120 BPM beats, got ${first}`)
  assert(playing.scheduled[0].accent === true && playing.scheduled[1].accent === false, 'accent on beat 1')
  const sources = await page.evaluate(() => {
    const destPlayers = [...document.querySelectorAll('[data-track-kind="metronome"]')]
    return {
      metroHeaders: destPlayers.length,
      clickSource: window.__musicaliaMetronome.getState().clickSource
    }
  })
  assert(sources.metroHeaders === 2, 'one header + one lane for the metronome')
  assert(sources.clickSource === 'track', 'still a single click source after play')

  await page.evaluate(() => document.querySelector('[data-testid="metronome-toolbar"]')?.click())
  const afterToolbar = await page.evaluate(() => window.__musicaliaMetronome.getState())
  assert(afterToolbar.mute === true && afterToolbar.toolbarOn === false, 'toolbar click remutes the same track')
  assert(afterToolbar.clickSource === 'none', 'muting clears the click source')

  await page.evaluate(() => window.__musicaliaMetronome.unmute())
  const shot = await page.locator('[data-testid="metronome-lane"]').screenshot()
  mkdirSync(SCREENSHOT_DIR, { recursive: true })
  const shotPath = join(SCREENSHOT_DIR, 'metronome-track-waveform.png')
  writeFileSync(shotPath, shot)
  console.log('screenshot', shotPath)
} finally {
  await browser.close()
  server.close()
}

if (failed > 0) {
  console.error(`\n${failed} assertion(s) failed`)
  process.exit(1)
}
console.log('\n✅ metronome track Chromium check passed')
