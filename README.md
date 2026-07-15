<!-- Open Historia — portions (install, Android app, hub & preset docs) © 2026 Nicholas Krol, MIT (see src/Editor/LICENSE). -->
<h1 align="center">Open Historia</h1>

<div align="center">
  <strong>An open-source, community-driven alternative to <a href="https://www.paxhistoria.co/games">Pax Historia</a>.</strong>
</div>

<br />

<div align="center">
  <!-- Discord -->
  <a href="https://discord.gg/C3AVwHacZ4">
    <img src="https://img.shields.io/badge/discord-join-5865F2.svg?style=flat-square&logo=discord&logoColor=white"
      alt="Discord" />
  </a>
  <!-- License -->
  <a href="LICENSE">
    <img src="https://img.shields.io/badge/license-MIT-blue.svg?style=flat-square"
      alt="License: MIT" />
  </a>
  <!-- Status -->
  <a href="#">
    <img src="https://img.shields.io/badge/status-early%20development-orange.svg?style=flat-square"
      alt="Early Development" />
  </a>
</div>

<div align="center">
  <sub>Built with ❤︎ by <a href="https://github.com/Open-Historia/open-historia/graphs/contributors">contributors</a>.
</div>

<br />
<br />

![](https://github.com/Open-Historia/open-historia/blob/main/public/screenshot.png?raw=true)

---

## ✨ Features

- __interactive world map:__ watch territory, borders, and nations shift as history unfolds
- __ai-generated events:__ dynamic events shaped by your decisions and the state of the world
- __diplomacy:__ negotiate with AI-controlled nations through natural language chat — click any country to talk to it or get an AI intelligence briefing
- __ai advisor:__ consult your advisor for strategic guidance, economic analysis, and situation summaries
- __map editor:__ a full vector map editor (draw, split, merge, paint owners, cities) built into the scenario editor — build a world and hit *Apply & Play*
- __troops:__ deploy, move and battle armies; deployments stay pending until the AI resolves them; scenarios control which troop types exist in their era
- __scenario hub:__ browse, vote on and import community scenarios from the in-game **Community** tab, and publish your own
- __self-hostable:__ run your own instance with your own AI backend completely offline

---

## 🚀 Installation

### Easiest

- **Windows:** double-click **`Launch Open Historia.bat`**
- **macOS:** double-click **`Launch Open Historia.command`** (first run: right-click → *Open*)
- **Linux:** run `./"Launch Open Historia.sh"` in a terminal

The launcher checks Node.js, downloads the map data, installs dependencies, builds,
and opens the game. To update an existing install later, run the matching
**`Update Open Historia`** script for your platform — it fetches the latest version
while preserving your saves, scenarios, and map data.

#### Android app (thin APK)

Easiest: download **`pax-historia.apk`** from the
[**Android release**](https://github.com/Open-Historia/open-historia/releases/tag/android)
and open it to install (allow installs from your browser when Android asks).
On first launch the app finds the Termux server on the same phone by itself;
to play against another machine, type its address once — it's remembered.
It's a thin client: the game itself runs on the server it connects to.

for it to work, you should have termux on your device setup

<details>
<summary>Build the APK yourself (needs the Android SDK)</summary>

```bash
cd mobile
npm install
npx cap sync android
cd android && ./gradlew assembleDebug   # gradlew.bat on Windows
```

The APK lands in `mobile/android/app/build/outputs/apk/debug/`. (Or open
`mobile/android` in Android Studio and press Run.) Maintainers: the
**Build Android APK** action in the Actions tab builds and republishes the
release APK — run it after changing `mobile/`.

</details>

### Manual

Prerequisites: [Git](https://git-scm.com/) and [Node.js](https://nodejs.org/en).

```bash
git clone https://github.com/Open-Historia/open-historia.git
cd open-historia
node scripts/fetch-map-assets.mjs  # Download the world map data (see note below)
npm install                        # Install dependencies (includes OpenLayers etc. for the editor)
npm run build                      # Build the client
node server/server.js              # Start the server
```

Then open **http://localhost:3000** in your browser.

> **Note:** the large map binaries (`*.pmtiles`, `public/assets/*-seed.*`, and
> `server/data/scenarios/default/regions.geojson`) are **not** in the repo — they are
> hosted as [GitHub Release assets](https://github.com/Open-Historia/open-historia/releases/tag/map-data)
> and downloaded by `scripts/fetch-map-assets.mjs`. The launcher script for your platform
> runs this for you automatically, so a plain ZIP download works too — no Git LFS needed.

---

## 🌍 Scenarios

**Modern Day** is the only built-in scenario. All other official presets — *WWII 1939*,
*Medieval 1200*, *Rome 117 AD*, *Mongol World 1300*, *New World 1650* — live on the
[**Scenario Hub**](https://github.com/Open-Historia/Open-historia-scenarios), pinned at the top of
the in-game **Community** tab. Import any of them with one click, or publish your own.

To rebuild an official preset from source (specs live in `scripts/presets/`):

```bash
node scripts/presets/build-preset.mjs scripts/presets/wwii-1939.spec.mjs
```

To regenerate the built-in Modern Day map: `node scripts/build-default-map.mjs`

## 🗺️ Map editor

Open any scenario's editor and click **🗺️ Open Map Editor** (or visit
`http://localhost:3000/?editor=1` for the standalone editor). Draw regions, split and
merge borders freehand, paint owners, import 70k cities, sign your map, then
**Apply & Play**.

## 🖥️ Host a server node

Want to help the network? Run a **content node** on your own device to cache and serve
the game's map data to nearby players so everyone loads faster. It's a one-click install
and deliberately safe — a node only ever serves **read-only, checksum-verified** map
files, and never touches anyone's games, accounts, AI keys, or code.

➡️ **[Set up a node → Open-Historia/open-historia-node](https://github.com/Open-Historia/open-historia-node)**

Your node registers itself and starts serving players once an admin accepts it. See the
[node README](https://github.com/Open-Historia/open-historia-node#readme) for the full
walkthrough (including a free Cloudflare Tunnel to put it online).
