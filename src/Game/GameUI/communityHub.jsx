/*! Open Historia — Scenario Hub (community tab) © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */

// The Community tab of the scenario library, Netflix-style: a Pinned shelf at
// the top (hub posts labeled "pinned" — the official/featured scenarios), then
// horizontally scrolling rows for Most Installed (⬇ release-asset download
// counts), Most Liked (👍) and Most Recent. Data comes from the public
// Scenario Hub — a GitHub
// repo where every issue is a posted scenario — as the hub's own index lists
// it: the posts whose file the hub has checked and released. Bundles import
// from those checked copies, through the server's /api/hub proxy. Publishing
// exports the chosen scenario locally and opens a prefilled hub post where the
// author drags the bundle in.

import React, { useEffect, useMemo, useRef, useState } from "react";
import { APP_HEIGHT, useTouchPrimary } from "../../runtime/mobileUi.js";
import { useIsMobile } from "../../runtime/useIsMobile.js";
import {
  exportScenarioBundle,
  importScenarioBundle,
  saveScenario,
  useLibraryState,
} from "../../runtime/library.js";
import { enqueueStrings } from "../../runtime/translator.js";
import { DISCORD_URL } from "../../runtime/communityLinks.js";
import { saveBlobToDisk } from "../../runtime/saveFile.js";
import { DISCORD_BLURPLE, DiscordMark } from "./communityLogos.jsx";
import {
  dedupeScenarioBundleBackground,
  splitScenarioBundleImage,
} from "../../runtime/communityBasemaps.js";
import { splitBundleFiles } from "../../runtime/bundleFiles.js";
import { zipBundle } from "../../runtime/bundleZip.js";
import { sha256Hex } from "../../runtime/basemapLibrary.js";
import { listFlags } from "../../runtime/flagLibrary.js";
import {
  HUB_NEW_POST_URL,
  HUB_URL,
  SCENARIO_KEY_LINE,
  downloadHubScenario,
  fetchHubPosts,
} from "../../runtime/hubPosts.js";
import { newPublishKey } from "../../runtime/scenarioSuggestion.js";

// Reading the hub (the post list, a post's bundle, a post's comments) lives in
// src/runtime/hubPosts.js, so the library can use it without this tab. The
// post list, which the translator has always imported from here, stays
// exported.
export { fetchHubPosts };

// How many of a scenario's custom flags are the author's OWN — i.e. worth
// advertising to the hub. A flag installed from the Community tab is already
// posted there, and tagging this scenario with it would list the very same flag
// a second time in the picker's Community tab. Matched by content hash against
// the local flag library (the same hash the library dedupes on). A flag with no
// library record — made before provenance shipped, or arrived inside an imported
// scenario — counts as the author's, so the tag is never wrongly suppressed.
// This only affects the Flags-Count TAG: the flags still travel inside the
// bundle exactly as before, so import is unchanged.
const countPublishableFlags = async (flagsData) => {
  const values = Object.values(flagsData ?? {}).filter(
    (value) => typeof value === "string" && value.startsWith("data:"),
  );
  if (!values.length) return 0;
  let communityHashes;
  try {
    communityHashes = new Set(
      (await listFlags())
        .filter((flag) => flag?.source?.community && flag?.contentHash)
        .map((flag) => flag.contentHash),
    );
  } catch {
    return values.length; // library unreachable: publish as before rather than under-report
  }
  if (!communityHashes.size) return values.length;
  const hashes = await Promise.all(values.map((value) => sha256Hex(value).catch(() => null)));
  return hashes.filter((hash) => !hash || !communityHashes.has(hash)).length;
};

// Never wider than the phone it is on: at 320 px a 19rem card pushed the
// search results sideways off the screen.
const CARD_WIDTH = "min(19rem, calc(100vw - 2rem))";

const cardSurface = {
  background: "rgba(255,255,255,0.04)",
  border: "1px solid rgba(255,255,255,0.09)",
  borderRadius: "16px",
  color: "#fff",
  display: "flex",
  flexDirection: "column",
  flex: `0 0 ${CARD_WIDTH}`,
  gap: "0.55rem",
  maxWidth: CARD_WIDTH,
  minWidth: 0,
  padding: "0.9rem",
  width: CARD_WIDTH,
};

