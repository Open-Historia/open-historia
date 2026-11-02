Settings live behind the **☰** button in the top-left corner. It opens a small **game menu**,
and the game menu leads to a full-screen **settings workspace**.

<p class="beta-note"><b>On beta the main menu has Settings too.</b> Its <b>Settings</b> button — at
the foot of the menu's rail on a wide screen — opens the same workspace straight away, holding
what applies to every game.
A game's own choices — its <a href="/wiki/time/#player-focus">player focus</a>, its pick of map —
stay in that game's <b>☰</b> menu.</p>

## The game menu

![The game menu, Settings tab](/wiki/img/game-menu-settings.jpg)
*The game menu's Settings tab — the four tiles open the settings workspace at that section.*

Press **☰** and you get the game menu with four tabs — **Game**, **Tools**, **Settings** and
**Help**. Game holds the current campaign and **Game Management** (switch, duplicate, import or
manage campaigns). Tools puts cheats, the events timeline and the AI debug console one click away.
Help has the wiki, bug reporting, the privacy policy and the community links.

Choosing one of the four **Settings** tiles opens the full-screen **workspace** with that section
selected:

| | Section | Holds |
|---|---|---|
| ◫ | **General** | Language, display, accessibility, privacy |
| ◇ | **Map** | Basemap, label font and labels, globe, terrain, camera |
| ✦ | **AI** | Models and backups, connections, reasoning, AI requests, generation behaviour |
| ⌘ | **Advanced** | Per-task models, telemetry, network, diagnostics |

<p class="beta-note"><b>On beta there is a fifth tile, ♫ Sound</b>, for the music and the sound
effects (see <a href="#sound">Sound</a> below), and Help also has <b>Check for updates</b>, which
asks the installed app for a newer build there and then.</p>

### Where things are

| I want to… | Go to |
|---|---|
| Set my API key | ☰ → Settings → **AI** |
| Add a backup model | ☰ → Settings → **AI** → + Add a backup |
| See how many requests I have used today | ☰ → Settings → **AI** → AI requests |
| Change language | ☰ → Settings → **General** |
| Stop Discord showing what I play | ☰ → Settings → **General** → Privacy |
| Turn off the globe | ☰ → Settings → **Map** |
| Change the basemap | ☰ → Settings → **Map** |
| Open cheats | ☰ → **Tools** → Cheats |
| Read the wiki | ☰ → **Help** → Wiki |
| Switch campaign | ☰ → **Game** → Game Management |
| See what the AI cost | ☰ → **Tools** → AI debug console |

<p class="beta-note"><b>On beta:</b> the music and its volume are in ☰ → Settings → <b>Sound</b>;
the switch between the Political and Diplomatic map is in ☰ → Settings → <b>Map</b>, and also at the
bottom right of the screen, under the advisor's button.</p>

## AI

The only part you must set up. Covered in full in
[connecting an AI provider](/wiki/ai-setup/) and [AI providers and models](/wiki/ai-providers/).

### Models and connections

The AI section opens on a list headed **Models**. Each entry is a model on a **connection**:

| On a connection | |
|---|---|
| **Provider** | Gemini, OpenAI, Anthropic, OpenAI Compatible, Anthropic Compatible. |
| **Connection name** | A name you choose, so two keys for the same provider can be told apart. |
| **API Key** | Yours. Stored locally, never sent to an Open Historia server. |
| **API endpoint** | Only for the two Compatible providers. |
| **Custom parameters (JSON)** | Raw fields merged into the request body. An escape hatch — you do not need it. |
| **Strict tool schema** | Only on an OpenAI Compatible connection. Makes a self-hosted backend such as vLLM or SGLang keep to the shape of the answer. Leave it off for OpenAI and Azure, which refuse it. |

| On an entry | |
|---|---|
| **Model** | The model name. Suggestions come from the models you have used recently. |
| **This model only** | Custom parameters for this model alone; **How the AI answers** — the structured-output method to try first. |

