/*!
 * Open Historia Map Editor — basemap picker overlay.
 * Copyright (c) 2026 Nicholas Krol - AGPL-3.0-or-later (see LICENSE).
 */

// A Netflix-style overlay (matching the game's Community hub look) for choosing
// the editor basemap: a "Built-in maps" shelf of ESRI presets (previewed by their
// whole-world z0 tile), a "Your basemaps" shelf of the user's uploaded basemaps
// (server-side library, thumbnailed), and a Community tab (filled in Phase 2).

import { useEffect, useState } from "react";
import { EDITOR_BASEMAPS, esriPreviewUrl } from "./basemaps.js";
import { BACKGROUND_ACCEPT } from "./customBackground.js";
import { listBasemaps, deleteBasemap as deleteBasemapApi, getBasemapPayload } from "../runtime/basemapLibrary.js";
import { basemapPostInstallable, fetchCommunityBasemaps, installCommunityBasemap, publishBasemap } from "../runtime/communityBasemaps.js";
import { acceptFor } from "../runtime/fileAccept.js";
import { useIsMobile } from "../runtime/useIsMobile.js";

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

const BasemapCard = ({ title, imageUrl, imageFilter, active, badge, onClick, onDelete, onPublish, communityUrl = null, fromCommunity = false }) => (
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

const BasemapPicker = ({
  open,
  onClose,
  currentBasemap,
  currentCustomId,
  onSelectBuiltin,
  onSelectCustom,
  onUpload,
}) => {
  const isMobile = useIsMobile();
  const [tab, setTab] = useState("mine"); // mine | community
  const [mine, setMine] = useState([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [community, setCommunity] = useState([]);
  const [communityLoading, setCommunityLoading] = useState(false);
  const [communityError, setCommunityError] = useState(null);
  const [communityLoaded, setCommunityLoaded] = useState(false);
  const [busyId, setBusyId] = useState(null);
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

  if (!open) return null;

  // What Your basemaps already holds, so a post installed before says so
  // instead of offering to download its whole payload again (the store would
  // only then find it by hash and hand back the copy it has).
  const installedHashes = new Set(mine.flatMap((bm) => [bm.contentHash, bm.source?.hash]).filter(Boolean).map((hash) => String(hash).toLowerCase()));
  const installedUrls = new Set(mine.map((bm) => bm.source?.url).filter(Boolean));
  const isInstalled = (post) => Boolean(
    (post.contentHash && installedHashes.has(String(post.contentHash).toLowerCase())) || (post.url && installedUrls.has(post.url)),
  );

  const handleUpload = async (file) => {
    if (!file) return;
    setBusy(true);
    setNotice(null);
    try {
      const result = await onUpload(file);
      refresh();
      if (result?.sessionOnly) {
        setNotice({ tone: "warn", text: "This GeoTIFF or PMTiles background is on the map for this session only. It is not saved with the map or added to your basemaps, and the game does not show it." });
      } else if (result?.libraryError) {
        setNotice({ tone: "error", text: "The basemap is on the map, but it could not be saved to your basemaps, so it will not be here to reuse." });
      }
    } catch (e) {
      window.alert(`Could not add that basemap: ${e?.message || e}`);
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async (id) => {
    await deleteBasemapApi(id).catch(() => {});
    refresh();
  };

  const handlePublish = async (bm) => {
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

  return (
    <div style={overlay} onClick={onClose}>
      <div style={panel} onClick={(e) => e.stopPropagation()}>
        {/* Wraps rather than clipping Upload and ✕ off a phone's edge, the way
            FlagPicker's header does; there Upload drops its label to an icon. */}
        <div style={{ ...headerBar, flexWrap: "wrap", gap: isMobile ? "0.4rem" : "0.6rem" }}>
          <div style={{ fontSize: isMobile ? "0.95rem" : "1.05rem", fontWeight: 800, marginRight: "0.4rem" }}>Basemaps</div>
          <button type="button" style={tabBtn(tab === "mine")} onClick={() => setTab("mine")}>My Basemaps</button>
          <button type="button" style={tabBtn(tab === "community")} onClick={() => setTab("community")}>Community</button>
          {!isMobile && <div style={{ flex: 1 }} />}
          <label style={uploadBtn} aria-label={isMobile ? "Upload basemap" : undefined} title="A map image (PNG, JPG, SVG) or a vector map (GeoJSON, KML, KMZ, Shapefile) is saved to your basemaps. GeoTIFF and PMTiles files are shown for the current session only.">
            {busy ? (isMobile ? "…" : "Uploading…") : isMobile ? "⬆" : "⬆ Upload basemap"}
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
          <button type="button" className="oh-tap" aria-label="Close basemap picker" style={{ ...closeBtn, marginLeft: isMobile ? "auto" : undefined }} onClick={onClose} title="Close">✕</button>
        </div>

        <div style={bodyBox}>
          {notice && (
            <div role="status" style={{ ...dim, color: notice.tone === "error" ? "#fecaca" : "#fde68a", paddingTop: 0 }}>{notice.text}</div>
          )}
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
                  <div style={dim}>No uploaded basemaps yet — use “⬆ Upload basemap” to add your own map image or vector map (it stays here so you can reuse it on any map). GeoTIFF and PMTiles files are shown for the current session only.</div>
                ) : (
                  <div style={rowScroll}>
                    {mine.map((bm) => (
                      <BasemapCard
                        key={bm.id}
                        title={bm.name}
                        imageUrl={bm.thumbnail}
                        active={currentCustomId === bm.id}
                        badge={bm.kind === "vector" ? "vector" : undefined}
                        onClick={() => { onSelectCustom(bm); onClose(); }}
                        onDelete={() => handleDelete(bm.id)}
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
                    const installed = isInstalled(post);
                    const canInstall = basemapPostInstallable(post) && !installed;
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
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default BasemapPicker;
