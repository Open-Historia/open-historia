/*! Open Historia — reading the community hub © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */

// The Scenario Hub is a GitHub repo whose issues are the Community tab's posts
// (labelled "scenario"). Everything here reads it the way a visitor would —
// unauthenticated REST calls, 60 an hour per player — and never writes: a post,
// or a comment on one, is always made by the player in their own browser, from
// a form or a page the game opens for them.
//
// Moved out of communityHub.jsx so the library can find a player's own posts
// and the suggestions left on them without loading the Community tab.

import { restoreBundleFiles } from "./bundleFiles.js";
import { looksLikeZip, unzipBundle } from "./bundleZip.js";
import {
  embedScenarioBundleImage,
  embedScenarioBundleVector,
  resolveScenarioBundleBackground,
} from "./communityBasemaps.js";
import {
  MAX_HUB_SUGGESTIONS,
  isBlockedContributor,
  normalizeHubKey,
  normalizeHubPublished,
  normalizeHubSuggestionRef,
} from "../../server/hubProvenance.js";
import { HUB_API, HUB_URL, fetchHubPages, fetchHubScenarioIssues, firstHubImage } from "./hubIssues.js";

export { HUB_OWNER, HUB_REPO, HUB_URL } from "./hubIssues.js";
export const HUB_NEW_POST_URL = `${HUB_URL}/issues/new?template=scenario.yml`;
const CACHE_TTL_MS = 5 * 60 * 1000;

export const hubPostUrl = (postId) => `${HUB_URL}/issues/${Number(postId)}`;

// The post a player means by what they pasted into Link my post: its address
// (a comment's #anchor, a trailing slash or a ?query after the number are
// fine) or its bare number. null for anything else.
export const postIdFromInput = (value) => {
  const text = String(value ?? "").trim();
  const match = /\/issues\/(\d+)(?=[/?#]|$)/.exec(text) || /^#?(\d+)$/.exec(text);
  const postId = match ? Number(match[1]) : 0;
  return Number.isSafeInteger(postId) && postId > 0 ? postId : null;
};

// First GitHub-hosted .json (release asset, attachment or raw) link in an issue
// body = the bundle. Release links come first in official posts so imports go
// through the download-counted URL; the raw mirror below it serves old clients.
export const BUNDLE_LINK_PATTERN =
  /https:\/\/(?:github\.com\/[^\s)<>"']+\/releases\/download\/[^\s)<>"']+\.(?:json|zip)|github\.com\/[^\s)<>"']+\/files\/[^\s)<>"']+|github\.com\/user-attachments\/files\/[^\s)<>"']+|raw\.githubusercontent\.com\/[^\s)<>"']+\.json)/i;

// The cover is the body's first image hosted by GitHub (hubIssues.js
// firstHubImage), used as the card/detail-view cover; posts with no such
// image simply get coverImageUrl: null (existing text-only card, no error).

// The key the Publish button writes into a post (the form's technical field),
// which is how an install recognises the post as the one its player made.
export const SCENARIO_KEY_LINE = "Scenario-Key";
const SCENARIO_KEY_PATTERN = /^\s*Scenario-Key:\s*([A-Za-z0-9-]{8,64})\s*$/im;

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

