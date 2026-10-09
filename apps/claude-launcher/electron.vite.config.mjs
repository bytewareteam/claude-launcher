import { resolve } from 'path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  main: {
    build: {
      // electron-store es solo ESM: se empaqueta dentro del bundle CJS.
      externalizeDeps: { exclude: ['electron-store'] }
    }
  },
  preload: {},
  renderer: {
    resolve: {
      alias: { '@': resolve('src/renderer/src') }
    },
    plugins: [react(), tailwindcss()]
  }
})
