The desktop app already runs a local server — that is how it works. This page is about running
that server deliberately: to play entirely offline, to reach your campaign from another device,
or to keep everything on hardware you control.

**There is no multiplayer.** Hosting lets *you* reach *your* game from another device. It does
not let two people play the same campaign. If you connect from your phone and your laptop at
once, you are two windows onto one single-player game, and you will fight each other for it.

## What you get

- **Fully offline play.** After install, nothing needs the internet — map, rendering, scenarios,
  editor and interface are all local. Only the AI needs a connection, and not even that if you
  run a [local model](/wiki/ai-setup/).
- **Your data on your disk.** Saves and scenarios are files you can back up.
- **Play from the sofa.** Start a campaign on your PC, carry on from a tablet.

## Running it

If you installed the desktop app, you are already running it. To run the server on its own from
a source checkout:

```
git clone https://github.com/Open-Historia/open-historia.git
cd open-historia
npm ci
node scripts/fetch-map-assets.mjs
node server/server.js
```

It listens on **port 3000**. Open `http://localhost:3000`.

Node.js `^20.19.0` or `>=22.12.0` is required on the server machine. Client devices need only a
browser.

## Connecting from another device

**The server answers only the machine it runs on** until you say otherwise. There are two ways to
open it up:

- **In the game:** ☰ → Settings → Advanced → Network → **Let other devices connect**. It takes
  effect immediately, without a restart, is remembered, and shows the address to type on the
  other device.
- **From the environment,** for a headless box: `OH_HOST=0.0.0.0 node server/server.js` for every
  interface, or `OH_HOST=192.168.1.9` for one. When `OH_HOST` is set it wins, and the in-game
  switch says the environment owns the decision.

Then open the address it gives you — `http://192.168.x.x:3000` — from the other device.

Writes from a page served by a *different* origin are blocked either way, which is what stops a
web page you visit from editing your saves. To allow them:

```
OH_ALLOW_CROSS_ORIGIN=1 node server/server.js
```

### Read this before you open it up

**The game's API has no password.** There is no login, no token and no permission model.

Once it is open, **anyone who can reach port 3000 can read, change and delete your games and
scenarios.** On a home network behind a router that is generally fine. It is not fine on a
shared, public or untrusted network, and it is emphatically not fine exposed directly to the
internet. Turn the switch off again when you are done.

Two things soften it: requests from other devices are rate-limited (1,200 a minute by default),
and the **AI relay** — which forwards requests to providers that refuse browser calls — still
answers only this machine, so your computer cannot be used as an open proxy by anything on the
network. Set `OH_ALLOW_REMOTE_RELAY=1` if you do want a device on your network to relay its AI
calls through this server.

If you want to reach your game from outside your home, use a private network overlay —
**Tailscale**, **ZeroTier** or a WireGuard tunnel — rather than forwarding port 3000. Those give
you the same access without publishing an unauthenticated API to the world.

If you must expose it, put it behind a reverse proxy such as nginx or Caddy with authentication
in front.

## Environment variables

| Variable | |
|---|---|
| `PORT` | Port to listen on. Default `3000`. |
| `OH_HOST` | Address to bind. Unset: this machine only, unless the in-game switch says otherwise. `0.0.0.0` for every interface. Overrides the switch. |
| `OH_DATA_DIR` | Where writable state lives — saves, scenarios, uploads. Relocate the whole library with this. |
| `OH_ALLOW_CROSS_ORIGIN` | Set to `1` to accept writes from a page on another origin. |
| `OH_ALLOW_REMOTE_RELAY` | Set to `1` to let other devices relay AI calls through this server. |
| `OH_RATE_LIMIT` | Requests a minute allowed from each other device. Default `1200`. This machine is exempt. |
| `OH_RELAY_TIMEOUT_MS` | How long the AI relay waits for a generation to finish. Default ten minutes. |
| `OH_ASSETS_DIR` | Where the map binaries are read from. |

## Running as a service

**Linux — systemd.** Create `/etc/systemd/system/open-historia.service`:

```
[Unit]
Description=Open Historia Game Server
After=network.target

[Service]
Type=simple
User=your-user
WorkingDirectory=/path/to/open-historia
ExecStart=/usr/bin/node server/server.js
Restart=on-failure
Environment=PORT=3000
Environment=OH_HOST=0.0.0.0

[Install]
WantedBy=multi-user.target
```

Then `sudo systemctl enable --now open-historia`. Drop the `OH_HOST` line if only that machine
should reach it — and read the warning above if you keep it.

**macOS** — a `launchd` plist in `~/Library/LaunchAgents/`.

**Windows** — Task Scheduler, triggered at logon, running `node server/server.js` in the project
directory.

## The map data

The map binaries — roughly 200 MB of vector tiles — are not in the Git repository. They are
release assets, fetched by:

```
node scripts/fetch-map-assets.mjs
```

Without them the map is blank. The desktop app does this for you on first launch.

## Where your files are

Under the data directory: your games, your scenarios, uploaded basemaps and flags, map editor
documents, and the manifests that index them. Back up the directory and you have backed up
everything.

Do not edit save files by hand while the game is running. Use the [cheats panel](/wiki/cheats/)
for changing a campaign — it goes through the same validation the game does.

## Privacy

No accounts, and no game data leaves your machine. Your AI provider key is stored locally and
sent only to the provider you configured.

One thing does reach the network by default: the browser build's analytics on the website itself.
It carries no game data. Importing a scenario from the Community Hub downloads its file from
GitHub, and GitHub's count of those downloads is what the hub shows as installs — the game
reports nothing of its own. (Versions before October 2026 pinged an anonymous counter on every
import; `OH_IMPORT_COUNTER_URL`, which switched that off, no longer does anything.)

## Next

- [Playing on your phone](/wiki/mobile/) — the Android app, which needs no server at all.
- [Saves and rollback](/wiki/saves/) — what is in the data directory.
- [Connecting an AI provider](/wiki/ai-setup/) — running a model locally too.
