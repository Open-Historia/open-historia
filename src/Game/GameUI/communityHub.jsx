/*! Open Historia — Scenario Hub (community tab) © 2026 Nicholas Krol, MIT (see src/Editor/LICENSE). */

// The Community tab of the scenario library, Netflix-style: a Pinned shelf at
// the top (hub posts labeled "pinned" — the official/featured scenarios), then
// horizontally scrolling rows for Most Installed (⬇ release-asset download
// counts), Most Liked (👍) and Most Recent. Data comes straight from the public
// Scenario Hub — a GitHub
// repo where every issue is a posted scenario — and bundles import through the
// server's /api/hub proxy. Publishing exports the chosen scenario locally and
// opens a prefilled hub post where the author drags the bundle in.

import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  exportScenarioBundle,
  importScenarioBundle,
  useLibraryState,
} from "../../runtime/library.js";
import { enqueueStrings } from "../../runtime/translator.js";
import {
  dedupeScenarioBundleBackground,
  embedScenarioBundleImage,
  embedScenarioBundleVector,
  resolveScenarioBundleBackground,
  splitScenarioBundleImage,
} from "../../runtime/communityBasemaps.js";
import { unzipBundle, zipBundle } from "../../runtime/bundleZip.js";

// The one and only hub. Not configurable by design.
const HUB_OWNER = "Open-Historia";
const HUB_REPO = "Open-historia-scenarios";
const HUB_URL = `https://github.com/${HUB_OWNER}/${HUB_REPO}`;
const HUB_API_ISSUES = `https://api.github.com/repos/${HUB_OWNER}/${HUB_REPO}/issues?state=open&labels=scenario&per_page=100`;
// Official bundles live as assets on the "bundles" release — GitHub counts
// every download of those, which is the install number shown on the cards.
const HUB_API_BUNDLES_RELEASE = `https://api.github.com/repos/${HUB_OWNER}/${HUB_REPO}/releases/tags/bundles`;
const HUB_NEW_POST_URL = `${HUB_URL}/issues/new?template=scenario.yml`;
const CACHE_TTL_MS = 5 * 60 * 1000;

// First GitHub-hosted .json (release asset, attachment or raw) link in an issue
// body = the bundle. Release links come first in official posts so imports go
// through the download-counted URL; the raw mirror below it serves old clients.
const BUNDLE_LINK_PATTERN =
  /https:\/\/(?:github\.com\/[^\s)<>"']+\/releases\/download\/[^\s)<>"']+\.(?:json|zip)|github\.com\/[^\s)<>"']+\/files\/[^\s)<>"']+|github\.com\/user-attachments\/files\/[^\s)<>"']+|raw\.githubusercontent\.com\/[^\s)<>"']+\.json)/i;

// First image in the issue body — markdown ![alt](url) or GitHub's own
// <img src="..."> attachment markup (issue bodies mix both depending on how
// the image was pasted). Used as the card/detail-view cover; posts with no
// image simply get coverImageUrl: null (existing text-only card, no error).
const COVER_IMAGE_PATTERN =
  /!\[[^\]]*\]\((https:\/\/[^\s)]+)\)|<img[^>]+src=["']([^"']+)["']/i;

let hubCache = { at: 0, posts: null };

// Installs per bundle file (release-asset download counts). Community posts
// attach their bundles to the issue instead, which GitHub can't count — those
// show no install number.
const fetchInstallCounts = async () => {
  try {
    const response = await fetch(HUB_API_BUNDLES_RELEASE, {
      headers: { Accept: "application/vnd.github+json" },
    });
    if (!response.ok) return new Map();
    const release = await response.json();
    return new Map((release.assets ?? []).map((asset) => [asset.name, asset.download_count ?? 0]));
  } catch {
    return new Map();
  }
};

