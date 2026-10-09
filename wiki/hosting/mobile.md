There is an Android app. It plays on its own — no PC to run alongside it, no server to set up,
no Termux.

## Installing

Download **`open-historia.apk`** (~21 MB) from the
[`android` release](https://github.com/Open-Historia/open-historia/releases/tag/android).

Android will warn you about installing from your browser rather than the Play Store. That is
expected for an app distributed this way; allow it for your browser and continue.

## What it is

The app is the same game [openhistoria.com/play/](/play/) serves, packaged as an Android app.
Your games and scenarios are saved on the phone, and the game logic runs there. The world map is
in the app as well, so the map draws without a connection; only your AI provider needs one.

Your AI provider requests go straight from the phone to the provider, the same as any other
build.

<p class="beta-note"><b>The beta app carries the whole world.</b> The beta channel's Android
build, which has not yet replaced the APK on the release page, ships the world map inside it, trimmed to the zoom the map actually draws, so it plays in
airplane mode from the first launch — only the Community Hub and your AI provider use the
network. It can also export games and save the diagnostics log through Android's share sheet, and
reach a model running on a PC on your own network (Ollama, LM Studio) without that model needing
browser permissions.</p>

## Setting up AI

Same as everywhere else: the game menu, pick a provider, paste a key. See
[connecting an AI provider](/wiki/ai-setup/).

A cloud provider is the practical choice on a phone. Running a local model on the handset is not
realistic. A model on a PC on the same network has to be entered by that PC's IP address rather
than `localhost`, and on the stable app it must also accept requests from a browser page — the
same restriction as [the browser build](/wiki/ai-providers/).

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

## Next

- [Install](/wiki/install/) — the other platforms.
- [Hosting a server](/wiki/self-hosting/) — pointing the phone at a PC.
- [Settings](/wiki/settings/) — what to turn off to save battery.
