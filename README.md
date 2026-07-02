<h1 align="center">Pax Historia</h1>

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
  <sub>Built with ❤︎ by <a href="https://github.com/Tommi-K/pax-historia/graphs/contributors">contributors</a>.
</div>

<br />
<br />

![](https://github.com/Tommi-K/pax-historia/blob/main/public/screenshot.png?raw=true)

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

- **Windows:** double-click **`Launch Pax Historia.bat`**
- **macOS:** double-click **`Launch Pax Historia.command`** (first run: right-click → *Open*)
- **Linux:** run `./"Launch Pax Historia.sh"` in a terminal

The launcher checks Node.js, downloads the map data, installs dependencies, builds,
and opens the game. To update an existing install later, run the matching
**`Update Pax Historia`** script for your platform — it fetches the latest version
while preserving your saves, scenarios, and map data.

### Android (Termux)

The game runs and hosts fine on a phone. In [Termux](https://termux.dev):

```bash
pkg install nodejs git git-lfs rsync
git clone https://github.com/Tommi-K/pax-historia.git && cd pax-historia
git lfs install && git lfs pull
npm install && npm run build
node server/server.js
```

Then open **http://localhost:3000** in your phone's browser — the UI adapts to
small touch screens. Other devices on the same Wi-Fi can play too, at
`http://<phone-ip>:3000`. (`./"Launch Pax Historia.sh"` and the update script
also work on Termux.)

#### Android app (thin APK)

Easiest: download **`pax-historia.apk`** from the
[**Android release**](https://github.com/Tommi-K/pax-historia/releases/tag/android)
and open it to install (allow installs from your browser when Android asks).
On first launch the app finds the Termux server on the same phone by itself;
to play against another machine, type its address once — it's remembered.
It's a thin client: the game itself runs on the server it connects to.

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

Prerequisites: [Git](https://git-scm.com/) (with [Git LFS](https://git-lfs.com/)) and [Node.js](https://nodejs.org/en).

```bash
git clone https://github.com/Tommi-K/pax-historia.git
cd pax-historia
git lfs install        # Set up Git LFS
git lfs pull           # Pull large files (map tiles + editor seeds + world map)
npm install            # Install dependencies (includes OpenLayers etc. for the editor)
npm run build          # Build the client
node server/server.js  # Start the server
```

Then open **http://localhost:3000** in your browser.

> **Note:** the large map assets (`*.pmtiles`, `public/assets/*-seed.*`, and
> `server/data/scenarios/default/regions.geojson`) live in Git LFS. If you downloaded a
> ZIP instead of cloning, run the launcher script for your platform — it fetches them automatically.

---

## 🌍 Scenarios

**Modern Day** is the only built-in scenario. All other official presets — *WWII 1939*,
*Medieval 1200*, *Rome 117 AD*, *Mongol World 1300*, *New World 1650* — live on the
[**Scenario Hub**](https://github.com/Arkniem/pax-historia-scenarios), pinned at the top of
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
