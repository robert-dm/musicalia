/**
 * Headless Chromium: Metrónomo Duración chips, badge, and persist.
 *
 *   npm run build
 *   node scripts/verify-metro-duration-chrome.mjs
 */
import { createServer } from 'node:http'
import { createReadStream, existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { extname, join, resolve } from 'node:path'

const require = createRequire('/tmp/pw/package.json')
const { chromium } = require('playwright-core')

const ROOT = resolve(process.cwd())
const DIST = join(ROOT, 'dist')
const PORT = Number(process.env.VERIFY_PORT || 4210)
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

  const version = await page.locator('.version-label').textContent()
  assert((version || '').includes('0.0100b'), `UI is 0.0100b, got ${version}`)

  await page.locator('[data-testid="metronome-settings-gear"]').click()
  await page.waitForSelector('[data-testid="metronome-settings"]')
  await page.waitForSelector('[data-testid="click-duration-always"]')

  const alwaysOn = await page.locator('[data-testid="click-duration-always"]').getAttribute('aria-pressed')
  assert(alwaysOn === 'true', `Siempre is the default (got ${alwaysOn})`)
  assert(
    (await page.locator('[data-testid="metro-click-badge"]').count()) === 0,
    'Siempre hides the header badge'
  )

  await page.locator('[data-testid="click-duration-4"]').click()
  await page.waitForSelector('[data-testid="metro-click-badge"]')
  const badge = await page.locator('[data-testid="metro-click-badge"]').textContent()
  assert(badge === 'Clic: 4 compases', `badge after 4-bar chip, got ${badge}`)
  const state = await page.evaluate(() => window.__musicaliaMetronome.getState())
  assert(state.clickBars === 4, `persist 4 bars on the meter (got ${state.clickBars})`)
  assert(state.clickRepeatEachLoop === false, 'repeat-each-loop defaults off')
  assert(
    await page.locator('[data-testid="click-repeat-loop"]').isVisible(),
    'loop-repeat option appears when N is set'
  )

  mkdirSync(SCREENSHOT_DIR, { recursive: true })
  const panel = await page.locator('[data-testid="metronome-settings"]').screenshot()
  writeFileSync(join(SCREENSHOT_DIR, 'metro_click_duration.png'), panel)
  console.log('screenshots', SCREENSHOT_DIR)
} finally {
  await browser.close()
  server.close()
}

if (failed > 0) {
  console.error(`\n${failed} assertion(s) failed`)
  process.exit(1)
}
console.log('\n✅ metronome duration Chromium check passed')
