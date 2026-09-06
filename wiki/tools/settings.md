Everything lives behind the **☰** button. This page lists what each option does and which ones
are actually worth changing.

## AI provider

The top of the menu, and the only part you must set up. Provider, API key, model, endpoint —
covered in full in [connecting an AI provider](/wiki/ai-setup/) and
[AI providers and models](/wiki/ai-providers/).

| Option | |
|---|---|
| **Provider** | Gemini, OpenAI, Anthropic, OpenAI Compatible, Anthropic Compatible. |
| **API Key** | Yours. Stored locally, never sent to an Open Historia server. |
| **Model** | Which model to use. Defaults are sensible; see below. |
| **API Endpoint** | Only for the two Compatible providers. |
| **Model reasoning** | Enables extended reasoning on models that support it. Slower, better on hard turns. |
| **Custom parameters (JSON)** | Raw fields merged into the request body. An escape hatch — you do not need it. |
| **Strict tool schema** | For OpenAI-compatible endpoints that handle structured output badly. Try toggling it if turns keep failing to parse. |

Default models: Gemini `gemini-3.5-flash-lite`, Anthropic `claude-haiku-4-5`, and
`http://localhost:11434/v1` as the OpenAI-compatible endpoint (Ollama's default).

Settings are stored **per provider**, so switching to a local model and back does not lose your
cloud keys.

## Limit AI generation

**Off by default.** Turned on, a generation that goes quiet is abandoned and the turn falls back
to a canned event instead of hanging indefinitely.

It measures **silence**, not total elapsed time — a model that is slowly but genuinely producing
output is not cut off. Worth turning on if you use a local model, or if you have had turns hang.

## Language

**UI language** translates the interface. Applying it reloads the page. Around fifty languages
are available.

**AI chat language** is separate: it is the language leaders and events are written in. You can
run an English interface with French diplomacy, or the reverse.

## Display

| Option | |
|---|---|
| **Fullscreen** | Borderless fullscreen. |
| **3D Globe** | Sphere instead of a flat map, with a real day/night terminator. |
| **3D Terrain** | Elevation with heavy exaggeration. Labelled "Very Experimental" and it means it. Flat map only, and disabled by a custom background. |

## Map

| Option | |
|---|---|
| **Hide country labels** | Removes country names from the map. |
| **Reduce motion** | Umbrella switch quieting several animations at once. Turn this on first if the game feels busy or you are prone to motion sickness. |
| **Disable idle globe rotation** | Stops the globe turning on its own. |
| **Disable camera movement during events** | Stops the camera flying to each event during the [staged reveal](/wiki/events/). |

The **basemap** — which imagery sits under the political colours — is chosen from the map
controls rather than this menu. See [the world map](/wiki/world-map/) for the ten options.

## Help and community

A **📖 Guides** link (which brings you here), plus Discord, Reddit and GitHub.

## Cheats

The menu also opens the **🧪 Cheats** panel. See
[cheats and the GM console](/wiki/cheats/).

## What to change first

1. **Set up your AI provider.** Nothing else matters until this is done.
2. **Turn on Limit AI generation** if you are running a local model.
3. **Try the 3D globe.** It is the better way to look at the world, and it costs little.
4. **Leave 3D terrain off** unless you specifically want it — it is the most expensive thing in
   the game to render.
5. **Reduce motion** if the interface feels restless.

## Where settings are stored

All of it lives in your browser's local storage, or in the desktop app's own profile. That means
settings are **per device and per install**, not per save — moving a campaign to another machine
does not carry your API key with it, which is deliberate.

It also means the beta build keeps entirely separate settings from the stable one.

## What the beta adds

<p class="beta-note"><b>Beta channel only.</b></p>

The beta channel reorganises this into a four-section workspace (General, Map, AI, Advanced) and
adds per-task model routing, saved configuration profiles, prompt caching, batched background
tasks, an AI debug console showing every call and its cost, telemetry and generation ratings, a
network-sharing panel, and a copyable diagnostics log.

## Next

- [AI providers and models](/wiki/ai-providers/) — choosing a model properly.
- [Troubleshooting](/wiki/troubleshooting/) — when a setting does not fix it.