export const parsePost = (issue, importsById) => {
  const body = String(issue.body ?? "");
  const bundleUrl = body.match(BUNDLE_LINK_PATTERN)?.[0] ?? null;
  // The issue-form body is a series of "### <label>\n<value>" sections. Show only
  // the author's Description prose: strip the attached-file link and never surface
  // the "Made by" or auto-filled "Basemap info" (hash/kind) sections — those are
  // metadata, not copy. Falls back to the whole body for old, non-form posts.
  const descSection = body.match(/###\s*Description[^\n]*\n+([\s\S]*?)(?=\n###\s|$)/i);
  const prose = (descSection ? descSection[1] : body)
    .replace(/\r\n?/g, "\n")
    .replace(/###\s*Basemap info[\s\S]*$/i, "")     // auto-filled technical section (fallback path)
    .replace(/^Basemap-(?:Hash|Kind):.*$/gim, "")   // stray hash/kind lines
    .replace(/^Flags-Count:.*$/gim, "")             // flag-pack tag (see communityFlags.js)
    .replace(/^Scenario-Key:.*$/gim, "")            // the publisher's key (below)
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")            // images
    .replace(/<img[^>]*>/gi, "")
    .replace(/\[[^\]]*\]\([^)]*\)/g, "")             // markdown links (the dragged-in scenario file)
    .replace(BUNDLE_LINK_PATTERN, "")               // a bare bundle URL (older posts)
    .replace(/^#+[ \t]*.*$/gim, "")                   // any leftover headings
    .replace(/\b(?:Scenario|Bundle) file:[ \t]*/gi, "") // older "Scenario file:" label
    .replace(/_No response_/gi, "");                 // GitHub's placeholder for empty fields
  // The author's own line breaks kept — setup notes and how to play read as
  // they wrote them on the detail view. Cards and search get one line.
  const fullDescription = prose
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  const description = fullDescription.replace(/\s+/g, " ");
  const coverImageUrl = firstHubImage(body);
  // Import count comes ONLY from our own counter Worker, keyed by hub issue number.
  // It is deduped per person (an account, or an IP hash) and covers every scenario —
  // release assets and attachment posts alike. We deliberately do NOT fall back to
  // GitHub's release download count: that counts every file download, including
  // repeat downloads by the same person and non-import curiosity clicks, so it both
  // over-counts and disagrees between posts. One accurate source for all.
  const installs = importsById?.[String(issue.number)]?.count ?? null;
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
    fullDescription,
    bundleUrl,
    installs,
    coverImageUrl,
    scenarioKey: normalizeHubKey(body.match(SCENARIO_KEY_PATTERN)?.[1]),
  };
};

// Exported so the translator can pre-translate the Community tab's posts.
// The issue list is the one every hub screen shares (hubIssues.js), every page
// of it; the posts made of it, with their import counts, are kept as long as
// that list is.
let hubCache = { issues: null, posts: null };
export const fetchHubPosts = async ({ force = false } = {}) => {
  const issues = await fetchHubScenarioIssues({ force }).catch((error) => {
    if (error?.status === undefined) throw error;
    throw new Error(
      error.status === 403
        ? "GitHub rate limit reached — try again in a few minutes."
        : `Could not reach the Scenario Hub (HTTP ${error.status}).`,
    );
  });
  if (hubCache.issues === issues) return hubCache.posts;
  const importsById = await fetchImportCounts();
  const posts = issues
    .map((issue) => parsePost(issue, importsById))
    // The parser already decides whether a post has an importable scenario
    // bundle. Do not surface malformed or misfiled "scenario" issues whose
    // Import button would otherwise be disabled.
    .filter((post) => Boolean(post.bundleUrl));
  hubCache = { issues, posts };
  return posts;
};

// ---- the library's copies of hub posts ----------------------------------------

// Whether a copy downloaded from a post can take the post's newer file: it came
// from that post, the player has not edited it (an edited copy is never
// overwritten — its player suggests their changes instead), and the post's
// file is not the one it was imported from, or its community basemap could not
// be downloaded (missingBasemap), which Update tries again. The Scenarios tab's
// Update button and the Community tab's "Update available" both ask this.
export const hubUpdateAvailable = (scenario, post) => Boolean(
  scenario?.hubOrigin &&
  !scenario.hubOrigin.editedAt &&
  post?.bundleUrl &&
  Number(post.id) === Number(scenario.hubOrigin.postId) &&
  (post.bundleUrl !== scenario.hubOrigin.bundleUrl || scenario.missingBasemap),
);

// The library's scenarios that came from each hub post, by post id.
export const hubCopiesByPostId = (scenarios) => {
  const byPost = new Map();
  for (const scenario of Array.isArray(scenarios) ? scenarios : []) {
    const postId = Number(scenario?.hubOrigin?.postId);
    if (!Number.isInteger(postId) || postId <= 0) continue;
    byPost.set(postId, [...(byPost.get(postId) ?? []), scenario]);
  }
  return byPost;
};

// What the library holds of one post, and the copy to play:
//   null      — nothing;
//   "current" — an unedited copy of the post's current file;
//   "update"  — only unedited copies the post has moved past;
//   "edited"  — only copies the player has changed.
// An unedited copy wins over an edited one, and among several the one touched
// last (updatedAt is a real timestamp, not a game date).
export const hubCopyStatus = (copies, post) => {
  const list = Array.isArray(copies) ? copies : [];
  if (!list.length) return { status: null, copy: null };
  const latest = (entries) =>
    entries.reduce((best, entry) => (String(entry?.updatedAt ?? "") > String(best?.updatedAt ?? "") ? entry : best), entries[0]);
  const unedited = list.filter((entry) => !entry?.hubOrigin?.editedAt);
  const current = unedited.filter((entry) => !hubUpdateAvailable(entry, post));
  if (current.length) return { status: "current", copy: latest(current) };
  if (unedited.length) return { status: "update", copy: latest(unedited) };
  return { status: "edited", copy: latest(list) };
};