const pillButton = {
  alignItems: "center",
  background: "rgba(255,255,255,0.06)",
  border: "1px solid rgba(255,255,255,0.1)",
  borderRadius: "999px",
  color: "rgba(246,246,248,0.92)",
  cursor: "pointer",
  display: "inline-flex",
  fontSize: "0.8rem",
  fontWeight: 600,
  gap: "0.35rem",
  justifyContent: "center",
  minHeight: "2rem",
  padding: "0 0.85rem",
};

// On a touch screen .oh-tap-row (styles.css) makes a pill a finger's 44 px
// tall, but the pill's inline min-height would beat the class, so there it is
// left out; with a mouse the style is returned untouched.
const touchFit = (style, touch) => (touch ? { ...style, minHeight: undefined } : style);

const rowTitleStyle = {
  color: "rgba(255,255,255,0.9)",
  fontSize: "0.95rem",
  fontWeight: 800,
  letterSpacing: "-0.01em",
  margin: "0 0 0.55rem",
};

const searchInputStyle = {
  background: "rgba(255,255,255,0.06)",
  border: "1px solid rgba(255,255,255,0.1)",
  borderRadius: "999px",
  color: "#fff",
  fontSize: "0.8rem",
  height: "2rem",
  minWidth: "12rem",
  outline: "none",
  padding: "0 0.9rem",
};

const DEFAULT_SCENARIO_COVER = "/scenario-placeholder.webp";

const handleScenarioCoverError = (event) => {
  const image = event.currentTarget;
  if (image.dataset.scenarioCoverFallback === "true") return;
  image.dataset.scenarioCoverFallback = "true";
  image.src = DEFAULT_SCENARIO_COVER;
};

// Covers can arrive in any source dimensions. The viewport owns the geometry;
// the image only fills/crops inside it and therefore cannot resize a card.
const ScenarioCover = ({ post, borderRadius = "10px", marginBottom }) => (
  <div
    style={{
      aspectRatio: "16 / 9",
      borderRadius,
      flex: "0 0 auto",
      maxWidth: "100%",
      minWidth: 0,
      overflow: "hidden",
      width: "100%",
      ...(marginBottom ? { marginBottom } : {}),
    }}
  >
    <img
      src={post.coverImageUrl || DEFAULT_SCENARIO_COVER}
      alt=""
      onError={handleScenarioCoverError}
      style={{
        display: "block",
        height: "100%",
        maxWidth: "100%",
        objectFit: "cover",
        width: "100%",
      }}
    />
  </div>
);

