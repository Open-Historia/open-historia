Settings live behind the **☰** button — but *what you find there depends on which build you are
running*, and the two are laid out very differently. Work out which one you have first;
everything below is easier once you know.

## Which menu am I looking at?

<p class="beta-note"><b>The stable and beta builds have different menus.</b> They hold much the
same options, but they are organised differently and reached differently. The beta build installs
alongside the stable app, so it is entirely possible to have both on one machine.</p>

### Stable — one flat menu

Press **☰** and everything is in a single scrolling list, top to bottom:

```
☰ ─────────────────────────────────────────
  AI provider              ▾
  API key / model / endpoint
  Custom parameters (JSON)
  UI language              ▾
  AI chat language         ▾
  Fullscreen               [ ]
  3D Globe                 [ ]
  3D Terrain               [ ]
  MAP
    Hide country labels             [ ]
    Reduce motion                   [ ]
    Disable idle globe rotation     [ ]
    Disable camera movement         [ ]
  Limit AI generation      [ ]
  🧪 Cheats
  📖 Wiki
  Discord · Reddit · GitHub
```

No tabs, no sections, no search. Scroll to what you want.

### Beta — a quick menu, then a workspace

Press **☰** and you get a small **quick menu** with four tabs:

```
☰ ┌── Game ──┬── Tools ──┬── Settings ──┬── Help ──┐
  │                                                │
  │ Game      current campaign · switch ·          │
  │           duplicate · import · manage          │
  │                                                │
  │ Tools     🧪 Cheats                            │
  │           Events / Timeline                    │
  │           AI debug console                     │
  │                                                │
  │ Settings  ◫ General      ◇ Map                 │
  │           ✦ AI           ⌘ Advanced            │
  │                                                │
  │ Help      Guides · Report a Bug ·              │
  │           Discord · Reddit · GitHub            │
  └────────────────────────────────────────────────┘
```

Choosing one of the four **Settings** tiles opens a full-screen **workspace** with that section
selected:

| | Section | Holds |
|---|---|---|
| ◫ | **General** | Language, display, accessibility |
| ◇ | **Map** | Basemap, labels, globe, terrain, camera |
| ✦ | **AI** | Provider, model, reasoning, limits, telemetry |
| ⌘ | **Advanced** | Provider parameters, per-task models, profiles, network, diagnostics |

So on beta, reaching a setting is two steps — the quick menu, then the section — while tools that
are buried on stable, such as cheats and the timeline, are one click from the quick menu.

### Translating between the two

| I want to… | Stable | Beta |
|---|---|---|
| Set my API key | ☰ → top of the list | ☰ → Settings → **AI** |
| Change language | ☰ → UI language | ☰ → Settings → **General** |
| Turn off the globe | ☰ → 3D Globe | ☰ → Settings → **Map** |
| Open cheats | ☰ → 🧪 Cheats | ☰ → **Tools** → Cheats |
| Read the wiki | ☰ → 📖 Wiki | ☰ → **Help** → Guides |
| Switch campaign | Exit to the main menu | ☰ → **Game** |
| See what the AI cost | *(not available)* | ☰ → **Tools** → AI debug console |

Everything from here down applies to both builds unless it says otherwise.

## AI provider

The only part you must set up. Covered in full in
[connecting an AI provider](/wiki/ai-setup/) and [AI providers and models](/wiki/ai-providers/).

| Option | |
|---|---|
| **Provider** | Gemini, OpenAI, Anthropic, OpenAI Compatible, Anthropic Compatible. |
| **API Key** | Yours. Stored locally, never sent to an Open Historia server. |
| **Model** | Defaults are sensible; see below. |
| **API Endpoint** | Only for the two Compatible providers. |
| **Model reasoning** | Extended reasoning on models that support it. Slower, better on hard turns. |
| **Custom parameters (JSON)** | Raw fields merged into the request body. An escape hatch — you do not need it. |
| **Strict tool schema** | For OpenAI-compatible endpoints that handle structured output badly. Toggle it if turns keep failing to parse. |

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

The **basemap** — the imagery under the political colours — is chosen from the map controls on
stable, and from Settings → Map on beta. See [the world map](/wiki/world-map/) for the ten
options.

## What to change first

1. **Set up your AI provider.** Nothing else matters until this is done.
2. **Turn on Limit AI generation** if you are running a local model.
3. **Try the 3D globe.** It is the better way to look at the world, and it costs little.
4. **Leave 3D terrain off** unless you specifically want it — it is the most expensive thing in
   the game to render.
5. **Reduce motion** if the interface feels restless.

## Where settings are stored

All of it lives in your browser's local storage, or in the desktop app's own profile. Settings
are therefore **per device and per install**, not per save — moving a campaign to another machine
does not carry your API key with it, which is deliberate.

It also means **the beta build keeps entirely separate settings from the stable one**. Installing
beta does not inherit your stable API key; you will need to paste it in again.

## Beta-only options

<p class="beta-note"><b>Beta channel only.</b> These have no equivalent on stable.</p>

Under **Settings → AI** and **Settings → Advanced**:

- **Per-task model routing** — a cheap model for background work, a strong one for the jump.
- **Configuration profiles** — saved provider setups you can switch between.
- **Prompt caching** and **batched background tasks** (Anthropic), roughly halving the cost of
  background work.
- **AI debug console** — every call with its prompt, answer and cost. Also on the Tools tab.
- **Telemetry** and **generation ratings**.
- **Network sharing** — an explicit toggle for letting other devices reach your server. On
  stable the server is reachable from your network with no toggle and no password; see
  [hosting a server](/wiki/self-hosting/).
- **Diagnostics log** with detailed logging, copyable for bug reports.
- **Beta unit system** — see [military and combat](/wiki/military/).

## Next

- [The interface](/wiki/interface/) — the rest of the screen.
- [AI providers and models](/wiki/ai-providers/) — choosing a model properly.
- [Troubleshooting](/wiki/troubleshooting/) — when a setting does not fix it.
