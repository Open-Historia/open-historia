There are four ways to run Open Historia. All of them are free, and none of them need an
account.

## Which one do I want?

| | Best for | Notes |
|---|---|---|
| **Desktop app** | Almost everyone | The full game. Installs like any other program and keeps itself up to date; the world map downloads itself on first launch. |
| **Browser** | Trying it out right now | Nothing to install. Slower, and the map is streamed rather than stored. |
| **Android app** | Playing on a phone | The whole game on the phone, world map included. It plays without a connection, apart from your AI provider. |
| **From source** | Contributors | Node.js and a terminal. See [hosting a server](/wiki/self-hosting/). |

The desktop app is the recommended one. The browser build is genuinely playable but it is the
lightest of the four, and on iPhone and iPad it is the only option.

## Desktop

Downloads live on the
[`desktop-stable` release](https://github.com/Open-Historia/open-historia/releases/tag/desktop-stable).

### Windows

Download **`Open-Historia-Setup.exe`** and run it. Open Historia lands in your Start
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

If macOS says instead that the app is *damaged*, it has quarantined the download. Clear that in
Terminal and open the app again:

```
xattr -dr com.apple.quarantine "/Applications/Open Historia.app"
```

### Linux

On Debian, Ubuntu and derivatives, install the `.deb`:

```
sudo apt install ./Open-Historia-amd64.deb
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

The world map is not bundled with the installer — it is about 290 MB of map files, which would
make every download enormous. The app fetches it the first time you open it and stores it
locally, so this happens once. A **Setting up Open Historia** window shows the download's
progress while it works. After that the game starts offline.

<p class="beta-note"><b>On beta a failed map download can be retried.</b> If the download does
not finish, the window says how many map files are missing and offers <b>Try again</b> or
<b>Continue without the map</b>.</p>

### Updating

There is nothing to run by hand: the desktop app keeps itself up to date, and your saves,
scenarios and settings are kept through every update.

- **When you open it**, the app first looks for a newer version. If one is waiting, an
  **Updating Open Historia** window downloads and installs it, and the game reopens on the new
  version by itself. **Open the game now** lets you play on the version you have instead; the
  update then installs when you close the game. The app waits only a few seconds for an answer:
  if you are offline or the answer is slow, the game simply opens.
- **While you play**, a newer version shows as a banner: *A new version of Open Historia is
  ready.* **Update now** fetches it in the background and **Restart now** finishes it. Fetched
  but not restarted, it is in place the next time you open the game.
- **Only what changed is downloaded.** An update fetches just the pieces of the app that changed,
  typically a few megabytes rather than the whole installer. A release that needs a newer engine
  underneath comes as the full installer instead, and installs itself silently, with no wizard.
- **On macOS** the app updates itself by those pieces only. When a release needs the full
  installer, the banner offers its download instead: unzip it and replace the app in
  Applications.

You can always download the newest build yourself and install it over the top.

<p class="beta-note"><b>On beta updates start faster, and you can look for one yourself.</b> An
update that follows an earlier one checks the files you already have against the list that update
left, in a second or two, instead of reading every one of them; the first update after installing
from the installer still reads them all once. <b>☰ → Help → Check for updates</b> looks for a new
version at any time.</p>

### The beta build

Newer features reach the
[`desktop-beta` pre-release](https://github.com/Open-Historia/open-historia/releases/tag/desktop-beta)
first. It installs **alongside** the official app as *Open Historia Beta* — its own Start Menu
entry, a BETA-badged icon, its own saves and settings — and updates itself from that page, the
same way, never onto the official build. It downloads its world map the first time it opens, like
the official app; the beta's is about 150 MB. The files are named `Open-Historia-Beta-Setup.exe`,
`Open-Historia-Beta-mac-arm64.zip` / `-x64.zip`, `Open-Historia-Beta-amd64.deb` and
`Open-Historia-Beta-x86_64.AppImage`, and the website offers each one under its stable download.

The official app recommends it. The first time it opens after you install it, and the first time
after each update, it asks *Do you want to download the beta version for the best experience?*
**Download the beta** opens the beta's download — on Windows the installer itself, elsewhere its
release page — and **Not now** leaves the question until the next update. The **Updating Open
Historia** window offers the same download while an update installs.

Pages and sections marked <em>beta</em> in this wiki describe that build.

## Browser

Go to **[openhistoria.com/play/](/play/)**. The game loads and you can start immediately.

What is different in the browser:

- Games and scenarios are stored in your browser's storage, not in files. Clearing site data
  clears your campaigns. The game will ask for persistent storage permission — grant it.
- The map files come with the site and download the first time you play, about 35 MB; your
  browser keeps them after that. If the map stays blank, see [Troubleshooting](/wiki/troubleshooting/).
- There is no account and no sync: your games stay in this browser. To play one somewhere else,
  export it and import it there; see [saves and rollback](/wiki/saves/).
- Providers that refuse direct browser requests need a relay, which the browser build does not
  have. Gemini and Anthropic work directly; see [AI providers](/wiki/ai-providers/).
- The website runs the stable release; there is no beta in the browser. When a new version of
  the site goes up, a banner offers to reload onto it — *Reload to get the latest fixes. Your
  games are saved.*

It works on phones and tablets, including iPhone and iPad. Expect it to be slower than the
desktop app, and add it to your Home Screen for a fullscreen window.

## Android

Download **`open-historia.apk`** from the
[`android` release](https://github.com/Open-Historia/open-historia/releases/tag/android) and
open it to install. Android will ask you to allow installing from your browser — this is normal
for an app distributed outside the Play Store. It needs Android 6.0 or newer.

The app carries the whole game: your saves and scenarios, the scenario workshop and the world map
are all on the phone, and it plays in airplane mode from the first launch. Your AI provider and
the community hub are the only things that use the network. There is nothing to run on a PC
alongside it, and a model served on your own network, such as Ollama or LM Studio, can answer it.

It updates itself. When a newer build is published, a banner says *A new version of Open Historia
is ready*; **Update now** downloads it, and opening the finished download installs it over the
app with your games kept.

<p class="beta-note"><b>On beta the app updates as it opens.</b> A newer build found when the app
starts downloads straight away under an <b>Updating Open Historia</b> cover — <b>Not now</b> plays
first — and Android then asks to install it. The first time, Android asks you to allow installs
from Open Historia: allow it, then go back.</p>

**The beta app.** A second app, *Open Historia Beta*, installs beside the stable one: download
**`open-historia-beta.apk`** from the
[`android-beta` pre-release](https://github.com/Open-Historia/open-historia/releases/tag/android-beta).
It has its own icon, the compass with a BETA banner, and its own saves — a game started in one
does not appear in the other, though Export and Import carry games and scenarios across — and it
updates itself from its own release, never to the stable build.

Had the Open Historia app from before 23 September 2026? Uninstall it first. The app is signed
with a new key, and Android will not install it over the old one; uninstalling deletes the old
app's saves on that phone.

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
fetched by `node scripts/fetch-map-assets.mjs`. The default branch is the stable release; the
beta's code is on the `beta` branch.

A copy run from source does not update itself, and there is no update script. To update it,
pull the newest code, install again and rebuild:

```
git pull
npm ci
node scripts/fetch-map-assets.mjs
```

The last line downloads only the map files that are missing or out of date. Then start it as
before (`npm run build` first for the desktop shell).

Full details are in
[`docs/`](https://github.com/Open-Historia/open-historia/tree/main/docs), and
[hosting a server](/wiki/self-hosting/) covers running it for other devices on your network.

## Next

Whichever way you installed, the game is not much use until it has a model to talk to.
Go to [connecting an AI provider](/wiki/ai-setup/).