const ScenarioCard = ({ post, busy, onImport, onSelect, touch, isMobile }) => (
  <div
    style={{ ...cardSurface, cursor: "pointer" }}
    onClick={() => onSelect(post)}
  >
    <ScenarioCover post={post} />
    <div style={{ alignItems: "center", display: "flex", gap: "0.55rem" }}>
      {post.avatarUrl && (
        <img src={post.avatarUrl} alt={post.author} style={{ borderRadius: "50%", height: "1.6rem", width: "1.6rem" }} />
      )}
      <div style={{ minWidth: 0 }}>
        <div
          title={post.official ? "Official: posted by a hub maintainer (verified by GitHub, not by the title)" : undefined}
          style={{
            // The OFFICIAL badge marks a post made by a team member (the hub's owner or a collaborator). A random poster writing
            // "official" in their title stays white.
            color: post.official ? "#e4e4e7" : "#fff",
            fontSize: "0.95rem",
            fontWeight: 800,
            letterSpacing: "-0.02em",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {post.pinned ? "📌 " : ""}{post.title}
        </div>
        <div style={{ color: "rgba(255,255,255,0.5)", fontSize: "0.7rem" }}>
          {post.official && (
            <span style={{ background: "rgba(255,255,255,0.13)", border: "1px solid rgba(255,255,255,0.23)", borderRadius: "999px", color: "#e4e4e7", fontSize: "0.62rem", fontWeight: 700, letterSpacing: "0.06em", marginRight: "0.35rem", padding: "0.08rem 0.4rem", textTransform: "uppercase" }}>
              ✓ Official
            </span>
          )}
          by {post.author} · {new Date(post.createdAt).toLocaleDateString()}
        </div>
      </div>
    </div>
    <div style={{ color: "rgba(244,244,246,0.72)", flex: 1, fontSize: "0.8rem", lineHeight: 1.5 }}>
      {post.description || "No description."}
    </div>
    {/* On a phone the card can be narrower than the counts and both pills,
        so a pill that does not fit drops to a line of its own, on the right. */}
    <div style={{ alignItems: "center", display: "flex", flexWrap: isMobile ? "wrap" : undefined, gap: "0.5rem", justifyContent: isMobile ? "flex-end" : undefined }}>
      {post.installs != null && (
        <span title="Times this scenario has been imported" style={{ color: "rgba(255,255,255,0.65)", fontSize: "0.76rem" }}>⬇ {post.installs}</span>
      )}
      <span title="Liked (👍 reactions on the hub post)" style={{ color: "rgba(255,255,255,0.65)", fontSize: "0.76rem" }}>👍 {post.upvotes}</span>
      <span title="Comments on the hub post" style={{ color: "rgba(255,255,255,0.65)", fontSize: "0.76rem" }}>💬 {post.comments}</span>
      <div style={{ flex: 1 }} />
      <a
        href={post.url}
        target="_blank"
        rel="noopener noreferrer"
        className="oh-tap-row"
        onClick={(event) => event.stopPropagation()}
        title="Open the GitHub post to 👍 like or 💬 comment"
        style={touchFit({ ...pillButton, minHeight: "1.8rem", textDecoration: "none" }, touch)}
      >
        👍 Like ↗
      </a>
      <button
        type="button"
        className="oh-tap-row"
        disabled={!post.bundleUrl || busy}
        onClick={(event) => { event.stopPropagation(); onImport(post); }}
        title={post.bundleUrl ? "Import into your Scenarios" : "This post has no scenario file attached"}
        style={touchFit({
          ...pillButton,
          minHeight: "1.8rem",
          background: post.bundleUrl ? "rgba(255,255,255,0.1)" : "rgba(255,255,255,0.04)",
          borderColor: post.bundleUrl ? "rgba(255,255,255,0.25)" : "rgba(255,255,255,0.08)",
          color: post.bundleUrl ? "#fff" : "rgba(255,255,255,0.35)",
          cursor: post.bundleUrl && !busy ? "pointer" : "default",
        }, touch)}
      >
        {busy ? "Importing…" : "Import"}
      </button>
    </div>
  </div>
);

const ScenarioRow = ({ title, posts, busyId, onImport, onSelect, emptyText, layout = "scroll", touch, isMobile }) => (
  <div style={{ marginBottom: "1.15rem" }}>
    <div style={rowTitleStyle}>{title}</div>
    {posts.length === 0 ? (
      <div style={{ color: "rgba(255,255,255,0.4)", fontSize: "0.8rem", padding: "0.3rem 0 0.6rem" }}>
        {emptyText || "Nothing here yet."}
      </div>
    ) : layout === "grid" ? (
      <div style={{ display: "flex", flexWrap: "wrap", gap: "0.8rem", paddingBottom: "0.35rem" }}>
        {posts.map((post) => (
          <ScenarioCard key={post.id} post={post} busy={busyId === post.id} onImport={onImport} onSelect={onSelect} touch={touch} isMobile={isMobile} />
        ))}
      </div>
    ) : (
      <div style={{ display: "flex", gap: "0.8rem", overflowX: "auto", paddingBottom: "0.35rem", scrollbarWidth: "thin" }}>
        {posts.map((post) => (
          <ScenarioCard key={post.id} post={post} busy={busyId === post.id} onImport={onImport} onSelect={onSelect} touch={touch} isMobile={isMobile} />
        ))}
      </div>
    )}
  </div>
);

const detailStat = { color: "rgba(255,255,255,0.75)", fontSize: "0.85rem" };

// Shared by the grid view and ScenarioDetail so the two can't drift out of
// sync in style/wording — each rendered its own copy of this before.
const StatusBanner = ({ notice, error }) => (
  <>
    {notice && (
      <div style={{ background: "rgba(34,197,94,0.12)", border: "1px solid rgba(34,197,94,0.35)", borderRadius: "12px", color: "#bbf7d0", fontSize: "0.82rem", marginBottom: "0.9rem", padding: "0.7rem 0.85rem" }}>
        {notice}
      </div>
    )}
    {error && (
      <div style={{ background: "rgba(248,113,113,0.12)", border: "1px solid rgba(248,113,113,0.34)", borderRadius: "12px", color: "#fecaca", fontSize: "0.82rem", marginBottom: "0.9rem", padding: "0.7rem 0.85rem" }}>
        {error}
      </div>
    )}
  </>
);

const ScenarioDetail = ({ post, busy, onImport, onBack, notice, error, touch }) => (
  <div style={{ color: "#fff" }}>
    <button
      type="button"
      className="oh-tap-row"
      onClick={onBack}
      style={touchFit({ ...pillButton, marginBottom: "0.9rem" }, touch)}
    >
      ← Back
    </button>

    <StatusBanner notice={notice} error={error} />

    <ScenarioCover post={post} borderRadius="14px" marginBottom="0.9rem" />

    <div style={{ alignItems: "center", display: "flex", gap: "0.6rem", marginBottom: "0.3rem" }}>
      {post.avatarUrl && (
        <img src={post.avatarUrl} alt={post.author} style={{ borderRadius: "50%", height: "1.8rem", width: "1.8rem" }} />
      )}
      <h3 style={{ fontSize: "1.3rem", fontWeight: 800, margin: 0 }}>
        {post.pinned ? "📌 " : ""}{post.title}
      </h3>
    </div>
    <div style={{ color: "rgba(255,255,255,0.55)", fontSize: "0.8rem", marginBottom: "0.9rem" }}>
      by {post.author} · {new Date(post.createdAt).toLocaleDateString()}
    </div>

    <div style={{ alignItems: "center", display: "flex", flexWrap: "wrap", gap: "1.1rem", marginBottom: "0.55rem" }}>
      {post.installs != null && <span style={detailStat}>⬇ {post.installs} imported</span>}
      <a href={post.url} target="_blank" rel="noopener noreferrer" title="Like this scenario on its GitHub post" style={{ ...detailStat, textDecoration: "none" }}>👍 {post.upvotes} liked</a>
      <a href={post.url} target="_blank" rel="noopener noreferrer" title="Comment on its GitHub post" style={{ ...detailStat, textDecoration: "none" }}>💬 {post.comments} comments</a>
    </div>
    <div style={{ color: "#e4e4e7", fontSize: "0.78rem", marginBottom: "1rem" }}>
      Likes and comments live on the scenario's GitHub post — tap 👍 or 💬 above (or the button below) to open it and react there.
    </div>

    <p style={{ color: "rgba(244,244,246,0.8)", fontSize: "0.9rem", lineHeight: 1.6, marginBottom: "1.3rem" }}>
      {post.description || "No description."}
    </p>

    {/* Wraps on a phone, where the two side by side are wider than the screen. */}
    <div style={{ display: "flex", flexWrap: "wrap", gap: "0.6rem" }}>
      <button
        type="button"
        className="oh-tap-row"
        disabled={!post.bundleUrl || busy}
        onClick={() => onImport(post)}
        style={{
          alignItems: "center",
          background: post.bundleUrl ? "rgba(255,255,255,0.1)" : "rgba(255,255,255,0.08)",
          border: "none",
          borderRadius: "10px",
          color: post.bundleUrl ? "#fff" : "rgba(255,255,255,0.35)",
          cursor: post.bundleUrl && !busy ? "pointer" : "default",
          display: "flex",
          fontSize: "1rem",
          fontWeight: 700,
          justifyContent: "center",
          padding: "0.8rem 1.6rem",
        }}
      >
        {busy ? "Importing…" : "▶ Import & Play"}
      </button>
      <a href={post.url} target="_blank" rel="noopener noreferrer" className="oh-tap-row" style={touchFit({ ...pillButton, textDecoration: "none" }, touch)}>
        👍 Like / 💬 Comment ↗
      </a>
    </div>
  </div>
);

const CommunityPanel = ({ fullPage = false, onImported }) => {
  const { scenarios } = useLibraryState();
  const touch = useTouchPrimary();
  const isMobile = useIsMobile();
  const [posts, setPosts] = useState(null);
  const [error, setError] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const [notice, setNotice] = useState(null);
  const [publishPickerOpen, setPublishPickerOpen] = useState(false);
  const [selectedPost, setSelectedPost] = useState(null);
  // Client-side filter over the already-fetched posts — title, author and
  // description. No extra network calls; the hub is only ever read by load().
  const [searchQuery, setSearchQuery] = useState("");

  // handleImport is async (network + import can take several seconds); by the
  // time it resolves the user may have navigated to a different post or back
  // to the grid. This ref holds the up-to-date selection so a delayed result
  // can tell whether it still applies, without a stale closure over
  // `selectedPost` from when the import started.
  const selectedPostRef = useRef(null);
  useEffect(() => {
    selectedPostRef.current = selectedPost;
  }, [selectedPost]);

  const clearBanners = () => {
    setNotice(null);
    setError(null);
  };

  // A notice/error from one post (e.g. "Imported X") must not leak into a
  // different post's detail view when the selection changes.
  const selectPost = (post) => {
    setSelectedPost(post);
    clearBanners();
  };

  const backToGrid = () => {
    setSelectedPost(null);
    clearBanners();
  };

  const load = (force) => {
    setError(null);
    fetchHubPosts({ force })
      .then((nextPosts) => {
        setPosts(nextPosts);
        // New uploads appear over time: hand their strings to the translator
        // so only the not-yet-translated ones cost anything.
        enqueueStrings(nextPosts.flatMap((post) => [post.title, post.description]));
      })
      .catch((nextError) => setError(nextError.message));
  };

  useEffect(() => {
    load(false);
  }, []);

  // Search filter. Matches title, desc and author
  const filteredPosts = useMemo(() => {
    if (!posts) return null;
    const query = searchQuery.trim().toLowerCase();
    if (!query) return posts;
    return posts.filter((post) =>
      post.title.toLowerCase().includes(query) ||
      post.author.toLowerCase().includes(query) ||
      post.description.toLowerCase().includes(query),
    );
  }, [posts, searchQuery]);

  // Search bar
  const searchResults = useMemo(() => {
    if (!filteredPosts) return null;
    const query = searchQuery.trim().toLowerCase();
    if (!query) return filteredPosts;
    const countHits = (text) => {
      if (!text) return 0;
      let count = 0;
      let from = 0;
      const lower = text.toLowerCase();
      while (true) {
        const index = lower.indexOf(query, from);
        if (index === -1) break;
        count += 1;
        from = index + query.length;
      }
      return count;
    };
    const weighted = filteredPosts.map((post) => ({
      post,
      // search weight: title > description > author
      score: countHits(post.title) * 5 + countHits(post.description) * 3 + countHits(post.author),
    }));
    weighted.sort((a, b) =>
      b.score - a.score ||
      (b.post.installs ?? -1) - (a.post.installs ?? -1) ||
      b.post.upvotes - a.post.upvotes ||
      b.post.createdAt.localeCompare(a.post.createdAt),
    );
    return weighted.map((entry) => entry.post);
  }, [filteredPosts, searchQuery]);

  // Netflix-style shelves. A post can appear in several rows — that's intended.
  const rows = useMemo(() => {
    if (!filteredPosts) return null;
    const pinned = filteredPosts.filter((post) => post.pinned);
    // Installs (real download counts) rank first; posts GitHub can't count
    // (attachment bundles) fall back to likes, then recency.
    const byInstalls = [...filteredPosts].sort(
      (a, b) =>
        (b.installs ?? -1) - (a.installs ?? -1) ||
        b.upvotes - a.upvotes ||
        b.createdAt.localeCompare(a.createdAt),
    );
    const byLikes = [...filteredPosts].sort((a, b) => b.upvotes - a.upvotes || b.createdAt.localeCompare(a.createdAt));
    const byRecent = [...filteredPosts].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return { pinned, byInstalls, byLikes, byRecent };
  }, [filteredPosts]);

  const handleImport = async (post) => {
    if (!post.bundleUrl || busyId) return;
    setBusyId(post.id);
    clearBanners();
    try {
      // The checked copy of the post's file, from the hub's releases, stamped
      // with its provenance: which post, which file of it, and which copy was
      // downloaded (hubPosts.js downloadHubScenario). The library's Scenarios
      // tab compares this against the post's CURRENT bundle URL to offer an
      // Update button while the copy is unedited; once the player edits it the
      // link stays, marked edited, so they can suggest their changes back to
      // the post (server/hubProvenance.js).
      const bundle = await downloadHubScenario({ postId: post.id, bundleUrl: post.bundleUrl, title: post.title, author: post.author, flatMap: post.flatMap });
      // Nothing is reported anywhere: the download of the post's file from the
      // hub's releases, just above, is what counts the import (hubFiles.js).
      const details = await importScenarioBundle(bundle);
      // The user may have navigated to a different post's detail view while
      // this was in flight — don't attribute this result to whatever happens
      // to be on screen now unless it's still this post (or the grid).
      const stillRelevant = !selectedPostRef.current || selectedPostRef.current.id === post.id;
      if (stillRelevant) {
        setNotice(
          `Imported "${details?.scenario?.name ?? post.title}" — it's in your Scenarios tab. ` +
            `Enjoyed it? Open its hub post (👍 Like ↗) and hit 👍 to like or 💬 to comment.`,
        );
      }
      onImported?.(details);
    } catch (nextError) {
      const stillRelevant = !selectedPostRef.current || selectedPostRef.current.id === post.id;
      if (stillRelevant) {
        setError(`Import failed: ${nextError.message}`);
      }
    } finally {
      setBusyId(null);
    }
  };

  // Publish: export the chosen scenario to disk, then open a prefilled hub post
  // where the author drags the downloaded bundle into the description.
  const handlePublish = async (scenario) => {
    setPublishPickerOpen(false);
    setError(null);
    try {
      const bundle = await exportScenarioBundle(scenario.id);
      // If this scenario's custom basemap is already on the community hub,
      // reference it instead of re-embedding the whole image (smaller bundle).
      const dedup = await dedupeScenarioBundleBackground(bundle).catch(() => ({ referenced: false, needsPublish: false }));
      const split = dedup.referenced ? null : await splitScenarioBundleImage(bundle).catch(() => null);
      // ALWAYS ship a .zip. GitHub issue attachments reject a bare .json, so a
      // scenario with no splittable image — e.g. a geometry-only preset like WWII,
      // whose custom borders live in an embedded regions.geojson, not a basemap —
      // could never actually be dragged into the post: the download looked fine, but
      // the share was impossible. Wrapping scenario.json in a zip makes EVERY scenario
      // attachable. A custom image basemap still rides alongside as a real file
      // (scenario.json + basemap + preview) when there is one, instead of bloating the
      // JSON as a base64 data URL.
      const files = {};
      let extra;
      if (split) {
        delete bundle.assets.backgroundData; // the image now rides in the zip as a real file
        files[split.imageName] = split.imageBytes;
        if (split.previewBytes) files[split.previewName] = split.previewBytes;
        extra =
          " Its custom basemap is bundled inside the .zip, so the scenario is self-contained — just drag the one file." +
          " (To also list the basemap on its own in the community Basemaps tab, open the editor's Basemap picker and hit ⤴ on it.)";
      } else {
        extra = dedup.referenced
          ? " Its custom basemap was reused from the community hub, so the file stays small."
          : "";
      }
      // The cover rides inside the .zip as its own file (cover.<ext>) so the bundle is
      // complete and browsable on its own. It ALSO downloads separately, because GitHub
      // can't render an image that lives inside a .zip: the author drags that copy into
      // the post, where the hub reads it as the card cover — like a basemap/flag preview.
      // The copy inside the .zip is what import reads, so the .zip stays self-contained.
      let hasCover = false;
      let coverBlob = null;
      let coverDownloadName = "";
      const cover = bundle.assets?.cover;
      if (cover?.mode === "embedded" && cover.data) {
        const ext = /png/i.test(cover.contentType || "") ? "png" : /webp/i.test(cover.contentType || "") ? "webp" : "jpg";
        try {
          coverBlob = await (await fetch(`data:${cover.contentType || "image/jpeg"};base64,${cover.data}`)).blob();
          files[`cover.${ext}`] = new Uint8Array(await coverBlob.arrayBuffer());
          coverDownloadName = `${scenario.id}-cover.${ext}`;
          hasCover = true;
        } catch { /* the cover is a nicety — never block the publish over it */ }
      }
      // The heavy assets ride as real entries rather than as base64 inside
      // scenario.json, which is most of what a shared map weighs
      // (src/runtime/bundleFiles.js).
      const lifted = splitBundleFiles(bundle);
      Object.assign(files, lifted.files);
      files["scenario.json"] = JSON.stringify(lifted.bundle);
      const fileName = `${scenario.id}-scenario.zip`;
      saveBlobToDisk(await zipBundle(files), fileName);
      if (coverBlob && coverDownloadName) saveBlobToDisk(coverBlob, coverDownloadName);
      // When the scenario carries a basemap, tag the post with the basemap hash so
      // the community Basemaps browser (which surfaces scenario-carried basemaps) can
      // dedupe it against dedicated posts. When it carries custom flags, tag the
      // count so the flag picker's Community tab surfaces the post as an
      // installable flag pack without downloading every bundle first. Harmless if
      // the scenario form has no such field — GitHub ignores unknown prefills.
      const customFlagCount = await countPublishableFlags(bundle.assets?.flags?.data);
      // The scenario's publish key, written into the post: finding it there is
      // how this install later learns which post is its player's own, and so
      // which posts' comments to read for suggested changes. The same key for
      // every post made of this scenario; the scenario keeps it.
      const publishKey = scenario.hubPublished?.key || newPublishKey();
      const technicalLines = [
        ...(split ? [`Basemap-Hash: ${split.hash}`, `Basemap-Kind: ${split.kind}`] : []),
        ...(customFlagCount > 0 ? [`Flags-Count: ${customFlagCount}`] : []),
        `${SCENARIO_KEY_LINE}: ${publishKey}`,
      ];
      const scenarioUrl =
        `${HUB_NEW_POST_URL}&title=${encodeURIComponent(`[Scenario] ${scenario.name}`)}` +
        `&technical=${encodeURIComponent(technicalLines.join("\n"))}`;
      window.open(scenarioUrl, "_blank", "noopener");
      // After the page is open: a browser only lets a click open a window for
      // a moment, and this write is not worth losing the page over.
      if (!scenario.hubPublished?.key) {
        saveScenario(scenario.id, {
          hubPublished: { ...(scenario.hubPublished ?? {}), key: publishKey, publishedAt: new Date().toISOString() },
        }).catch((nextError) => console.warn("[hub] could not record the publish key:", nextError));
      }
      setNotice(
        `${hasCover ? `"${fileName}" and its cover image were` : `"${fileName}" was`} downloaded. ` +
          `On the GitHub page that just opened, drag ${hasCover ? "both files" : "that file"} into the Description box, then submit.` +
          `${hasCover ? " The cover image becomes the card's preview in the hub." : ""}${extra}`,
      );
    } catch (nextError) {
      setError(`Publish failed: ${nextError.message}`);
    }
  };

  return (
    // As the main menu's Community tab (fullPage) the surrounding page owns
    // scrolling; as a floating panel it caps its own height and scrolls itself.
    <div style={{ color: "#fff", ...(fullPage ? {} : { maxHeight: `calc(${APP_HEIGHT} - 11rem)`, overflowY: "auto", paddingRight: "0.2rem" }) }}>
      {selectedPost ? (
        <ScenarioDetail
          post={selectedPost}
          busy={busyId === selectedPost.id}
          onImport={handleImport}
          onBack={backToGrid}
          notice={notice}
          error={error}
          touch={touch}
        />
      ) : (
        <>
          <div style={{ alignItems: "center", display: "flex", flexWrap: "wrap", gap: "0.5rem", marginBottom: "0.9rem" }}>
            <div style={{ color: "rgba(255,255,255,0.55)", fontSize: "0.78rem" }}>
              Community scenarios from the hub — ⬇ = imports, 👍 = likes. Open any post to 👍 like or 💬 comment on GitHub.
              {" "}<span style={{ color: "#e4e4e7" }}>The OFFICIAL badge marks a post made by a team member of the game.</span>
            </div>
            <div style={{ flex: 1 }} />
            <input
              type="text"
              className="oh-tap-row"
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder="Search scenarios…"
              aria-label="Search community scenarios"
              style={searchInputStyle}
            />
            <button type="button" className="oh-tap-row" onClick={() => load(true)} style={touchFit(pillButton, touch)}>Refresh</button>
            <button
              type="button"
              className="oh-tap-row"
              onClick={() => setPublishPickerOpen((open) => !open)}
              style={touchFit({ ...pillButton, background: "rgba(255,255,255,0.15)", borderColor: "rgba(255,255,255,0.25)" }, touch)}
            >
              ⬆ Publish to Hub
            </button>
            <a href={HUB_URL} target="_blank" rel="noopener noreferrer" className="oh-tap-row" style={touchFit({ ...pillButton, textDecoration: "none" }, touch)}>
              Open Hub ↗
            </a>
            {/* The one coloured control on this page, on purpose: it is the brand's
                own blue, and the corner is where a newcomer looks for the door. */}
            <a href={DISCORD_URL} target="_blank" rel="noopener noreferrer" className="oh-tap-row" style={touchFit({ ...pillButton, background: DISCORD_BLURPLE, borderColor: "#6d78f5", color: "#fff", fontWeight: 700, gap: "0.45rem", textDecoration: "none" }, touch)}>
              <DiscordMark size="1.05rem" />
              Join the Discord
            </a>
          </div>

          {publishPickerOpen && (
            <div style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: "14px", marginBottom: "0.9rem", padding: "0.8rem" }}>
              <div style={{ color: "rgba(255,255,255,0.7)", fontSize: "0.8rem", marginBottom: "0.55rem" }}>
                Pick a scenario to publish. Its bundle downloads to your computer, and a prefilled hub post opens —
                drag the downloaded file into the Description box there and submit.
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "0.45rem" }}>
                {scenarios.map((scenario) => (
                  <button key={scenario.id} type="button" className="oh-tap-row" onClick={() => handlePublish(scenario)} style={touchFit(pillButton, touch)}>
                    {scenario.name}
                  </button>
                ))}
              </div>
            </div>
          )}

          <StatusBanner notice={notice} error={error} />

          {!posts && !error && (
            <div style={{ color: "rgba(255,255,255,0.55)", fontSize: "0.85rem", padding: "1rem 0" }}>
              Loading community scenarios…
            </div>
          )}

          {rows && (
            searchQuery.trim() ? (
              <ScenarioRow
                title={`🔍 Results (${searchResults.length})`}
                posts={searchResults}
                busyId={busyId}
                onImport={handleImport}
                onSelect={selectPost}
                emptyText="No scenarios match your search."
                layout="grid"
                touch={touch}
                isMobile={isMobile}
              />
            ) : (
              <>
                {/* A shelf with nothing on it is not a shelf: with no pinned posts the
                    page starts at Most Installed. */}
                {rows.pinned.length > 0 && (
                  <ScenarioRow
                    title="📌 Pinned"
                    posts={rows.pinned}
                    busyId={busyId}
                    onImport={handleImport}
                    onSelect={selectPost}
                    touch={touch}
                    isMobile={isMobile}
                  />
                )}
                <ScenarioRow title="⬇ Most Installed" posts={rows.byInstalls} busyId={busyId} onImport={handleImport} onSelect={selectPost} touch={touch} isMobile={isMobile} />
                <ScenarioRow title="👍 Most Liked" posts={rows.byLikes} busyId={busyId} onImport={handleImport} onSelect={selectPost} touch={touch} isMobile={isMobile} />
                <ScenarioRow title="🕐 Most Recent" posts={rows.byRecent} busyId={busyId} onImport={handleImport} onSelect={selectPost} touch={touch} isMobile={isMobile} />
              </>
            )
          )}
        </>
      )}
    </div>
  );
};

export default CommunityPanel;
