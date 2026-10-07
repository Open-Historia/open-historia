/*! Open Historia — reading the community hub © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */

// The Scenario Hub is a GitHub repo whose issues are the Community tab's posts
// (labelled "scenario"). The game reads what the hub has checked and released,
// and nothing else of it: the posts and their files through the hub's own
// index (hubFiles.js, hubIssues.js), which costs no API request, and a post's
// comments the way a visitor would, by unauthenticated REST calls, 60 an hour
// per player. It never writes: a post, or a comment on one, is always made by
// the player in their own browser, from a form or a page the game opens for
// them.
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
import { normalizeHubKey, normalizeHubPublished, normalizeHubSuggestionRef } from "../../server/hubProvenance.js";
import { checkedSuggestionsOf, fetchHubFile, fetchHubIndex, importCountOf, releaseCopyOf, requireReleaseCopy } from "./hubFiles.js";
import { HUB_API, HUB_URL, fetchHubScenarioIssues, firstHubImage } from "./hubIssues.js";

export { HUB_OWNER, HUB_REPO, HUB_URL } from "./hubIssues.js";
export const HUB_NEW_POST_URL = `${HUB_URL}/issues/new?template=scenario.yml`;
const CACHE_TTL_MS = 5 * 60 * 1000;

export const hubPostUrl = (postId) => `${HUB_URL}/issues/${Number(postId)}`;

// First GitHub-hosted .json (release asset, attachment or raw) link in an issue
// body = the bundle. Release links come first in official posts so imports go
// through the download-counted URL; the raw mirror below it serves old clients.
// It is the post's file as the post names it, which is what the file's checked
// copy is looked up by; the file itself is only ever downloaded from that copy.
export const BUNDLE_LINK_PATTERN =
  /https:\/\/(?:github\.com\/[^\s)<>"']+\/releases\/download\/[^\s)<>"']+\.(?:json|zip)|github\.com\/[^\s)<>"']+\/files\/[^\s)<>"']+|github\.com\/user-attachments\/files\/[^\s)<>"']+|raw\.githubusercontent\.com\/[^\s)<>"']+\.json)/i;

// The cover is the body's first image hosted by GitHub (hubIssues.js
// firstHubImage), shown from its checked copy in the hub's releases as the
// card/detail-view cover; a post with no such image, or whose image the hub
// has not copied, gets coverImageUrl: null (the default cover, no error).

// The key the Publish button writes into a post (the form's technical field),
// which is how an install recognises the post as the one its player made.
export const SCENARIO_KEY_LINE = "Scenario-Key";
const SCENARIO_KEY_PATTERN = /^\s*Scenario-Key:\s*([A-Za-z0-9-]{8,64})\s*$/im;

// Official = posted by someone with real access to the hub repo, as reported
// by GitHub itself (author_association). Titles and body text can't fake this.
const OFFICIAL_ASSOCIATIONS = new Set(["OWNER", "MEMBER", "COLLABORATOR"]);

// `hubIndex` is the hub's index (hubFiles.js): where a post's import count, the
// checked copies of its file and of its cover, and the suggestions on it that
// passed the hub's check come from.
export const parsePost = (issue, hubIndex) => {
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
    .replace(/^Flags-Count:.*$/gim, "")             // flag-pack tag (see communityFlags.js)
    .replace(/^Scenario-Key:.*$/gim, "")            // the publisher's key (below)
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")            // images
    .replace(/<img[^>]*>/gi, "")
    .replace(/\[[^\]]*\]\([^)]*\)/g, "")             // markdown links (the dragged-in scenario file)
    .replace(BUNDLE_LINK_PATTERN, "")               // a bare bundle URL (older posts)
    .replace(/^#+\s*.*$/gim, "")                      // any leftover headings
    .replace(/\b(?:Scenario|Bundle) file:\s*/gi, "") // older "Scenario file:" label
    .replace(/_No response_/gi, "")                  // GitHub's placeholder for empty fields
    .replace(/\s+/g, " ")
    .trim();
  // Never the attachment itself: no copy, no picture.
  const coverImageUrl = releaseCopyOf(hubIndex, firstHubImage(body));
  // The import count is how many times the post's file has been downloaded from
  // the hub's releases, as GitHub counts it and the hub's index reports it
  // (hubFiles.js). It counts downloads, not people: importing again after
  // clearing the download cache counts again. It used to come from a counter of
  // the game's own, one per install, which ran on a free Cloudflare allowance
  // that was spent within hours of every day; what that counter had reached is
  // carried into these numbers by the hub.
  const installs = importCountOf(hubIndex, issue.number);
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
    // The checked copy of that file in the hub's releases: what Import and
    // Update download, and null for a post that has none to offer.
    releaseUrl: releaseCopyOf(hubIndex, bundleUrl),
    installs,
    coverImageUrl,
    scenarioKey: normalizeHubKey(body.match(SCENARIO_KEY_PATTERN)?.[1]),
    // { comment id -> its .zip }: the comments on this post that the hub has
    // checked as suggestions (refreshPublishedRecord offers no others).
    checkedSuggestions: checkedSuggestionsOf(hubIndex, issue.number),
  };
};

