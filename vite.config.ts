import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const here = path.dirname(fileURLToPath(import.meta.url))
const ortDist = (...file: string[]) => path.resolve(here, 'node_modules/onnxruntime-web/dist', ...file)

// ONNX Runtime WASM files are loaded from the jsDelivr CDN (wasmPaths in
// src/onnxRuntime.ts / stemSeparator.ts). Point Vite at the non-bundled
// ORT builds so production does not ship 25–30 MB .wasm files.

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: [
      { find: 'onnxruntime-web/webgpu', replacement: ortDist('ort.webgpu.min.mjs') },
      { find: 'onnxruntime-web', replacement: ortDist('ort.min.mjs') },
    ],
  },
  optimizeDeps: { exclude: ['onnxruntime-web'] },
  server: {
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'credentialless',
    },
  },
  preview: {
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'credentialless',
    },
  },
})
