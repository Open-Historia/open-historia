/*! Open Historia — portions (dev API proxy + vendor chunks) © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'

// The big map binaries live in public/ so the dev server and the Express server can
// serve them off disk, but NEITHER build serves them from the bundle: the desktop
// streams them via /api/runtime/pmtiles/:assetKey, and a web build carries its own
// pinned copies, which scripts/stage-map-assets.mjs lays into the output AFTER this.
//
// Vite copies publicDir wholesale and offers no partial exclude, so it duplicated
// ~160MB into dist/ and — worse — made `npm run build:site` emit a site Cloudflare
// Pages REJECTS outright: its limit is 25 MiB per file and regions.pmtiles is ~101.
//
// The trap is that it only fires on a machine that has actually played. The files
// are gitignored and arrive from the map-data Release at first launch, so CI and a
// fresh clone build fine and the deploy failure looks random. Dropping them after
// the copy is the fix; "remember to delete them before deploying" is not.
// A developer's copies are never wanted in EITHER build. The desktop streams its
// archives off disk via /api/runtime/pmtiles/:assetKey. A web build carries the
// pinned z8 archives under the same names, laid in after the build by
// scripts/stage-map-assets.mjs; whatever happens to sit in public/ must not go
// in their place (a z10 archive would break the Pages deploy at its 25 MiB a file).
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
// A web build must not carry THESE copies: a developer's public/ holds the
// desktop's (regions-seed.geojson is 55 MB at z8, and Pages rejects any file
// over 25 MiB). It carries its own, web-sized ones, which scripts/stage-map-assets.mjs
// lays into the output after this from the pinned map-data release
// (scripts/map-assets.web.json), under the same names.
const EDITOR_SEEDS = [
  'assets/regions-seed.geojson',
  'assets/cities-seed.json',
  'assets/default-regions.geojson',
]

// The Android bundle drops both sets as well: mobile/scripts/stage-www.mjs lays
// the trimmed archives and the web-sized seeds under www/assets itself, from the
// pinned map-data release, never from whatever a developer's public/ holds.
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

// Identifies THIS web build. It is baked into the bundle (VITE_WEB_BUILD) and written
// to version.json beside it, so a running page can tell whether the copy of the site
// it booted from is still the one being served. Computed once per build so both halves
// always agree. A plain timestamp is enough — it only ever has to differ from the last
// deploy and compare as "newer".
const WEB_BUILD_ID = String(Date.now())

// Emits version.json into the web build output. Deployed as /play/version.json (the
// assemble step copies dist-web wholesale), which is what the update banner polls.
const emitWebVersion = (isWeb: boolean) => {
  let outDir = 'dist'
  return {
    name: 'oh-web-version',
    apply: 'build' as const,
    configResolved(config: { build: { outDir: string } }) {
      outDir = config.build.outDir
    },
    closeBundle() {
      if (!isWeb) return
      fs.writeFileSync(
        path.resolve(outDir, 'version.json'),
        JSON.stringify({ build: WEB_BUILD_ID }),
      )
    },
  }
}

// The Android app does not report to the website's Google Analytics: its
// players never saw the site that set it up, a store listing would have to
// declare it, and on a device with no network it was one more failed request
// per start. No page carries a counter itself any more: the website and the
// desktop add the gate that asks first (public/consent.js, through
// src/runtime/visitCount.js), and the Android app never does. This keeps it so:
// the android build fails if a counter, or the gate, is written into its page.
const dropWebAnalytics = (isAndroid: boolean) => ({
  name: 'oh-drop-web-analytics',
  apply: 'build' as const,
  transformIndexHtml(html: string) {
    if (isAndroid && /googletagmanager|gtag\(|umami|consent\.js/.test(html)) {
      throw new Error('oh-drop-web-analytics: a visit counter is written into the Android index.html')
    }
    return html
  },
})

// Two features run a model in a worker on Transformers.js and the copy of ONNX
// Runtime it pins: the Advisor's microphone (Whisper, src/runtime/speechWorker.js)
// and the translator (Opus-MT, src/runtime/translationWorker.js). Both import the
// runtime's WebAssembly from `oh-ort-transformers/`, so it is emitted into the
// build once, from that package, and never fetched from a CDN; only the model
// weights come from the model host. Both run on the CPU build of the runtime
// (their 8-bit models gain nothing from WebGPU), which is half the size of the
// WebGPU one Transformers.js imports by default.
const ortDistOf = (fromFile: string) =>
  path.dirname(createRequire(new URL(fromFile, import.meta.url)).resolve('onnxruntime-web/ort-wasm-simd-threaded.wasm')).replace(/\\/g, '/')
// The Android app listens through the phone's own recogniser and never runs a
// model, but a dead `import()` is still loaded, and loading speechOnDevice.js
// emits its worker and the runtime's WebAssembly (14 MB) into the APK. There
// it is a module that has nothing to offer.
const dropOnDeviceSpeech = (isAndroid: boolean) => ({
  name: 'oh-drop-on-device-speech',
  enforce: 'pre' as const,
  resolveId(id: string, importer?: string) {
    if (isAndroid && id === './speechOnDevice.js' && importer?.replace(/\\/g, '/').endsWith('/src/runtime/speechInput.js')) return '\0oh-no-on-device-speech'
    return null
  },
  load(id: string) {
    if (id !== '\0oh-no-on-device-speech') return null
    return 'const no = () => Promise.reject(Object.assign(new Error("failed"), { code: "failed" }));\n'
      + 'export const modelReady = no;\nexport const downloadModel = no;\nexport const startOnDevice = () => { throw Object.assign(new Error("failed"), { code: "failed" }); };\n'
  },
})

const transformersRuntimeAliases = [
  { find: /^onnxruntime-web(?:\/webgpu)?$/, replacement: 'onnxruntime-web/wasm' },
  { find: /^oh-ort-transformers\//, replacement: `${ortDistOf('./node_modules/@huggingface/transformers/dist/transformers.web.js')}/` },
]

// The game's own MapLibre (vendor/maplibre-gl/README.md). Its stylesheet and types still come from the package.
const mapLibreAlias = { find: /^maplibre-gl$/, replacement: path.resolve('vendor/maplibre-gl/entry.js') }

// https://vite.dev/config/
// `--mode web` (npm run build:web / build:site / dev:web) builds the website,
// `--mode android` (npm run build:android) the Android app's bundle — the web
// build with the world map inside the APK; any other mode builds the
// local/desktop app that ships in "Download for Windows".
export default defineConfig(({ mode }) => ({
  define: {
    // Empty off the web, which is what keeps the banner inert on desktop/dev.
    'import.meta.env.VITE_WEB_BUILD': JSON.stringify(mode === 'web' ? WEB_BUILD_ID : ''),
    // Make the web flag a COMPILE-TIME literal so Rollup dead-code-eliminates
    // every `if (import.meta.env.VITE_OH_WEB)` branch — and the web backend they
    // dynamically import (src/runtime/web/*) — from the desktop build. Without
    // this the flag is only a runtime value, so `npm run build` still pulls the
    // web runtime into the graph and fails to resolve its web-only, git-ignored
    // generated seed files on any machine that hasn't run a web build first (e.g.
    // a fresh "Download for Windows" extract). Boolean is safe: every use site is
    // a plain truthiness check.
    'import.meta.env.VITE_OH_WEB': JSON.stringify(mode === 'web' || mode === 'android'),
    // The Android app is the web build with everything on the device: the map
    // inside the APK (the website carries the same files under its own /assets),
    // native file saving, native HTTP for a model on the LAN. A second compile-time literal, so those branches
    // are stripped from the website exactly as the web ones are from desktop.
    'import.meta.env.VITE_OH_NATIVE': JSON.stringify(mode === 'android'),
  },
  // PTR placement runs in a module worker whose dependency graph can be
  // split into multiple chunks. Vite's default worker output is IIFE, which
  // Rollup cannot use for code-splitting builds; emit workers as native ES
  // modules so production builds match the module-worker runtime contract.
  worker: {
    format: 'es',
  },
  resolve: {
    alias: [...transformersRuntimeAliases, mapLibreAlias],
  },
  plugins: [
    react({
      babel: {
        plugins: [['babel-plugin-react-compiler']],
      },
    }),
    dropMapBinaries(mode === 'web' || mode === 'android'),
    emitWebVersion(mode === 'web'),
    dropWebAnalytics(mode === 'android'),
    dropOnDeviceSpeech(mode === 'android'),
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
      // The game, and the hidden page a desktop host runs a shared game's
      // engine in (engine.html, src/multiplayer/host/engineMain.js).
      input: {
        main: 'index.html',
        engine: 'engine.html',
      },
      output: {
        // Explicit entries so the split is stable across builds rather than
        // incidental. The AI stack reaches the graph only through
        // Game/AI/gameplayLazy.js, so naming it here keeps it one chunk instead
        // of letting Rollup fold it back into whatever imports it first.
        manualChunks: {
          'vendor-react': ['react', 'react-dom'],
          'vendor-maplibre': ['maplibre-gl'],
          'vendor-chartjs': ['chart.js'],
          'vendor-ol': ['ol'],
          'vendor-geo': [
            '@turf/area',
            '@turf/boolean-point-in-polygon',
            '@turf/centroid',
            '@turf/helpers',
            '@turf/line-intersect',
            '@turf/line-split',
            '@turf/polygon-to-line',
            '@turf/simplify',
            'd3-geo',
            'polygon-clipping',
          ],
        },
      },
    },
  },
}))
