/*!
 * Open Historia Map Editor — basemap picker overlay.
 * Copyright (c) 2026 Nicholas Krol - AGPL-3.0-or-later (see LICENSE).
 */

// A Netflix-style overlay (matching the game's Community hub look) for choosing
// the editor basemap: a "Built-in maps" shelf of ESRI presets (previewed by their
// whole-world z0 tile), a "Your basemaps" shelf of the user's uploaded basemaps
// (server-side library, thumbnailed), and a Community tab (filled in Phase 2).

import { useEffect, useRef, useState } from "react";
import { EDITOR_BASEMAPS, esriPreviewUrl } from "./basemaps.js";
import { ESRI_BASEMAPS } from "../runtime/assets.js";
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

const overlay = {
  position: "fixed",
  inset: 0,
  zIndex: 120,
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

const BasemapCard = ({ title, imageUrl, imageFilter, active, badge, onClick, onDelete, onPublish }) => (
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
          ✓ In use
        </span>
      )}
      {onPublish && (
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
        Large terrain maps that stay sharp up close. Each downloads once, and every scenario on it shares it.
        To share your own, use the ⤴ button on its card in My Basemaps.
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

// Which of the built-in (real-world) maps players may switch to in Settings →
// Map while playing this scenario. null = any of them (the default, and every
// scenario made before this existed); [] = only the scenario's own map, which
// is what a made-up world wants (runtime/assets.js allowedBasemapIds).
const AllowedBasemaps = ({ value, onChange }) => {
  const all = value === null || value === undefined;
  const chosen = new Set(all ? ESRI_BASEMAPS.map((b) => b.id) : value);
  const toggle = (id) => {
    const next = new Set(chosen);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onChange(next.size === ESRI_BASEMAPS.length ? null : ESRI_BASEMAPS.map((b) => b.id).filter((x) => next.has(x)));
  };
  return (
    <div style={{ marginBottom: "1.3rem", padding: "0.7rem 0.8rem", border: "1px solid rgba(255,255,255,0.09)", borderRadius: "12px", background: "rgba(255,255,255,0.03)" }}>
      <div style={{ ...rowTitle, marginBottom: "0.3rem" }}>Maps players can switch to</div>
      <div style={{ ...dim, padding: "0 0 0.5rem" }}>
        Players can always use this scenario&apos;s own map. Tick the built-in maps they may also pick in Settings → Map. For a made-up world, untick them all.
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "0.4rem 0.9rem", alignItems: "center" }}>
        <button type="button" style={tabBtn(all)} onClick={() => onChange(null)}>All</button>
        <button type="button" style={tabBtn(!all && chosen.size === 0)} onClick={() => onChange([])}>None (own map only)</button>
        {ESRI_BASEMAPS.map((b) => (
          <label key={b.id} style={{ display: "inline-flex", alignItems: "center", gap: "0.3rem", fontSize: "0.78rem", cursor: "pointer" }}>
            <input type="checkbox" checked={chosen.has(b.id)} onChange={() => toggle(b.id)} />
            {b.label}
          </label>
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
  currentBasemap,
  currentCustomId,
  onSelectBuiltin,
  onSelectCustom,
  onUpload,
  currentVectorGeojson = null,
  browse = false,
  allowedBasemaps,
  onAllowedBasemapsChange,
}) => {
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

  if (!open) return null;

  // Outside the editor there is nothing to apply a picture or painted map to:
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
  // detailed map; anything else (a picture, a painted map, a vector-tile
  // reference) goes where it always did.
  const handleAdd = async (file) => {
    if (!file) return;
    setBusy(true);
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
      if (browse || !onUpload) await addToLibrary(file);
      else await onUpload(file);
      refresh();
    } catch (e) {
      window.alert(`Could not add that map: ${e?.message || e}`);
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async (bm) => {
    // A Tiled Basemap may be named by scenarios: deleting it leaves them on their
    // painted fallback until it is downloaded again, so say which.
    if (bm.kind === "tiled") {
      const users = await listTiledBasemapUsers(bm.id);
      const size = formatBytes(bm.bytes);
      const message = users.length
        ? `"${bm.name}" is the detailed map of: ${users.map((u) => u.name).join(", ")}. Deleting it frees ${size || "its space"}; those scenarios will show their basic map until it's downloaded again. Delete it?`
        : `Delete "${bm.name}"${size ? ` and free ${size}` : ""}?`;
      if (!window.confirm(message)) return;
    }
    await deleteBasemapApi(bm.id).catch(() => {});
    // A game open on a scenario naming it goes back to its painted map.
    if (bm.kind === "tiled") announceTiledBasemap(null);
    refresh();
  };

  // An author's own detailed map: a PMTiles archive of raster tiles, streamed to
  // the game server (never read here). The vector drawing currently on screen,
  // if any, becomes its painted fallback.
  const handleAddTiled = async (file) => {
    const meta = await uploadTiledBasemap(file, { name: file.name.replace(/\.pmtiles$/i, "") });
    if (currentVectorGeojson) await setTiledBasemapFallback(meta.id, currentVectorGeojson).catch(() => {});
    refresh();
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
      window.alert("Players only download detailed maps from the official Open Historia list. On the GitHub page that opened, add a link where the team can download your .pmtiles file to review it, and who made it, then submit. Once it's added, scenarios you publish with it offer it to players; until then they see the basic map.");
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

  return (
    <div style={overlay} onClick={onClose}>
      <div style={panel} onClick={(e) => e.stopPropagation()}>
        <div style={headerBar}>
          <div style={{ fontSize: "1.05rem", fontWeight: 800, marginRight: "0.4rem" }}>Basemaps</div>
          <button type="button" style={tabBtn(tab === "mine")} onClick={() => setTab("mine")}>My Basemaps</button>
          <button type="button" style={tabBtn(tab === "community")} onClick={() => setTab("community")}>Community</button>
          <div style={{ flex: 1 }} />
          <label
            style={uploadBtn}
            title="A picture (.png, .jpg), a painted map (.geojson, .kml, .zip…), or a detailed map (.pmtiles of picture tiles, up to 500 MB)"
          >
            {busy ? "Adding…" : "⬆ Add your own map"}
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
          <button type="button" style={closeBtn} onClick={onClose} title="Close">✕</button>
        </div>

        <div style={bodyBox}>
          {tab === "mine" ? (
            <>
              {!browse && onAllowedBasemapsChange && (
                <AllowedBasemaps value={allowedBasemaps} onChange={onAllowedBasemapsChange} />
              )}
              {!browse && (
              <div style={{ marginBottom: "1.3rem" }}>
                <div style={rowTitle}>Built-in maps</div>
                <div style={rowScroll}>
                  {EDITOR_BASEMAPS.map((b) => (
                    <BasemapCard
                      key={b.id}
                      title={b.label}
                      imageUrl={esriPreviewUrl(b.service)}
                      imageFilter={b.previewFilter}
                      active={!currentCustomId && currentBasemap === b.id}
                      onClick={() => { onSelectBuiltin(b.id); onClose(); }}
                    />
                  ))}
                </div>
              </div>
              )}
              <div>
                <div style={rowTitle}>Your basemaps</div>
                {loading ? (
                  <div style={dim}>Loading…</div>
                ) : mine.length === 0 ? (
                  <div style={dim}>No maps of your own yet. Use “⬆ Add your own map” to add a picture, a painted map or a detailed map; it stays here so you can reuse it on any scenario. Detailed maps you download from the Community tab appear here too.</div>
                ) : (
                  <div style={rowScroll}>
                    {mine.map((bm) => (
                      <BasemapCard
                        key={bm.id}
                        title={bm.name}
                        imageUrl={bm.thumbnail}
                        active={!browse && currentCustomId === bm.id}
                        badge={bm.kind === "tiled"
                          ? `detailed${bm.official ? ` v${bm.official.version}` : ""} · ${formatBytes(bm.bytes)}`
                          : bm.kind === "vector" ? "vector" : undefined}
                        onClick={browse ? undefined : () => { onSelectCustom(bm); onClose(); }}
                        onDelete={() => handleDelete(bm)}
                        onPublish={() => handlePublish(bm)}
                      />
                    ))}
                  </div>
                )}
              </div>
            </>
          ) : (
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.7rem", flexWrap: "wrap" }}>
                <div style={{ ...rowTitle, margin: 0 }}>Community basemaps</div>
                <button type="button" style={tabBtn(communityFilter === "all")} onClick={() => setCommunityFilter("all")}>All</button>
                <button type="button" style={tabBtn(communityFilter === "painted")} onClick={() => setCommunityFilter("painted")}>Painted maps</button>
                <button type="button" style={tabBtn(communityFilter === "detailed")} onClick={() => setCommunityFilter("detailed")}>Detailed maps</button>
                <div style={{ flex: 1 }} />
                <a
                  href="https://github.com/Open-Historia/Open-historia-scenarios/issues?q=is%3Aissue+is%3Aopen+label%3Abasemap"
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
              {communityFilter === "all" && <div style={rowTitle}>Painted maps</div>}
              {communityError && <div style={{ ...dim, color: "#fecaca" }}>{communityError}</div>}
              {communityLoading ? (
                <div style={dim}>Loading community basemaps…</div>
              ) : community.length === 0 && !communityError ? (
                <div style={dim}>No community basemaps yet — share one of yours with the ⤴ button on a “Your basemaps” card.</div>
              ) : (
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(11rem, 1fr))", gap: "0.8rem" }}>
                  {community.map((post) => {
                    const canInstall = basemapPostInstallable(post);
                    return (
                    <div key={post.id} style={{ ...cardSurface, flex: "unset", cursor: "default" }}>
                      <div style={{ position: "relative", aspectRatio: "3 / 2", background: "#111113" }}>
                        {post.coverImageUrl ? (
                          <img
                            src={post.coverImageUrl}
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
                          title={canInstall ? "Install into Your basemaps" : "This post has no basemap file attached"}
                          style={{
                            ...tabBtn(false),
                            background: canInstall ? "rgba(255,255,255,0.1)" : "rgba(255,255,255,0.04)",
                            cursor: canInstall && busyId !== post.id ? "pointer" : "default",
                            opacity: canInstall ? 1 : 0.5,
                          }}
                        >
                          {busyId === post.id ? "Installing…" : "⬇ Install"}
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
    </div>
  );
};

export default BasemapPicker;
