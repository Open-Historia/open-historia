/*!
 * Open Historia Map Editor — basemap picker overlay.
 * Copyright (c) 2026 Nicholas Krol - AGPL-3.0-or-later (see LICENSE).
 */

// A Netflix-style overlay (matching the game's Community hub look) for the
// scenario's maps: the list of them on top (scenarioMaps.js), then shelves to
// add from: the built-in maps (previewed by their whole-world z0 tile), Your
// basemaps and Your detailed maps (server-side library, thumbnailed), and a
// Community tab.

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { EDITOR_BASEMAPS, esriPreviewUrl } from "./basemaps.js";
import { BACKGROUND_ACCEPT, loadBackgroundFile, vectorLayerToGeoJSON } from "./customBackground.js";
import { addBackgroundToLibrary, listBasemaps, deleteBasemap as deleteBasemapApi, getBasemapPayload } from "../runtime/basemapLibrary.js";
import {
  announceTiledBasemap,
  fetchOfficialBasemaps,
  formatBytes,
  installOfficialBasemap,
  listTiledBasemapUsers,
  officialBasemapSubmissionUrl,
  setTiledBasemapFallback,
  uploadTiledBasemap,
} from "../runtime/tiledBasemaps.js";
import { basemapPostInstallable, fetchCommunityBasemaps, installCommunityBasemap, publishBasemap } from "../runtime/communityBasemaps.js";
import { acceptFor } from "../runtime/fileAccept.js";
import { useIsMobile } from "../runtime/useIsMobile.js";
import { ownBasemapIdOfLibrary } from "./ownBasemaps.js";
import { ownMapHash } from "./ownMapHash.js";

const overlay = {
  position: "fixed",
  inset: 0,
  zIndex: 2147483100,
  background: "rgba(8,8,9,0.82)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: "1.5rem",
};

const panel = {
  width: "min(66rem, 96vw)",
  maxHeight: "88vh",
  display: "flex",
  flexDirection: "column",
  background: "rgba(21,21,24,0.98)",
  border: "1px solid rgba(255,255,255,0.1)",
  borderRadius: "18px",
  color: "#fff",
  boxShadow: "0 24px 80px rgba(0,0,0,0.55)",
  overflow: "hidden",
};

const headerBar = {
  display: "flex",
  alignItems: "center",
  gap: "0.6rem",
  padding: "0.85rem 1.1rem",
  borderBottom: "1px solid rgba(255,255,255,0.08)",
};

const bodyBox = { padding: "1.1rem", overflowY: "auto" };

const cardSurface = {
  background: "rgba(255,255,255,0.04)",
  border: "1px solid rgba(255,255,255,0.09)",
  borderRadius: "14px",
  overflow: "hidden",
  display: "flex",
  flexDirection: "column",
  flex: "0 0 12.5rem",
  cursor: "pointer",
};

const rowTitle = { color: "rgba(255,255,255,0.9)", fontSize: "0.95rem", fontWeight: 800, margin: "0 0 0.6rem" };
const rowScroll = { display: "flex", gap: "0.8rem", overflowX: "auto", paddingBottom: "0.4rem", scrollbarWidth: "thin" };
const dim = { color: "rgba(255,255,255,0.4)", fontSize: "0.82rem", padding: "0.3rem 0 0.7rem" };

const tabBtn = (active) => ({
  background: active ? "rgba(0,0,0,0.49)" : "rgba(255,255,255,0.06)",
  border: active ? "1px solid rgba(255,255,255,0.28)" : "1px solid rgba(255,255,255,0.1)",
  borderRadius: "999px",
  color: "#fff",
  cursor: "pointer",
  fontSize: "0.8rem",
  fontWeight: 700,
  padding: "0.32rem 0.9rem",
});

const uploadBtn = {
  alignItems: "center",
  background: "rgba(255,255,255,0.14)",
  border: "1px solid rgba(255,255,255,0.23)",
  borderRadius: "999px",
  color: "#fff",
  cursor: "pointer",
  display: "inline-flex",
  fontSize: "0.8rem",
  fontWeight: 700,
  gap: "0.35rem",
  padding: "0.34rem 0.9rem",
};

const closeBtn = {
  background: "rgba(255,255,255,0.06)",
  border: "1px solid rgba(255,255,255,0.1)",
  borderRadius: "999px",
  color: "#fff",
  cursor: "pointer",
  fontSize: "0.85rem",
  fontWeight: 700,
  height: "2rem",
  width: "2rem",
};

// A little pill on a card saying it came from the community, linking to its
// post when the record kept one. Shared with FlagPicker's cards.
export const CommunitySourceBadge = ({ url }) => {
  const style = { position: "absolute", left: 6, bottom: 6, background: "rgba(0,0,0,0.6)", border: "1px solid rgba(255,255,255,0.2)", borderRadius: "999px", color: "#fff", fontSize: "0.6rem", fontWeight: 700, padding: "0.12rem 0.45rem", textDecoration: "none" };
  return url ? (
    <a href={url} target="_blank" rel="noopener noreferrer" title="Installed from the community hub. Open its post" onClick={(e) => e.stopPropagation()} style={style}>
      Community ↗
    </a>
  ) : (
    <span title="Installed from the community hub" style={style}>Community</span>
  );
};

