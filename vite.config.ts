import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  build: {
    rolldownOptions: {
      output: {
        codeSplitting: {
          minSize: 20_000,
          groups: [
            { name: 'react-core', test: /node_modules[\\/](react|react-dom|react-router|react-router-dom)[\\/]/, includeDependenciesRecursively: false },
            { name: 'supabase', test: /node_modules[\\/](@supabase|@realtime)[\\/]/, includeDependenciesRecursively: false },
            { name: 'data-offline', test: /node_modules[\\/](@tanstack|dexie)[\\/]/, includeDependenciesRecursively: false },
            { name: 'ui-vendor', test: /node_modules[\\/](lucide-react|sonner|react-hook-form|zod)[\\/]/, includeDependenciesRecursively: false }
          ]
        }
      }
    }
  },
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
