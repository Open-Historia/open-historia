Almost the entire screen is map. Everything else sits around the edges and gets out of the way
when you are not using it.

<p class="beta-note"><b>This page describes the stable build.</b> The beta channel reorganises the
menus considerably and adds a Projects button to the toolbar — see
<a href="/wiki/settings/">the settings reference</a> for a side-by-side of the two menu systems.</p>

![The in-game HUD](/wiki/img/interface-hud.jpg)
*The session pill and date pill top, the toolbar bottom left, the advisor on the right edge. Everything else is map.*

## The edges at a glance

| Where | What |
|---|---|
| **Top left** | Session pill — scenario, country, date — and **⌂ Exit Game**. |
| **Top right** | The date pill, with **«** history and **»** time skip. |
| **Bottom left** | The toolbar: **💬 Chat** and **✦ Actions**. |
| **Right edge** | **🧭 Advisor** — opens a drawer with Advisor and Stats. |
| **Corner** | Settings (**⋮**) and search (**🔍**). |

Panels overlap in a fixed order, so opening the advisor never buries the thing you were reading,
and the main menu always comes out on top.

## The map itself

Clicking things is the primary way you interact with the world.

- **Click a region** → a popup with the region, who administers it, and buttons to open an
  intelligence briefing, start a chat, or open the owning country's panel.
- **Click a country** → the country dossier: flag, tags, recent events filtered by importance,
  and an AI intelligence briefing on request.
- **Click a unit** → an intelligence card describing the formation — what it is, whose it is,
  how strong, and what it appears to be doing.
- **Click a city or structure** → its name, population, and what it is.

Drag to pan, scroll to zoom. See [the world map](/wiki/world-map/) for what the colours,
stripes and labels mean.

## The date pill and time

Top right, always visible: your country and the current in-game date.

- **»** opens the **time skip** panel — fixed jumps from six hours to a year, a custom amount,
  auto-jump, and **Undo turn**.
- **«** opens the **event history** — the events from the last jump, replayed one at a time,
  with the map animating as each lands.

Full detail in [time and turns](/wiki/time/).

## The toolbar

Two buttons, bottom left. (Beta adds a third, **Projects** — see
[projects and operations](/wiki/projects/).)

### 💬 Chat

Diplomacy. Two tabs:

- **Diplomacy** — every conversation you are part of. One-to-one threads with a country, or
  group threads with several. Countries open threads with you unprompted, and unread ones are
  badged.
- **Spy** — everyone else's conversations, as far as your intelligence service can read them.
  This is also where you deploy, recall, expel and turn agents.

See [diplomacy](/wiki/diplomacy/) and [espionage](/wiki/espionage/).

### ✦ Actions

Your order queue for the coming turn. Write orders in plain English, get AI suggestions, refine
a rough draft into a proper order, and delete anything you change your mind about. Only planned
orders show; they clear as the turn resolves them. See [giving orders](/wiki/orders/).

## The advisor drawer

The **🧭** button on the right edge opens a drawer you can resize by dragging its left edge. It
has two tabs.

**Advisor** — a chat with your own analyst. It reads the real game state and answers about it,
in markdown, sometimes with charts. Ask it anything about your position.

**Stats** — the national stat sheet. Two sub-tabs, **Diplomacy** and **Economy**, covering your
intelligence rating, strategic indices, stability, population and economic figures. It retargets
to **whatever country you last clicked**, so it doubles as a way to read anyone.

See [the advisor](/wiki/advisor/) and [national statistics](/wiki/statistics/).

## Settings

On stable, the **⋮** button opens **one flat menu** with everything in it: your AI provider and
its key and model, UI and chat language, fullscreen, the 3D globe and terrain, a **Map** group
holding country labels, reduced motion and the camera options, plus **🧪 Cheats**, a **📖 Wiki**
link and the community links. No tabs, no sections — scroll to what you want.

On beta the equivalent button is **☰**, and it opens a **quick menu** with Game / Tools / Settings / Help tabs, and
settings themselves live in a separate four-section workspace.

Both are laid out side by side in [the settings reference](/wiki/settings/).

## Search

The **🔍** button finds real-world places by name and flies the camera to them. It only moves the
camera — it does not select or change anything.

## Cheats

The **🧪** cheats panel is the game master's toolbox: annex territory, edit or create countries,
author events, roll back turns, switch which country you play, inspect regions, and place map
features.

It is also where **manual troop control** lives. On the stable build, deploying and moving units
by hand is deliberately filed as a cheat — the intended way to move forces is to order it and
let the world carry it out. See [cheats and the GM console](/wiki/cheats/) and
[military and combat](/wiki/military/).

## The main menu

The session pill's **⌂ Exit Game** returns you to the library, which has three tabs:

- **Games** — your campaigns, by last played and most played.
- **Scenarios** — the worlds you can start new games on, plus **Create**.
- **Community** — the [Community Hub](/wiki/community-hub/).

## If the screen is blank

A full-screen warning means WebGL is unavailable — the map cannot render without it. On a
desktop this usually means graphics drivers or a browser flag. See
[troubleshooting](/wiki/troubleshooting/).

## Next

- [The world map](/wiki/world-map/) — reading what you are looking at.
- [Time and turns](/wiki/time/) — the button that actually advances the game.
