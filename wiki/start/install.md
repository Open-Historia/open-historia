There are four ways to run Open Historia. All of them are free, and none of them need an
account.

## Which one do I want?

| | Best for | Notes |
|---|---|---|
| **Desktop app** | Almost everyone | The full game. Installs like any other program; the world map downloads itself on first launch. |
| **Browser** | Trying it out right now | Nothing to install. Slower, and the map is streamed rather than stored. |
| **Android app** | Playing on a phone | Self-contained — nothing to run alongside it. Downloads the map on first launch. |
| **From source** | Contributors | Node.js and a terminal. See [hosting a server](/wiki/self-hosting/). |

The desktop app is the recommended one. The browser build is genuinely playable but it is the
lightest of the four, and on iPhone and iPad it is the only option.

## Desktop

Downloads live on the
[`desktop-stable` release](https://github.com/Open-Historia/open-historia/releases/tag/desktop-stable).

### Windows

Download **`Open-Historia-Setup.exe`** (~124 MB) and run it. Open Historia lands in your Start
Menu like any other application — there is no Node.js to install, no setup script and no
terminal window.

The installer is not code-signed yet, so Windows SmartScreen will warn you the first time.
Choose **More info → Run anyway**.

### macOS

Download the zip that matches your Mac — **`Open-Historia-mac-arm64.zip`** for Apple Silicon
(M1 and later) or **`Open-Historia-mac-x64.zip`** for Intel — then unzip it and drag
**Open Historia** to your Applications folder.

The app is not code-signed, so on first launch macOS will refuse to open it by double-click.
Right-click the app and choose **Open**, then confirm. You only have to do this once.

### Linux

On Debian, Ubuntu and derivatives, install the `.deb`:

```
sudo apt install ./open-historia_amd64.deb
```

It lands in your applications menu like any other program. The `.deb` is the better choice
where it works: it installs to `/opt` with a root-owned `chrome-sandbox`, so Chromium's sandbox
stays switched on.

On any other distribution, use the AppImage:

```
chmod +x Open-Historia-x86_64.AppImage
./Open-Historia-x86_64.AppImage
```

Nothing is installed system-wide.

### First launch

The world map is not bundled with the installer — it is around 200 MB of vector tiles, which
would make every download enormous. The app fetches it the first time you open it and stores it
locally, so this happens once. You will see a startup screen with named steps and a progress
readout while it works. After that the game starts offline.

### Updating

The desktop app checks for updates on its own and shows a banner when one is ready. You choose
when to download it, and it installs when you next quit. You can also just download the newest
build and run it over the top — your saves and scenarios are kept.

## Browser

Go to **[openhistoria.com/play/](/play/)**. The game loads and you can start immediately.

What is different in the browser:

- Games and scenarios are stored in your browser's storage, not in files. Clearing site data
  clears your campaigns. The game will ask for persistent storage permission — grant it.
- The map is served by community-run content nodes rather than downloaded whole. If no node is
  reachable you get a blank map; see [Troubleshooting](/wiki/troubleshooting/).
- You can optionally sign in — by emailed magic link or with Google — to sync games and
  scenarios between devices. They are encrypted in your browser before upload, so the server
  only ever holds ciphertext. See [saves and rollback](/wiki/saves/) for what that does and does
  not protect.
- Providers that refuse direct browser requests need a relay, which the browser build does not
  have. Gemini and Anthropic work directly; see [AI providers](/wiki/ai-providers/).

It works on phones and tablets, including iPhone and iPad. Expect it to be slower than the
desktop app, and add it to your Home Screen for a fullscreen window.

## Android

Download **`open-historia.apk`** (~6 MB) from the
[`android` release](https://github.com/Open-Historia/open-historia/releases/tag/android) and
install it. Android will ask you to allow installing from your browser — this is normal for an
app distributed outside the Play Store.

The app is a thin client with a server embedded inside it. It plays on its own: there is
nothing to run on a PC alongside it, and no Termux setup. On first launch it downloads the
world map (~200 MB), so use Wi-Fi. Your games are saved on the phone.

It updates itself — it checks the release for a newer build and offers it in a banner.

See [playing on your phone](/wiki/mobile/) for more.

## From source

You need Node.js `^20.19.0` or `>=22.12.0`.

```
git clone https://github.com/Open-Historia/open-historia.git
cd open-historia
npm ci
npm run dev
```

That starts the Vite dev server. To run the desktop shell instead, `npm run build` then
`npm run electron`. The map binaries are not in the Git repository — they are release assets,
fetched by `node scripts/fetch-map-assets.mjs`.

Full details are in
[`docs/`](https://github.com/Open-Historia/open-historia/tree/main/docs), and
[hosting a server](/wiki/self-hosting/) covers running it for other devices on your network.

## Next

Whichever way you installed, the game is not much use until it has a model to talk to.
Go to [connecting an AI provider](/wiki/ai-setup/).
