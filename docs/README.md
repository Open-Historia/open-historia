# Open Historia — Developer Documentation

Open Historia is an AI-driven, map-based alternate-history strategy game: players run a world of owned regions on an interactive map and advance it turn-by-turn, with a language model narrating events and applying concrete changes back to the world state. The same codebase ships as three variants from one source tree — a Node/Express server build, a browser-only web build (openhistoria.com), and a Capacitor Android app with an embedded server — gated by the compile-time `VITE_OH_WEB` flag. These docs are organized by subsystem: the map and in-game UI, the world/turn model, the AI pipeline, the standalone map editor, the backend and data layers, the web/mobile targets, and the delivery/release topology. Every page is a standalone reference; this index groups them and links each with a one-line summary.

## Start here

New to the codebase? Read **[Architecture Overview](architecture.md)** first — it covers the tech stack, the three build variants and the `VITE_OH_WEB` flag, the boot sequence, the directory map, and the frontend↔`/api`↔storage data flow that every other page builds on. From there, follow the group that matches what you're working on.

> **Editing AI prompts?** The **[Prompt-Making Guide](ai-prompts.md)** is the canonical reference — every placeholder/variable, all 13 tasks plus the advisor/leader roots, end-to-end prompt assembly, the override/frozen-prompt model, and recipes for adding a variable or a task. Start there before touching any prompt text.

## Contents

### Getting Started
- [Architecture Overview](architecture.md) — Tech stack, the three build variants and the `VITE_OH_WEB` flag, boot sequence, directory map, and the frontend↔`/api`↔storage data flow.
- [Contributing & Conventions](conventions.md) — Repo/remote layout, release-channel workflow, PR-only process, commit/attribution and comment style, local dev, `node --test`, and frozen identifiers.

### Game
- [Game Map & Rendering](game-map.md) — In-game MapLibre rendering: region/country layers, owner colouring, disputed stripes, labels, cities/markers/units, the decorative globe, and `world.json` data flow.
- [In-Game UI (HUD, Panels & Buttons)](game-ui.md) — Complete HUD/panels/buttons reference: shell, z-index ladder, main menu, and every panel with its state/props and map/AI/server data flow.
- [World State & Turn Model](world-state.md) — The `world.json`/`game.json` schema, normalizers, AI impact application, the 5s poll, units peer-poll, country tags, and games-vs-scenarios storage.

### AI & Prompts
- [AI System Overview](ai-overview.md) — Transport/provider dispatch, key/relay security, streaming vs buffered, token caps, and the `runJsonTask` strict/salvage task pipeline.
- [Prompt-Making Guide](ai-prompts.md) — The reference for authoring and editing AI prompts: every variable, all tasks, end-to-end assembly, and the override/frozen-prompt model.
- [AI Return Schemas & Validation](ai-schemas.md) — AI JSON return schemas, the two-layer validator, and the `runJsonTask` strict/salvage retry discipline.

### Editor
- [Map Editor](map-editor.md) — The OpenLayers map editor: tools, region/owner/flag/tag editing, tier-1/tier-2 game-seed export, and how edits reach the game.

### Backend & Data
- [Server & API](server.md) — The Node/Express game server: routes, data-dir layout, asset serving, owner migration, and portability.
- [Map Data & Assets](assets-and-data.md) — Map-data & asset handling from GitHub-Release download through server override resolution to the browser caching/warming model.
- [Runtime Services](runtime-services.md) — Library/scenario/game stores, the country-name resolver, i18n/translator, and tags/labels/community-flags/map-settings services.

### Web & Mobile
- [Web Build (openhistoria.com)](web-build.md) — The browser-only `VITE_OH_WEB` build: fetch-interceptor fake backend, IndexedDB stores, PMTiles Worker-proxy/content-node trust chain, magic-link/Google accounts + E2E sync.
- [Android App (Embedded Server)](mobile.md) — The Capacitor + nodejs-mobile Android app: boot shell, first-run map fetch, self-update, the `android` release channel, and build pipeline.

### Delivery
- [The Player Wiki](wiki.md) — Maintaining openhistoria.com/wiki/: the markdown-to-HTML generator, `npm run wiki:check` for spotting when it has gone stale, the screenshot harness, and the main-vs-beta rules.
- [Delivery, Deploy & Releases](delivery-and-deploy.md) — Full CI/release/deploy topology: build scripts, main/beta/alpha channels + PR-triplet, the release assets, the four workflows, `build:site`, the admin-panel deploy engine, and the Workers.