// Exported so the translator can pre-translate the Community tab's posts.
// The issue list is the one every hub screen shares (hubIssues.js), read from
// the hub's index together with the index itself; the posts made of it, with
// their import counts and checked copies, are kept as long as that index is.
let hubCache = { index: null, posts: null };
export const fetchHubPosts = async ({ force = false } = {}) => {
  const [issues, hubIndex] = await Promise.all([fetchHubScenarioIssues({ force }), fetchHubIndex({ force })]);
  if (hubCache.index === hubIndex) return hubCache.posts;
  const posts = issues
    .map((issue) => parsePost(issue, hubIndex))
    // The parser finds the post's scenario file, and the index that file's
    // checked copy. A post without either has nothing to import, so it is not
    // surfaced: a malformed or misfiled "scenario" issue, or one whose file
    // the index does not hold under the address the post gives it.
    .filter((post) => Boolean(post.bundleUrl && post.releaseUrl));
  hubCache = { index: hubIndex, posts };
  return posts;
};

// A file on the hub (a bundle, a suggestion), through the allowlisted
// /api/hub/file proxy: GitHub's files send no CORS headers. A post's file is
// its checked copy in the hub's releases, and there is no download without
// one (hubFiles.js); `copy: false` is for a suggestion, which is a comment's
// attachment and never copied, fetched once the hub has checked it.
export const downloadHubFile = async (fileUrl, { copy = true } = {}) => {
  const response = await fetchHubFile(fileUrl, { copy });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.error || `Download failed (HTTP ${response.status}).`);
  }
  return response.arrayBuffer();
};

// Download + assemble a hub post's scenario bundle through the server's
// allowlisted /api/hub/file proxy: the checked copy of the file `bundleUrl`
// names, a .zip unpacked (re-embedding the basemap that rides alongside
// scenario.json) and a referenced community basemap inlined. Suggest changes
// reads the file a copy came from this way (it is what a suggestion is
// measured against); an import goes through downloadHubScenario, which also
// says where the bundle came from.
export const downloadHubBundle = async (bundleUrl) => {
  const bytes = await downloadHubFile(bundleUrl);
  // A scenario with a custom basemap ships as a .zip (scenario.json + the raw
  // basemap file + preview); everything else is a plain JSON bundle. The basemap
  // is an image (basemap.png/jpg…) or a generated vector (basemap.geojson).
  // Told apart by the bytes: what was downloaded is the hub's copy, which is
  // not bound to carry the name the post gave its file.
  let bundle;
  if (looksLikeZip(new Uint8Array(bytes))) {
    const zip = await unzipBundle(bytes);
    const scenarioText = await zip.text("scenario.json");
    if (!scenarioText) throw new Error("That .zip is missing scenario.json.");
    bundle = await restoreBundleFiles(JSON.parse(scenarioText), zip);
    const imageName = zip.names().find((n) => /(^|\/)basemap\.(png|jpe?g|webp|gif|svg)$/i.test(n));
    if (imageName) {
      embedScenarioBundleImage(bundle, await zip.bytes(imageName), imageName);
    } else {
      const vectorName = zip.names().find((n) => /(^|\/)basemap\.geojson$/i.test(n));
      if (vectorName) embedScenarioBundleVector(bundle, await zip.bytes(vectorName));
    }
  } else {
    bundle = JSON.parse(new TextDecoder().decode(bytes));
  }
  // A file never says for itself which post it came from: the game stamps that
  // on a bundle after it has downloaded a post's checked copy
  // (downloadHubScenario), and a link a file brought along would pass for one.
  if (bundle && typeof bundle === "object") delete bundle.hubOrigin;
  // A shared scenario may reference a community basemap instead of embedding
  // it — fetch and inline it before importing so the map isn't blank.
  await resolveScenarioBundleBackground(bundle);
  return bundle;
};

