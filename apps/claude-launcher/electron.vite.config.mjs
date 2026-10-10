import { resolve } from 'path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  main: {
    build: {
      // electron-store es solo ESM: se empaqueta dentro del bundle CJS.
      externalizeDeps: { exclude: ['electron-store'] },
      // El host de extensiones se arranca como utilityProcess: necesita su propio archivo.
      rollupOptions: {
        input: {
          index: resolve('src/main/index.js'),
          'extension-host': resolve('src/main/extension-host.js')
        }
      }
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
