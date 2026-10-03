# Detailed terrain is a tiled Basemap, downloaded to disk once and shared by Scenarios

A map drawn in detail, such as a hand-rendered relief of a fictional world at zoom 10 everywhere and more round its places, is hundreds of thousands of raster tiles: about 460 MB for the Game of Thrones map. It becomes a third kind of Basemap, **tiled**, next to `image` and `vector`. It is a PMTiles archive plus a small vector fallback. A Scenario points to it by id, exactly as it points to a library Basemap today, and never carries it.

The archive is downloaded once, **streamed to the player's disk as it arrives**, and served to the map from there by byte range. It is capped at **500 MB**. It is shared on the community hub as a **GitHub release file in any repository**, linked from a basemap post, because the hub's attachment route stops at GitHub's 10 MB (images) and 25 MB (files).

> Where the archive comes from, and how a Scenario names it, is superseded by [ADR 0006](0006-official-basemap-list.md): one official list in `Open-Historia/open-historia-basemaps`, maps named by id and lowest version, never by link. The streaming, the cap, the checks and the rendering below stand.

## Considered Options

- **Terrain inside the Scenario (the first cut of this branch).** Rejected. Every Scenario on the same map would carry its own copy, so several Game of Thrones starts (298 AC, Robert's Rebellion, the Dance of the Dragons) would each be a 460 MB download. The terrain would also ride inside the Scenario bundle's JSON as base64. That pushes it into the 512 MB request limit and into V8's string ceiling, which sits at about the same size and cannot be raised. The map is the basemap and the Scenario is what is placed on it, which is how authors already think about it.
- **One large image Basemap.** Rejected. Zoom-11 detail across a continent is an image hundreds of thousands of pixels wide. Browsers stop at about 16,000, and the hub's image attachments stop at 10 MB. Squeezed to fit, it is roughly zoom 6.
- **Raise the hub cap without streaming.** Rejected. The hub download is buffered whole in memory, once in the server and again in the window, so a large cap is a large RAM spike. Only streaming to disk makes the file's size irrelevant to memory. The cap then only stops accidental multi-gigabyte shares, and 500 MB fits the one map that needs it with room to spare.
- **Official hub repository only.** Considered, for real takedowns: a maintainer can delete a release in their own repository, but not one in an author's. Rejected in favour of letting authors host it themselves. Closing the hub post already removes a Basemap from the game's hub list wherever the file lives, and requiring a maintainer upload for every large map puts a person in the path of every author.

## Consequences

- The hub download path changes shape for every file it fetches. Today it reads the whole body into memory, then checks the size, then writes a cache file. Tiled Basemaps need a body piped to a temporary file on disk, aborted the moment it passes the cap, and renamed into place only when complete. Scenario bundles keep their own 200 MB cap.
- The download must be checked before it is trusted: it has to parse as a PMTiles archive, and its header's zoom range and bounds become the Basemap's. The branch's authored `terrain.maxzoom` goes, because the archive already knows its own range.
- The rendering on this branch is reused unchanged. That covers the `ohrelief` protocol, drawing a missing tile from its nearest ancestor, and the fill-opacity ramp. What moves is only where the archive comes from: a Basemap's own store instead of a Scenario asset.
- A Scenario that names a tiled Basemap the player does not have must still open. It shows the Basemap's vector fallback, or the stock background, and offers the download. It must never fail to load.
- The web build and the Android app have no disk server to stream to, so they never download a Tiled Basemap: a Scenario naming one shows its basic map there.
- Existing `image` and `vector` Basemaps, and every existing Scenario and hub post, are untouched.
- Where the archive is hosted, how a Scenario names it, and how maps are submitted, approved, updated, archived and deleted: [ADR 0006](0006-official-basemap-list.md). The hub carries no detailed-map posts.
