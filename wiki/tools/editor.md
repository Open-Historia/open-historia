The map editor is a full vector editor for building worlds. Draw regions, assign owners, place
cities, set flags and colours, import a background, and hit **Apply & Play** to start a campaign
on what you made.

Open it from any scenario's editor drawer via **🗺️ Open Map Editor**, or go straight to the
standalone editor at **`/?editor=1`**.

## The tools

| Tool | |
|---|---|
| **Select** | Pick a region and inspect it. |
| **Lasso select** | Drag a circle to select several at once. |
| **Pan** | Move the view. |
| **Draw region** | Trace a new territory. Click along an existing border and it follows it. |
| **Edit vertices** | Reshape an existing region point by point. |
| **Move** | Move a region. |
| **Delete** | Remove a region. |
| **Delete border** | Dissolve the boundary between two regions, merging them. |
| **Paint owner** | Click regions to assign them to a country. |
| **City tool** | Click the map to add a city, click a city to edit it. |

Plus **Undo**, **Redo** and **Fit to data**.

### Two things that make it pleasant

**Drawing traces borders.** Clicking along an existing boundary follows it exactly rather than
making you approximate it by hand. Adjacent countries end up sharing a real border instead of
almost sharing one.

**Regions cannot overlap.** Drawing a new region carves it out of whatever was underneath, so no
piece of ground is ever owned twice. You do not have to clean up after yourself.

## Creating countries

There is no "add country" step. **Paint a region with a name that does not exist and that country
now exists** — with a generated colour, ready to be given a flag and edited.

This follows from names being the game's identity system. See
[countries and identity](/wiki/countries/).

## Region properties

Select a region and the inspector gives you its name, its type, its owner, a colour override, a
flag, tags, and **Disputed by** — the claimants list that makes a region render
[striped](/wiki/territory/).

**Region types** are reusable property sets: opacity, stroke, z-order, whether the region is
interactable or passable, whether it appears in labels, and which zoom levels it shows at. Every
document starts with Land and Coastal, and you can define your own.

## Panels

| Panel | |
|---|---|
| **Layers** | What is drawn and in what order. |
| **Regions** | The full region list, searchable. |
| **Feature manager** | Cities and other placed features. |
| **Basemap picker** | The imagery underneath, or a custom background image. |
| **Flag picker** | Assign flags to countries. |
| **Reference** | Drop in an image to trace over — a historical atlas, a sketch, a screenshot. |
| **Search** | Find a place by name. |

## Importing

**Cities** can be imported from the built-in database of roughly seventy thousand, filtered to
your map.

**Regions** can be imported from existing geodata.

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
- **Apply & Play** writes the geometry, owners, cities, palette, flags and background back into
  the scenario and starts a game on it.

Apply & Play is the fast iteration loop: change something, play a turn, come back.

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

**Assets** — cover image, cities, colours, countries, regions.

**Bundles** — download the whole scenario as a `.zip` or `.json`.

## Sharing what you make

Export a bundle and publish it to the [Community Hub](/wiki/community-hub/). Bundles carry the
map, cities, colours, flags and any custom basemap, so someone importing it gets exactly what you
built.

## Next

- [The community hub](/wiki/community-hub/) — publishing it.
- [Territory](/wiki/territory/) — what regions and claims mean in play.
- [Starting a game](/wiki/new-game/) — playing what you made.
