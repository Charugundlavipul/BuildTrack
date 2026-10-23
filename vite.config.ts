import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'prompt',
      includeAssets: ['buildtrack-mark.svg', 'buildtrack-192.png', 'buildtrack-512.png'],
      manifest: {
        name: 'BuildTrack',
        short_name: 'BuildTrack',
        description: 'Construction field operations and quality management',
        theme_color: '#12372a',
        background_color: '#f5f3eb',
        display: 'standalone',
        id: '/',
        scope: '/',
        start_url: '/',
        icons: [
          { src: '/buildtrack-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: '/buildtrack-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: '/buildtrack-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
          { src: '/buildtrack-mark.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any maskable' }
        ]
      },
      workbox: {
        navigateFallback: '/index.html',
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        runtimeCaching: []
      }
    })
  ],
  test: {
    environment: 'jsdom',
    setupFiles: ['./tests/unit/setup.ts'],
    include: ['tests/unit/**/*.test.{ts,tsx}'],
    css: true
  }
})
