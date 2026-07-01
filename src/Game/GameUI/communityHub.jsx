/*! Pax Historia — Scenario Hub (community tab) © 2026 Nicholas Krol, MIT (see src/Editor/LICENSE). */

// The Community tab of the scenario library. Reads the public Scenario Hub —
// a GitHub repo where every issue is a posted scenario — straight from the
// GitHub API (no auth, cached), sorts by 👍 reactions (Most Popular) or post
// date (Recently Posted), and imports bundles through the server's /api/hub
// proxy. Publishing exports the chosen scenario locally and opens a prefilled
// hub post where the author drags the bundle in.

import React, { useEffect, useMemo, useState } from "react";
import {
  exportScenarioBundle,
  importScenarioBundle,
  useLibraryState,
} from "../../runtime/library.js";

// The one and only hub. Not configurable by design.
const HUB_OWNER = "Arkniem";
const HUB_REPO = "pax-historia-scenarios";
const HUB_URL = `https://github.com/${HUB_OWNER}/${HUB_REPO}`;
const HUB_API_ISSUES = `https://api.github.com/repos/${HUB_OWNER}/${HUB_REPO}/issues?state=open&labels=scenario&per_page=100`;
const HUB_NEW_POST_URL = `${HUB_URL}/issues/new?template=scenario.yml`;
const CACHE_TTL_MS = 5 * 60 * 1000;

// First GitHub-hosted .json (or attachment) link in an issue body = the bundle.
const BUNDLE_LINK_PATTERN =
  /https:\/\/(?:github\.com\/[^\s)<>"']+\/files\/[^\s)<>"']+|github\.com\/user-attachments\/files\/[^\s)<>"']+|raw\.githubusercontent\.com\/[^\s)<>"']+\.json)/i;

let hubCache = { at: 0, posts: null };