// Self-hosted import counts (keyed by hub issue number), read back through the
// server proxy from our own counter Worker. Unlike GitHub's release download
// counts, this covers EVERY scenario — including attachment posts — and is
// deduped per person. Empty object if the counter isn't configured/reachable.
const fetchImportCounts = async () => {
  try {
    const response = await fetch("/api/hub/import-counts");
    if (!response.ok) return {};
    const data = await response.json();
    return data && typeof data === "object" ? data : {};
  } catch {
    return {};
  }
};

// Official = posted by someone with real access to the hub repo, as reported
// by GitHub itself (author_association). Titles and body text can't fake this.
const OFFICIAL_ASSOCIATIONS = new Set(["OWNER", "MEMBER", "COLLABORATOR"]);

const parsePost = (issue, installsByFile, importsById) => {
  const body = String(issue.body ?? "");
  const bundleUrl = body.match(BUNDLE_LINK_PATTERN)?.[0] ?? null;
  // The issue-form body is a series of "### <label>\n<value>" sections. Show only
  // the author's Description prose: strip the attached-file link and never surface
  // the "Made by" or auto-filled "Basemap info" (hash/kind) sections — those are
  // metadata, not copy. Falls back to the whole body for old, non-form posts.
  const descSection = body.match(/###\s*Description[^\n]*\n+([\s\S]*?)(?=\n###\s|$)/i);
  const description = (descSection ? descSection[1] : body)
    .replace(/###\s*Basemap info[\s\S]*$/i, "")     // auto-filled technical section (fallback path)
    .replace(/^Basemap-(?:Hash|Kind):.*$/gim, "")   // stray hash/kind lines
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")            // images
    .replace(/<img[^>]*>/gi, "")
    .replace(/\[[^\]]*\]\([^)]*\)/g, "")             // markdown links (the dragged-in scenario file)
    .replace(BUNDLE_LINK_PATTERN, "")               // a bare bundle URL (older posts)
    .replace(/^#+\s*.*$/gim, "")                      // any leftover headings
    .replace(/\b(?:Scenario|Bundle) file:\s*/gi, "") // older "Scenario file:" label
    .replace(/_No response_/gi, "")                  // GitHub's placeholder for empty fields
    .replace(/\s+/g, " ")
    .trim();
  const coverImageMatch = body.match(COVER_IMAGE_PATTERN);
  const coverImageUrl = coverImageMatch ? (coverImageMatch[1] ?? coverImageMatch[2] ?? null) : null;
  // Import count: prefer our own counter (covers every scenario, deduped per
  // person); fall back to the GitHub release download count; null if neither.
  const selfHostedImports = importsById?.[String(issue.number)]?.count;
  const githubInstalls = bundleUrl && installsByFile ? installsByFile.get(bundleUrl.split("/").pop()) : undefined;
  const installs = selfHostedImports != null ? selfHostedImports : (githubInstalls ?? null);
  return {
    id: issue.number,
    title: String(issue.title ?? "").replace(/^\[Scenario\]\s*/i, "").trim() || `Scenario #${issue.number}`,
    author: issue.user?.login ?? "unknown",
    avatarUrl: issue.user?.avatar_url ?? null,
    url: issue.html_url,
    createdAt: issue.created_at,
    // The "pinned" label can only be applied by hub collaborators: GitHub
    // silently drops labels set by anyone without push access (API, issue
    // forms and URL params alike), so authors can't pin their own posts.
    pinned: (issue.labels ?? []).some((label) => (label.name ?? label) === "pinned"),
    // Verified against GitHub's author_association — only posts actually made
    // by the hub owner or a repo collaborator count. Writing "official" in a
    // title does nothing.
    official: OFFICIAL_ASSOCIATIONS.has(issue.author_association),
    upvotes: issue.reactions?.["+1"] ?? 0,
    comments: issue.comments ?? 0,
    description: description.length > 200 ? `${description.slice(0, 197)}...` : description,
    bundleUrl,
    installs,
    coverImageUrl,
  };
};

// Exported so the translator can pre-translate the Community tab's posts.
export const fetchHubPosts = async ({ force = false } = {}) => {
  if (!force && hubCache.posts && Date.now() - hubCache.at < CACHE_TTL_MS) {
    return hubCache.posts;
  }
  const [response, installsByFile, importsById] = await Promise.all([
    fetch(HUB_API_ISSUES, { headers: { Accept: "application/vnd.github+json" } }),
    fetchInstallCounts(),
    fetchImportCounts(),
  ]);
  if (!response.ok) {
    throw new Error(
      response.status === 403
        ? "GitHub rate limit reached — try again in a few minutes."
        : `Could not reach the Scenario Hub (HTTP ${response.status}).`,
    );
  }
  const issues = await response.json();
  const posts = (Array.isArray(issues) ? issues : [])
    .filter((issue) => !issue.pull_request)
    .map((issue) => parsePost(issue, installsByFile, importsById));
  hubCache = { at: Date.now(), posts };
  return posts;
};

const saveBlobToDisk = (blob, fileName) => {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
};

const saveJsonToDisk = (data, fileName) =>
  saveBlobToDisk(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }), fileName);