// A file on the hub (a bundle, a suggestion), through the allowlisted
// /api/hub/file proxy: GitHub's attachments send no CORS headers.
export const downloadHubFile = async (fileUrl) => {
  const response = await fetch(`/api/hub/file?url=${encodeURIComponent(fileUrl)}`);
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.error || `Download failed (HTTP ${response.status}).`);
  }
  return response.arrayBuffer();
};

// A scenario file's bytes as one self-contained bundle, ready for import. A
// scenario ships as a .zip (scenario.json, the raw basemap file, a preview and
// its heavy assets as real entries); an older one is a plain JSON bundle. Told
// apart by the bytes, never the file name, so a renamed download still reads.
// The basemap is an image (basemap.png/jpg…) or a generated vector
// (basemap.geojson), re-embedded here.
export const unpackScenarioBundle = async (bytes) => {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (!looksLikeZip(view)) return JSON.parse(new TextDecoder().decode(view));
  const zip = await unzipBundle(view);
  const scenarioText = await zip.text("scenario.json");
  if (!scenarioText) throw new Error("That .zip is missing scenario.json.");
  const bundle = await restoreBundleFiles(JSON.parse(scenarioText), zip);
  const imageName = zip.names().find((n) => /(^|\/)basemap\.(png|jpe?g|webp|gif|svg)$/i.test(n));
  if (imageName) {
    embedScenarioBundleImage(bundle, await zip.bytes(imageName), imageName);
  } else {
    const vectorName = zip.names().find((n) => /(^|\/)basemap\.geojson$/i.test(n));
    if (vectorName) embedScenarioBundleVector(bundle, await zip.bytes(vectorName));
  }
  return bundle;
};

// unpackScenarioBundle, then the one step a hub scenario may still need: a
// shared scenario can reference a community basemap instead of embedding it,
// so fetch and inline it before importing or the map is blank. Every way a
// hub scenario arrives goes through here — downloaded by the game, or a
// post's .zip the player downloaded and imported from disk.
export const readScenarioBundleBytes = async (bytes) => {
  const bundle = await unpackScenarioBundle(bytes);
  await resolveScenarioBundleBackground(bundle);
  return bundle;
};

// Download + assemble a hub post's scenario bundle, ready for import, through
// the server's allowlisted /api/hub/file proxy. Shared by the Community tab's
// Import button, the Scenarios tab's Update button and Suggest changes (the
// post's file is what a suggestion is measured against).
export const downloadHubBundle = async (bundleUrl) => readScenarioBundleBytes(await downloadHubFile(bundleUrl));

// ---- suggestions: comments on a post that carry a suggestion file ------------

// Suggest changes saves "<scenario>-suggestion.zip" and a comment to paste that
// ends with this marker line. A comment is a suggestion when it carries a .zip
// attachment and either the marker or a file named like one: a player who
// forgot to paste the text but dragged the file in has still suggested it.
export const SUGGESTION_MARKER = "Open-Historia-Suggestion";
const SUGGESTION_MARKER_PATTERN = /^\s*Open-Historia-Suggestion:\s*([A-Za-z0-9-]{4,80})\s*$/im;
const ZIP_ATTACHMENT_PATTERN =
  /https:\/\/github\.com\/(?:user-attachments\/files|[^\s)<>"'/]+\/[^\s)<>"'/]+\/files)\/[^\s)<>"']+\.zip/gi;

export const parseSuggestionComment = (comment, postId) => {
  const body = String(comment?.body ?? "");
  const zips = body.match(ZIP_ATTACHMENT_PATTERN) ?? [];
  if (!zips.length) return null;
  const marker = body.match(SUGGESTION_MARKER_PATTERN)?.[1] ?? "";
  const zipUrl = zips.find((url) => /suggestion[^/]*\.zip$/i.test(url)) ?? (marker ? zips[0] : null);
  if (!zipUrl) return null;
  const commentId = Number(comment?.id);
  const note = body
    .replace(SUGGESTION_MARKER_PATTERN, "")
    .replace(/\[[^\]]*\]\([^)]*\)/g, "")
    .replace(ZIP_ATTACHMENT_PATTERN, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return normalizeHubSuggestionRef({
    id: Number.isInteger(commentId) && commentId > 0 ? `c${commentId}` : `m${marker}`,
    postId,
    commentId,
    author: comment?.user?.login ?? "",
    createdAt: comment?.created_at ?? "",
    url: comment?.html_url ?? "",
    zipUrl,
    note,
  });
};

