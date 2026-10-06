/*! Open Historia — the hub's files, from its releases © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */

// A file attached to a hub post (a scenario, a flag, a basemap) is copied into
// the hub repository's releases by a workflow there ("Copy post files to
// releases"), and that copy is the one the game downloads: GitHub counts a
// release file's downloads, and that count is the post's import count. The
// game used to download the post's own attachment and report each import to a
// counter of its own on Cloudflare, whose free allowance ran out within hours
// of every day.
//
// The workflow publishes one small file, index.json on the hub's `hub-index`
// branch: for each attachment's address, the address of its copy, and for each
// scenario post, how many times its file has been downloaded. It is read from
// raw.githubusercontent.com, which answers any origin and is not counted
// against the 60 API requests an hour a player has; like the post lists
// (hubIssues.js) it is kept five minutes and shared by every screen.
//
// Nothing here can stop a download. A post the workflow has not reached yet (it
// takes a minute), an index that cannot be read, a copy that will not download:
// the post's own attachment is fetched, as it always was. A post's identity
// stays its attachment's address (hubOrigin.bundleUrl, the Update button), so a
// copy appearing or moving never looks like a new version.
//
// Suggestions are comments, and comments are never copied: a suggestion's .zip
// has no entry here and is always fetched from its comment.
//
// A leaf module, like hubIssues.js: hubPosts.js, communityFlags.js and
// communityBasemaps.js all download through it.

import { HUB_OWNER, HUB_REPO } from "./hubIssues.js";

export const HUB_INDEX_URL = `https://raw.githubusercontent.com/${HUB_OWNER}/${HUB_REPO}/hub-index/index.json`;
const CACHE_TTL_MS = 5 * 60 * 1000;
const INDEX_TIMEOUT_MS = 8000;

// Only a file in the hub repository's own releases is ever taken from the
// index: whatever the file says, a download never leaves the hub for it.
const RELEASE_COPY = new RegExp(`^https://github\\.com/${HUB_OWNER}/${HUB_REPO}/releases/download/[^\\s?#]+$`, "i");

const EMPTY_INDEX = Object.freeze({ files: Object.freeze({}), imports: Object.freeze({}) });

// The index as the game uses it: { files: { attachment address -> copy's
// address }, imports: { post number -> count } }. Anything malformed is left out.
export const normalizeHubIndex = (raw) => {
  const files = {};
  const imports = {};
  const source = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  if (source.files && typeof source.files === "object" && !Array.isArray(source.files)) {
    for (const [from, to] of Object.entries(source.files)) {
      if (typeof to === "string" && RELEASE_COPY.test(to)) files[from] = to;
    }
  }
  if (source.imports && typeof source.imports === "object" && !Array.isArray(source.imports)) {
    for (const [post, count] of Object.entries(source.imports)) {
      const number = Number(count);
      if (/^\d+$/.test(post) && Number.isSafeInteger(number) && number >= 0) imports[post] = number;
    }
  }
  return { files, imports };
};

let cache = { at: 0, index: null, pending: null };

// The hub's index. Never throws: without it there are no copies and no counts,
// and everything still downloads from the posts.
export const fetchHubIndex = async ({ force = false } = {}) => {
  if (!force && cache.index && Date.now() - cache.at < CACHE_TTL_MS) return cache.index;
  if (cache.pending) return cache.pending;
  const pending = (async () => {
    try {
      // no-store: raw.githubusercontent.com already holds it five minutes, and
      // a browser cache on top would hold a pressed Refresh back further.
      const response = await fetch(HUB_INDEX_URL, { cache: "no-store", signal: AbortSignal.timeout(INDEX_TIMEOUT_MS) });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const index = normalizeHubIndex(await response.json());
      cache = { at: Date.now(), index, pending: null };
      return index;
    } catch {
      // The last one read is better than none; a miss is asked again next time.
      const index = cache.index ?? EMPTY_INDEX;
      cache = { at: cache.index ? cache.at : 0, index: cache.index, pending: null };
      return index;
    }
  })();
  cache = { ...cache, pending };
  return pending;
};

// Tests only.
export const resetHubIndexCache = () => {
  cache = { at: 0, index: null, pending: null };
};

// The release copy of an attachment, or null when the index has none.
export const releaseCopyOf = (index, fileUrl) => {
  const url = String(fileUrl ?? "").trim();
  return (url && index?.files?.[url]) || null;
};

// A scenario post's import count, or null when nothing has counted it yet.
export const importCountOf = (index, postId) => {
  const count = index?.imports?.[String(postId)];
  return Number.isSafeInteger(count) ? count : null;
};

const proxied = (url) => fetch(`/api/hub/file?url=${encodeURIComponent(url)}`);

// A hub file's Response, through the /api/hub/file proxy (GitHub's files send
// no CORS headers): the release copy when there is one, else the attachment
// itself, and the attachment too whenever the copy will not download. `copy:
// false` is for what is never copied (a suggestion on a post).
export const fetchHubFile = async (fileUrl, { copy = true } = {}) => {
  if (copy) {
    const mirrored = releaseCopyOf(await fetchHubIndex(), fileUrl);
    if (mirrored && mirrored !== fileUrl) {
      try {
        const response = await proxied(mirrored);
        if (response.ok) return response;
      } catch {
        // The post's own attachment, below.
      }
    }
  }
  return proxied(fileUrl);
};
