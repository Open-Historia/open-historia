Settings live behind the settings button — **⋮** on stable, **☰** on beta — but *what you find there depends on which build you are
running*, and the two are laid out very differently. Work out which one you have first;
everything below is easier once you know.

## Which menu am I looking at?

<p class="beta-note"><b>The stable and beta builds have different menus.</b> They hold much the
same options, but they are organised differently and reached differently. The beta build installs
alongside the stable app, so it is entirely possible to have both on one machine.</p>

### Stable — one flat menu

![The stable settings menu](/wiki/img/settings-menu.jpg)
*The stable build's settings: one scrolling list, no tabs. Your API key is stored locally and shown masked.*

Press **⋮** and everything is in a single scrolling list. In order, top to bottom: the **AI
provider** and its key, model and endpoint; **custom parameters**; **UI language** and **AI chat
language**; **Fullscreen**, **3D Globe** and **3D Terrain**; a **Map** group holding country
labels, reduced motion and the two camera options; **Limit AI generation**; then **🧪 Cheats**, a
**📖 Wiki** link and the community links.

No tabs, no sections, no search. Scroll to what you want.

### Beta — a quick menu, then a workspace

![Beta quick menu, Settings tab](/wiki/img/beta-quick-settings.jpg)
*Beta's quick menu, Settings tab — the four sections open a full-screen workspace.*

Press **☰** and you get a small **quick menu** with four tabs — **Game**, **Tools**, **Settings**
and **Help**. Game holds the current campaign and the switch, duplicate, import and manage
actions. Tools puts cheats, the events timeline and the AI debug console one click away. Help has
the guides, bug reporting and the community links.

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
| Set my API key | ⋮ → top of the list | ☰ → Settings → **AI** |
| Change language | ⋮ → UI language | ☰ → Settings → **General** |
| Turn off the globe | ⋮ → 3D Globe | ☰ → Settings → **Map** |
| Open cheats | ⋮ → 🧪 Cheats | ☰ → **Tools** → Cheats |
| Read the wiki | ⋮ → 📖 Wiki | ☰ → **Help** → Guides |
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

## The map renderer

<p class="beta-note"><b>Beta channel only.</b> The stable build has one renderer and no setting
for it.</p>

![The Legacy map renderer toggle](/wiki/img/beta-renderer-setting.jpg)
*Settings → Map → Renderer on beta. Note that the description mentions only a redraw — restart anyway.*

Beta is developing a new map renderer — **Map vNext** — and ships it as the default. It draws
dissolved polity surfaces, stitched frontiers and curved polity labels, rather than filling each
region separately.

It is a work in progress. If you would rather have the older look, or vNext is giving you
trouble, you can switch back:

**Settings → Map → Renderer → "Legacy map renderer"**

Off by default. On, you get the renderer the game used before vNext — per-region fills and the
older country labels. This is a **rendering choice only**: no world state, save data or geometry
differs between them, and you can switch back and forth as often as you like without touching
your campaign.

### Restart the app after switching

The map redraws when you flip the toggle, but **the change does not fully take effect until you
restart Open Historia**. Switch it, then close the app and reopen it. Until you do, expect the
map to be only partly converted.

The in-app description does not currently mention this — it says only that switching redraws the
map. Restart anyway.

Also worth knowing: **vNext takes noticeably longer to draw when a campaign opens**, because it
dissolves every polity's surface before revealing the map. A long "drawing borders and labels"
pause on open is normal for vNext, not a hang. The legacy renderer opens faster.

## Beta-only options

<p class="beta-note"><b>Beta channel only.</b> These have no equivalent on stable.</p>

Every one of these is under **Settings → AI** or **Settings → Advanced**, and none has an
equivalent on stable.

### Cost and speed

