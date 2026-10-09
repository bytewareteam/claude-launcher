import { defineConfig } from 'astro/config'
import tailwindcss from '@tailwindcss/vite'

// Se publica en GitHub Pages bajo /<repo>: los enlaces internos usan import.meta.env.BASE_URL.
export default defineConfig({
  site: 'https://bytewareteam.github.io',
  base: '/claude-launcher',
  vite: {
    plugins: [tailwindcss()],
    // El logo se repite varias veces: mejor un único fichero cacheable que data: URIs.
    build: { assetsInlineLimit: 0 }
  }
})
