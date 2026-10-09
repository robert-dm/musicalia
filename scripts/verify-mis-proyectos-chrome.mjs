/**
 * Headless Chromium: sign in (mocked auth), save a local project, see it in
 * Mis proyectos, reopen from the list.
 *
 *   npx vite preview --host 127.0.0.1 --port 4177 --outDir dist
 *   node scripts/verify-mis-proyectos-chrome.mjs
 */
import { createServer } from 'node:http'
import { createReadStream, existsSync } from 'node:fs'
import { mkdir, writeFile, stat } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { extname, join, resolve } from 'node:path'

const require = createRequire('/tmp/pw/package.json')
const { chromium } = require('playwright-core')

const ROOT = resolve(process.cwd())
const DIST = join(ROOT, 'dist')
const PORT = Number(process.env.VERIFY_PORT || 4177)
const ORIGIN = `http://127.0.0.1:${PORT}`
const SCREENSHOT_DIR = process.env.SCREENSHOT_DIR || '/opt/cursor/artifacts/screenshots'
const SCREENSHOT = join(SCREENSHOT_DIR, 'mis-proyectos-list-signed-in.png')

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.wasm': 'application/wasm',
  '.png': 'image/png',
  '.woff2': 'font/woff2'
}

function pcmWav(seconds = 0.25, sampleRate = 44100) {
  const n = Math.floor(sampleRate * seconds)
  const data = Buffer.alloc(n * 2)
  for (let i = 0; i < n; i++) {
    const s = Math.sin((2 * Math.PI * 440 * i) / sampleRate)
    data.writeInt16LE(Math.round(s * 8000), i * 2)
  }
  const header = Buffer.alloc(44)
  header.write('RIFF', 0)
  header.writeUInt32LE(36 + data.length, 4)
  header.write('WAVE', 8)
  header.write('fmt ', 12)
  header.writeUInt32LE(16, 16)
  header.writeUInt16LE(1, 20)
  header.writeUInt16LE(1, 22)
  header.writeUInt32LE(sampleRate, 24)
  header.writeUInt32LE(sampleRate * 2, 28)
  header.writeUInt16LE(2, 32)
  header.writeUInt16LE(16, 34)
  header.write('data', 36)
  header.writeUInt32LE(data.length, 40)
  return Buffer.concat([header, data])
}

async function serveDist() {
  const server = createServer(async (req, res) => {
    const url = new URL(req.url || '/', ORIGIN)
    let filePath = join(DIST, decodeURIComponent(url.pathname))
    if (url.pathname === '/' || !extname(url.pathname)) {
      filePath = join(DIST, 'index.html')
    }
    try {
      const info = await stat(filePath)
      if (!info.isFile()) throw new Error('not a file')
      res.writeHead(200, { 'content-type': MIME[extname(filePath)] || 'application/octet-stream' })
      createReadStream(filePath).pipe(res)
    } catch {
      res.writeHead(404)
      res.end('not found')
    }
  })
  await new Promise((resolve) => server.listen(PORT, '127.0.0.1', resolve))
  return server
}

const INIT = `
(() => {
  window.__musicaliaFiles = new Map();
  window.alert = (msg) => { window.__lastAlert = String(msg || ''); return true; };
  window.confirm = (msg) => { window.__lastConfirm = String(msg || ''); return true; };

  const makeHandle = (name, blob) => {
    const handle = {
      name,
      kind: 'file',
      _blob: blob,
      async getFile() {
        const b = handle._blob || window.__musicaliaFiles.get(name);
        return new File([b], name, { type: 'application/x-musicalia' });
      },
      async createWritable() {
        const chunks = [];
        return {
          async write(data) { chunks.push(data); },
          async close() {
            const next = new Blob(chunks, { type: 'application/x-musicalia' });
            handle._blob = next;
            window.__musicaliaFiles.set(name, next);
          }
        };
      },
      async queryPermission() { return 'granted'; },
      async requestPermission() { return 'granted'; }
    };
    return handle;
  };

  window.showSaveFilePicker = async (opts = {}) => {
    const name = opts.suggestedName || 'Proyecto_sin_titulo.musicalia';
    const handle = makeHandle(name, new Blob());
    window.__lastSaveHandle = handle;
    return handle;
  };
  window.showOpenFilePicker = async () => {
    const handle = window.__lastSaveHandle;
    if (!handle) throw Object.assign(new Error('cancelled'), { name: 'AbortError' });
    return [handle];
  };
})();
`

