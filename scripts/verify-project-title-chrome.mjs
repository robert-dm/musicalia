/**
 * Headless Chromium: project title, dirty dot, tab title, inline rename.
 *
 *   npm run build
 *   node scripts/verify-project-title-chrome.mjs
 */
import { createServer } from 'node:http'
import { createReadStream, existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { extname, join, resolve } from 'node:path'

const require = createRequire('/tmp/pw/package.json')
const { chromium } = require('playwright-core')

const ROOT = resolve(process.cwd())
const DIST = join(ROOT, 'dist')
const PORT = Number(process.env.VERIFY_PORT || 4191)
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
  await page.waitForFunction(() => window.__musicaliaClips, { timeout: 15000 })
  await page.waitForSelector('[data-testid="project-title-name"]')

  const untitled = await page.evaluate(() => ({
    name: window.__musicaliaClips.getProjectTitle(),
    dirty: window.__musicaliaClips.isProjectDirty(),
    tab: window.__musicaliaClips.getTabTitle(),
    label: document.querySelector('[data-testid="project-title-name"]')?.textContent
  }))
  console.log('untitled', untitled)
  assert(untitled.name === 'Sin título', 'new project displays Sin título')
  assert(untitled.label === 'Sin título', 'header button shows Sin título')
  assert(untitled.tab === 'Sin título — Musicalia', 'tab title is Sin título — Musicalia')
  assert(untitled.dirty === false, 'new project starts clean')

  mkdirSync(SCREENSHOT_DIR, { recursive: true })
  const header = page.locator('.app-titlebar')
  await header.screenshot({ path: join(SCREENSHOT_DIR, 'project-title-untitled.png') })
  await page.screenshot({ path: join(SCREENSHOT_DIR, 'project-title-untitled-app.png'), fullPage: false })

  await page.mouse.click(200, 80)
  await page.evaluate(async () => window.__musicaliaClips.seedGrid())
  await page.waitForSelector('[data-testid="clip-wrapper"]')
  await page.waitForFunction(() => window.__musicaliaClips.isProjectDirty(), { timeout: 8000 })
  const dirty = await page.evaluate(() => ({
    dirty: window.__musicaliaClips.isProjectDirty(),
    tab: window.__musicaliaClips.getTabTitle(),
    dot: !!document.querySelector('[data-testid="project-title-dirty"]')
  }))
  console.log('dirty', dirty)
  assert(dirty.dirty && dirty.dot, 'edits show the unsaved •')
  assert(dirty.tab === '• Sin título — Musicalia', 'dirty tab title prefixes •')
  await header.screenshot({ path: join(SCREENSHOT_DIR, 'project-title-dirty.png') })

  await page.locator('[data-testid="project-title-name"]').dblclick()
  const input = page.locator('[data-testid="project-title-input"]')
  await input.waitFor()
  await input.fill('Tema demo')
  await input.press('Enter')
  await page.waitForFunction(() => window.__musicaliaClips.getProjectTitle() === 'Tema demo')
  const renamed = await page.evaluate(() => ({
    name: window.__musicaliaClips.getProjectTitle(),
    tab: window.__musicaliaClips.getTabTitle(),
    label: document.querySelector('[data-testid="project-title-name"]')?.textContent,
    tooltip: document.querySelector('[data-testid="project-title"]')?.getAttribute('title')
  }))
  console.log('renamed', renamed)
  assert(renamed.name === 'Tema demo' && renamed.label === 'Tema demo', 'Enter commits the inline rename')
  assert(renamed.tab.startsWith('• Tema demo'), 'tab title follows the new name')
  assert((renamed.tooltip || '').includes('Tema demo'), 'tooltip suggests the .musicalia file name')
  await header.screenshot({ path: join(SCREENSHOT_DIR, 'project-title-renamed.png') })
  await page.screenshot({ path: join(SCREENSHOT_DIR, 'project-title-renamed-app.png'), fullPage: false })

  await page.locator('[data-testid="project-title-name"]').dblclick()
  await page.locator('[data-testid="project-title-input"]').fill('Descartar')
  await page.keyboard.press('Escape')
  const afterEsc = await page.evaluate(() => window.__musicaliaClips.getProjectTitle())
  assert(afterEsc === 'Tema demo', 'Esc cancels the inline rename')

  await page.evaluate(() => window.__musicaliaClips.markProjectClean())
  await page.waitForFunction(() => window.__musicaliaClips.isProjectDirty() === false)
  const clean = await page.evaluate(() => ({
    dirty: window.__musicaliaClips.isProjectDirty(),
    tab: window.__musicaliaClips.getTabTitle(),
    dot: !!document.querySelector('[data-testid="project-title-dirty"]')
  }))
  assert(!clean.dirty && !clean.dot, 'successful save clears the •')
  assert(clean.tab === 'Tema demo — Musicalia', 'clean tab title drops the •')
  await header.screenshot({ path: join(SCREENSHOT_DIR, 'project-title-saved.png') })

  writeFileSync(join(SCREENSHOT_DIR, 'project-title.json'), JSON.stringify({
    untitled, dirty, renamed, afterEsc, clean
  }, null, 2))
} finally {
  await browser.close()
  server.close()
}

if (failed > 0) {
  console.error(`\n${failed} assertion(s) failed`)
  process.exit(1)
}
console.log('\n✅ project title Chromium check passed')