| Setting | |
|---|---|
| **Generate long time skips in segments** | A long skip runs as several shorter requests merged into one round. Costs more tokens; far less likely to time out. See [time and turns](/wiki/time/). |
| **Batch background AI tasks** | Anthropic only. Background work (such as history consolidation) rides the Message Batches API at roughly half price. It is not instant, which is why it is only used for work you are not waiting on. |
| **Per-task model routing** | A cheap model for background tasks, a strong one for the jump itself. The single most effective way to cut cost without making turns worse. |
| **Configuration profiles** | Saved provider setups — key, model, endpoint, parameters — that you can switch between by name. |

### Seeing what the AI did

| Setting | |
|---|---|
| **AI debug console** | Every call with its task, model, prompt, answer, token counts, latency and cost. Also on the quick menu's Tools tab. |
| **Record AI telemetry** | Keeps that per-call record. On by default. Turning it off empties the debug console. |
| **Rate AI generations** | Shows a 1–10 rating bar after each jump so you can score what the model produced. Feedback for you, not sent anywhere. |

### Diagnostics and network

| Setting | |
|---|---|
| **Keep a diagnostics log** | On by default. Records errors, API failures and the exact context the model was given, copyable for a bug report. Off means nothing is recorded and the stored log is thrown away. |
| **Detailed logging** | Off by default. See below — **please turn it on if you are going to report a bug**. |
| **Let other devices connect** | Opens the server to your network. Beta binds to loopback only by default; stable is open with no toggle and no password. See [hosting a server](/wiki/self-hosting/). |

### Gameplay and presentation

| Setting | |
|---|---|
| **Beta unit system** | AI-driven unit movement with postures and standing orders, instead of hands-on control. Stored per save, not per browser. See [military and combat](/wiki/military/). |
| **Legacy map renderer** | The pre-vNext renderer. **Restart the app after switching.** See above. |
| **Basemap** and **label font** | Beta moves the basemap picker into Settings → Map and adds a label-font override; on stable the basemap is chosen from the map controls. |

## Detailed logging

**Settings → Advanced → Detailed logging**, off by default.

The ordinary log records failures. Detailed logging records **everything**, and it is the
difference between a bug report someone can act on and one that just says the game misbehaved.

### Please turn it on before reporting a bug

If you are about to report something — especially anything about the advisor, diplomacy or a turn
going wrong — switch it on, reproduce the problem, then copy the log out. A maintainer can very
often find the cause immediately from a detailed log and not at all from a normal one.

### What it adds

| | Normal | Detailed |
|---|---|---|
| Entries kept | 400 | 5,000 |
| Total log size | ~192 KB | ~1 MB |
| Detail per entry | 600 characters | 20,000 |
| Stack frames | 1 | 8 |

And it records categories the normal log leaves out entirely:

- **Every AI task and API call**, not only the ones that failed.
- **World-state changes**, turn by turn.
- **Panel navigation** and general console output.
- **The full text of every conversation with the model** — what you asked the advisor and what it
  answered, every diplomatic message in both directions, and the notes a turn or the idle drip
  dropped into your inbox.

That last one is deliberate. The bugs people actually report about diplomacy are about the
*content* of an exchange — "it forgot what I told it", "it replied as the wrong country", "it
drafted a letter and sent something else" — and a log that records only that an exchange happened
cannot settle any of them.

### What it means for your privacy

It quotes considerably more of your campaign than the normal log: your conversations, in full.
That is all fiction you or the model wrote, but it is yours, so read the log before you paste it
somewhere public.

**API keys are never recorded.** Nothing on this path reads a key deliberately, and every entry is
run through a redaction pass as it is written — not at export time — so a key that arrives by
accident inside a provider error or a URL is scrubbed before it is ever stored.

Both switches persist across restarts and across campaigns.

## Next

- [The interface](/wiki/interface/) — the rest of the screen.
- [AI providers and models](/wiki/ai-providers/) — choosing a model properly.
- [Troubleshooting](/wiki/troubleshooting/) — when a setting does not fix it.
