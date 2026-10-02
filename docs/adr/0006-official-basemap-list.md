---
status: proposed
---

# Detailed maps come from one official list, by map id and version

A Tiled Basemap ([ADR 0005](0005-tiled-basemaps-stream-to-disk.md)) is downloaded only from **`Open-Historia/Open-Historia-basemaps`**. Maintainers upload each map as a release there, one release per map version, and list it in that repository's `basemaps.json`: a stable **map id**, and for each **version** its release link, its size and its **SHA-256**. A Scenario names a map by id and the **lowest version it needs** (`world.background.tiled = { id, version, name }`), never by link. The game reads the list, downloads from it only, and checks every download against the list's checksum before it is used.

A player keeps **one copy per map**. A copy of any version satisfies every Scenario on that map: a Scenario made on a newer version than the player has still draws on theirs, and the newer version is **offered, never forced**. Installing a version replaces the others, and their checksums then find the new copy.

## Considered Options

- **Any GitHub release, linked from the Scenario (the first cut of ADR 0005).** Rejected. Players would download hundreds of megabytes from repositories nobody in the project controls, and a map that turns out to be offensive, stolen or broken could not be taken down. The link also tied a Scenario to one file: a corrected map was a different file every Scenario would have to be republished to name.
- **Official repository trusted, any other repository allowed with a warning.** Rejected for now. It keeps designers unblocked, but every detailed map players meet would still be unreviewed by default. Detailed maps are rare (one needs a rendering pipeline like the Game of Thrones one), so a review step costs little. Loosening this later is a change to `isOfficialReleaseUrl` alone.
- **Let the public publish releases to the official repository.** Not possible: GitHub gives release rights only to collaborators, and anyone who can publish a release can also delete one.
- **Scenarios name an exact version.** Rejected. A player with version 9 who installs a Scenario made on version 10 would download the whole map again. Naming the lowest version needed makes an update optional, so the same map is never downloaded twice.
- **Keep every version a player has downloaded.** Rejected. Two versions of a 460 MB map is a gigabyte of disk for no gain, because any version draws every Scenario on that map.

## Consequences

- Every Scenario on a detailed map must also carry a **basic map**: its painted vector background, with something drawn on it. The Map Editor will not pick a detailed map without one, and a Scenario bundle naming a detailed map with an empty basic map is refused on import. A player who does not download the detailed map, or whose game cannot show it (an older version, the web build), always sees a map, never empty sea.
- The game reads the list from `raw.githubusercontent.com` at most every ten minutes, and keeps the last good copy on disk (`DATA_DIR/basemaps-official.json`). Offline, the maps it last saw are still offered, marked stale. A list that cannot be read never holds the map up: the Scenario draws first, and the offer appears when the list arrives.
- Each entry is checked as it is read (`server/officialBasemaps.js`), and a bad one is left out on its own: a link outside the official releases, a malformed checksum, a size over the 500 MB cap.
- The install route takes `{ id, version? }`, never a link. Two installs of the same version share one download, and a version the player already has (or a newer one) downloads nothing.
- A copy the player already has, byte for byte one of the listed versions (installed before the list existed, or added from a file), is marked as that version when the list is read, so it is never downloaded again.
- A Scenario still naming its map by checksum (the author's own map, not on the list) plays on its basic map; publishing it says so, and the Basemap picker's ⤴ opens a prefilled submission on the official repository for the team to review.
- The hub no longer carries detailed-map posts, and the release walk-through for authors is gone. Maintainers add a version with `scripts/official-basemap-entry.mjs`, which checks the file as the game will and writes its entry.
- A version number, once listed, never changes its file: Scenarios and players' copies trust its checksum. A corrected map is a new version.
- The web build has no disk to stream to: its list is empty, and a Scenario naming an official map shows its basic map.
