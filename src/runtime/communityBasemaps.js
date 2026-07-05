/*! Open Historia — community basemaps client © 2026 Nicholas Krol, MIT (see src/Editor/LICENSE). */

// Browse + install + publish basemaps shared through the community hub. Mirrors
// the scenario hub (src/Game/GameUI/communityHub.jsx): each community basemap is
// a GitHub issue labeled "basemap" whose body links a bundle .json (and, ideally,
// an attached preview image used as the card cover). A content hash in the body
// lets a scenario reference an existing community basemap instead of re-uploading
// it. Publishing is the same safe, token-less flow scenarios use: the app exports
// the bundle to disk and opens a prefilled issue for the author to submit.

import { createBasemap, sha256Hex } from "./basemapLibrary.js";

// UTF-8-safe base64 <-> string (the scenario bundle base64-encodes the
// background.json file bytes; plain atob/btoa mangle non-Latin1 vector data).
const utf8ToBase64 = (str) => btoa(unescape(encodeURIComponent(str)));
const base64ToUtf8 = (b64) => decodeURIComponent(escape(atob(b64)));

const HUB_OWNER = "Arkniem";
const HUB_REPO = "pax-historia-scenarios";
const HUB_URL = `https://github.com/${HUB_OWNER}/${HUB_REPO}`;
const HUB_API_BASEMAPS = `https://api.github.com/repos/${HUB_OWNER}/${HUB_REPO}/issues?state=open&labels=basemap&per_page=100`;
const CACHE_TTL_MS = 5 * 60 * 1000;

const BUNDLE_LINK_PATTERN =
  /https:\/\/(?:github\.com\/[^\s)<>"']+\/releases\/download\/[^\s)<>"']+\.json|github\.com\/[^\s)<>"']+\/files\/[^\s)<>"']+|github\.com\/user-attachments\/files\/[^\s)<>"']+|raw\.githubusercontent\.com\/[^\s)<>"']+\.json)/i;
const COVER_IMAGE_PATTERN = /!\[[^\]]*\]\((https:\/\/[^\s)]+)\)|<img[^>]+src=["']([^"']+)["']/i;
const HASH_PATTERN = /Basemap-Hash:\s*([a-f0-9]{16,64})/i;
const KIND_PATTERN = /Basemap-Kind:\s*(image|vector)/i;
const OFFICIAL_ASSOCIATIONS = new Set(["OWNER", "MEMBER", "COLLABORATOR"]);

let cache = { at: 0, posts: null };

const parseBasemapPost = (issue) => {
  const body = String(issue.body ?? "");
  const coverMatch = body.match(COVER_IMAGE_PATTERN);
  return {
    id: issue.number,
    title: String(issue.title ?? "").replace(/^\[Basemap\]\s*/i, "").trim() || `Basemap #${issue.number}`,
    author: issue.user?.login ?? "unknown",
    avatarUrl: issue.user?.avatar_url ?? null,
    url: issue.html_url,
    createdAt: issue.created_at,
    official: OFFICIAL_ASSOCIATIONS.has(issue.author_association),
    upvotes: issue.reactions?.["+1"] ?? 0,
    bundleUrl: body.match(BUNDLE_LINK_PATTERN)?.[0] ?? null,
    coverImageUrl: coverMatch ? coverMatch[1] ?? coverMatch[2] ?? null : null,
    contentHash: body.match(HASH_PATTERN)?.[1]?.toLowerCase() ?? null,
    kind: body.match(KIND_PATTERN)?.[1]?.toLowerCase() ?? "image",
  };
};

export const fetchCommunityBasemaps = async ({ force = false } = {}) => {
  if (!force && cache.posts && Date.now() - cache.at < CACHE_TTL_MS) return cache.posts;
  const r = await fetch(HUB_API_BASEMAPS, { headers: { Accept: "application/vnd.github+json" } });
  if (!r.ok) {
    throw new Error(
      r.status === 403
        ? "GitHub rate limit reached — try again in a few minutes."
        : `Could not reach the basemap hub (HTTP ${r.status}).`,
    );
  }
  const issues = await r.json();
  const posts = (Array.isArray(issues) ? issues : []).filter((i) => !i.pull_request).map(parseBasemapPost);
  cache = { at: Date.now(), posts };
  return posts;
};

// Dedup lookup — reads the issue list only (no bundle downloads), matching the
// content hash embedded in each post body.
export const findCommunityBasemapByHash = async (hash) => {
  if (!hash) return null;
  try {
    const posts = await fetchCommunityBasemaps();
    return posts.find((p) => p.contentHash === String(hash).toLowerCase() && p.bundleUrl) ?? null;
  } catch {
    return null;
  }
};

export const fetchBasemapBundle = async (bundleUrl) => {
  const r = await fetch(`/api/hub/file?url=${encodeURIComponent(bundleUrl)}`);
  if (!r.ok) {
    const p = await r.json().catch(() => ({}));
    throw new Error(p.error || `Download failed (HTTP ${r.status}).`);
  }
  return r.json();
};