Several entries can share one connection, and the list is tried from the top: when one model runs
out or cannot answer, the next one takes over. See [backup models](/wiki/ai-setup/#backup-models).
**+ Add a backup** adds an entry, **Fill…** builds the list from every model you type on every
connection you tick, and **Clear list** empties it while keeping your connections and keys.
**When a model is rate limited** decides what a short pause from the provider does: use the next
one straight away (the default), or wait and try the same one again, which spares your backups'
daily allowance at the cost of a slower turn. **Model reasoning** sits under the list and applies
to every entry.

The **Connections** section below it lists every saved connection, how many entries use it, and
ready-made ones to add: **+ Groq**, **+ OpenRouter** and **+ Local Ollama**. Removing a connection
names the entries that go with it before it asks.

A first Gemini connection fills the list with Google's defaults — `gemini-3.5-flash-lite`, with
`gemini-3.1-flash-lite` as its backup. An OpenAI entry with no model runs `gpt-6-luna`; an
Anthropic one runs `claude-haiku-4-5`.

<p class="beta-note"><b>On beta the key field has an eye button</b> to show or hide the key as
you type it, and in the desktop app there is a sixth provider, <b>Your own Agent</b>, under
<i>Your subscription</i>. It needs no key: what you start waits for your own Claude Code, Codex,
OpenCode or Antigravity CLI, signed in with your own account and opened in the Agent folder
(<b>Open the Agent folder</b>, and a <b>Copy the command for…</b> button for each), where typing
<code>/answer</code> answers everything waiting, a whole time skip included. Its switches say which
of Time skips, Advisor, Diplomacy, Game Master and Interactive events go to it; <b>Pause my
Agent</b> sends everything to the entry below it while you are away. Anything unticked, and what
the game starts by itself, goes to the next entry in the list — with nothing below it, that
background work does not run.</p>

### AI requests

A free key allows a few hundred requests a day, and this section decides how many the game
spends. It shows how many have been used today (counted on this device, from midnight Pacific
time, which is when a Gemini key's day begins) and what your last time skip cost.

| Setting | |
|---|---|
| **Save AI requests** | **On by default.** A time skip is one request either way: each event arrives already carrying what it changed, and your agents' reports come back in the same answer. On, the model is handed the names it needs instead of looking them up, and a small mistake in its answer is cut out rather than asked for again; a skip takes a second request only when its answer could not be used at all, when a provider refuses the single-request form, or on a turn where the automatic Stats refresh falls due. Off is for a key with no daily limit: with AI lookup functions on, the model may look things up before it answers — two rounds at most, so a skip never uses more than three — and outside a skip a flawed answer is sent back to be redone. |
| **Requests a day your key allows** | 500 by default. Used only for the count and to keep background AI off the end of your day. The game never stops you at the limit; your provider does. |
| **Background AI** | **On by default.** While you are not skipping time, countries may write to you unprompted, forces may reposition, agents may file extra reports, and a country you look at gets its first intelligence reading. Off: the game only calls the model when you do something. |
| **Background requests a day, at most** | 30 by default. Background AI also stops by itself once less than a tenth of your day is left. |

<p class="beta-note"><b>On beta the section does more.</b> <b>Used today, by task</b> opens the
day's count task by task; an <b>Emergency AI stop</b> box holds <b>Cancel all AI requests</b>,
which stops every AI call the game can still abort; and NPC votes in an institution are a second
thing, beside the Stats refresh, that can add a request to a skip when they fall due.</p>

### Generation behaviour

| Setting | |
|---|---|
| **Limit AI generation** | **Off by default.** On, the game stops waiting and falls back to canned events when the model goes quiet — five minutes of silence part-way through an answer, or fifteen with no answer at all. It measures **silence**, not elapsed time: a model that is still writing is never interrupted. Worth turning on for a local model, or if you have had turns hang. |
| **Generate long time skips in segments** | **Off by default.** On, skips of more than a few months are generated as several shorter requests merged into one round — slower and costlier, but far less likely to time out on a hosted provider. See [time and turns](/wiki/time/). |
| **AI lookup functions** | On by default, but only used while Save AI requests is off. The model can call functions — exact power and region names, a region's neighbours, the war ledger, a chat — in up to three extra requests per task, and two inside a time skip. Needs a provider that supports function calling. |
| **Show time skip events as they are written** | **On by default.** A skip opens the Events panel and fills it as the model writes. Off: the round appears at the end. The turn is the same either way, and Gemini arrives all at once regardless. |
| **Batch background AI tasks** | Anthropic only, off by default. History consolidation runs through the Message Batches API at about half the price and lands a little later. |

<p class="beta-note"><b>On beta, Player focus sits here too</b> — how much of each time skip is
about your own country, stored with the game rather than the device. See
<a href="/wiki/time/#player-focus">time and turns</a>. So does <b>Stop when my events fail</b>, off
by default: on, a skip that has an event about your country refused, or an order of yours left
without an outcome, stops before anything is saved and lists what failed, so you can retry those
events, retry the whole skip, or keep it and move on.</p>

## General

**UI language** translates the interface. Applying it reloads the page. Twenty-two languages ship
fully translated — Arabic, Bengali, Chinese, Dutch, French, German, Hindi, Indonesian, Italian,
Japanese, Korean, Persian, Polish, Portuguese, Russian, Spanish, Swedish, Thai, Turkish,
Ukrainian, Urdu and Vietnamese — and the list marks them. In those, the interface costs no AI
requests at all; only content a scenario's author or a player wrote (scenario names, polity
names, custom events) is sent to your model to translate, once. Other languages are still
offered, translated by your model as panels are met.

**AI chat language** is separate: it is the language leaders and events are written in. You can
run an English interface with French diplomacy, or the reverse.

**Fullscreen** is under Display, and **Reduce motion** under Accessibility. Reduce motion turns on
both camera switches in the Map section at once — turn it on first if the game feels busy or you
are prone to motion sickness.

**Privacy** holds the two things the game tells other services about you, with a link to the
[privacy policy](/privacy/):

| Switch | |
|---|---|
| **Show what I am playing on Discord** | Desktop app only, on by default. Discord shows the country you play, the scenario and the in-game date to people who can see your activity. |
| **Count my visits** | **Off unless you say yes.** Lets Google Analytics and Umami count that you played and which version; Google Analytics sets cookies. If your browser asks sites not to track you, it stays off until you answer yourself. Only shown where the build counts visits. |

<p class="beta-note"><b>On beta</b>, Display also has <b>Show the vault door every time</b>, off by
default: the door shows the first time the game opens after an update, and with this on, at every
start. Reduce motion also follows your system's own reduced-motion setting (the switch then shows
on and cannot be turned off here), lands a region's new colour at once instead of sweeping it in,
and lets the vault door simply fade away.</p>