const parsePost = (issue) => {
  const body = String(issue.body ?? "");
  const bundleUrl = body.match(BUNDLE_LINK_PATTERN)?.[0] ?? null;
  const description = body
    .replace(BUNDLE_LINK_PATTERN, "")
    .replace(/^#+\s*(Description|Made by)\s*$/gim, "")
    .replace(/\s+/g, " ")
    .trim();
  return {
    id: issue.number,
    title: String(issue.title ?? "").replace(/^\[Scenario\]\s*/i, "").trim() || `Scenario #${issue.number}`,
    author: issue.user?.login ?? "unknown",
    avatarUrl: issue.user?.avatar_url ?? null,
    url: issue.html_url,
    createdAt: issue.created_at,
    upvotes: issue.reactions?.["+1"] ?? 0,
    comments: issue.comments ?? 0,
    description: description.length > 220 ? `${description.slice(0, 217)}...` : description,
    bundleUrl,
  };
};

const fetchHubPosts = async ({ force = false } = {}) => {
  if (!force && hubCache.posts && Date.now() - hubCache.at < CACHE_TTL_MS) {
    return hubCache.posts;
  }
  const response = await fetch(HUB_API_ISSUES, {
    headers: { Accept: "application/vnd.github+json" },
  });
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
    .map(parsePost);
  hubCache = { at: Date.now(), posts };
  return posts;
};

const saveJsonToDisk = (data, fileName) => {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
};

const cardSurface = {
  background: "rgba(255,255,255,0.04)",
  border: "1px solid rgba(255,255,255,0.09)",
  borderRadius: "18px",
  color: "#fff",
  display: "flex",
  flexDirection: "column",
  flex: "0 0 21rem",
  gap: "0.6rem",
  padding: "1rem",
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

const CommunityPanel = ({ onImported }) => {
  const { scenarios } = useLibraryState();
  const [posts, setPosts] = useState(null);
  const [error, setError] = useState(null);
  const [sortMode, setSortMode] = useState("popular"); // 'popular' | 'recent'
  const [busyId, setBusyId] = useState(null);
  const [notice, setNotice] = useState(null);
  const [publishPickerOpen, setPublishPickerOpen] = useState(false);

  const load = (force) => {
    setError(null);
    fetchHubPosts({ force })
      .then(setPosts)
      .catch((nextError) => setError(nextError.message));
  };

  useEffect(() => {
    load(false);
  }, []);

  const sortedPosts = useMemo(() => {
    if (!posts) return [];
    const copy = [...posts];
    if (sortMode === "popular") {
      copy.sort((a, b) => b.upvotes - a.upvotes || b.comments - a.comments || b.createdAt.localeCompare(a.createdAt));
    } else {
      copy.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    }
    return copy;
  }, [posts, sortMode]);

  const handleImport = async (post) => {
    if (!post.bundleUrl || busyId) return;
    setBusyId(post.id);
    setNotice(null);
    setError(null);
    try {
      const response = await fetch(`/api/hub/file?url=${encodeURIComponent(post.bundleUrl)}`);
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload.error || `Download failed (HTTP ${response.status}).`);
      }
      const bundle = await response.json();
      const details = await importScenarioBundle(bundle);
      setNotice(`Imported "${details?.scenario?.name ?? post.title}" — it's in your Scenarios tab.`);
      onImported?.(details);
    } catch (nextError) {
      setError(`Import failed: ${nextError.message}`);
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
      const fileName = `${scenario.id}-scenario.json`;
      saveJsonToDisk(bundle, fileName);
      window.open(
        `${HUB_NEW_POST_URL}&title=${encodeURIComponent(`[Scenario] ${scenario.name}`)}`,
        "_blank",
        "noopener",
      );
      setNotice(
        `"${fileName}" was downloaded. On the GitHub page that just opened, drag that file into the Description box, then submit.`,
      );
    } catch (nextError) {
      setError(`Publish failed: ${nextError.message}`);
    }
  };

  return (
    <div style={{ color: "#fff" }}>
      <div style={{ alignItems: "center", display: "flex", flexWrap: "wrap", gap: "0.5rem", marginBottom: "0.85rem" }}>
        <button
          type="button"
          onClick={() => setSortMode("popular")}
          style={{ ...pillButton, background: sortMode === "popular" ? "rgba(124,58,237,0.3)" : pillButton.background, borderColor: sortMode === "popular" ? "rgba(124,58,237,0.5)" : pillButton.border }}
        >
          🔥 Most Popular
        </button>
        <button
          type="button"
          onClick={() => setSortMode("recent")}
          style={{ ...pillButton, background: sortMode === "recent" ? "rgba(124,58,237,0.3)" : pillButton.background, borderColor: sortMode === "recent" ? "rgba(124,58,237,0.5)" : pillButton.border }}
        >
          🕐 Recently Posted
        </button>
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
        <div style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: "14px", marginBottom: "0.85rem", padding: "0.8rem" }}>
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

      {notice && (
        <div style={{ background: "rgba(34,197,94,0.12)", border: "1px solid rgba(34,197,94,0.35)", borderRadius: "12px", color: "#bbf7d0", fontSize: "0.82rem", marginBottom: "0.85rem", padding: "0.7rem 0.85rem" }}>
          {notice}
        </div>
      )}
      {error && (
        <div style={{ background: "rgba(248,113,113,0.12)", border: "1px solid rgba(248,113,113,0.34)", borderRadius: "12px", color: "#fecaca", fontSize: "0.82rem", marginBottom: "0.85rem", padding: "0.7rem 0.85rem" }}>
          {error}
        </div>
      )}

      {!posts && !error && (
        <div style={{ color: "rgba(255,255,255,0.55)", fontSize: "0.85rem", padding: "1rem 0" }}>
          Loading community scenarios…
        </div>
      )}
      {posts && sortedPosts.length === 0 && (
        <div style={{ color: "rgba(255,255,255,0.55)", fontSize: "0.85rem", padding: "1rem 0" }}>
          No scenarios posted yet — be the first with “Publish to Hub”.
        </div>
      )}

      <div style={{ display: "flex", gap: "0.9rem", overflowX: "auto", paddingBottom: "0.2rem", scrollbarWidth: "thin" }}>
        {sortedPosts.map((post) => (
          <div key={post.id} style={cardSurface}>
            <div style={{ alignItems: "center", display: "flex", gap: "0.55rem" }}>
              {post.avatarUrl && (
                <img
                  src={post.avatarUrl}
                  alt={post.author}
                  style={{ borderRadius: "50%", height: "1.7rem", width: "1.7rem" }}
                />
              )}
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: "1rem", fontWeight: 800, letterSpacing: "-0.02em", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {post.title}
                </div>
                <div style={{ color: "rgba(255,255,255,0.5)", fontSize: "0.72rem" }}>
                  by {post.author} · {new Date(post.createdAt).toLocaleDateString()}
                </div>
              </div>
            </div>
            <div style={{ color: "rgba(240,244,255,0.72)", flex: 1, fontSize: "0.82rem", lineHeight: 1.5 }}>
              {post.description || "No description."}
            </div>
            <div style={{ alignItems: "center", display: "flex", gap: "0.55rem" }}>
              <span style={{ color: "rgba(255,255,255,0.65)", fontSize: "0.78rem" }}>👍 {post.upvotes}</span>
              <span style={{ color: "rgba(255,255,255,0.65)", fontSize: "0.78rem" }}>💬 {post.comments}</span>
              <div style={{ flex: 1 }} />
              <a href={post.url} target="_blank" rel="noopener noreferrer" style={{ ...pillButton, textDecoration: "none" }}>
                View ↗
              </a>
              <button
                type="button"
                disabled={!post.bundleUrl || busyId === post.id}
                onClick={() => handleImport(post)}
                title={post.bundleUrl ? "Import into your Scenarios" : "This post has no scenario file attached"}
                style={{
                  ...pillButton,
                  background: post.bundleUrl ? "rgba(124,58,237,0.35)" : "rgba(255,255,255,0.04)",
                  borderColor: post.bundleUrl ? "rgba(124,58,237,0.5)" : "rgba(255,255,255,0.08)",
                  color: post.bundleUrl ? "#fff" : "rgba(255,255,255,0.35)",
                  cursor: post.bundleUrl && busyId !== post.id ? "pointer" : "default",
                }}
              >
                {busyId === post.id ? "Importing…" : "Import"}
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default CommunityPanel;
