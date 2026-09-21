import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// ONNX Runtime WASM files are now loaded from CDN (jsdelivr)
// This is more reliable than self-hosting and includes all necessary files

export default defineConfig({
  plugins: [react()],
})
