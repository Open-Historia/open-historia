/*! Open Historia — portions (dev API proxy + vendor chunks) © 2026 Nicholas Krol, MIT (see src/Editor/LICENSE). */
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import fs from 'node:fs'
import path from 'node:path'

// The big map binaries live in public/ so the dev server and the Express server can
// serve them off disk, but NEITHER build serves them from the bundle: the desktop
// streams them via /api/runtime/pmtiles/:assetKey, and the website fetches them from
// the content nodes, hash-verified against the signed manifest.
//
// Vite copies publicDir wholesale and offers no partial exclude, so it duplicated
// ~160MB into dist/ and — worse — made `npm run build:site` emit a site Cloudflare
// Pages REJECTS outright: its limit is 25 MiB per file and regions.pmtiles is ~101.
//
// The trap is that it only fires on a machine that has actually played. The files
// are gitignored and arrive from the map-data Release at first launch, so CI and a
// fresh clone build fine and the deploy failure looks random. Dropping them after
// the copy is the fix; "remember to delete them before deploying" is not.
// Never wanted in EITHER build: nothing loads a pmtiles archive from the bundle.
// The desktop streams them off disk via /api/runtime/pmtiles/:assetKey and the
// website fetches them from the content nodes, hash-verified. Copying them in only
// broke the Pages deploy at its 25 MiB-per-file limit.
const PMTILES = [
  'assets/regions.pmtiles',
  'assets/countries.pmtiles',
  'assets/cities.pmtiles',
]

// Wanted by the DESKTOP, fatal to the WEBSITE. The map editor loads these, and the
// desktop server serves exactly one directory (`app.use(express.static(distDir))`)
// — so dropping them there makes /assets/regions-seed.geojson fall through to the
// SPA fallback, answer with index.html, and the editor open with zero regions.
//
// The web build resolves them from VITE_OH_PMTILES_URL instead (see
// regionImport.js), so it never reads them from the bundle — and it must not carry
// them: regions-seed.geojson is 52.8MB at z8 and Pages rejects any file over 25MiB.
const EDITOR_SEEDS = [
  'assets/regions-seed.geojson',
  'assets/cities-seed.json',
]

const dropMapBinaries = (isWeb) => {
  // Take outDir from the resolved config rather than assuming: --outDir varies
  // (dist for the desktop, dist-web for build:web/build:site).
  let outDir = 'dist'
  return {
    name: 'oh-drop-map-binaries',
    apply: 'build' as const,
    configResolved(config: { build: { outDir: string } }) {
      outDir = config.build.outDir
    },
    closeBundle() {
      for (const rel of isWeb ? [...PMTILES, ...EDITOR_SEEDS] : PMTILES) {
        const target = path.resolve(outDir, rel)
        if (fs.existsSync(target)) fs.rmSync(target)
      }
    },
  }
}

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
    dropMapBinaries(mode === 'web'),
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
