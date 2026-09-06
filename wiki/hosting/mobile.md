There is an Android app. It plays on its own — no PC to run alongside it, no server to set up,
no Termux.

## Installing

Download **`open-historia.apk`** (~6 MB) from the
[`android` release](https://github.com/Open-Historia/open-historia/releases/tag/android).

Android will warn you about installing from your browser rather than the Play Store. That is
expected for an app distributed this way; allow it for your browser and continue.

## First launch

The app itself is tiny because the world map is not in it. On first launch it downloads about
**200 MB** of map data and stores it on the phone.

Use Wi-Fi, and let it finish. After that the map is local and the app starts quickly.

## What it is

A thin client with a small server embedded inside it. Everything runs on the phone: your games
are saved there, the map is stored there, and the game logic runs there.

The only thing that leaves the phone is your AI provider request — the same as any other build.

## Setting up AI

Same as everywhere else: settings, pick a provider, paste a key. See
[connecting an AI provider](/wiki/ai-setup/).

A cloud provider is the practical choice on a phone. Running a local model on the handset is not
realistic; if you have one on a PC on the same network you can point the app at it, but you will
need that machine reachable and its endpoint entered by IP rather than `localhost`.

## Updating

The app checks the release for a newer build and offers it in a banner. Accepting downloads and
installs it; your games are kept.

## Playing on a small screen

The interface adapts, but a grand strategy map is a grand strategy map. Some honest expectations:

- The map is the best part and works well with touch — pan, pinch, tap to select.
- Reading diplomacy and events is comfortable.
- The [map editor](/wiki/editor/) is usable but fiddly. Author worlds on a desktop.
- Long sessions are hard on the battery, because the map is a live 3D surface.

Turning off the **3D globe** and **3D terrain**, and switching on **Reduce motion**, all help
noticeably. See [settings](/wiki/settings/).

## iPhone and iPad

There is no iOS app. Open **[openhistoria.com/play/](/play/)** in Safari and add it to your Home
Screen for a fullscreen window.

Expect it to be slower than the Android app — the browser build streams its map rather than
storing it, and the device is doing more work. It is playable, not ideal.

## Connecting to a machine instead

If you would rather your phone be a window onto a game running on your PC, that works too: run
the server on the PC and open its address on the phone. See
[hosting a server](/wiki/self-hosting/) — including the warning about the API having no
password.

Note that this is not two people playing together. It is one campaign, viewed from a different
screen.

## The beta APK

There is a separate `android-beta` release carrying the beta channel's features. It installs
alongside the stable app rather than replacing it, and keeps its own saves.

## Next

- [Install](/wiki/install/) — the other platforms.
- [Hosting a server](/wiki/self-hosting/) — pointing the phone at a PC.
- [Settings](/wiki/settings/) — what to turn off to save battery.
