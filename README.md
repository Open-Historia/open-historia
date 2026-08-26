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
  <!-- Reddit -->
  <a href="https://www.reddit.com/r/OpenHistoria">
    <img src="https://img.shields.io/badge/reddit-r%2FOpenHistoria-FF4500.svg?style=flat-square&logo=reddit&logoColor=white"
      alt="Reddit" />
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

## 🚀 Play

### In your browser

**[openhistoria.com](https://openhistoria.com)** — nothing to install. Games are saved in
your browser, and you bring your own AI key (it goes straight to your provider, never to
us). The world map is served by the community [content-node network](https://github.com/Open-Historia/open-historia-node).

Local AI (Ollama, LM Studio) needs one extra step in the browser: the server has to allow
the site's origin, e.g. start Ollama with `OLLAMA_ORIGINS=https://openhistoria.com`. The
desktop app below needs no such setup.

### Desktop (offline, single-player)

Download **[`Open-Historia.zip`](https://github.com/Open-Historia/open-historia/releases/tag/app-stable)**
(~186 MB — code *and* all map data), unzip it anywhere, then:

- **Windows:** run **`Open-Historia-Setup.exe`**, then open Open Historia from the Start Menu
- **macOS:** unzip and drag **Open Historia** to Applications (first run: right-click -> *Open*)
- **Linux:** `chmod +x Open-Historia-x86_64.AppImage` and run it

The launcher checks Node.js, downloads the map data, installs dependencies, builds,
and opens the game. To update an existing install later, run the matching
newest installer from the downloads page and run it over the top - your saves
while preserving your saves, scenarios, and map data.

> [!TIP]
> Run the launcher **normally** — it does not need (and works better without)
> administrator rights: an elevated window gets the admin account's environment,
> which can hide a Node.js that was installed for your own account.


#### Android app (thin APK)

Easiest: download **`open-historia.apk`** from the
[**Android release**](https://github.com/Open-Historia/open-historia/releases/tag/android)
and open it to install (allow installs from your browser when Android asks).
It's a thin client: the game itself runs on whatever server it connects to, so you need
one of the two:

- **A desktop on the same network** running the launcher — type its address
  (e.g. `http://192.168.1.20:3000`) into the app once; it's remembered.
  Start that server with `OH_HOST=0.0.0.0` (see
  [Reaching the server from another device](#reaching-the-server-from-another-device)),
  or it only answers the machine it runs on.
- **[Termux](https://termux.dev/) on the phone itself** running the server — the app
  finds it on first launch by itself, no address needed.

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

Prerequisites: [Git](https://git-scm.com/) and [Node.js](https://nodejs.org/en) 22 LTS or newer (minimum 20.19 / 22.12 — the client build runs on Vite 7, which requires it).

```bash
git clone https://github.com/Open-Historia/open-historia.git
cd open-historia
node scripts/fetch-map-assets.mjs  # Download the world map data (see note below)
npm install                        # Install dependencies (includes OpenLayers etc. for the editor)
npm run build                      # Build the client
node server/server.js              # Start the server
```

Then open **http://localhost:3000** in your browser.

### Reaching the server from another device

The server listens on **`127.0.0.1` only** — the machine it runs on. That covers
the desktop app, Termux on the same phone, and a browser on the same computer.

To play from your phone or another computer, tell it to listen on the network:

```bash
OH_HOST=0.0.0.0 node server/server.js      # every interface
OH_HOST=192.168.1.20 node server/server.js # one interface
```

Worth knowing before you do: **the game's API has no password.** Anyone who can
reach that address can read, change and delete your games and scenarios — the
server can't tell them apart from you. That's fine on a home network you control
and a bad idea on café, hotel, dorm or office Wi-Fi. Two related switches:

| Variable | Default | What it does |
| --- | --- | --- |
| `OH_HOST` | `127.0.0.1` | Which interface to listen on. Anything but loopback puts the API on your network. |
| `OH_ALLOW_REMOTE_RELAY` | off | Lets other devices use this server's AI relay. Off means the relay only answers this machine, so it can't be used as a proxy by anyone else on the network. |
| `OH_RATE_LIMIT` | `1200` | Requests per minute per network client (loopback is exempt). |

> [!TIP]
> **Running the server only — Termux/Android, a headless box, a NAS?** Skip the
> desktop-app tooling:
>
> ```bash
> npm install --omit=dev --omit=optional
> ```
>
> That drops Electron and its build chain (783 packages → 286) while keeping
> everything the client build and the server actually need. On Android it is the
> difference between working and not: Electron publishes no Android build, so its
> install script exits with *"Electron builds are not available on platform:
> android"*. A plain `npm install` still succeeds there — Electron is an
> `optionalDependency`, so npm reports the failure and carries on — but there is no
> reason to download it in the first place.

> **Note:** the large map binaries (`*.pmtiles`, `public/assets/*-seed.*`, and
> `server/data/scenarios/default/regions.geojson`) are **not** in the repo — they are
> hosted as [GitHub Release assets](https://github.com/Open-Historia/open-historia/releases/tag/map-data)
> and downloaded by `scripts/fetch-map-assets.mjs`. The launcher script for your platform
> runs this for you automatically, so a plain ZIP download works too — no Git LFS needed.

---

## 🌍 Scenarios

**Modern Day** is the only built-in scenario. All other official presets — *World War II — 1939*,
*Medieval — 1200 AD*, *Rome — 117 AD*, *Mongol World — 1300 AD*, *New World — 1650*, and
*Bronze Age — 1200 BC* — live on the
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