async function main() {
  if (!existsSync(join(DIST, 'index.html'))) {
    throw new Error('dist/ missing — run npm run build first')
  }
  const server = await serveDist()
  const browser = await chromium.launch({
    executablePath: process.env.CHROME || '/usr/bin/google-chrome-stable',
    headless: true,
    args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage']
  })
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  page.on('pageerror', (err) => console.error('[pageerror]', err.message))
  page.on('console', (msg) => {
    if (msg.type() === 'error') console.error('[console.error]', msg.text())
  })

  const registry = { entries: [] }
  const user = { id: 'user-verify-1', username: 'Roberto', email: 'roberto@example.com' }
  const token = 'mock-token-0087b'

  await page.route('**/api/**', async (route) => {
    const req = route.request()
    const url = new URL(req.url())
    const method = req.method()
    const path = url.pathname
    const json = (status, body) => route.fulfill({
      status,
      contentType: 'application/json',
      body: JSON.stringify(body)
    })
    if (path === '/api/login' && method === 'POST') {
      return json(200, { token, user })
    }
    if (path === '/api/me') {
      const auth = req.headers().authorization || ''
      if (!auth.includes(token)) return json(401, { error: 'No autenticado' })
      return json(200, { user })
    }
    if (path === '/api/project-registry') {
      const auth = req.headers().authorization || ''
      if (!auth.includes(token)) return json(401, { error: 'No autenticado' })
      if (method === 'GET') return json(200, { entries: registry.entries })
      if (method === 'PUT') {
        const incoming = JSON.parse(req.postData() || '{}')
        const idx = registry.entries.findIndex((e) => e.id === incoming.id)
        if (idx < 0) registry.entries = [incoming, ...registry.entries]
        else {
          const prev = registry.entries[idx]
          const merged = {
            ...prev,
            ...incoming,
            locationNote: incoming.locationNote ? incoming.locationNote : prev.locationNote
          }
          registry.entries.splice(idx, 1)
          registry.entries = [merged, ...registry.entries]
        }
        return json(200, { entries: registry.entries })
      }
      if (method === 'PATCH') {
        const body = JSON.parse(req.postData() || '{}')
        registry.entries = registry.entries.map((e) => (
          e.id === body.id ? { ...e, locationNote: String(body.locationNote || '').trim() } : e
        ))
        return json(200, { entries: registry.entries })
      }
      if (method === 'DELETE') {
        const id = url.searchParams.get('id')
        registry.entries = registry.entries.filter((e) => e.id !== id)
        return json(200, { entries: registry.entries })
      }
    }
    return json(404, { error: 'not mocked' })
  })

  await page.addInitScript(INIT)
  await page.goto(ORIGIN, { waitUntil: 'networkidle' })
  await page.getByTitle('Iniciar sesión').click()
  await page.getByPlaceholder('Email').fill('roberto@example.com')
  await page.getByPlaceholder('Contraseña').fill('secret-1')
  await page.getByRole('button', { name: 'Iniciar sesión' }).click()
  await page.getByText('Roberto', { exact: true }).waitFor({ timeout: 10000 })

  const wavPath = join('/tmp', 'mis-proyectos-tone.wav')
  await writeFile(wavPath, pcmWav())
  await page.locator('input[accept*="audio"]').first().setInputFiles(wavPath)
  await page.getByRole('button', { name: 'No, una sola pista' }).click()
  await page.waitForTimeout(1500)

  await page.getByTitle(/Guardar proyecto/).click()
  await page.getByText(/Proyecto guardado/i).waitFor({ timeout: 30000 })

  const dismiss = page.locator('.error-toast button')
  if (await dismiss.count()) await dismiss.click().catch(() => {})
  await page.getByTestId('my-projects-button').click()
  const row = page.getByTestId('my-projects-row')
  await row.waitFor({ timeout: 10000 })
  const rowText = await row.innerText()
  if (!/BPM/.test(rowText) || !/pistas/.test(rowText)) {
    throw new Error(`List row missing BPM/pistas: ${rowText}`)
  }
  if (!/\.musicalia/.test(rowText)) {
    throw new Error(`List row missing file name: ${rowText}`)
  }

  await mkdir(SCREENSHOT_DIR, { recursive: true })
  await page.screenshot({ path: SCREENSHOT, fullPage: true })
  console.log('screenshot', SCREENSHOT)

  const savedId = await page.getAttribute('[data-testid="my-projects-row"]', 'data-project-id')
  await page.getByTestId('my-projects-open').click()
  await page.getByText(/Proyecto cargado/i).waitFor({ timeout: 30000 })
  const modalGone = await page.getByTestId('my-projects-modal').count()
  if (modalGone !== 0) throw new Error('modal still open after Abrir')

  await page.getByTestId('my-projects-button').click()
  await page.getByTestId('my-projects-row').waitFor({ timeout: 10000 })
  const againId = await page.getAttribute('[data-testid="my-projects-row"]', 'data-project-id')
  if (savedId && againId && savedId !== againId) {
    throw new Error(`reopen created a different id: ${savedId} vs ${againId}`)
  }
  const count = await page.getByTestId('my-projects-row').count()
  if (count !== 1) throw new Error(`expected 1 registry row, got ${count}`)

  const version = await page.locator('.version-label').innerText()
  await browser.close()
  server.close()
  console.log(JSON.stringify({
    ok: true,
    version,
    projectId: savedId,
    rowText: rowText.replace(/\s+/g, ' ').trim(),
    screenshot: SCREENSHOT,
    entries: registry.entries
  }, null, 2))
}

main().catch(async (err) => {
  console.error(err)
  try {
    const extra = join(SCREENSHOT_DIR, 'mis-proyectos-failure.png')
    await mkdir(SCREENSHOT_DIR, { recursive: true })
    await writeFile(join('/tmp', 'mis-proyectos-error.txt'), String(err && err.stack || err))
  } catch { /* ignore */ }
  process.exit(1)
})