// Install a community basemap into the local "Your basemaps" library.
export const installCommunityBasemap = async (post) => {
  if (!post?.bundleUrl) throw new Error("This basemap post has no bundle file attached.");
  const bundle = await fetchBasemapBundle(post.bundleUrl);
  const bm = bundle?.basemap ?? {};
  const payload = bundle?.payload ?? {};
  const kind = bm.kind === "vector" ? "vector" : "image";
  if ((kind === "image" && !payload.dataUrl) || (kind === "vector" && !payload.geojson)) {
    throw new Error("That basemap bundle is missing its payload.");
  }
  return createBasemap({
    name: bm.name || post.title,
    kind,
    aspect: bm.aspect || null,
    thumbnail: bm.thumbnail || post.coverImageUrl || null,
    contentHash: bm.contentHash || post.contentHash || null,
    author: bm.author || post.author,
    source: { community: true, hash: bm.contentHash || post.contentHash || null, bundleUrl: post.bundleUrl, url: post.url },
    payload,
  });
};

// The JSON bundle a published basemap ships as.
export const buildBasemapBundle = (meta, payload) => ({
  schema: "pax-historia-basemap-bundle",
  version: 1,
  basemap: {
    name: meta.name,
    kind: meta.kind === "vector" ? "vector" : "image",
    aspect: meta.aspect ?? null,
    contentHash: meta.contentHash ?? null,
    thumbnail: meta.thumbnail ?? null,
    author: meta.author ?? "",
  },
  payload,
});

const downloadFile = (blob, fileName) => {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
};

const dataUrlToBlob = (dataUrl) => {
  try {
    const [head, b64] = String(dataUrl).split(",");
    const mime = head.match(/data:([^;]+)/)?.[1] || "image/jpeg";
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
    return new Blob([bytes], { type: mime });
  } catch {
    return null;
  }
};

// Publish: download the bundle (and a preview image to attach as the cover), then
// open a prefilled hub issue for the author to drag the files into and submit.
export const publishBasemap = (meta, payload) => {
  const safe = (meta.name || "basemap").replace(/[^a-z0-9]+/gi, "-").replace(/^-+|-+$/g, "").toLowerCase() || "basemap";
  const bundle = buildBasemapBundle(meta, payload);
  downloadFile(new Blob([JSON.stringify(bundle)], { type: "application/json" }), `${safe}.basemap.json`);
  if (meta.thumbnail && String(meta.thumbnail).startsWith("data:image")) {
    const thumbBlob = dataUrlToBlob(meta.thumbnail);
    if (thumbBlob) downloadFile(thumbBlob, `${safe}-preview.jpg`);
  }
  const title = `[Basemap] ${meta.name || "Untitled basemap"}`;
  const body = [
    `Basemap-Hash: ${meta.contentHash || ""}`,
    `Basemap-Kind: ${meta.kind === "vector" ? "vector" : "image"}`,
    "",
    `Drag the downloaded **${safe}.basemap.json** into this box (and the **${safe}-preview.jpg** so it shows a preview), then submit.`,
    "",
    "Do not remove the two lines at the top — they let the game find and dedupe this basemap.",
  ].join("\n");
  window.open(
    `${HUB_URL}/issues/new?labels=basemap&title=${encodeURIComponent(title)}&body=${encodeURIComponent(body)}`,
    "_blank",
    "noopener",
  );
};

// ---- Scenario-bundle background dedup ------------------------------------
// A scenario's custom background embeds the full image/vector in its bundle. If
// that same basemap is already a community basemap, the bundle can reference it
// (by hash) instead of re-embedding it, saving space — resolved back on import.

// Decode the bundle's embedded backgroundData into { kind, payload, hash }.
const readBundleBackground = async (bundle) => {
  const asset = bundle?.assets?.backgroundData;
  if (!asset || asset.mode !== "embedded" || !asset.data) return null;
  let payload;
  try {
    payload = JSON.parse(base64ToUtf8(asset.data));
  } catch {
    return null;
  }
  const kind = bundle?.data?.world?.background?.kind === "vector" ? "vector" : "image";
  const canonical = kind === "vector" ? (payload.geojson ? JSON.stringify(payload.geojson) : null) : payload.dataUrl;
  if (!canonical) return null;
  return { kind, payload, hash: await sha256Hex(canonical) };
};

// If the scenario's background is already a community basemap, swap the embedded
// copy for a reference. Returns { referenced, needsPublish } (needsPublish = the
// background is custom but not yet shared, so it can't be deduped).
export const dedupeScenarioBundleBackground = async (bundle) => {
  let bg = null;
  try {
    bg = await readBundleBackground(bundle);
  } catch {
    bg = null;
  }
  if (!bg) return { referenced: false, needsPublish: false };
  const match = await findCommunityBasemapByHash(bg.hash);
  if (match) {
    bundle.assets.backgroundData = {
      mode: "communityRef",
      hash: bg.hash,
      bundleUrl: match.bundleUrl,
      fileName: "background.json",
    };
    return { referenced: true, needsPublish: false };
  }
  return { referenced: false, needsPublish: true };
};

// On import: turn a community reference back into an embedded background by
// fetching the referenced basemap, so the server import writes it normally.
export const resolveScenarioBundleBackground = async (bundle) => {
  const asset = bundle?.assets?.backgroundData;
  if (!asset || asset.mode !== "communityRef" || !asset.bundleUrl) return bundle;
  try {
    const bmBundle = await fetchBasemapBundle(asset.bundleUrl);
    const payload = bmBundle?.payload;
    if (payload && (payload.dataUrl || payload.geojson)) {
      bundle.assets.backgroundData = {
        mode: "embedded",
        data: utf8ToBase64(JSON.stringify(payload)),
        fileName: "background.json",
        contentType: "application/json",
      };
    } else {
      delete bundle.assets.backgroundData;
    }
  } catch {
    // Couldn't resolve the reference — import without the background rather than
    // failing the whole scenario import.
    delete bundle.assets.backgroundData;
  }
  return bundle;
};
