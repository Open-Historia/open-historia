/*! Open Historia — portions (dev API proxy + vendor chunks) © 2026 Nicholas Krol, MIT (see src/Editor/LICENSE). */
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
// `--mode web` (npm run build:web / build:site / dev:web) builds the website; any
// other mode builds the local/desktop app that ships in "Download for Windows".
export default defineConfig(({ mode }) => ({
  define: {
    // Make the web flag a COMPILE-TIME literal so Rollup dead-code-eliminates
    // every `if (import.meta.env.VITE_OH_WEB)` branch — and the web backend they
    // dynamically import (src/runtime/web/*) — from the desktop build. Without
    // this the flag is only a runtime value, so `npm run build` still pulls the
    // web runtime into the graph and fails to resolve its web-only, git-ignored
    // generated seed files on any machine that hasn't run a web build first (e.g.
    // a fresh "Download for Windows" extract). Boolean is safe: every use site is
    // a plain truthiness check.
    'import.meta.env.VITE_OH_WEB': JSON.stringify(mode === 'web'),
  },
  plugins: [
    react({
      babel: {
        plugins: [['babel-plugin-react-compiler']],
      },
    }),
  ],
  // Proxy API calls to the Express server during `npm run dev` so the map editor's
  // save/load (and the game's runtime endpoints) work with hot-reload too.
  server: {
    proxy: {
      '/api': 'http://localhost:3000',
    },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          'vendor-react': ['react', 'react-dom'],
          'vendor-maplibre': ['maplibre-gl'],
          'vendor-chartjs': ['chart.js'],
          'vendor-ol': ['ol'],
        },
      },
    },
  },
}))
