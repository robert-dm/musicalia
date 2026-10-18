/**
 * Headless Chromium: BPM decimals / ×2 ÷2 TAP, metronome settings, align.
 *
 *   npm run build
 *   node scripts/verify-metronome-bpm-chrome.mjs
 */
import { createServer } from 'node:http'
import { createReadStream, existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { extname, join, resolve } from 'node:path'

const require = createRequire('/tmp/pw/package.json')
const { chromium } = require('playwright-core')

const ROOT = resolve(process.cwd())
const DIST = join(ROOT, 'dist')
const PORT = Number(process.env.VERIFY_PORT || 4193)
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

try {
  await page.goto(ORIGIN, { waitUntil: 'networkidle', timeout: 60000 })
  await page.waitForFunction(() => window.__musicaliaMetronome, { timeout: 15000 })

  const toolbar = await page.evaluate(() => ({
    input: !!document.querySelector('[data-testid="bpm-input"]'),
    half: !!document.querySelector('[data-testid="bpm-half"]'),
    double: !!document.querySelector('[data-testid="bpm-double"]'),
    tap: !!document.querySelector('[data-testid="bpm-tap"]'),
    gear: !!document.querySelector('[data-testid="metronome-settings-gear"]'),
    step: document.querySelector('[data-testid="bpm-input"]')?.getAttribute('step'),
    bpm: window.__musicaliaMetronome.getState().bpm
  }))
  console.log('toolbar', toolbar)
  assert(toolbar.input && toolbar.half && toolbar.double && toolbar.tap, 'BPM ×2 ÷2 TAP are next to the field')
  assert(toolbar.gear, 'gear is on the Metrónomo header')
  assert(toolbar.step === '0.1', 'BPM input allows tenths')

  await page.evaluate(() => window.__musicaliaMetronome.setBpm(76))
  await page.click('[data-testid="bpm-double"]')
  const doubled = await page.evaluate(() => window.__musicaliaMetronome.getState().bpm)
  assert(doubled === 152, `×2 76 → 152, got ${doubled}`)

  await page.click('[data-testid="bpm-half"]')
  const halved = await page.evaluate(() => window.__musicaliaMetronome.getState().bpm)
  assert(halved === 76, `÷2 152 → 76, got ${halved}`)

  await page.evaluate(() => window.__musicaliaMetronome.setBpm(117.5))
  await page.waitForFunction(() => {
    const api = window.__musicaliaMetronome.getState()
    const value = document.querySelector('[data-testid="bpm-input"]')?.value
    return api.bpm === 117.5 && value === '117.5'
  }, { timeout: 4000 })
  const decimal = await page.evaluate(() => ({
    bpm: window.__musicaliaMetronome.getState().bpm,
    value: document.querySelector('[data-testid="bpm-input"]')?.value
  }))
  assert(decimal.bpm === 117.5 && decimal.value === '117.5', `decimal BPM 117.5, got ${JSON.stringify(decimal)}`)

  await page.click('[data-testid="metronome-settings-gear"]')
  await page.waitForSelector('[data-testid="metronome-settings"]')
  const panel = await page.evaluate(() => ({
    presets: [...document.querySelectorAll('[data-testid^="meter-preset-"]')].map((el) => el.textContent.trim()),
    accent: document.querySelector('[data-testid="accent-downbeat"]')?.checked,
    sounds: ['wood', 'beep', 'rim'].every((s) => document.querySelector(`[data-testid="click-sound-${s}"]`)),
    subs: ['none', 'eighths', 'triplets', 'sixteenths'].every((s) => document.querySelector(`[data-testid="subdivision-${s}"]`)),
    align: !!document.querySelector('[data-testid="align-metronome"]')
  }))
  console.log('panel', panel)
  assert(panel.presets.join(',') === '4/4,3/4,2/4,6/8,5/4,7/8,12/8', 'compás presets')
  assert(panel.accent === true, 'Acentuar el 1 starts on')
  assert(panel.sounds && panel.subs && panel.align, 'subdivision, sounds, and align are present')

  await page.click('[data-testid="meter-preset-3-4"]')
  const threeFour = await page.evaluate(() => {
    const wave = document.querySelector('[data-testid="metronome-waveform"]')
    const meter = window.__musicaliaMetronome.getState().meter
    return {
      sig: wave?.getAttribute('data-time-signature'),
      numerator: meter.numerator,
      denominator: meter.denominator
    }
  })
  assert(threeFour.sig === '3/4' && threeFour.numerator === 3, `waveform follows 3/4, got ${JSON.stringify(threeFour)}`)

  await page.click('[data-testid="meter-preset-6-8"]')
  await page.waitForSelector('[data-testid="compound-dotted"]')
  await page.click('[data-testid="compound-eighth"]')
  const sixEight = await page.evaluate(() => window.__musicaliaMetronome.getState().meter)
  assert(sixEight.numerator === 6 && sixEight.compoundPulse === 'eighth', '6/8 can click on 8ths')

  await page.click('[data-testid="click-sound-wood"]')
  await page.click('[data-testid="subdivision-eighths"]')
  await page.evaluate(() => window.__musicaliaMetronome.alignAt(0.12))
  const aligned = await page.evaluate(() => window.__musicaliaMetronome.getState().meter)
  assert(Math.abs(aligned.phaseSeconds - 0.12) < 1e-6, `align sets phase, got ${aligned.phaseSeconds}`)
  assert(aligned.clickSound === 'wood' && aligned.subdivision === 'eighths', 'sound and subdivision persist on the track')

  mkdirSync(SCREENSHOT_DIR, { recursive: true })
  const toolbarShot = await page.locator('[data-testid="bpm-control"]').screenshot()
  writeFileSync(join(SCREENSHOT_DIR, 'metronome-bpm-toolbar.png'), toolbarShot)
  const panelShot = await page.locator('[data-testid="metronome-settings"]').screenshot()
  writeFileSync(join(SCREENSHOT_DIR, 'metronome-settings-panel.png'), panelShot)
  const laneShot = await page.locator('[data-testid="metronome-lane"]').screenshot()
  writeFileSync(join(SCREENSHOT_DIR, 'metronome-lane-68.png'), laneShot)
  console.log('screenshots', SCREENSHOT_DIR)
} finally {
  await browser.close()
  server.close()
}

if (failed > 0) {
  console.error(`\n${failed} assertion(s) failed`)
  process.exit(1)
}
console.log('\n✅ metronome BPM Chromium check passed')
