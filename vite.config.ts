import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { copyFileSync, mkdirSync, existsSync } from 'fs'
import { resolve } from 'path'

// Plugin to copy ONNX Runtime WASM files to public directory
function copyOnnxWasmFiles() {
  return {
    name: 'copy-onnx-wasm',
    buildStart() {
      const sourceDir = resolve(__dirname, 'node_modules/onnxruntime-web/dist')
      const targetDir = resolve(__dirname, 'public/onnx')
      
      // Create target directory if it doesn't exist
      if (!existsSync(targetDir)) {
        mkdirSync(targetDir, { recursive: true })
      }
      
      // Copy all WASM files
      const wasmFiles = [
        'ort-wasm.wasm',
        'ort-wasm-simd.wasm',
        'ort-wasm-threaded.wasm',
        'ort-wasm-simd-threaded.wasm',
        'ort-wasm-simd.jsep.wasm',
        'ort-wasm-simd-threaded.jsep.wasm'
      ]
      
      wasmFiles.forEach(file => {
        const sourcePath = resolve(sourceDir, file)
        const targetPath = resolve(targetDir, file)
        try {
          if (existsSync(sourcePath)) {
            copyFileSync(sourcePath, targetPath)
            console.log(`Copied ${file} to public/onnx/`)
          }
        } catch (err) {
          console.warn(`Could not copy ${file}:`, err)
        }
      })
    }
  }
}

export default defineConfig({
  plugins: [
    react(),
    copyOnnxWasmFiles()
  ],
})
