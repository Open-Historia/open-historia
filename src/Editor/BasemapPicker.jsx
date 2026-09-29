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
import { BACKGROUND_ACCEPT } from "./customBackground.js";
import { listBasemaps, deleteBasemap as deleteBasemapApi, getBasemapPayload } from "../runtime/basemapLibrary.js";
import { announceTiledBasemap, formatBytes, listTiledBasemapUsers, setTiledBasemapFallback, setTiledBasemapSource, uploadTiledBasemap } from "../runtime/tiledBasemaps.js";
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

const BasemapPicker = ({
  open,
  onClose,
  currentBasemap,
  currentCustomId,
  onSelectBuiltin,
  onSelectCustom,
  onUpload,
  currentVectorGeojson = null,
}) => {
  const [tab, setTab] = useState("mine"); // mine | community
  const [mine, setMine] = useState([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [community, setCommunity] = useState([]);
  const [communityLoading, setCommunityLoading] = useState(false);
  const [communityError, setCommunityError] = useState(null);
  const [communityLoaded, setCommunityLoaded] = useState(false);
  const [busyId, setBusyId] = useState(null);
  const [installPercent, setInstallPercent] = useState(null);
  const installControllerRef = useRef(null);
  const [tiledBusy, setTiledBusy] = useState(false);

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

  if (!open) return null;

  const handleUpload = async (file) => {
    if (!file) return;
    setBusy(true);
    try {
      await onUpload(file);
      refresh();
    } catch (e) {
      window.alert(`Could not add that basemap: ${e?.message || e}`);
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
        ? `"${bm.name}" is the detailed map of: ${users.map((u) => u.name).join(", ")}. Deleting it frees ${size || "its space"}; those scenarios will show their painted map until it's downloaded again. Delete it?`
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
    if (!file) return;
    setTiledBusy(true);
    try {
      const meta = await uploadTiledBasemap(file, { name: file.name.replace(/\.pmtiles$/i, "") });
      if (currentVectorGeojson) await setTiledBasemapFallback(meta.id, currentVectorGeojson).catch(() => {});
      refresh();
    } catch (e) {
      window.alert(`Could not add that detailed map: ${e?.message || e}`);
    } finally {
      setTiledBusy(false);
    }
  };

  const handlePublish = async (bm) => {
    if (bm.kind === "tiled") {
      // Too large to attach to a post: it goes in a GitHub release, and the post
      // links it. The link is kept, so scenarios naming this map can offer it.
      let meta = bm;
      if (!bm.source?.payloadUrl) {
        const link = window.prompt(
          `"${bm.name}" is ${formatBytes(bm.bytes) || "too large"} to attach to a hub post, so it's shared as a GitHub release file:\n\n` +
          "1. On GitHub, open any repository of yours (or make one) and choose Releases → Draft a new release.\n" +
          `2. Attach the .pmtiles file (${bm.name}) and publish the release.\n` +
          "3. Copy the file's download link and paste it here.\n\nRelease download link:",
        );
        if (!link) return;
        try {
          meta = await setTiledBasemapSource(bm.id, link);
          refresh();
        } catch (e) {
          window.alert(e?.message || String(e));
          return;
        }
      }
      await publishBasemap(meta, null);
      window.alert("On the GitHub page that opened, check the release link is in the post, add a preview picture if you like, then submit. Scenarios you save with this map from now on tell players where to download it.");
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
    setInstallPercent(null);
    const controller = new AbortController();
    installControllerRef.current = controller;
    try {
      await installCommunityBasemap(post, {
        signal: controller.signal,
        onProgress: ({ received, total }) => setInstallPercent(total ? Math.round((received / total) * 100) : null),
      });
      refresh();
      setTab("mine");
    } catch (e) {
      if (e?.name !== "AbortError") window.alert(`Install failed: ${e?.message || e}`);
    } finally {
      installControllerRef.current = null;
      setBusyId(null);
      setInstallPercent(null);
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
          <label style={uploadBtn}>
            {busy ? "Uploading…" : "⬆ Upload basemap"}
            <input
              type="file"
              accept={acceptFor(BACKGROUND_ACCEPT)}
              style={{ display: "none" }}
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = "";
                handleUpload(f);
              }}
            />
          </label>
          <label style={uploadBtn} title="A detailed map of raster tiles (a .pmtiles archive, up to 500 MB) that scenarios can name">
            {tiledBusy ? "Adding…" : "⬆ Add detailed map"}
            <input
              type="file"
              accept={acceptFor(".pmtiles")}
              style={{ display: "none" }}
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = "";
                handleAddTiled(f);
              }}
            />
          </label>
          <button type="button" style={closeBtn} onClick={onClose} title="Close">✕</button>
        </div>

        <div style={bodyBox}>
          {tab === "mine" ? (
            <>
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
              <div>
                <div style={rowTitle}>Your basemaps</div>
                {loading ? (
                  <div style={dim}>Loading…</div>
                ) : mine.length === 0 ? (
                  <div style={dim}>No uploaded basemaps yet — use “⬆ Upload basemap” to add your own map image (it stays here so you can reuse it on any map).</div>
                ) : (
                  <div style={rowScroll}>
                    {mine.map((bm) => (
                      <BasemapCard
                        key={bm.id}
                        title={bm.name}
                        imageUrl={bm.thumbnail}
                        active={currentCustomId === bm.id}
                        badge={bm.kind === "tiled" ? `detailed · ${formatBytes(bm.bytes)}` : bm.kind === "vector" ? "vector" : undefined}
                        onClick={() => { onSelectCustom(bm); onClose(); }}
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
              <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.7rem" }}>
                <div style={{ ...rowTitle, margin: 0 }}>Community basemaps</div>
                <div style={{ flex: 1 }} />
                <a
                  href="https://github.com/Open-Historia/Open-historia-scenarios/issues?q=is%3Aissue+is%3Aopen+label%3Abasemap"
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ ...tabBtn(false), textDecoration: "none" }}
                >
                  Open hub ↗
                </a>
                <button type="button" style={tabBtn(false)} onClick={() => loadCommunity(true)}>↻ Refresh</button>
              </div>
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
                        {(post.kind === "vector" || post.kind === "tiled") && (
                          <span style={{ position: "absolute", left: 6, top: 6, background: "rgba(0,0,0,0.55)", borderRadius: "6px", fontSize: "0.6rem", fontWeight: 700, padding: "0.1rem 0.35rem", textTransform: "uppercase" }}>
                            {post.kind === "tiled" ? `detailed${post.bytes ? ` · ${formatBytes(post.bytes)}` : ""}` : "vector"}
                          </span>
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
                          {busyId === post.id
                            ? `Installing…${installPercent !== null ? ` ${installPercent}%` : ""}`
                            : `⬇ Install${post.kind === "tiled" && post.bytes ? ` (${formatBytes(post.bytes)})` : ""}`}
                        </button>
                        {busyId === post.id && post.kind === "tiled" && (
                          <button type="button" style={tabBtn(false)} onClick={() => installControllerRef.current?.abort()}>
                            Cancel
                          </button>
                        )}
                      </div>
                    </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default BasemapPicker;
