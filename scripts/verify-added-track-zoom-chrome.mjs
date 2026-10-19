/**
 * Headless Chromium: a user-added track clip must follow horizontal zoom
 * the same way a long stem-like clip does.
 *
 *   npm run build
 *   node scripts/verify-added-track-zoom-chrome.mjs
 */
import { createServer } from 'node:http'
import { createReadStream, existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { extname, join, resolve } from 'node:path'

const require = createRequire('/tmp/pw/package.json')
const { chromium } = require('playwright-core')

const ROOT = resolve(process.cwd())
const DIST = join(ROOT, 'dist')
const PORT = Number(process.env.VERIFY_PORT || 4212)
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

async function measure(id) {
  return page.evaluate((clipId) => {
    const wrap = document.querySelector(`[data-clip-id="${clipId}"]`)
    const host = wrap?.querySelector('[data-waveform-host]')
    const canvas = host?.querySelector('canvas')
    const inner = document.querySelector('[data-testid="lanes-scroll-inner"]')
    return {
      clipW: wrap?.getBoundingClientRect().width ?? 0,
      hostW: host?.getBoundingClientRect().width ?? 0,
      paintW: Number(host?.getAttribute('data-waveform-host-w') || 0),
      canvasCssW: canvas ? parseFloat(canvas.style.width || '0') : 0,
      zoom: Number(inner?.getAttribute('data-horizontal-zoom') || '0'),
      tiles: Number(host?.getAttribute('data-waveform-tiles') || 0)
    }
  }, id)
}

try {
  await page.goto(ORIGIN, { waitUntil: 'networkidle', timeout: 60000 })
  await page.waitForFunction(() => window.__musicaliaClips && window.__musicaliaMetronome, { timeout: 15000 })

  const version = await page.locator('.version-label').textContent()
  assert((version || '').includes('0.0101b'), `UI is 0.0101b, got ${version}`)

  const stem = await page.evaluate(async () => window.__musicaliaClips.seedWaveform())
  await page.waitForSelector(`[data-clip-id="${stem.id}"]`)

  const addedIndex = await page.evaluate(() => window.__musicaliaClips.addEmptyTrack())
  const added = await page.evaluate(
    async (idx) => window.__musicaliaClips.seedClipOnTrack(idx, 0.8),
    addedIndex
  )
  await page.waitForSelector(`[data-clip-id="${added.id}"]`)
  await page.waitForFunction((id) => {
    const host = document.querySelector(`[data-clip-id="${id}"] [data-waveform-host]`)
    return Number(host?.getAttribute('data-waveform-tiles') || '0') > 0
  }, added.id)

  const stem1 = await measure(stem.id)
  const added1 = await measure(added.id)
  console.log('zoom1', { stem1, added1 })
  assert(stem1.clipW > 200, `stem clip is wide at 1× (got ${stem1.clipW})`)
  assert(added1.clipW > 8, `added clip is visible at 1× (got ${added1.clipW})`)
  assert(added1.clipW < stem1.clipW * 0.8, 'added clip is shorter than the stem clip')

  await page.evaluate(() => window.__musicaliaClips.setZoom(4))
  await page.waitForFunction(() => {
    const el = document.querySelector('[data-testid="lanes-scroll-inner"]')
    return Math.abs(Number(el?.getAttribute('data-horizontal-zoom') || '0') - 4) < 1e-6
  })
  await page.waitForTimeout(200)

  const stem4 = await measure(stem.id)
  const added4 = await measure(added.id)
  console.log('zoom4', { stem4, added4 })

  const stemScale = stem4.clipW / stem1.clipW
  const addedScale = added4.clipW / added1.clipW
  const addedHostScale = added4.hostW / added1.hostW
  const addedPaintScale = added4.paintW / Math.max(1e-6, added1.paintW)
  assert(stemScale > 3.5 && stemScale < 4.5, `stem clip scales ~4× (got ${stemScale.toFixed(2)})`)
  assert(addedScale > 3.5 && addedScale < 4.5, `added clip box scales ~4× (got ${addedScale.toFixed(2)})`)
  assert(addedHostScale > 3.5 && addedHostScale < 4.5, `added waveform host scales ~4× (got ${addedHostScale.toFixed(2)})`)
  assert(addedPaintScale > 3.5 && addedPaintScale < 4.5, `added waveform paint width follows zoom (got ${addedPaintScale.toFixed(2)})`)
  assert(added4.tiles > 0, 'added clip still has waveform tiles after zoom')

  const saveBtn = page.locator('[data-testid="save-button"]')
  await page.evaluate(() => window.__musicaliaClips.clearUnsaved())
  await page.waitForFunction(() => {
    const el = document.querySelector('[data-testid="save-button"]')
    return el?.getAttribute('data-unsaved') === 'false'
  })
  assert((await saveBtn.getAttribute('data-unsaved')) === 'false', 'clean save button has no unsaved flag')
  assert(!(await saveBtn.evaluate((el) => el.classList.contains('unsaved'))), 'clean save has no underline class')
  assert(!(await saveBtn.textContent()).includes('•'), 'clean save has no dirty dot')

  await page.evaluate(() => window.__musicaliaClips.markUnsaved())
  await page.waitForFunction(() => {
    const el = document.querySelector('[data-testid="save-button"]')
    return el?.getAttribute('data-unsaved') === 'true'
  })
  assert((await saveBtn.getAttribute('data-unsaved')) === 'true', 'dirty save button is flagged')
  assert(await saveBtn.evaluate((el) => el.classList.contains('unsaved')), 'underline class appears with the dot')
  assert((await saveBtn.textContent()).includes('•'), 'dirty save shows the dot')
  assert(
    (await saveBtn.getAttribute('title')) === 'Cambios sin guardar · Cmd+S',
    'dirty save tooltip explains the underline'
  )

  async function headerSnapshot() {
    return page.evaluate(() => {
      const headers = [...document.querySelectorAll('.sidebar-scroll .track-header')]
      return headers.map((header, i) => {
        const lane = document.querySelector(`[data-testid="lane-stack-${i}"] .track-content`)
        const style = getComputedStyle(header)
        return {
          density: header.getAttribute('data-header-density'),
          headerH: header.getBoundingClientRect().height,
          laneH: lane?.getBoundingClientRect().height ?? 0,
          overflowY: style.overflowY,
          scrollH: header.scrollHeight,
          clientH: header.clientHeight,
          moreDisplay: getComputedStyle(header.querySelector('.header-more')).display,
          extraDisplay: getComputedStyle(header.querySelector('.header-extra')).display,
          volumeDisplay: getComputedStyle(header.querySelector('.header-volume')).display,
          labelMode: lane?.getAttribute('data-lane-density') || ''
        }
      })
    })
  }

  const tall = await headerSnapshot()
  console.log('headers tall', tall)
  for (const row of tall) {
    assert(row.density === 'tall', `default header density is tall (got ${row.density})`)
    assert(Math.abs(row.headerH - row.laneH) < 1.5, `tall header ${row.headerH} matches lane ${row.laneH}`)
    assert(row.overflowY === 'hidden', 'tall header clips overflow')
    assert(row.scrollH <= row.clientH + 1, `tall header does not overflow (scroll ${row.scrollH} vs ${row.clientH})`)
    assert(row.moreDisplay === 'none', '⋯ hidden on tall headers')
    assert(row.extraDisplay !== 'none', 'P / Aislar stay visible on tall headers')
    assert(row.labelMode === 'full', 'tall lanes show full clip labels')
  }

  await page.evaluate(() => window.__musicaliaClips.setVerticalZoom(0.7))
  await page.waitForFunction(() => {
    const el = document.querySelector('.track-header')
    return el?.getAttribute('data-header-density') === 'medium'
  })
  const medium = await headerSnapshot()
  console.log('headers medium', medium)
  for (const row of medium) {
    assert(row.density === 'medium', `0.7× header density is medium (got ${row.density})`)
    assert(Math.abs(row.headerH - row.laneH) < 1.5, `medium header ${row.headerH} matches lane ${row.laneH}`)
    assert(row.scrollH <= row.clientH + 1, 'medium header does not overflow')
    assert(row.moreDisplay !== 'none', '⋯ visible on medium headers')
    assert(row.extraDisplay === 'none', 'extra controls hide on medium headers')
    assert(row.volumeDisplay !== 'none', 'volume stays on medium headers')
    assert(row.labelMode === 'compact', 'medium lanes shrink clip labels')
  }

  await page.evaluate(() => window.__musicaliaClips.setVerticalZoom(0.5))
  await page.waitForFunction(() => {
    const el = document.querySelector('.track-header')
    return el?.getAttribute('data-header-density') === 'compact'
  })
  const compact = await headerSnapshot()
  console.log('headers compact', compact)
  for (const row of compact) {
    assert(row.density === 'compact', `0.5× header density is compact (got ${row.density})`)
    assert(Math.abs(row.headerH - row.laneH) < 1.5, `compact header ${row.headerH} matches lane ${row.laneH}`)
    assert(row.scrollH <= row.clientH + 1, 'compact header does not overflow')
    assert(row.moreDisplay === 'none', '⋯ hidden on compact headers')
    assert(row.volumeDisplay === 'none', 'volume hides on compact headers')
    assert(row.labelMode === 'hidden', 'compact lanes hide clip labels')
  }

  mkdirSync(SCREENSHOT_DIR, { recursive: true })
  const box = await page.locator(`[data-clip-id="${added.id}"]`).boundingBox()
  if (box) {
    const shot = await page.screenshot({
      clip: {
        x: Math.max(0, box.x - 8),
        y: Math.max(0, box.y - 8),
        width: Math.min(1100, box.width + 16),
        height: Math.min(160, box.height + 16)
      }
    })
    writeFileSync(join(SCREENSHOT_DIR, 'added_track_zoom.png'), shot)
  }
  const sidebar = await page.locator('.sidebar-scroll').screenshot()
  writeFileSync(join(SCREENSHOT_DIR, 'track_headers_compact.png'), sidebar)
  await page.evaluate(() => window.__musicaliaClips.setVerticalZoom(1))
  await page.waitForFunction(() => {
    const el = document.querySelector('.track-header')
    return el?.getAttribute('data-header-density') === 'tall'
  })
  writeFileSync(join(SCREENSHOT_DIR, 'track_headers_tall.png'), await page.locator('.sidebar-scroll').screenshot())
  writeFileSync(join(SCREENSHOT_DIR, 'guardar_unsaved.png'), await saveBtn.screenshot())
  console.log('screenshots', SCREENSHOT_DIR)
} finally {
  await browser.close()
  server.close()
}

if (failed > 0) {
  console.error(`\n${failed} assertion(s) failed`)
  process.exit(1)
}
console.log('\n✅ added-track zoom Chromium check passed')