const cardSurface = {
  background: "rgba(255,255,255,0.04)",
  border: "1px solid rgba(255,255,255,0.09)",
  borderRadius: "16px",
  color: "#fff",
  display: "flex",
  flexDirection: "column",
  flex: "0 0 19rem",
  gap: "0.55rem",
  padding: "0.9rem",
};

const pillButton = {
  alignItems: "center",
  background: "rgba(255,255,255,0.06)",
  border: "1px solid rgba(255,255,255,0.1)",
  borderRadius: "999px",
  color: "rgba(244,246,255,0.92)",
  cursor: "pointer",
  display: "inline-flex",
  fontSize: "0.8rem",
  fontWeight: 600,
  gap: "0.35rem",
  justifyContent: "center",
  minHeight: "2rem",
  padding: "0 0.85rem",
};

const rowTitleStyle = {
  color: "rgba(255,255,255,0.9)",
  fontSize: "0.95rem",
  fontWeight: 800,
  letterSpacing: "-0.01em",
  margin: "0 0 0.55rem",
};

const ScenarioCard = ({ post, busy, onImport, onSelect }) => (
  <div
    style={{ ...cardSurface, cursor: "pointer" }}
    onClick={() => onSelect(post)}
  >
    {post.coverImageUrl && (
      <img
        src={post.coverImageUrl}
        alt=""
        onError={(event) => { event.currentTarget.style.display = "none"; }}
        style={{
          aspectRatio: "16 / 9",
          borderRadius: "10px",
          objectFit: "cover",
          width: "100%",
        }}
      />
    )}
    <div style={{ alignItems: "center", display: "flex", gap: "0.55rem" }}>
      {post.avatarUrl && (
        <img src={post.avatarUrl} alt={post.author} style={{ borderRadius: "50%", height: "1.6rem", width: "1.6rem" }} />
      )}
      <div style={{ minWidth: 0 }}>
        <div
          title={post.official ? "Official: posted by a hub maintainer (verified by GitHub, not by the title)" : undefined}
          style={{
            // Purple = verified official (hub-owner post). A random poster writing
            // "official" in their title stays white.
            color: post.official ? "#c4b5fd" : "#fff",
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
            <span style={{ background: "rgba(124,58,237,0.25)", border: "1px solid rgba(167,139,250,0.45)", borderRadius: "999px", color: "#c4b5fd", fontSize: "0.62rem", fontWeight: 700, letterSpacing: "0.06em", marginRight: "0.35rem", padding: "0.08rem 0.4rem", textTransform: "uppercase" }}>
              ✓ Official
            </span>
          )}
          by {post.author} · {new Date(post.createdAt).toLocaleDateString()}
        </div>
      </div>
    </div>
    <div style={{ color: "rgba(240,244,255,0.72)", flex: 1, fontSize: "0.8rem", lineHeight: 1.5 }}>
      {post.description || "No description."}
    </div>
    <div style={{ alignItems: "center", display: "flex", gap: "0.5rem" }}>
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
        onClick={(event) => event.stopPropagation()}
        title="Open the GitHub post to 👍 like or 💬 comment"
        style={{ ...pillButton, minHeight: "1.8rem", textDecoration: "none" }}
      >
        👍 Like ↗
      </a>
      <button
        type="button"
        disabled={!post.bundleUrl || busy}
        onClick={(event) => { event.stopPropagation(); onImport(post); }}
        title={post.bundleUrl ? "Import into your Scenarios" : "This post has no scenario file attached"}
        style={{
          ...pillButton,
          minHeight: "1.8rem",
          background: post.bundleUrl ? "rgba(124,58,237,0.35)" : "rgba(255,255,255,0.04)",
          borderColor: post.bundleUrl ? "rgba(124,58,237,0.5)" : "rgba(255,255,255,0.08)",
          color: post.bundleUrl ? "#fff" : "rgba(255,255,255,0.35)",
          cursor: post.bundleUrl && !busy ? "pointer" : "default",
        }}
      >
        {busy ? "Importing…" : "Import"}
      </button>
    </div>
  </div>
);

