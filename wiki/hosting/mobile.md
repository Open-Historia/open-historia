There is an Android app. It plays on its own — no PC to run alongside it, no server to set up,
no Termux.

## Installing

Download **`open-historia.apk`** from the
[`android` release](https://github.com/Open-Historia/open-historia/releases/tag/android) and open
it to install.

Android will warn you about installing from your browser rather than the Play Store. That is
expected for an app distributed this way; allow it for your browser and continue.

**Had the older Open Historia app, from before 23 September 2026?** Uninstall it first. The
current app is signed with a new key, and Android will not install it over the old one.
Uninstalling deletes the old app's saves on that phone. From then on, updates install over the
app and keep your games.

**The beta is a second app.** Download `open-historia-beta.apk` from the
[`android-beta` release](https://github.com/Open-Historia/open-historia/releases/tag/android-beta):
it installs as **Open Historia Beta** beside the stable app rather than over it, with its own icon
and its own saves. A game started in one does not appear in the other, though Export and Import
carry games and scenarios across. It carries the beta's features, ahead of the stable app and less
tested.

## What it is

The app is the whole game on the phone: the same game [openhistoria.com/play/](/play/) serves,
with your games, your scenarios, the map editor and the world map all on the device. It plays in
airplane mode from the first launch; only the Community Hub and your AI provider use the network.
Offline, the sea and land under the countries are drawn from relief pictures the app carries.

Your AI provider requests go straight from the phone to the provider, the same as any other
build.

Exports and the diagnostics log are saved to your phone's Downloads folder, under
**Open Historia**, and **Import** opens Android's file picker.

In the background the app rests, so it does not drain the battery: a turn or a reply still being
written is let finish first, and the rest waits until you come back. If Android stops the app's
page to free memory, the app rebuilds it instead of closing.

## Setting up AI

Same as everywhere else: the game menu, pick a provider, paste a key. See
[connecting an AI provider](/wiki/ai-setup/).

A cloud provider is the practical choice on a phone. Running a local model on the handset is not
realistic. A model on a PC on the same network (Ollama, LM Studio) works: enter it by that PC's
IP address rather than `localhost`. The app reaches it without the model needing browser
permissions, but its replies arrive whole rather than word by word.

## Updating

The app checks its release for a newer build. When there is one, a banner says **A new version of
Open Historia is ready**; **Update now** downloads the new APK, and opening the finished download
installs it over the app. Your games are kept.

<p class="beta-note"><b>The beta app updates itself.</b> An update found as the game opens is
downloaded straight away on an <b>Updating Open Historia</b> screen, and Android then asks to
install it; <b>Not now</b> stops the download and opens the game. The first time, Android asks you to allow installs from Open
Historia: allow it, then go back. One found later is offered in the banner, and ☰ → Help →
<b>Check for updates</b> looks for one when you ask.</p>

## Playing on a small screen

The interface adapts, but a grand strategy map is a grand strategy map. Some honest expectations:

- The map is the best part and works well with touch — pan, pinch, tap to select.
- Reading diplomacy and events is comfortable.
- The [map editor](/wiki/editor/) is usable but fiddly. Author worlds on a desktop.
- Long sessions are hard on the battery, because the map is a live 3D surface.

Turning off the **3D globe** and **3D terrain**, and switching on **Reduce motion**, all help
noticeably. See [settings](/wiki/settings/).

<p class="beta-note"><b>On beta, Settings → Map has a Performance mode.</b> <b>Auto</b> picks
<b>Low memory</b> in the Android app, on a touch screen with no mouse, and on a device with 4 GB
of memory or less: the map loads in smaller steps with fewer workers. <b>Full</b> is faster on a
strong tablet. A change applies once the game is reloaded.</p>

<p class="beta-note"><b>Detailed maps are desktop-only.</b> On a phone a scenario that uses one shows
the drawn map underneath.</p>

## iPhone and iPad

There is no iOS app. Open **[openhistoria.com/play/](/play/)** in Safari and add it to your Home
Screen for a fullscreen window.

Expect it to be slower than the Android app — the browser build streams its map rather than
storing it, and the device is doing more work. It is playable, not ideal.

## Connecting to a machine instead

If you would rather your phone be a window onto a game running on your PC, that works too: run
the server on the PC and open its address in the phone's browser. See
[hosting a server](/wiki/self-hosting/) — including the warning about the API having no
password.

Note that this is not two people playing together. It is one campaign, viewed from a different
screen.

## Next

- [Install](/wiki/install/) — the other platforms.
- [Hosting a server](/wiki/self-hosting/) — pointing the phone at a PC.
- [Settings](/wiki/settings/) — what to turn off to save battery.
