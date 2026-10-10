# Open Historia

A grand-strategy game played on a map of the world, or of a made-up one, that players and scenario authors shape in the Map Editor.

## Language

### Maps

**Basemap**:
The map drawn under the countries: a built-in map, a picture, or a drawn map.
_Avoid_: Background, custom background

**Drawn map**:
A basemap made of shapes (GeoJSON, KML…) rather than a picture.
_Avoid_: Painted map, vector background

**Starting map**:
The map a scenario opens on, one of the scenario's maps.
_Avoid_: Main map, own map, scenario default

**Scenario's maps**:
Every map a scenario offers: its starting map and the ones players may switch to.
_Avoid_: Allowed basemaps, other maps, own basemaps

**Built-in maps**:
The world maps that come with the game.
_Avoid_: ESRI basemaps, presets

**Your basemaps**:
The basemaps saved on this device, reusable in any scenario.
_Avoid_: Library, my maps

**Detailed map**:
A large map of picture tiles, sharp up close, that a scenario names but does not carry: each player downloads it once. It draws over a drawn map, which is what a player without it sees.
_Avoid_: Tiled basemap, relief tiles

**Shown over**:
The drawn map, one of the scenario's maps, that a detailed map is laid over, and what a player without the detailed map sees in its place.
_Avoid_: Fallback, basic map, painted fallback

**Basemap pick**:
The map a player chose to see in one game, kept on their device for that game only.
_Avoid_: Basemap override, basemap style

**Default basemap**:
A built-in map a player chose in the main menu settings to start every game on, wherever the scenario offers it.

### Settings

**Game settings**:
Settings opened inside a game; they apply to that game only.

**Main menu settings**:
Settings opened from the main menu; they apply to every game.
