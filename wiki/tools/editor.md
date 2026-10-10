The map editor is a full vector editor for building worlds. Draw regions, assign owners, place
cities, set flags and colours, import a background, and hit **Apply & Play** to start a campaign
on what you made.

Open it from any scenario's editor drawer via **🗺️ Open Map Editor**, or go straight to the
standalone editor at **`/?editor=1`**.

![The map editor](/wiki/img/map-editor.jpg)
*The standalone editor on its default world. The tools run along the top; the bottom bar opens the panels, each with a count — regions, countries, features, units, region types.*

## The tools

| Tool | |
|---|---|
| **Select** | Pick a region and inspect it. |
| **Lasso select** | Drag a circle to select several at once. |
| **Pan** | Move the view. |
| **Draw region** | Trace a new territory. Click along an existing border and it follows it. |
| **Edit vertices** | Reshape selected regions point by point, with snapping and undo. |
| **Shared border precision** | Select exactly two neighbours and drag their shared border; it is welded into both. |
| **Move** | Move a region. |
| **Delete** | Remove a region. |
| **Delete border** | Dissolve the boundary between two regions, merging them. |
| **Paint polity** | Click or drag across regions to assign them to a country — one stroke is one undo. |
| **City tool** | Click the map to add a city, click a city to edit it. |
| **Unit tool** | Click the map to place a **starting unit**, click a unit to edit it. |
| **Box-select features** | Drag a rectangle over cities and features to select them all, then tag them in bulk. |

Plus **Undo**, **Redo** and **Fit to data**.

### Two things that make it pleasant

**Drawing traces borders.** Clicking along an existing boundary follows it exactly rather than
making you approximate it by hand. Adjacent countries end up sharing a real border instead of
almost sharing one.

**Regions cannot overlap.** Drawing a new region carves it out of whatever was underneath, so no
piece of ground is ever owned twice. You do not have to clean up after yourself.

## Countries

Every country in the scenario is in the **Countries** panel (the chip in the bottom bar says how
many): a registry you edit in one place — name, aliases, colour, flag, tags, lore — rather than
region by region, with a bulk roster import. Renaming a country there keeps every region, flag,
tag and colour. The selection inspector picks a region's owner from the registry, so a typo
cannot mint a one-province country — but the owner field also takes a name that does not exist
yet and creates the country from it, so you can still work map-first.

A country exists **on the map or not at all**. Only countries that own a region, or claim a
disputed one, are written into the scenario — a record left holding nothing is dropped rather than
shipped as a phantom government in exile that keeps writing to the player. Paint it back in the
same session and its name, aliases and lore return. Creating a country puts it on the map: with
regions selected it takes them, and without a selection it is handed to the paint tool. Its delete
button is **Remove from the map** — its regions become unowned, its claims are dropped, and the
record goes with its colour, flag and tags. See [countries and identity](/wiki/countries/).

## Region properties

Select a region and the inspector gives you its name, its type, its owner, a colour override, a
flag, tags, and **Disputed by** — the claimants list that makes a region render
[striped](/wiki/territory/).

**Region types** are reusable property sets: opacity, stroke, z-order, whether the region is
interactable or passable, whether it appears in labels, and which zoom levels it shows at. Every
document starts with Land and Coastal, and you can define your own.

## Panels

The bottom bar opens them, with a count on each:

| Panel | |
|---|---|
| **Regions** | The full region list, searchable. |
| **Features** | Cities and other placed features. |
| **Units** | The starting units placed with the unit tool. |
| **Types** | Region types. |
| **Countries** | The country registry, above. |
| **Topology** | Find and repair slivers, overlaps and enclosed gaps. |
| **Clipboard** | Regions copied from one map, to paste into another. |
| **Layers** | What is drawn and in what order. |
| **Reference** | Drop in an image to trace over — a historical atlas, a sketch, a screenshot. |
| **Import Map** | Province import, below. |

Plus the **basemap picker** (a built-in basemap, one you uploaded, or a new upload), a **flag
picker** for countries, and **search** to find a place by name.

**Copying between maps.** Copy regions from one map and paste them into another: they replace the
territory they cover (one covered entirely is removed), and countries the target map does not know
yet arrive with their colour and flag.