// A post's scenario file, ready for import and stamped with where it came from
// (bundle.hubOrigin, which the stores keep with the scenario:
// server/hubProvenance.js): the post, the file as the post names it, and
// `release`, the checked copy that was downloaded. Every link the game makes
// is made here: the Community tab's Import, the Scenarios tab's Update, and
// Import & play for a game whose map the library lacks. The copy is found
// first and then asked for by its own address, so the address stamped is the
// one the bytes came from, even if the index is read again in between.
export const downloadHubScenario = async ({ postId, bundleUrl, title, author, syncedAt } = {}) => {
  const release = await requireReleaseCopy(bundleUrl);
  const bundle = await downloadHubBundle(release);
  bundle.hubOrigin = {
    postId,
    bundleUrl,
    release,
    ...(title ? { title } : {}),
    ...(author ? { author } : {}),
    ...(syncedAt ? { syncedAt } : {}),
  };
  return bundle;
};

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

export const fetchPostComments = async (postId, { force = false } = {}) => {
  const id = Number(postId);
  const cached = commentCache.get(id);
  if (!force && cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.comments;
  const response = await fetch(`${HUB_API}/issues/${id}/comments?per_page=100`, {
    headers: { Accept: "application/vnd.github+json" },
  });
  if (!response.ok) {
    throw new Error(
      response.status === 403
        ? "GitHub rate limit reached — try again in a few minutes."
        : `Could not read the post's comments (HTTP ${response.status}).`,
    );
  }
  const comments = await response.json();
  const list = Array.isArray(comments) ? comments : [];
  commentCache.set(id, { at: Date.now(), comments: list });
  return list;
};

// A player's own post record brought up to date from the hub: the posts that
// carry its key (new ones found, the author and title read from them), and the
// suggestions on those posts. Comments are read only for a post whose comment
// count moved since the last look, so an unchanged post costs nothing but its
// share of the one post list. Returns { published, changed }.
//
// Only a suggestion the hub has checked is kept: the hub looks inside every
// suggestion's file as it does a post's, lists the comments that pass
// (post.checkedSuggestions, from the index) and deletes the ones that fail. A
// comment that reads as a suggestion and is not on that list is still waiting
// for its check, or is about to be deleted: it is neither stored nor offered.
// So that it appears once it has passed, the post's comment count is not
// recorded while one is waiting, and the next look reads the comments again.
// A suggestion already held is put away the same way when the hub no longer
// lists it, or lists another file for its comment (the comment was edited).
export const refreshPublishedRecord = async (published, posts, { fetchComments = fetchPostComments } = {}) => {
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
    if (!post) continue; // no longer on the hub's list: keep what we had
    const checked = post.checkedSuggestions ?? {};
    const isChecked = (ref) => Boolean(ref.commentId) && Object.hasOwn(checked, ref.commentId) && checked[ref.commentId] === ref.zipUrl;
    const held = suggestions.filter((ref) => ref.postId === postId);
    const stillChecked = held.filter(isChecked);
    suggestions = suggestions.filter((ref) => ref.postId !== postId || isChecked(ref));
    const count = Number(post.comments) || 0;
    if (stillChecked.length === held.length && count === (commentCounts[postId] ?? 0)) continue;
    const comments = await fetchComments(postId);
    fetchedAny = true;
    // The hub never checks a bot's comment, so one is never a suggestion in waiting.
    const found = comments
      .filter((comment) => comment?.user?.type !== "Bot")
      .map((comment) => parseSuggestionComment(comment, postId))
      .filter(Boolean);
    const offered = found.filter(isChecked);
    // Comments the author deleted take their suggestions with them.
    suggestions = [...suggestions.filter((ref) => ref.postId !== postId), ...offered];
    if (offered.length === found.length) commentCounts[postId] = count;
    else delete commentCounts[postId];
  }
  const next = normalizeHubPublished({
    ...current,
    postIds,
    ...(newest ? { author: newest.author, title: newest.title } : {}),
    suggestions,
    commentCounts,
    ...(fetchedAny || matched.length ? { checkedAt: new Date().toISOString() } : {}),
  });
  const strip = (record) => JSON.stringify({ ...record, checkedAt: undefined });
  return { published: next, changed: strip(next) !== strip(current) };
};
