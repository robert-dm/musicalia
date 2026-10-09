import { mkdirSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import handler from 'serve-handler'
import puppeteer from 'puppeteer'

const root = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist')
const shotDir = '/opt/cursor/artifacts/screenshots'
mkdirSync(shotDir, { recursive: true })

const server = createServer((req, res) => handler(req, res, { public: root }))
await new Promise((resolve) => server.listen(4177, resolve))
const url = 'http://127.0.0.1:4177/'

const browser = await puppeteer.launch({
  headless: 'new',
  args: ['--no-sandbox', '--disable-setuid-sandbox', '--use-fake-ui-for-media-stream']
})

const page = await browser.newPage()
await page.setViewport({ width: 1440, height: 900 })
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
  await page.goto(url, { waitUntil: 'networkidle0', timeout: 60000 })
  await page.waitForSelector('[data-testid="add-drum-track"]', { timeout: 15000 })

  await page.evaluate(async () => {
    const api = window.__musicaliaDrums
    if (!api) throw new Error('drum API missing')
    await api.addDrumTrack()
    api.programBasicBeat()
    api.openEditor()
  })

  await page.waitForSelector('[data-testid="drum-editor"]', { timeout: 15000 })
  await page.screenshot({ path: join(shotDir, 'drum-editor-pads.png'), fullPage: true })

  const before = await page.evaluate(() => window.__musicaliaDrums.getSnapshot())
  assert(before.length >= 1, 'drum track exists')
  assert(before[0].padLoaded.filter(Boolean).length >= 8, 'starter kit loaded on 8 pads')
  assert(before[0].patternA[0][0] === 3, 'kick programmed')
  assert(before[0].patternA[1][4] === 3, 'snare programmed')

  await page.evaluate(async () => {
    await window.__musicaliaDrums.play()
  })

  await page.waitForFunction(() => (window.__musicaliaDrumSchedule || []).length > 0, { timeout: 8000 })
  const schedule = await page.evaluate(() => window.__musicaliaDrumSchedule || window.__musicaliaDrums.getSchedule())
  const firstBar = schedule.filter((e) => e.songTime >= 0 && e.songTime < 2)
  const kicks = firstBar.filter((e) => e.padIndex === 0).map((e) => e.songTime)
  const snares = firstBar.filter((e) => e.padIndex === 1).map((e) => e.songTime)
  console.log('schedule first bar', JSON.stringify(firstBar.map((e) => ({ p: e.padIndex, t: e.songTime, tr: e.transportTime }))))
  assert(kicks.length === 4, `4 kicks in first bar, got ${kicks.length}`)
  assert(snares.length === 2, `2 snares in first bar, got ${snares.length}`)
  assert(Math.abs((kicks[1] ?? -1) - 0.5) < 1e-6, `second kick at 0.5, got ${kicks[1]}`)
  assert(firstBar.every((e) => Math.abs(e.transportTime - e.songTime) < 1e-6), 'transport times match song times at 1x 120 BPM')

  await page.screenshot({ path: join(shotDir, 'drum-editor-playing.png'), fullPage: true })

  await page.evaluate(async () => {
    await window.__musicaliaDrums.flushAutosave()
  })
  await page.reload({ waitUntil: 'networkidle0', timeout: 60000 })
  await page.waitForFunction(() => (window.__musicaliaDrums?.getSnapshot()?.length || 0) >= 1, { timeout: 20000 })
  const after = await page.evaluate(() => window.__musicaliaDrums.getSnapshot())
  assert(after[0]?.padNames?.[0] === 'Bombo', 'reopened pad name')
  assert(after[0]?.patternA?.[0]?.[0] === 3, 'reopened kick step')
  assert(after[0]?.patternA?.[1]?.[4] === 3, 'reopened snare step')
  assert(after[0]?.padLoaded?.filter(Boolean).length >= 8, 'reopened starter buffers')

  await page.evaluate(() => window.__musicaliaDrums.openEditor())
  await page.waitForSelector('[data-testid="drum-editor"]', { timeout: 10000 })
  await page.screenshot({ path: join(shotDir, 'drum-editor-reopened.png'), fullPage: true })

  writeFileSync('/tmp/drum-e2e-result.json', JSON.stringify({ failed, before, after, firstBar }, null, 2))
} finally {
  await browser.close()
  server.close()
}

if (failed > 0) {
  console.error(`\n${failed} e2e assertion(s) failed`)
  process.exit(1)
}
console.log('\n✅ drum e2e passed')
