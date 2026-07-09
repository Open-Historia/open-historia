/*!
 * Open Historia Map Editor — basemap picker overlay.
 * Copyright (c) 2026 Nicholas Krol - MIT License (see src/Editor/LICENSE).
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

const overlay = {
  position: "fixed",
  inset: 0,
  zIndex: 120,
  background: "rgba(4,6,14,0.74)",
  backdropFilter: "blur(4px)",
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
  background: "rgba(14,18,32,0.98)",
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
  background: active ? "rgba(124,58,237,0.35)" : "rgba(255,255,255,0.06)",
  border: active ? "1px solid rgba(124,58,237,0.6)" : "1px solid rgba(255,255,255,0.1)",
  borderRadius: "999px",
  color: "#fff",
  cursor: "pointer",
  fontSize: "0.8rem",
  fontWeight: 700,
  padding: "0.32rem 0.9rem",
});

const uploadBtn = {
  alignItems: "center",
  background: "rgba(59,130,246,0.85)",
  border: "1px solid rgba(147,197,253,0.5)",
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

const BasemapCard = ({ title, imageUrl, active, badge, onClick, onDelete, onPublish }) => (
  <div
    style={{ ...cardSurface, outline: active ? "2px solid #7c3aed" : "none", outlineOffset: "-2px" }}
    onClick={onClick}
    title={title}
  >
    <div style={{ position: "relative", aspectRatio: "3 / 2", background: "#0b1020" }}>
      {imageUrl ? (
        <img
          src={imageUrl}
          alt=""
          loading="lazy"
          onError={(e) => { e.currentTarget.style.visibility = "hidden"; }}
          style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
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
        <span style={{ position: "absolute", right: 6, top: 6, background: "rgba(124,58,237,0.9)", borderRadius: "999px", fontSize: "0.62rem", fontWeight: 700, padding: "0.1rem 0.4rem" }}>
          ✓ In use
        </span>
      )}
      {onPublish && (
        <button
          type="button"
          title="Share this basemap to the community"
          onClick={(e) => { e.stopPropagation(); onPublish(); }}
          style={{ position: "absolute", left: 6, bottom: 6, background: "rgba(124,58,237,0.85)", border: "1px solid rgba(167,139,250,0.5)", borderRadius: "999px", color: "#fff", cursor: "pointer", fontSize: "0.7rem", height: "1.5rem", width: "1.5rem", lineHeight: 1 }}
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
  const [tab, setTab] = useState("mine"); // mine | community
  const [mine, setMine] = useState([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [community, setCommunity] = useState([]);
  const [communityLoading, setCommunityLoading] = useState(false);
  const [communityError, setCommunityError] = useState(null);
  const [communityLoaded, setCommunityLoaded] = useState(false);
  const [busyId, setBusyId] = useState(null);

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

  const handleDelete = async (id) => {
    await deleteBasemapApi(id).catch(() => {});
    refresh();
  };

  const handlePublish = async (bm) => {
    try {
      const payload = await getBasemapPayload(bm.id);
      const { fileName } = publishBasemap(bm, payload);
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
        <div style={headerBar}>
          <div style={{ fontSize: "1.05rem", fontWeight: 800, marginRight: "0.4rem" }}>Basemaps</div>
          <button type="button" style={tabBtn(tab === "mine")} onClick={() => setTab("mine")}>My Basemaps</button>
          <button type="button" style={tabBtn(tab === "community")} onClick={() => setTab("community")}>Community</button>
          <div style={{ flex: 1 }} />
          <label style={uploadBtn}>
            {busy ? "Uploading…" : "⬆ Upload basemap"}
            <input
              type="file"
              accept={BACKGROUND_ACCEPT}
              style={{ display: "none" }}
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = "";
                handleUpload(f);
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
                        badge={bm.kind === "vector" ? "vector" : undefined}
                        onClick={() => { onSelectCustom(bm); onClose(); }}
                        onDelete={() => handleDelete(bm.id)}
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
                      <div style={{ position: "relative", aspectRatio: "3 / 2", background: "#0b1020" }}>
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
                            background: canInstall ? "rgba(124,58,237,0.35)" : "rgba(255,255,255,0.04)",
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
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default BasemapPicker;