const commentCache = new Map(); // postId -> { at, comments }

// Every page of a post's comments. A page that fails fails the read, so the
// caller never records a comment count it has not read all of.
export const fetchPostComments = async (postId, { force = false } = {}) => {
  const id = Number(postId);
  const cached = commentCache.get(id);
  if (!force && cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.comments;
  const list = await fetchHubPages(`${HUB_API}/issues/${id}/comments?per_page=100`).catch((error) => {
    if (error?.status === undefined) throw error;
    throw new Error(
      error.status === 403
        ? "GitHub rate limit reached — try again in a few minutes."
        : `Could not read the post's comments (HTTP ${error.status}).`,
    );
  });
  commentCache.set(id, { at: Date.now(), comments: list });
  return list;
};

// A record keeps at most MAX_HUB_SUGGESTIONS. Past that, the ones the author
// already reviewed or dismissed (`reviews`, the scenario's hubReviews) go
// first, then the oldest, so a new suggestion is never the one left out.
export const trimSuggestions = (list, reviews = {}) => {
  if (list.length <= MAX_HUB_SUGGESTIONS) return list;
  const settled = (ref) => (["done", "dismissed"].includes(reviews?.[ref.id]?.status) ? 1 : 0);
  const drop = new Set(list
    .map((ref, index) => ({ ref, index }))
    .sort((a, b) => settled(b.ref) - settled(a.ref)
      || String(a.ref.createdAt ?? "").localeCompare(String(b.ref.createdAt ?? ""))
      || a.index - b.index)
    .slice(0, list.length - MAX_HUB_SUGGESTIONS)
    .map((entry) => entry.ref.id));
  return list.filter((ref) => !drop.has(ref.id));
};

// A player's own post record brought up to date from the hub: the posts that
// carry its key (new ones found, the author and title read from them), and the
// suggestions on those posts. Comments are read only for a post whose comment
// count moved since the last look, so an unchanged post costs nothing but its
// share of the one post list. Returns { published, changed }.
export const refreshPublishedRecord = async (published, posts, { fetchComments = fetchPostComments, reviews = {} } = {}) => {
  const current = normalizeHubPublished(published);
  if (!current) return { published: null, changed: false };
  const list = Array.isArray(posts) ? posts : [];
  const byId = new Map(list.map((post) => [Number(post.id), post]));
  const matched = current.key ? list.filter((post) => post.scenarioKey === current.key).map((post) => Number(post.id)) : [];
  const postIds = [...new Set([...matched.sort((a, b) => b - a), ...current.postIds])].slice(0, 10);
  const newest = byId.get(postIds.find((id) => byId.has(id)));
  const commentCounts = { ...(current.commentCounts ?? {}) };
  let suggestions = [...current.suggestions];
  let fetchedAny = false;
  for (const postId of postIds) {
    const post = byId.get(postId);
    if (!post) continue; // closed, or past every page read: keep what we had
    const count = Number(post.comments) || 0;
    if (count === (commentCounts[postId] ?? 0)) continue;
    const comments = await fetchComments(postId);
    fetchedAny = true;
    const found = comments.map((comment) => parseSuggestionComment(comment, postId)).filter(Boolean);
    // Comments the author deleted take their suggestions with them.
    suggestions = [...suggestions.filter((ref) => ref.postId !== postId), ...found];
    commentCounts[postId] = count;
  }
  const next = normalizeHubPublished({
    ...current,
    postIds,
    ...(newest ? { author: newest.author, title: newest.title } : {}),
    suggestions: trimSuggestions(suggestions.filter((ref) => !isBlockedContributor(current, ref.author)), reviews),
    commentCounts,
    ...(fetchedAny || matched.length ? { checkedAt: new Date().toISOString() } : {}),
  });
  const strip = (record) => JSON.stringify({ ...record, checkedAt: undefined });
  return { published: next, changed: strip(next) !== strip(current) };
};