**Groups.** The **Groups** chip in the bottom bar opens a panel for actors that are not countries
— a cartel, a militia, an outbreak: name one, say what it is (the AI is told this), pick its tint,
and add or remove the selected regions. **Controlled by group** in the region inspector sets it
per selection. A group's area is tinted and outlined on the map and owns nothing; see
[territory](/wiki/territory/#groups).

## Importing

**Cities** can be imported from the built-in database of roughly seventy thousand, filtered to
your map.

**Regions** can be imported from existing geodata.

**Province import** (**Import Map**) turns a raster image into provinces: feed it a map coloured by
province and it traces the regions out for you, in the browser, which is dramatically faster than
drawing a few hundred by hand. Optional definition and metadata files supply owners, names and
cities. It also takes GeoJSON, and **Import explicit city Point markers** brings that file's cities
in as real cities — replacing the current ones or merging with them.

**Features** can be imported too, and box-selected to tag in bulk.

**Fantasy Map Generator** documents import directly, which is the fastest route to a
non-Earth world: generate the landmass there, bring it in here, and paint the politics.

**Custom backgrounds** replace Earth entirely, either as an image pinned to an extent or as
vector artwork. This is what makes fantasy scenarios work — the political layer sits on a world
that has nothing to do with this planet.

## Reference tracing

Load a historical map as a reference image, position it over the canvas, and draw on top of it.
This is by far the most practical way to build a historically accurate scenario, and it is what
the official presets were made with.

## Saving and playing

- **Save** keeps working.
- **Save & Exit** returns to the scenario.
- **Apply & Play** writes the geometry, owners, cities, starting units, palette, flags and
  background back into the scenario and starts a game on it.

Apply & Play is the fast iteration loop: change something, play a turn, come back.

**Every save cleans up the borders first** — slivers, overlaps and gaps between neighbours — then
writes only the regions that changed. The clean-up stops after a minute and looks again only
around its own repairs, so a large map does not stall on it.

**Saving waits for the map.** A scenario's own map streams in after the editor opens, and a large
one takes a while. Until it has loaded, Save reads **Loading map…** and Save & Exit and Apply &
Play are disabled, so an early click cannot write an empty map over your scenario.

## The scenario editor

The map is only part of a scenario. The scenario editor drawer — reachable from any scenario's
card — holds the rest:

**Overview** — name, subtitle, description, accent colour and the hero text players see on the
card.

**World** — the starting country, the game date, the language, which **troop types** are
deployable in this era, the *World Before Round One* briefing that generates the campaign's
backstory, and **Simulation Rules**: house rules injected directly into the world's instructions.
This last one is the most powerful field in the editor. It is where you write things like
"nuclear weapons do not exist in this world" or "the Roman Empire never fell".

**Prompts** — per-section prompt overrides, for authors who want to change how the world thinks.
The default prompts' guidance ships translated for the 22 fully supported languages, and when the
game updates its prompts, a passage you edited is kept while everything else is refreshed.

**Features** — gameplay systems a scenario can switch off or tune, and a game made from it can
override:

| Feature | |
|---|---|
| **Espionage** | Spies, intercepts and foreign agents. Off hides the Spy tab. |
| **Idle diplomacy** | Unprompted notes between turns, and how often — one attempt every 8 minutes on average by default. |
| **World direction** | **Pace** (40–250% of the usual number of events), **the world's share** (at least this much of each skip is not about the player, 35% by default), **priority rules** that outrank everything else the simulation is told, **scripted events** (one per line, the date first — the engine writes any the skip leaves out), and **the map's tempo** (a ceiling on regions changing hands per 30 days). |

<p class="beta-note"><b>On beta there are two more.</b> <b>Puppet states</b> switches the
<a href="/wiki/war/#puppets-and-overlords">puppet system</a> off entirely, and <b>Player focus</b>
sets where new games start on <a href="/wiki/time/#player-focus">how much of a skip is the
player's own</a>.</p>

**Stats** — the scenario's own **National Stats** sheet. See
[scenario stat sheets](/wiki/statistics/#scenario-stat-sheets).

**Assets** — cover image, cities, colours, countries, regions.

**Bundles** — download the whole scenario as a `.zip` or `.json`.

## Sharing what you make

Export a bundle and publish it to the [Community Hub](/wiki/community-hub/). Bundles carry the
map, cities, colours, flags and any custom basemap — including a map uploaded as a tile archive
(`.pmtiles`) rather than drawn in the editor — so someone importing it gets exactly what you
built.

## Next

- [The community hub](/wiki/community-hub/) — publishing it.
- [Territory](/wiki/territory/) — what regions and claims mean in play.
- [Starting a game](/wiki/new-game/) — playing what you made.
