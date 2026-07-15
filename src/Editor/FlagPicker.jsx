/*!
 * Open Historia Map Editor
 * Copyright (c) 2026 Nicholas Krol - MIT License (see src/Editor/LICENSE).
 */

// A Netflix-style overlay for choosing a country's flag — built-in flags, the ones
// already used on this map, or the community's — matching BasemapPicker exactly.
//
// Styling note: like BasemapPicker, this deliberately does NOT use editorStyles.js.
// The picker family shares the game's Community-hub purple (#7c3aed), not the
// editor chrome's blue ACCENT. Keeping the constants local (rather than importing
// the editor's) is what makes the two pickers look like siblings.

import { useEffect, useMemo, useState } from "react";
import { listBuiltInFlags } from "../runtime/countryFlags.js";
import {
  communityFlagsHubUrl,
  fetchCommunityFlags,
  loadCommunityFlagDataUrl,
  openFlagPublishForm,
} from "../runtime/communityFlags.js";
import { FLAG_ACCEPT, fileToFlagDataUrl } from "./flagImage.js";

const overlay = {
  position: "fixed",
  inset: 0,
  zIndex: 130, // above the basemap picker (120) — this can open from a panel over it
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
const rowTitle = { fontSize: "0.78rem", opacity: 0.6, margin: "0.2rem 0 0.5rem", letterSpacing: "0.04em" };
const dim = { fontSize: "0.82rem", opacity: 0.6, padding: "0.6rem 0" };
const cardSurface = {
  position: "relative",
  background: "rgba(255,255,255,0.04)",
  border: "1px solid rgba(255,255,255,0.1)",
  borderRadius: "10px",
  overflow: "hidden",
  cursor: "pointer",
};
const tabBtn = (active) => ({
  background: active ? "rgba(124,58,237,0.9)" : "rgba(255,255,255,0.06)",
  border: "1px solid rgba(255,255,255,0.12)",
  borderRadius: "999px",
  color: "#fff",
  cursor: "pointer",
  fontSize: "0.8rem",
  padding: "0.35rem 0.8rem",
});
const uploadBtn = {
  background: "rgba(59,130,246,0.85)",
  border: "1px solid rgba(255,255,255,0.14)",
  borderRadius: "8px",
  color: "#fff",
  cursor: "pointer",
  fontSize: "0.8rem",
  padding: "0.4rem 0.7rem",
  whiteSpace: "nowrap",
};
const closeBtn = {
  background: "rgba(255,255,255,0.06)",
  border: "1px solid rgba(255,255,255,0.12)",
  borderRadius: "8px",
  color: "#fff",
  cursor: "pointer",
  fontSize: "0.9rem",
  lineHeight: 1,
  padding: "0.4rem 0.6rem",
};

// One flag. 3:2 like a real flag; `contain` not `cover` so a flag is never cropped
// (a cropped flag is often a different country's).
const FlagCard = ({ title, subtitle, imageUrl, active, onClick, onPublish }) => (
  <div
    style={{
      ...cardSurface,
      outline: active ? "2px solid rgba(124,58,237,0.9)" : "none",
      outlineOffset: "-2px",
    }}
    onClick={onClick}
    title={title}
  >
    <div style={{ aspectRatio: "3 / 2", background: "rgba(0,0,0,0.35)", display: "flex", alignItems: "center", justifyContent: "center" }}>
      {imageUrl ? (
        <img
          src={imageUrl}
          alt=""
          loading="lazy"
          style={{ width: "100%", height: "100%", objectFit: "contain" }}
          onError={(e) => { e.currentTarget.style.visibility = "hidden"; }}
        />
      ) : (
        <span style={{ fontSize: "1.4rem", opacity: 0.5 }}>🏳️</span>
      )}
    </div>
    <div style={{ padding: "0.4rem 0.5rem" }}>
      <div style={{ fontSize: "0.78rem", fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{title}</div>
      {subtitle && <div style={{ fontSize: "0.7rem", opacity: 0.55 }}>{subtitle}</div>}
    </div>
    {active && (
      <div style={{ position: "absolute", top: 6, right: 6, background: "rgba(124,58,237,0.9)", borderRadius: 6, fontSize: "0.65rem", padding: "0.1rem 0.35rem" }}>
        ✓ In use
      </div>
    )}
    {onPublish && (
      <button
        type="button"
        title="Share this flag with the community"
        onClick={(e) => { e.stopPropagation(); onPublish(); }}
        style={{
          position: "absolute", left: 6, bottom: 6, background: "rgba(124,58,237,0.85)",
          border: "none", borderRadius: 6, color: "#fff", cursor: "pointer", fontSize: "0.7rem",
          lineHeight: 1, padding: "0.2rem 0.35rem",
        }}
      >
        ⤴
      </button>
    )}
  </div>
);

const grid = { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(8rem, 1fr))", gap: "0.7rem" };

const FlagPicker = ({ open, onClose, ownerCode, currentFlag, mapFlags = {}, author = "", onPick }) => {
  const [tab, setTab] = useState("mine"); // mine | community
  const [query, setQuery] = useState("");
  const [error, setError] = useState("");
  const [community, setCommunity] = useState([]);
  const [communityLoading, setCommunityLoading] = useState(false);
  const [communityError, setCommunityError] = useState("");
  const [communityLoaded, setCommunityLoaded] = useState(false);
  const [busyId, setBusyId] = useState(null);

  const builtIn = useMemo(() => listBuiltInFlags(), []);
  // Flags already placed on this map — the fastest way to reuse one across countries.
  const inThisMap = useMemo(
    () => Object.entries(mapFlags || {}).map(([code, dataUrl]) => ({ code, dataUrl })),
    [mapFlags],
  );

  const loadCommunity = async (force = false) => {
    setCommunityLoading(true);
    setCommunityError("");
    try {
      setCommunity(await fetchCommunityFlags({ force }));
      setCommunityLoaded(true);
    } catch (e) {
      setCommunityError(e?.message || "Could not load community flags.");
    } finally {
      setCommunityLoading(false);
    }
  };

  useEffect(() => {
    if (open && tab === "community" && !communityLoaded) loadCommunity();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, tab, communityLoaded]);

  if (!open) return null;

  const q = query.trim().toLowerCase();
  const filteredBuiltIn = q ? builtIn.filter((f) => f.code.toLowerCase().includes(q) || f.alpha2.includes(q)) : builtIn;
  const filteredCommunity = q
    ? community.filter((p) => `${p.title} ${p.author} ${p.code || ""}`.toLowerCase().includes(q))
    : community;

  const pick = (dataUrlOrUrl) => { onPick(dataUrlOrUrl); onClose(); };

  const handleUpload = async (file) => {
    if (!file) return;
    setError("");
    try {
      pick(await fileToFlagDataUrl(file));
    } catch (e) {
      setError(e?.message || "Could not read that image.");
    }
  };

  // A community flag is fetched through the hub proxy and stored as a data URL, so
  // the scenario keeps working if the post is later edited or deleted.
  const handleInstall = async (post) => {
    setBusyId(post.id);
    setCommunityError("");
    try {
      pick(await loadCommunityFlagDataUrl(post));
    } catch (e) {
      setCommunityError(e?.message || "Could not download that flag.");
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div style={overlay} onClick={onClose}>
      <div style={panel} onClick={(e) => e.stopPropagation()}>
        <div style={headerBar}>
          <div style={{ fontSize: "1.05rem", fontWeight: 800, marginRight: "0.4rem" }}>
            Flags{ownerCode ? ` — ${ownerCode}` : ""}
          </div>
          <button type="button" style={tabBtn(tab === "mine")} onClick={() => setTab("mine")}>In the game</button>
          <button type="button" style={tabBtn(tab === "community")} onClick={() => setTab("community")}>Community</button>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search…"
            style={{
              background: "rgba(0,0,0,0.3)", border: "1px solid rgba(255,255,255,0.14)",
              borderRadius: 8, color: "#fff", fontSize: "0.8rem", padding: "0.35rem 0.6rem", width: "9rem",
            }}
          />
          <div style={{ flex: 1 }} />
          <label style={uploadBtn}>
            ⬆ Upload your own
            <input
              type="file"
              accept={FLAG_ACCEPT}
              style={{ display: "none" }}
              onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; handleUpload(f); }}
            />
          </label>
          {currentFlag && (
            <button type="button" style={closeBtn} title="Use the standard flag again" onClick={() => pick(null)}>
              Remove
            </button>
          )}
          <button type="button" style={closeBtn} onClick={onClose}>✕</button>
        </div>

        <div style={bodyBox}>
          {error && <div style={{ ...dim, color: "#fecaca" }}>{error}</div>}

          {tab === "mine" ? (
            <>
              {inThisMap.length > 0 && (
                <>
                  <div style={rowTitle}>Already on this map</div>
                  <div style={{ ...grid, marginBottom: "1rem" }}>
                    {inThisMap.map((f) => (
                      <FlagCard
                        key={`map-${f.code}`}
                        title={f.code}
                        subtitle="uploaded"
                        imageUrl={f.dataUrl}
                        active={currentFlag === f.dataUrl}
                        onClick={() => pick(f.dataUrl)}
                        onPublish={() => openFlagPublishForm({ name: `${f.code} flag`, author, code: f.code })}
                      />
                    ))}
                  </div>
                </>
              )}

              <div style={rowTitle}>Built-in flags ({filteredBuiltIn.length})</div>
              {filteredBuiltIn.length === 0 ? (
                <div style={dim}>No flag matches “{query}”.</div>
              ) : (
                <div style={grid}>
                  {filteredBuiltIn.map((f) => (
                    <FlagCard
                      key={f.code}
                      title={f.code}
                      subtitle={f.alpha2.toUpperCase()}
                      imageUrl={f.imageUrl}
                      active={currentFlag === f.imageUrl}
                      onClick={() => pick(f.imageUrl)}
                    />
                  ))}
                </div>
              )}
            </>
          ) : (
            <>
              <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.6rem" }}>
                <button
                  type="button"
                  style={{ ...uploadBtn, background: "rgba(124,58,237,0.85)" }}
                  onClick={() => openFlagPublishForm({ name: ownerCode ? `${ownerCode} flag` : "", author, code: ownerCode || "" })}
                  title="Opens the hub's flag form — drag your image in and submit"
                >
                  ⬆ Share a flag
                </button>
                <a
                  href={communityFlagsHubUrl()}
                  target="_blank"
                  rel="noreferrer noopener"
                  style={{ ...tabBtn(false), textDecoration: "none", display: "inline-block" }}
                >
                  Open hub ↗
                </a>
                <button type="button" style={tabBtn(false)} onClick={() => loadCommunity(true)}>↻ Refresh</button>
              </div>

              {communityError && <div style={{ ...dim, color: "#fecaca" }}>{communityError}</div>}
              {communityLoading ? (
                <div style={dim}>Loading community flags…</div>
              ) : filteredCommunity.length === 0 ? (
                <div style={dim}>
                  {community.length === 0
                    ? "No community flags yet — “⬆ Share a flag” posts one to the hub for everyone."
                    : `No community flag matches “${query}”.`}
                </div>
              ) : (
                <div style={grid}>
                  {filteredCommunity.map((post) => (
                    <div key={post.id} style={{ ...cardSurface, cursor: "default" }}>
                      <div style={{ aspectRatio: "3 / 2", background: "rgba(0,0,0,0.35)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                        <img src={post.imageUrl} alt="" loading="lazy" style={{ width: "100%", height: "100%", objectFit: "contain" }} />
                      </div>
                      <div style={{ padding: "0.4rem 0.5rem" }}>
                        <div style={{ fontSize: "0.78rem", fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {post.official && <span title="Posted by the project">✓ </span>}
                          {post.title}
                        </div>
                        <div style={{ fontSize: "0.7rem", opacity: 0.55 }}>by {post.author}</div>
                        <button
                          type="button"
                          disabled={busyId === post.id}
                          onClick={() => handleInstall(post)}
                          style={{ ...tabBtn(false), marginTop: "0.35rem", width: "100%" }}
                        >
                          {busyId === post.id ? "Applying…" : "Use this flag"}
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default FlagPicker;