## Sound

<p class="beta-note"><b>Beta channel only.</b></p>

The game has a soundtrack: music by Scott Buckley, released under CC BY 4.0, which Settings credits
along with every piece it ships. The menu, a game opening, a game being played and the War Room
each have their own; a scenario may bring tracks of its own from the community hub's music list.

| Setting | |
|---|---|
| **Music** | On by default. Nothing plays until your first click, tap or key press, and the music stops while the window is hidden. |
| **Music volume** | 0 to 100%, 25% by default. |
| **Sound effects** | On by default — the vault door's among them. |
| **Downloaded music** | How many scenario tracks are kept on this device, and how much room they take. **Clear** deletes them; a scenario that plays one again downloads it again. |

While a scenario's own track plays, **Now playing** names it and who made it.

## Map

| Option | |
|---|---|
| **Basemap** | The imagery under the political colours. *Scenario default* uses whatever the scenario's author chose; fourteen others override it. A scenario with a map of its own keeps it, and the list is greyed out. See [the world map](/wiki/world-map/#basemaps). |
| **Country label font** | Empty uses the scenario's font. Any font installed on your computer works. |
| **Hide country labels** | Removes country names from the map. |
| **3D Globe** | Sphere instead of a flat map, with a real day/night terminator. Marked experimental. A scenario whose map is a flat sheet can switch the globe off, and the switch then says so. |
| **3D Terrain** | Elevation with heavy exaggeration. Marked experimental, and flat map only. |
| **Disable idle globe rotation** | Stops the globe turning on its own. |
| **Disable camera movement during events** | Stops the camera flying to each event during the [staged reveal](/wiki/events/). |

Switching the globe on or off shows the game's loading screen while the map redraws from nothing.

<p class="beta-note"><b>On beta the Map section has more.</b> <b>Map mode</b> switches between
<b>Political</b> and <b>Diplomatic</b>, which colours each country by where it stands with you —
your puppets, allies, friends, hostile countries and enemies at war; every time the game opens it
starts on Political. In a game, <b>Basemap</b> picks among the maps the scenario offers, the
starting one first, and the pick is kept for that game on this device; from the main menu it is
<b>Use my default basemap</b> and <b>Default basemap</b>, a built-in map every game starts on
wherever its scenario offers it. In the desktop app, <b>Detailed maps</b> lists the scenario's
large terrain maps you are missing or have an older version of, with <b>Download…</b>, and
<b>Browse and download maps…</b> opens your basemaps, your detailed maps and the community's. <b>Seasons and weather</b> (on by default) tints the map by
the season and shows its weather, and <b>Weather effects</b> under it (on by default, off by
default in Low memory) draws the rain, snow, frost and fog. <b>Performance mode</b> is
<b>Auto</b>, <b>Low memory</b> or <b>Full</b>: Auto picks Low memory in the Android app, on a
touch screen with no mouse, and on a device with 4 GB of memory or less, and a change applies
after the game is reloaded.</p>

