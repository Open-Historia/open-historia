The map is the game's main display and its main control. Everything on it is clickable, and the
way it is coloured tells you who holds what.

## Political fills

Every region is painted in the colour of whoever administers it, at a constant 72% opacity over
the basemap, so you can still read the terrain underneath.

Colours are resolved in a fixed order: the scenario's own palette first, then any colour set on
the country, then a match against known aliases, and finally a colour derived from the country's
name. That last fallback is why an invented faction always gets *a* colour even if you never
picked one — and why two countries occasionally land on similar shades.

![The 3D globe](/wiki/img/world-map-globe.jpg)
*The globe, with the real day/night terminator falling across Africa and the starfield behind it. Western Sahara is striped even at this angle.*

## Striped regions mean a dispute

A region rendered in **stripes** is claimed by more than one country. The stripes combine the
colour of whoever actually administers it with the colours of the claimants.

This is a real mechanic, not decoration — see [territory](/wiki/territory/) for the difference
between holding ground and being acknowledged as its owner.

## Labels

Country names scale with the map and fade out as you zoom in, on the assumption that once you
are looking at one country closely you no longer need it named. Cities appear from about zoom
3.4 and get more numerous as you go in.

Scenario authors can set the label font, letter colour and border colour for their world, so a
custom map may look quite different from Modern Day.

You can turn country labels off entirely in **Settings → Map**.

## Zoom and bounds

The camera runs from zoom **2.25** (the whole world) to **16** (street level, where the basemap
supports it). Vertical panning is bounded at roughly 80°S to 85°N — there is no reason to fly off
the top of the map.

## Basemaps

The imagery under the political fills. **Settings → Map → Basemap** offers ten:

| | |
|---|---|
| Satellite | Photographic imagery |
| Streets | Roads and place names |
| Topographic | Contours and relief |
| Terrain | Physical terrain base |
| Shaded Relief | Hillshading only |
| Physical | Natural-earth style |
| National Geographic | Atlas styling |
| **Ocean** | The default — bathymetry and a muted land base |
| Light Gray Canvas | Minimal, light |
| Dark Gray Canvas | Minimal, dark |

Your choice is stored per browser and overrides whatever the scenario author picked. Clearing it
hands control back to the scenario.

Not every basemap has imagery at every zoom — Physical stops at zoom 8, Terrain and Shaded Relief
at 13. Past that the game upscales the last available tiles rather than showing nothing.

## The 3D globe

**Settings → Map → 3D Globe** swaps the flat projection for a sphere.

It is not just a projection change. The globe carries a real day/night terminator computed from
the actual subsolar point, a starfield, and a sun sprite — the lighting corresponds to the real
world clock, refreshed every minute. Left alone, the globe rotates slowly, a full turn every ten
minutes.

Both the idle rotation and the general motion can be switched off — **Disable idle globe
rotation**, or **Reduce motion** as an umbrella setting.

## 3D terrain

**Settings → Map → 3D Terrain**, labelled "Very Experimental" and honestly so. It raises real
elevation with a heavy 15× exaggeration so that mountain ranges actually read at world scale,
plus light hillshading.

It only applies on the flat map — terrain and the globe are mutually exclusive, and a scenario
with a custom background image disables it too.

## Custom backgrounds

A scenario can replace Earth entirely, either with an image pinned to a geographic extent or
with its own vector artwork. This is how fantasy maps work: the political layer sits on top of a
world that has nothing to do with this planet.

## Clicking things

| Click | You get |
|---|---|
| **A region** | Who administers it, an intelligence briefing, a shortcut to open a chat, and a link to the owner's dossier. |
| **A country** | Its dossier: flag, tags, recent events filtered by importance, and an AI briefing on request. |
| **A unit** | An intelligence card — what the formation is, whose, how strong, what it appears to be doing. Not a command panel. |
| **A city or structure** | Name, population, whether it is a capital, and what kind of thing it is. |

## Two renderers

<p class="beta-note"><b>Beta channel only.</b></p>

The beta build is developing a new renderer, <b>Map vNext</b>, which is the default there. It
dissolves each polity into a single surface with stitched frontiers and curved labels, instead of
filling every region separately. It is a work in progress, and it takes noticeably longer to draw
when a campaign opens.

You can switch back to the older look at **Settings → Map → Renderer → "Legacy map renderer"** —
and you should **restart the app afterwards**, because the change does not fully take effect
until you do. Nothing about your save changes either way; it is purely how the map is drawn. See
[the settings reference](/wiki/settings/).

The stable build has one renderer and no setting for it, which is what this page describes.

## Performance

If the map is slow:

- **Turn off 3D terrain.** It is the most expensive thing on the list by a wide margin.
- **Turn off the globe.** The flat map is cheaper.
- **Reduce motion**, which quiets several animations at once.
- Zoom out. Fewer tiles, fewer labels.

The map caches a bounded number of tiles deliberately, to avoid running a browser tab out of
memory on a long campaign.

## Next

- [Territory](/wiki/territory/) — what the stripes actually mean.
- [Cities and structures](/wiki/cities/) — the things drawn on top.
- [Settings](/wiki/settings/) — every map option in one place.