const ScenarioRow = ({ title, posts, busyId, onImport, onSelect, emptyText }) => (
  <div style={{ marginBottom: "1.15rem" }}>
    <div style={rowTitleStyle}>{title}</div>
    {posts.length === 0 ? (
      <div style={{ color: "rgba(255,255,255,0.4)", fontSize: "0.8rem", padding: "0.3rem 0 0.6rem" }}>
        {emptyText || "Nothing here yet."}
      </div>
    ) : (
      <div style={{ display: "flex", gap: "0.8rem", overflowX: "auto", paddingBottom: "0.35rem", scrollbarWidth: "thin" }}>
        {posts.map((post) => (
          <ScenarioCard key={post.id} post={post} busy={busyId === post.id} onImport={onImport} onSelect={onSelect} />
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

const ScenarioDetail = ({ post, busy, onImport, onBack, notice, error }) => (
  <div style={{ color: "#fff" }}>
    <button
      type="button"
      onClick={onBack}
      style={{ ...pillButton, marginBottom: "0.9rem" }}
    >
      ← Back
    </button>

    <StatusBanner notice={notice} error={error} />

    {post.coverImageUrl && (
      <img
        src={post.coverImageUrl}
        alt=""
        onError={(event) => { event.currentTarget.style.display = "none"; }}
        style={{
          aspectRatio: "16 / 9",
          borderRadius: "14px",
          marginBottom: "0.9rem",
          objectFit: "cover",
          width: "100%",
        }}
      />
    )}

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
    <div style={{ color: "rgba(196,181,253,0.9)", fontSize: "0.78rem", marginBottom: "1rem" }}>
      Likes and comments live on the scenario's GitHub post — tap 👍 or 💬 above (or the button below) to open it and react there.
    </div>

    <p style={{ color: "rgba(240,244,255,0.8)", fontSize: "0.9rem", lineHeight: 1.6, marginBottom: "1.3rem" }}>
      {post.description || "No description."}
    </p>

    <div style={{ display: "flex", gap: "0.6rem" }}>
      <button
        type="button"
        disabled={!post.bundleUrl || busy}
        onClick={() => onImport(post)}
        style={{
          alignItems: "center",
          background: post.bundleUrl ? "rgba(124,58,237,0.85)" : "rgba(255,255,255,0.08)",
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
      <a href={post.url} target="_blank" rel="noopener noreferrer" style={{ ...pillButton, textDecoration: "none" }}>
        👍 Like / 💬 Comment ↗
      </a>
    </div>
  </div>
);

const CommunityPanel = ({ onImported }) => {
  const { scenarios } = useLibraryState();
  const [posts, setPosts] = useState(null);
  const [error, setError] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const [notice, setNotice] = useState(null);
  const [publishPickerOpen, setPublishPickerOpen] = useState(false);
  const [selectedPost, setSelectedPost] = useState(null);

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

  // Netflix-style shelves. A post can appear in several rows — that's intended.
  const rows = useMemo(() => {
    if (!posts) return null;
    const pinned = posts.filter((post) => post.pinned);
    // Installs (real download counts) rank first; posts GitHub can't count
    // (attachment bundles) fall back to likes, then recency.
    const byInstalls = [...posts].sort(
      (a, b) =>
        (b.installs ?? -1) - (a.installs ?? -1) ||
        b.upvotes - a.upvotes ||
        b.createdAt.localeCompare(a.createdAt),
    );
    const byLikes = [...posts].sort((a, b) => b.upvotes - a.upvotes || b.createdAt.localeCompare(a.createdAt));
    const byRecent = [...posts].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return { pinned, byInstalls, byLikes, byRecent };
  }, [posts]);

  const handleImport = async (post) => {
    if (!post.bundleUrl || busyId) return;
    setBusyId(post.id);
    clearBanners();
    try {
      const response = await fetch(`/api/hub/file?url=${encodeURIComponent(post.bundleUrl)}`);
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload.error || `Download failed (HTTP ${response.status}).`);
      }
      // A scenario with a custom basemap ships as a .zip (scenario.json + the raw
      // basemap file + preview); everything else is a plain JSON bundle. The basemap
      // is an image (basemap.png/jpg…) or a generated vector (basemap.geojson).
      let bundle;
      if (/\.zip(\?|$)/i.test(post.bundleUrl)) {
        const zip = await unzipBundle(await response.arrayBuffer());
        const scenarioText = await zip.text("scenario.json");
        if (!scenarioText) throw new Error("That .zip is missing scenario.json.");
        bundle = JSON.parse(scenarioText);
        const imageName = zip.names().find((n) => /(^|\/)basemap\.(png|jpe?g|webp|gif|svg)$/i.test(n));
        if (imageName) {
          embedScenarioBundleImage(bundle, await zip.bytes(imageName), imageName);
        } else {
          const vectorName = zip.names().find((n) => /(^|\/)basemap\.geojson$/i.test(n));
          if (vectorName) embedScenarioBundleVector(bundle, await zip.bytes(vectorName));
        }
      } else {
        bundle = await response.json();
      }
      // A shared scenario may reference a community basemap instead of embedding
      // it — fetch and inline it before importing so the map isn't blank.
      await resolveScenarioBundleBackground(bundle);
      const details = await importScenarioBundle(bundle);
      // Best-effort: tell the server this import succeeded so it can count it
      // (once per install) on the hub's self-hosted import counter. Never blocks
      // or fails the import — fire and forget.
      fetch("/api/hub/import-log", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: post.bundleUrl, id: post.id, title: post.title }),
      }).catch(() => {});
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
      const bundle = await exportScenarioBundle(scenario.id, "light");
      // If this scenario's custom basemap is already on the community hub,
      // reference it instead of re-embedding the whole image (smaller bundle).
      const dedup = await dedupeScenarioBundleBackground(bundle).catch(() => ({ referenced: false, needsPublish: false }));
      // A not-yet-shared custom image basemap ships bundled as ONE .zip
      // (scenario.json + the raw basemap image + a preview) so the author drags a
      // single file and the image travels as real bytes, not a bloated data URL.
      const split = dedup.referenced ? null : await splitScenarioBundleImage(bundle).catch(() => null);
      let fileName;
      let extra;
      if (split) {
        delete bundle.assets.backgroundData; // the image now rides in the zip as a real file
        const files = { "scenario.json": JSON.stringify(bundle), [split.imageName]: split.imageBytes };
        if (split.previewBytes) files[split.previewName] = split.previewBytes;
        fileName = `${scenario.id}-scenario.zip`;
        saveBlobToDisk(await zipBundle(files), fileName);
        extra =
          " Its custom basemap is bundled inside the .zip, so the scenario is self-contained — just drag the one file." +
          " (To also list the basemap on its own in the community Basemaps tab, open the editor's Basemap picker and hit ⤴ on it.)";
      } else {
        fileName = `${scenario.id}-scenario.json`;
        saveJsonToDisk(bundle, fileName);
        extra = dedup.referenced
          ? " Its custom basemap was reused from the community hub, so the file stays small."
          : "";
      }
      // When the scenario carries a basemap, tag the post with the basemap hash so
      // the community Basemaps browser (which surfaces scenario-carried basemaps) can
      // dedupe it against dedicated posts. Harmless if the scenario form has no such
      // field — GitHub just ignores the unknown prefill param.
      const scenarioUrl =
        `${HUB_NEW_POST_URL}&title=${encodeURIComponent(`[Scenario] ${scenario.name}`)}` +
        (split ? `&technical=${encodeURIComponent(`Basemap-Hash: ${split.hash}\nBasemap-Kind: ${split.kind}`)}` : "");
      window.open(scenarioUrl, "_blank", "noopener");
      setNotice(
        `"${fileName}" was downloaded. On the GitHub page that just opened, drag that file into the Description box, then submit.${extra}`,
      );
    } catch (nextError) {
      setError(`Publish failed: ${nextError.message}`);
    }
  };

  return (
    <div style={{ color: "#fff", maxHeight: "calc(100vh - 11rem)", overflowY: "auto", paddingRight: "0.2rem" }}>
      {selectedPost ? (
        <ScenarioDetail
          post={selectedPost}
          busy={busyId === selectedPost.id}
          onImport={handleImport}
          onBack={backToGrid}
          notice={notice}
          error={error}
        />
      ) : (
        <>
          <div style={{ alignItems: "center", display: "flex", flexWrap: "wrap", gap: "0.5rem", marginBottom: "0.9rem" }}>
            <div style={{ color: "rgba(255,255,255,0.55)", fontSize: "0.78rem" }}>
              Community scenarios from the hub — ⬇ = imports, 👍 = likes. Open any post to 👍 like or 💬 comment on GitHub.
              {" "}<span style={{ color: "#c4b5fd" }}>Purple = verified official post.</span>
            </div>
            <div style={{ flex: 1 }} />
            <button type="button" onClick={() => load(true)} style={pillButton}>Refresh</button>
            <button
              type="button"
              onClick={() => setPublishPickerOpen((open) => !open)}
              style={{ ...pillButton, background: "rgba(124,58,237,0.3)", borderColor: "rgba(124,58,237,0.5)" }}
            >
              ⬆ Publish to Hub
            </button>
            <a href={HUB_URL} target="_blank" rel="noopener noreferrer" style={{ ...pillButton, textDecoration: "none" }}>
              Open Hub ↗
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
                  <button key={scenario.id} type="button" onClick={() => handlePublish(scenario)} style={pillButton}>
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
            <>
              <ScenarioRow
                title="📌 Pinned"
                posts={rows.pinned}
                busyId={busyId}
                onImport={handleImport}
                onSelect={selectPost}
                emptyText="No pinned scenarios right now."
              />
              <ScenarioRow title="⬇ Most Installed" posts={rows.byInstalls} busyId={busyId} onImport={handleImport} onSelect={selectPost} />
              <ScenarioRow title="👍 Most Liked" posts={rows.byLikes} busyId={busyId} onImport={handleImport} onSelect={selectPost} />
              <ScenarioRow title="🕐 Most Recent" posts={rows.byRecent} busyId={busyId} onImport={handleImport} onSelect={selectPost} />
            </>
          )}
        </>
      )}
    </div>
  );
};

export default CommunityPanel;