// `activeLabel`: what the mark on an active card says.
const BasemapCard = ({ title, imageUrl, imageFilter, active, activeLabel = "✓ In use", badge, onClick, onDelete, onPublish, communityUrl = null, fromCommunity = false }) => (
  <div
    style={{ ...cardSurface, outline: active ? "2px solid rgba(255,255,255,0.22)" : "none", outlineOffset: "-2px" }}
    onClick={onClick}
    title={title}
  >
    <div style={{ position: "relative", aspectRatio: "3 / 2", background: "#111113" }}>
      {imageUrl ? (
        <img
          src={imageUrl}
          alt=""
          loading="lazy"
          onError={(e) => { e.currentTarget.style.visibility = "hidden"; }}
          style={{ width: "100%", height: "100%", objectFit: "cover", display: "block", filter: imageFilter || "none" }}
        />
      ) : (
        <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", fontSize: "1.6rem", opacity: 0.5 }}>
          🗺️
        </div>
      )}
      {badge && (
        <span style={{ position: "absolute", left: 6, top: 6, background: "rgba(0,0,0,0.55)", borderRadius: "6px", fontSize: "0.6rem", fontWeight: 700, letterSpacing: "0.04em", padding: "0.1rem 0.35rem", textTransform: "uppercase" }}>
          {badge}
        </span>
      )}
      {active && (
        <span style={{ position: "absolute", right: 6, top: 6, background: "rgba(255,255,255,0.28)", borderRadius: "999px", fontSize: "0.62rem", fontWeight: 700, padding: "0.1rem 0.4rem" }}>
          {activeLabel}
        </span>
      )}
      {fromCommunity && <CommunitySourceBadge url={communityUrl} />}
      {onPublish && !fromCommunity && (
        <button
          type="button"
          title="Share this basemap to the community"
          onClick={(e) => { e.stopPropagation(); onPublish(); }}
          style={{ position: "absolute", left: 6, bottom: 6, background: "rgba(255,255,255,0.28)", border: "1px solid rgba(255,255,255,0.25)", borderRadius: "999px", color: "#fff", cursor: "pointer", fontSize: "0.7rem", height: "1.5rem", width: "1.5rem", lineHeight: 1 }}
        >
          ⤴
        </button>
      )}
      {onDelete && (
        <button
          type="button"
          title="Remove from your basemaps"
          onClick={(e) => { e.stopPropagation(); onDelete(); }}
          style={{ position: "absolute", right: 6, bottom: 6, background: "rgba(0,0,0,0.6)", border: "1px solid rgba(255,255,255,0.2)", borderRadius: "999px", color: "#fff", cursor: "pointer", fontSize: "0.7rem", height: "1.5rem", width: "1.5rem", lineHeight: 1 }}
        >
          ✕
        </button>
      )}
    </div>
    <div style={{ padding: "0.5rem 0.6rem", fontSize: "0.8rem", fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
      {title}
    </div>
  </div>
);

// Detailed maps (docs/adr/0006), shown in the Community tab beside the hub's
// basemaps: each with its size and what the player has. A map they have is never
// downloaded again; a newer version replaces it.
const DetailedMaps = ({ list, loading, download, onDownload, onCancel }) => {
  const available = list.basemaps.filter((entry) => entry.versions.length > 0);
  return (
    <div>
      <div style={dim}>
        Large terrain maps, drawn on top of a scenario&apos;s basemap, that stay sharp up close. Each downloads once, and every scenario on it shares it.
        To share your own, use the ⤴ button on its card in My Maps → Your detailed maps.
      </div>
      {list.error && (
        <div style={{ ...dim, color: "#fecaca" }}>
          {available.length ? `Showing the last list this game saw (${list.error}).` : list.error}
        </div>
      )}
      {loading && !available.length ? (
        <div style={dim}>Loading detailed maps…</div>
      ) : !available.length ? (
        !list.error && <div style={dim}>No detailed maps yet.</div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(13rem, 1fr))", gap: "0.8rem" }}>
          {available.map((entry) => {
            const latest = entry.versions[entry.versions.length - 1];
            const have = entry.installed?.version || 0;
            const upToDate = have >= latest.version;
            const size = formatBytes(latest.bytes);
            const busy = download?.id === entry.id;
            const label = busy
              ? `Downloading…${download.percent !== null ? ` ${download.percent}%` : ""}`
              : upToDate ? `✓ Downloaded (v${have})`
                : have ? `⬆ Update to v${latest.version} (${size})` : `⬇ Download (${size})`;
            return (
              <div key={entry.id} style={{ ...cardSurface, flex: "unset", cursor: "default" }}>
                <div style={{ position: "relative", aspectRatio: "3 / 2", background: "#111113" }}>
                  {latest.preview ? (
                    <img
                      src={latest.preview}
                      alt=""
                      loading="lazy"
                      onError={(e) => { e.currentTarget.style.visibility = "hidden"; }}
                      style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
                    />
                  ) : (
                    <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", fontSize: "1.6rem", opacity: 0.5 }}>🗺️</div>
                  )}
                  <span style={{ position: "absolute", left: 6, top: 6, background: "rgba(0,0,0,0.55)", borderRadius: "6px", fontSize: "0.6rem", fontWeight: 700, padding: "0.1rem 0.35rem", textTransform: "uppercase" }}>
                    detailed · v{latest.version} · {size}
                  </span>
                </div>
                <div style={{ padding: "0.5rem 0.6rem", display: "flex", flexDirection: "column", gap: "0.35rem" }}>
                  <div style={{ fontSize: "0.8rem", fontWeight: 700 }}>{entry.name}</div>
                  {entry.author && <div style={{ fontSize: "0.68rem", color: "rgba(255,255,255,0.5)" }}>by {entry.author}</div>}
                  {entry.license && <div style={{ fontSize: "0.66rem", color: "rgba(255,255,255,0.45)" }}>{entry.license}</div>}
                  {have > 0 && !upToDate && latest.notes && (
                    <div style={{ fontSize: "0.68rem", color: "rgba(255,255,255,0.65)" }}>New in v{latest.version}: {latest.notes}</div>
                  )}
                  <button
                    type="button"
                    disabled={upToDate || Boolean(download)}
                    onClick={() => onDownload(entry)}
                    style={{ ...tabBtn(false), cursor: upToDate || download ? "default" : "pointer", opacity: upToDate ? 0.7 : 1 }}
                  >
                    {label}
                  </button>
                  {busy && <button type="button" style={tabBtn(false)} onClick={onCancel}>Cancel</button>}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

// The scenario's maps (scenarioMaps.js, CONTEXT.md): the ★ starting map and
// every map players may switch to in Settings → Map. Clicking a card below adds
// one; here a map is made the starting one, taken out (✕), or, a detailed map,
// shown over another of the scenario's drawn maps.
const MAP_KIND_LABELS = { builtinLabel: "built-in", vectorLabel: "drawn map", imageLabel: "picture", plainLabel: "plain sea", detailedLabel: "detailed map" };
const mapRow = { display: "flex", alignItems: "center", flexWrap: "wrap", gap: "0.5rem", padding: "0.35rem 0.5rem", borderRadius: "10px", background: "rgba(255,255,255,0.04)" };
const smallBtn = { ...tabBtn(false), fontSize: "0.72rem", padding: "0.2rem 0.6rem" };
const ScenarioMapsList = ({ maps, onMakeStarting, onRemove, onShownOver, onSaveToLibrary, inLibrary }) => {
  const drawn = maps.filter((map) => map.kind === "vector");
  const nameOf = (key) => maps.find((map) => map.key === key)?.name || "";
  const box = { marginBottom: "1.3rem", padding: "0.7rem 0.8rem", border: "1px solid rgba(255,255,255,0.09)", borderRadius: "12px", background: "rgba(255,255,255,0.03)" };
  return (
    <div style={box}>
      <div style={{ ...rowTitle, marginBottom: "0.3rem" }}>This scenario&apos;s maps</div>
      <div style={{ ...dim, padding: "0 0 0.6rem" }}>
        Players start on the ★ starting map and can switch to any other map here in Settings → Map. Click a map below to add it. Every map must fit your regions: they stay where they are on each one.
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: "0.35rem" }}>
        {maps.map((map) => (
          <div key={map.key} style={mapRow}>
            <span style={{ width: "1rem", textAlign: "center" }} title={map.starting ? "The starting map" : undefined}>{map.starting ? "★" : ""}</span>
            <span data-no-translate style={{ fontSize: "0.82rem", fontWeight: 700 }}>{map.name}</span>
            <span style={{ fontSize: "0.7rem", opacity: 0.55, fontWeight: 600 }}>{MAP_KIND_LABELS[`${map.kind}Label`]}</span>
            {map.kind === "detailed" && (
              <span style={{ display: "inline-flex", alignItems: "center", gap: "0.3rem", fontSize: "0.72rem", opacity: 0.8 }}>
                Shown over
                {drawn.length > 1 ? (
                  <select
                    data-no-translate
                    value={map.over}
                    onChange={(e) => onShownOver(map.key, e.target.value)}
                    style={{ background: "rgba(0,0,0,0.4)", color: "#fff", border: "1px solid rgba(255,255,255,0.2)", borderRadius: "6px", fontSize: "0.72rem" }}
                  >
                    {drawn.map((option) => <option key={option.key} value={option.key} style={{ color: "black" }}>{option.name}</option>)}
                  </select>
                ) : (
                  <span data-no-translate style={{ fontWeight: 700 }}>{nameOf(map.over)}</span>
                )}
              </span>
            )}
            <span style={{ flex: 1 }} />
            {onSaveToLibrary && map.background && !inLibrary(map) && (
              <button type="button" style={smallBtn} title="Keep a copy in Your basemaps, to use in your other scenarios" onClick={() => onSaveToLibrary(map)}>
                Save to Your basemaps
              </button>
            )}
            {!map.starting && (
              <button type="button" style={smallBtn} title="Players start on this map" onClick={() => onMakeStarting(map)}>
                ★ Make starting map
              </button>
            )}
            {!map.starting && (
              <button
                type="button"
                title="Take this map out of the scenario's maps"
                onClick={() => onRemove(map.key)}
                style={{ background: "none", border: "none", color: "#fff", cursor: "pointer", fontSize: "0.8rem", padding: "0 0.2rem" }}
              >
                ✕
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
};

// `browse`: opened from Settings, outside the Map Editor. Players can download,
// add and remove maps, but there is no scenario to apply one to.
const BasemapPicker = ({
  open,
  onClose,
  onUpload,
  currentVectorGeojson = null,
  browse = false,
  // The scenario's maps (scenarioMaps.js) and what the Map Editor does with
  // them: add a built-in map or one of Your basemaps or detailed maps, make
  // one the starting map, take one out, show a detailed map over another
  // drawn map.
  maps = [],
  onAddBuiltin = null,
  onAddLibrary = null,
  onMakeStarting = null,
  onRemoveMap = null,
  onShownOver = null,
}) => {
  const isMobile = useIsMobile();
  const [tab, setTab] = useState("mine"); // mine | community
  // Community shows the hub's basemaps and the detailed maps, filtered.
  const [communityFilter, setCommunityFilter] = useState("all"); // all | painted | detailed
  const [mine, setMine] = useState([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [community, setCommunity] = useState([]);
  const [communityLoading, setCommunityLoading] = useState(false);
  const [communityError, setCommunityError] = useState(null);
  const [communityLoaded, setCommunityLoaded] = useState(false);
  const [busyId, setBusyId] = useState(null);
  // Official detailed maps (docs/adr/0006): the list, and the one downloading.
  const [official, setOfficial] = useState({ basemaps: [] });
  const [officialLoading, setOfficialLoading] = useState(false);
  const [officialLoaded, setOfficialLoaded] = useState(false);
  const [download, setDownload] = useState(null); // { id, percent }
  const downloadControllerRef = useRef(null);
  // What the last upload came to when it is not simply "saved": a session-only
  // raster, or a library that would not take it ({ tone, text }).
  const [notice, setNotice] = useState(null);

  const refresh = () => {
    setLoading(true);
    listBasemaps().then((list) => setMine(Array.isArray(list) ? list : [])).finally(() => setLoading(false));
  };

  const loadCommunity = (force = false) => {
    setCommunityLoading(true);
    setCommunityError(null);
    fetchCommunityBasemaps({ force })
      .then((p) => setCommunity(Array.isArray(p) ? p : []))
      .catch((e) => setCommunityError(e.message))
      .finally(() => {
        setCommunityLoading(false);
        setCommunityLoaded(true);
      });
  };

  useEffect(() => {
    if (open) refresh();
    setNotice(null);
  }, [open]);

  useEffect(() => {
    if (open && tab === "community" && !communityLoaded) loadCommunity();
  }, [open, tab, communityLoaded]);

  const loadOfficial = (refresh = false) => {
    setOfficialLoading(true);
    fetchOfficialBasemaps({ refresh })
      .then(setOfficial)
      .finally(() => {
        setOfficialLoading(false);
        setOfficialLoaded(true);
      });
  };

  useEffect(() => {
    if (open && tab === "community" && !officialLoaded) loadOfficial();
  }, [open, tab, officialLoaded]);

  // Stops a download in flight when the picker goes away.
  useEffect(() => () => downloadControllerRef.current?.abort(), []);

  // The checksum the library knows each of the scenario's pictures and drawn
  // maps by (ownMapHash.js), to mark the Your basemaps card holding it and to
  // offer "Save to Your basemaps" for one no card holds.
  const [mapHashes, setMapHashes] = useState({});
  const backgrounds = maps.filter((map) => map.background);
  const backgroundsKey = backgrounds.map((map) => map.key).join("|");
  useEffect(() => {
    if (!open || browse) return undefined;
    let alive = true;
    Promise.all(backgrounds.map(async (map) => [map.key, await ownMapHash(map.background).catch(() => null)]))
      .then((pairs) => { if (alive) setMapHashes(Object.fromEntries(pairs)); });
    return () => { alive = false; };
    // backgroundsKey stands in for the list, rebuilt on every render; a map's
    // payload changes only with its key here.
  }, [open, browse, backgroundsKey]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!open) return null;

  const painted = mine.filter((bm) => bm.kind !== "tiled");
  const scenarioHashes = new Set(Object.values(mapHashes).filter(Boolean));
  // Whether a card is one of the scenario's maps already.
  const builtinInScenario = (id) => maps.some((map) => map.builtinId === id);
  const startingBuiltin = (id) => maps.some((map) => map.starting && map.builtinId === id);
  const libraryInScenario = (bm) => scenarioHashes.has(String(bm.contentHash || "").toLowerCase())
    || maps.some((map) => map.key === `own:${ownBasemapIdOfLibrary(bm)}`);
  const namesDetailed = (bm, detailed) => (detailed?.id
    ? bm.official?.id === detailed.id
    : Boolean(detailed?.hash) && (bm.contentHash === detailed.hash || (bm.supersedes || []).includes(detailed.hash)));
  const detailedInScenario = (bm) => maps.some((map) => map.kind === "detailed" && namesDetailed(bm, map.detailed));
  const startingDetailed = (bm) => maps.some((map) => map.starting && map.kind === "detailed" && namesDetailed(bm, map.detailed));

  // What Your basemaps already holds, so a post installed before says so
  // instead of offering to download its whole payload again (the store would
  // only then find it by hash and hand back the copy it has).
  const installedHashes = new Set(mine.flatMap((bm) => [bm.contentHash, bm.source?.hash]).filter(Boolean).map((hash) => String(hash).toLowerCase()));
  const installedUrls = new Set(mine.map((bm) => bm.source?.url).filter(Boolean));
  const isInstalled = (post) => Boolean(
    (post.contentHash && installedHashes.has(String(post.contentHash).toLowerCase())) || (post.url && installedUrls.has(post.url)),
  );

  // One of the scenario's pictures or drawn maps, kept in Your basemaps to use
  // in other scenarios.
  const saveToLibrary = async (map) => {
    const bg = map.background;
    try {
      await addBackgroundToLibrary(bg.kind === "image" ? { kind: "image", dataUrl: bg.dataUrl, aspect: bg.aspect } : { kind: "vector", geojson: bg.geojson }, map.name);
      refresh();
    } catch (e) {
      window.alert(`Could not save that map to Your basemaps: ${e?.message || e}`);
    }
  };

  // Outside the editor there is nothing to apply a basemap to:
  // it only joins the library.
  const addToLibrary = async (file) => {
    const bg = await loadBackgroundFile(file);
    const normalized = bg?.kind === "image" && bg.dataUrl
      ? { kind: "image", dataUrl: bg.dataUrl, aspect: bg.aspect }
      : bg?.kind === "vector" && bg.layer ? { kind: "vector", geojson: vectorLayerToGeoJSON(bg.layer) } : null;
    if (!normalized) throw new Error("That file can only be used as a reference inside the Map Editor.");
    await addBackgroundToLibrary(normalized, file.name.replace(/\.[^.]+$/, "") || "My basemap");
  };

  // One button for every kind of map: a .pmtiles file of picture tiles is a
  // detailed map; anything else (a picture or painted basemap, a vector-tile
  // reference) goes where it always did.
  const handleAdd = async (file) => {
    if (!file) return;
    setBusy(true);
    setNotice(null);
    try {
      if (/\.pmtiles$/i.test(file.name)) {
        try {
          await handleAddTiled(file);
          return;
        } catch (e) {
          // Vector tiles are a drawing reference for the editor, not a detailed map.
          if (!/vector tiles/i.test(e?.message || "") || browse || !onUpload) throw e;
        }
      }
      const result = browse || !onUpload ? await addToLibrary(file) : await onUpload(file);
      refresh();
      if (result?.sessionOnly) {
        setNotice({ tone: "warn", text: "This GeoTIFF or PMTiles background is on the map for this session only, to draw over. It is not saved with the map or added to Your basemaps, and the game does not show it." });
      } else if (result?.libraryError) {
        setNotice({ tone: "error", text: "The basemap is in this scenario's maps, but it could not be saved to Your basemaps, so it will not be here to reuse." });
      } else if (result?.added) {
        setNotice({ tone: "warn", text: "Added to this scenario's maps. To draw on it, make it the starting map (★)." });
      }
    } catch (e) {
      window.alert(`Could not add that map: ${e?.message || e}`);
    } finally {
      setBusy(false);
    }
  };

  // A map keeps its own copy of a painted or picture basemap
  // (doc.metadata.customBackground), so only the library entry goes. A Tiled
  // Basemap may be named by scenarios: deleting it leaves them on their basemap
  // until it is downloaded again, so say which.
  const handleDelete = async (bm) => {
    if (bm.kind === "tiled") {
      const users = await listTiledBasemapUsers(bm.id);
      const size = formatBytes(bm.bytes);
      const message = users.length
        ? `"${bm.name}" is the detailed map of: ${users.map((u) => u.name).join(", ")}. Deleting it frees ${size || "its space"}; those scenarios will show their basemap until it's downloaded again. Delete it?`
        : `Delete "${bm.name}"${size ? ` and free ${size}` : ""}?`;
      if (!window.confirm(message)) return;
    } else if (!window.confirm(`Delete the basemap “${bm.name || "Custom basemap"}” from Your basemaps? Maps already using it keep their own copy.`)) {
      return;
    }
    try {
      await deleteBasemapApi(bm.id);
      // A game open on a scenario naming it goes back to its basemap.
      if (bm.kind === "tiled") announceTiledBasemap(null);
    } catch (e) {
      window.alert(`Could not delete that basemap: ${e?.message || e}`);
    }
    refresh();
  };

  // An author's own detailed map: a PMTiles archive of raster tiles, streamed to
  // the game server (never read here). The vector drawing currently on screen,
  // if any, becomes its painted fallback.
  // In the Map Editor it joins the scenario's maps too.
  const handleAddTiled = async (file) => {
    const meta = await uploadTiledBasemap(file, { name: file.name.replace(/\.pmtiles$/i, "") });
    if (currentVectorGeojson) await setTiledBasemapFallback(meta.id, currentVectorGeojson).catch(() => {});
    refresh();
    if (!browse && onAddLibrary) await onAddLibrary({ ...meta, kind: "tiled" });
  };

  const handlePublish = async (bm) => {
    if (bm.kind === "tiled") {
      // Too large for a hub post, and players only download detailed maps from
      // the official list: the author asks for it to be added, and the team
      // reviews it and uploads it (docs/adr/0006).
      if (bm.official) {
        window.alert(`"${bm.name}" is already on the official list (version ${bm.official.version}). Scenarios you publish with it offer it to players.`);
        return;
      }
      window.open(officialBasemapSubmissionUrl(bm), "_blank", "noopener");
      window.alert("Players only download detailed maps from the official Open Historia list. On the GitHub page that opened, add a link where the team can download your .pmtiles file to review it, and who made it, then submit. Once it's added, scenarios you publish with it offer it to players; until then they see the basemap.");
      return;
    }
    try {
      const payload = await getBasemapPayload(bm.id);
      const { fileName } = await publishBasemap(bm, payload);
      window.alert(
        `"${fileName}" was downloaded. On the GitHub page that opened, drag that file into the "Basemap image" box, then submit.`,
      );
    } catch (e) {
      window.alert(`Could not prepare that basemap for publishing: ${e?.message || e}`);
    }
  };

  const handleInstall = async (post) => {
    if (busyId) return;
    setBusyId(post.id);
    try {
      await installCommunityBasemap(post);
      refresh();
      setTab("mine");
    } catch (e) {
      window.alert(`Install failed: ${e?.message || e}`);
    } finally {
      setBusyId(null);
    }
  };

  // Downloads (or updates to) an official map's newest version. Nothing is
  // downloaded twice: the server keeps one copy per map, replacing the older.
  const handleOfficialDownload = async (entry) => {
    if (download) return;
    const controller = new AbortController();
    downloadControllerRef.current = controller;
    setDownload({ id: entry.id, percent: null });
    try {
      await installOfficialBasemap({
        id: entry.id,
        signal: controller.signal,
        onProgress: ({ received, total }) => setDownload({ id: entry.id, percent: total ? Math.round((received / total) * 100) : null }),
      });
      refresh();
      loadOfficial();
    } catch (e) {
      if (e?.name !== "AbortError") window.alert(`Download failed: ${e?.message || e}`);
    } finally {
      downloadControllerRef.current = null;
      setDownload(null);
    }
  };

  // Drawn straight into the page, above everything: opened from Settings it
  // would otherwise sit inside the settings card (which clips it and covers
  // its header), and both Settings and the Map Editor are drawn above the
  // rest of the page, so the window has to be above them too.
  return createPortal(
    <div style={overlay} onClick={onClose}>
      <div style={panel} onClick={(e) => e.stopPropagation()}>
        {/* Wraps rather than clipping Add and ✕ off a phone's edge, the way
            FlagPicker's header does; there Add drops its label to an icon. */}
        <div style={{ ...headerBar, flexWrap: "wrap", gap: isMobile ? "0.4rem" : "0.6rem" }}>
          <div style={{ fontSize: isMobile ? "0.95rem" : "1.05rem", fontWeight: 800, marginRight: "0.4rem" }}>Maps</div>
          <button type="button" style={tabBtn(tab === "mine")} onClick={() => setTab("mine")}>My Maps</button>
          <button type="button" style={tabBtn(tab === "community")} onClick={() => setTab("community")}>Community</button>
          {!isMobile && <div style={{ flex: 1 }} />}
          <label
            style={uploadBtn}
            aria-label={isMobile ? "Add basemap or detailed map" : undefined}
            title="A basemap: a picture (.png, .jpg) or a painted map (.geojson, .kml, .zip…). Or a detailed map: a .pmtiles file of picture tiles, up to 500 MB. GeoTIFF files and .pmtiles of vector tiles are shown for the current session only."
          >
            {busy ? (isMobile ? "…" : "Adding…") : isMobile ? "⬆" : "⬆ Add basemap or detailed map"}
            <input
              type="file"
              accept={acceptFor(BACKGROUND_ACCEPT)}
              style={{ display: "none" }}
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = "";
                handleAdd(f);
              }}
            />
          </label>
          <button type="button" className="oh-tap" aria-label="Close basemap picker" style={{ ...closeBtn, marginLeft: isMobile ? "auto" : undefined }} onClick={onClose} title="Close">✕</button>
        </div>

        <div style={bodyBox}>
          {notice && (
            <div role="status" style={{ ...dim, color: notice.tone === "error" ? "#fecaca" : "#fde68a", paddingTop: 0 }}>{notice.text}</div>
          )}
          {tab === "mine" ? (
            <>
              {!browse && maps.length > 0 && (
                <ScenarioMapsList
                  maps={maps}
                  onMakeStarting={onMakeStarting}
                  onRemove={onRemoveMap}
                  onShownOver={onShownOver}
                  onSaveToLibrary={saveToLibrary}
                  inLibrary={(map) => !mapHashes[map.key] || installedHashes.has(mapHashes[map.key])}
                />
              )}
              {!browse && (
              <div style={{ marginBottom: "1.3rem" }}>
                <div style={rowTitle}>Built-in basemaps</div>
                <div style={rowScroll}>
                  {EDITOR_BASEMAPS.map((b) => (
                    <BasemapCard
                      key={b.id}
                      title={b.label}
                      imageUrl={esriPreviewUrl(b.service)}
                      imageFilter={b.previewFilter}
                      active={builtinInScenario(b.id)}
                      activeLabel={startingBuiltin(b.id) ? "★ Starting map" : "✓ In this scenario"}
                      onClick={() => onAddBuiltin?.(b.id)}
                    />
                  ))}
                </div>
              </div>
              )}
              <div style={{ marginBottom: "1.3rem" }}>
                <div style={rowTitle}>Your basemaps</div>
                {loading ? (
                  <div style={dim}>Loading…</div>
                ) : !painted.length ? (
                  <div style={dim}>No basemaps of your own yet. Use “⬆ Add basemap or detailed map” to add a picture or a painted map (.png, .jpg, .geojson…); it stays here so you can reuse it on any scenario.</div>
                ) : (
                  <div style={rowScroll}>
                    {painted.map((bm) => (
                      <BasemapCard
                        key={bm.id}
                        title={bm.name}
                        imageUrl={bm.thumbnail}
                        active={!browse && libraryInScenario(bm)}
                        activeLabel="✓ In this scenario"
                        badge={bm.kind === "vector" ? "drawn map" : "picture"}
                        onClick={browse ? undefined : () => onAddLibrary?.(bm)}
                        onDelete={() => handleDelete(bm)}
                        // Someone else's work, installed from the hub: it links
                        // to its post rather than offering to publish it again.
                        onPublish={() => handlePublish(bm)}
                        fromCommunity={Boolean(bm.source?.community)}
                        communityUrl={bm.source?.url || null}
                      />
                    ))}
                  </div>
                )}
              </div>
              <div>
                <div style={rowTitle}>Your detailed maps</div>
                {loading ? (
                  <div style={dim}>Loading…</div>
                ) : !mine.some((bm) => bm.kind === "tiled") ? (
                  <div style={dim}>No detailed maps yet. Download one from the Community tab, or add your own .pmtiles file with “⬆ Add basemap or detailed map”. A detailed map is drawn on top of a scenario&apos;s basemap.</div>
                ) : (
                  <div style={rowScroll}>
                    {mine.filter((bm) => bm.kind === "tiled").map((bm) => (
                      <BasemapCard
                        key={bm.id}
                        title={bm.name}
                        imageUrl={bm.thumbnail}
                        active={!browse && detailedInScenario(bm)}
                        activeLabel={startingDetailed(bm) ? "★ Starting map" : "✓ In this scenario"}
                        badge={`detailed${bm.official ? ` v${bm.official.version}` : ""} · ${formatBytes(bm.bytes)}`}
                        onClick={browse ? undefined : () => onAddLibrary?.(bm)}
                        onDelete={() => handleDelete(bm)}
                        onPublish={() => handlePublish(bm)}
                        fromCommunity={Boolean(bm.source?.community)}
                        communityUrl={bm.source?.url || null}
                      />
                    ))}
                  </div>
                )}
              </div>
            </>
          ) : (
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.7rem", flexWrap: "wrap" }}>
                <div style={{ ...rowTitle, margin: 0 }}>Community maps</div>
                <button type="button" style={tabBtn(communityFilter === "all")} onClick={() => setCommunityFilter("all")}>All</button>
                <button type="button" style={tabBtn(communityFilter === "painted")} onClick={() => setCommunityFilter("painted")}>Basemaps</button>
                <button type="button" style={tabBtn(communityFilter === "detailed")} onClick={() => setCommunityFilter("detailed")}>Detailed maps</button>
                <div style={{ flex: 1 }} />
                {/* Open and closed alike: the hub closes a post once it has
                    released its file. */}
                <a
                  href="https://github.com/Open-Historia/Open-historia-scenarios/issues?q=is%3Aissue+label%3Abasemap"
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ ...tabBtn(false), textDecoration: "none" }}
                >
                  Open hub ↗
                </a>
                <button type="button" style={tabBtn(false)} onClick={() => { loadCommunity(true); loadOfficial(true); }}>↻ Refresh</button>
              </div>
              {communityFilter !== "painted" && (
                <div style={{ marginBottom: "1.3rem" }}>
                  {communityFilter === "all" && <div style={rowTitle}>Detailed maps</div>}
                  <DetailedMaps
                    list={official}
                    loading={officialLoading}
                    download={download}
                    onDownload={handleOfficialDownload}
                    onCancel={() => downloadControllerRef.current?.abort()}
                  />
                </div>
              )}
              {communityFilter !== "detailed" && (<>
              {communityFilter === "all" && <div style={rowTitle}>Basemaps</div>}
              {communityError && <div style={{ ...dim, color: "#fecaca" }}>{communityError}</div>}
              {communityLoading ? (
                <div style={dim}>Loading community basemaps…</div>
              ) : community.length === 0 && !communityError ? (
                <div style={dim}>No community basemaps yet — share one of yours with the ⤴ button on a “Your basemaps” card in My Maps.</div>
              ) : (
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(11rem, 1fr))", gap: "0.8rem" }}>
                  {community.map((post) => {
                    const installed = isInstalled(post);
                    const canInstall = basemapPostInstallable(post) && !installed;
                    return (
                    <div key={post.id} style={{ ...cardSurface, flex: "unset", cursor: "default" }}>
                      <div style={{ position: "relative", aspectRatio: "3 / 2", background: "#111113" }}>
                        {/* The image's checked copy in the hub's releases, never
                            the post's own attachment (communityBasemaps.js). */}
                        {post.pictureUrl ? (
                          <img
                            src={post.pictureUrl}
                            alt=""
                            loading="lazy"
                            onError={(e) => { e.currentTarget.style.visibility = "hidden"; }}
                            style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
                          />
                        ) : (
                          <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", fontSize: "1.6rem", opacity: 0.5 }}>🗺️</div>
                        )}
                        {post.kind === "vector" && (
                          <span style={{ position: "absolute", left: 6, top: 6, background: "rgba(0,0,0,0.55)", borderRadius: "6px", fontSize: "0.6rem", fontWeight: 700, padding: "0.1rem 0.35rem", textTransform: "uppercase" }}>vector</span>
                        )}
                        {post.fromScenario && (
                          <span title="Shared as part of a scenario — installing pulls the map out of that scenario's file" style={{ position: "absolute", right: 6, top: 6, background: "rgba(0,0,0,0.55)", borderRadius: "6px", fontSize: "0.6rem", fontWeight: 700, padding: "0.1rem 0.35rem", textTransform: "uppercase" }}>from scenario</span>
                        )}
                      </div>
                      <div style={{ padding: "0.5rem 0.6rem", display: "flex", flexDirection: "column", gap: "0.4rem" }}>
                        <div style={{ fontSize: "0.8rem", fontWeight: 700, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{post.title}</div>
                        <div style={{ fontSize: "0.68rem", color: "rgba(255,255,255,0.5)" }}>by {post.author}</div>
                        <button
                          type="button"
                          disabled={!canInstall || busyId === post.id}
                          onClick={() => handleInstall(post)}
                          title={installed ? "Already in Your basemaps" : canInstall ? "Install into Your basemaps" : "This post has no basemap file attached"}
                          style={{
                            ...tabBtn(false),
                            background: canInstall ? "rgba(255,255,255,0.1)" : "rgba(255,255,255,0.04)",
                            cursor: canInstall && busyId !== post.id ? "pointer" : "default",
                            opacity: canInstall || installed ? 1 : 0.5,
                          }}
                        >
                          {busyId === post.id ? "Installing…" : installed ? "✓ Installed" : "⬇ Install"}
                        </button>
                      </div>
                    </div>
                    );
                  })}
                </div>
              )}
              </>)}
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
};

export default BasemapPicker;
