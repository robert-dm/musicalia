/**
 * Headless Chromium: 0.0095b save toolbar + Guardar como exist.
 *
 *   npm run build
 *   node scripts/verify-file-save-chrome.mjs
 */
import { createServer } from 'node:http'
import { createReadStream, existsSync, mkdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { extname, join, resolve } from 'node:path'

const require = createRequire('/tmp/pw/package.json')
const { chromium } = require('playwright-core')

const ROOT = resolve(process.cwd())
const DIST = join(ROOT, 'dist')
const PORT = Number(process.env.VERIFY_PORT || 4186)
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
  await page.waitForSelector('[data-testid="save-as-button"]')
  const version = await page.locator('.version-label').innerText()
  assert(version.includes('0.0095b'), `UI version is 0.0095b, got ${version}`)
  assert(await page.locator('[data-testid="save-button"]').count() === 1, 'Guardar button exists')
  const saveAs = page.locator('[data-testid="save-as-button"]')
  assert(await saveAs.count() === 1, 'Guardar como… menu item exists')
  assert((await saveAs.getAttribute('title') || '').includes('Guardar como'), 'Guardar como title is set')
  mkdirSync(SCREENSHOT_DIR, { recursive: true })
  const shot = join(SCREENSHOT_DIR, 'file-save-toolbar-0095b.png')
  await page.screenshot({ path: shot, fullPage: false })
  console.log('screenshot', shot)
} finally {
  await browser.close()
  server.close()
}

if (failed > 0) {
  console.error(`\n${failed} assertion(s) failed`)
  process.exit(1)
}
console.log('\n✅ file save Chromium check passed')