## Advanced

| Setting | |
|---|---|
| **Per-task models** | Point a task at one entry in the list: a cheap model for background tasks, a strong one for the jump itself. The task tries its pick first, then the list from the top. The single most effective way to cut cost without making turns worse. |
| **Record AI telemetry** | Keeps every AI call — prompt, answer, model, tokens, latency, validation verdict — for the **AI debug console** (200 across sessions). Off: the console sees this session only. |
| **Rate AI generations** | Off by default. A small 1–10 bar after each time skip, Game Master edit and interactive event, stored beside the call in the console. Feedback for you, not sent anywhere. |
| **Let other devices connect** | Under **Network**, desktop only. The server answers this machine only until you turn it on. See [hosting a server](/wiki/self-hosting/). |
| **Keep a diagnostics log** | Under **Diagnostics**. On by default. **📋 Copy log**, **💾 Save log file**, or **💾 Save log file + game** to send with a bug report; the 💾 **Save logging file** button on a failed turn or advisor reply saves the same file with that failure attached. **🔎 View log** reads it in place and **Clear** empties it. Off means nothing is recorded and the stored log is thrown away. |
| **Detailed logging** | Off by default. See below — **please turn it on if you are going to report a bug**. |

<p class="beta-note"><b>On beta</b>, with Let other devices connect on, a second switch — <b>Let
other devices send AI calls through this server</b> — lets a browser on another device reach a
model running on this computer (LM Studio, Ollama) that refuses calls from other sites. And a
<b>Storage</b> section, on the desktop, says how many community downloads are kept and how much
room they take, with <b>Clear download cache</b>; past 1 GB the ones used longest ago are removed
on their own.</p>

## What to change first

1. **Set up your AI provider.** Nothing else matters until this is done.
2. **Look at AI requests** if you are on a free key — the defaults are chosen for one, and the
   counter tells you what a turn costs.
3. **Turn on Limit AI generation** if you are running a local model.
4. **Try the 3D globe.** It is the better way to look at the world, and it costs little.
5. **Leave 3D terrain off** unless you specifically want it — it is the most expensive thing in
   the game to render.
6. **Reduce motion** if the interface feels restless.

## Where settings are stored

All of it lives in your browser's local storage, or in the desktop app's own profile. Settings
are therefore **per device and per install**, not per save — moving a campaign to another machine
does not carry your API key with it, which is deliberate.

It also means **the beta build keeps entirely separate settings from the stable one**. Installing
beta does not inherit your stable API key; you will need to paste it in again.

## Detailed logging

**☰ → Settings → Advanced → Diagnostics → Detailed logging**, off by default.

The ordinary log is a running record of what you did — saves opened, orders queued, turns taken —
and anything that went wrong. Detailed logging records **everything**, and it is the difference between a bug report someone can act on and one that just says the game misbehaved.

### Please turn it on before reporting a bug

If you are about to report something — especially anything about the advisor, diplomacy or a turn
going wrong — switch it on, reproduce the problem, then save the log as a file and attach it. A
maintainer can very often find the cause immediately from a detailed log and not at all from a
normal one.

### What it adds

| | Normal | Detailed |
|---|---|---|
| Detail per entry | 600 characters | 20,000 |
| Stack frames | 1 | 8 |

Both keep up to 5,000 entries and 1 MB; the difference is what gets recorded, not how much is
kept.

And it records what the normal log leaves out:

- **Every message to and from your advisor**, in full.
- **Every diplomatic message**, in full, with who said it to whom.
- **Letters the advisor drafted**, and the notes countries send you.
- **Every AI task and what it answered**, and why an answer was rejected.
- **What each turn changed in the world.**
- **Every server request and every save**, with sizes.
- **Which panels you opened**, and the game's routine console messages.

The conversations are deliberate. The bugs people actually report about diplomacy are about the
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
