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

Prerequisites: [Git](https://git-scm.com/) (with [Git LFS](https://git-lfs.com/)) and [Node.js](https://nodejs.org/en).

```bash
git clone https://github.com/Open-Historia/open-historia.git
cd open-historia
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

#### Installing the app (PWA) on other devices

The app can be installed as a standalone app (manifest + service worker). Installing from
`http://localhost:3000` on the machine running the server works out of the box. Installing from
another device on the same network — `http://192.168.x.x:3000` — does not, because a plain LAN
address isn't a secure context and service workers refuse to register on it. To fix that:

```bash
node scripts/generate-dev-cert.mjs   # writes certs/dev-cert.pem + certs/dev-key.pem
node server/server.js                # now serves https://<your-LAN-IP>:3000
```

> **Once the cert exists, port 3000 is HTTPS-only** — there's no separate HTTP port anymore. This
> also affects the host machine itself: use `https://localhost:3000`, not `http://`, and the same
> for the `Launch Open Historia` scripts and the Android app's connect address (both default to
> `http://`). If you don't need LAN installs, don't run the generator and the port stays plain HTTP
> exactly as before. Delete `certs/` to go back to HTTP.

The cert is self-signed, so every other device must be told to trust it once — otherwise Chrome
refuses the connection outright. Copy `certs/dev-cert.pem` to the device and install it as a
trusted certificate (Android: Settings → Security → Install from storage → CA certificate; iOS:
AirDrop/email the file, open it, then enable full trust under Settings → General → About →
Certificate Trust Settings; Windows: double-click → Install Certificate → Local Machine → Trusted
Root Certification Authorities). Re-run the generator if your LAN IP changes.

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
