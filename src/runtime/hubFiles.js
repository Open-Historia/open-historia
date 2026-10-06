/*! Open Historia — the hub's index: its posts and its checked files © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */

// Everything the game takes from the community hub is something the hub has
// checked. A post there is a GitHub issue with a file dragged into it, and a
// workflow in the hub repository looks inside every such file before anyone
// plays it. A file that would not work, or that carries something it should
// not, is refused with a comment on its post. One that passes is copied into
// the repository's releases, repaired where that is safe (an SVG becomes a
// PNG, a zip is rebuilt from its checked entries).
//
// The game used to list the hub's open issues through GitHub's API and
// download each post's attachment as its author had uploaded it. It does
// neither any more:
//
//   - the list of posts is the workflow's: the posts whose file it released,
//     open or closed (the hub closes a post once it is released), and no
//     others;
//   - the only files downloaded are the checked copies in the releases. A
//     post's own attachment is never fetched, and never shown either: a
//     scenario's cover, a flag, a basemap's picture are drawn from their
//     copies.
//
// The workflow publishes one small file for both, index.json on the hub's
// `hub-index` branch: the posts, for each attachment's address the address of
// its checked copy, how many times each scenario's file has been downloaded
// (GitHub counts a release file's downloads, and that is the post's import
// count), and which suggestion comments passed the check. It is read from
// raw.githubusercontent.com, which answers any origin and is not counted
// against the 60 API requests an hour a player has; it is kept five minutes
// and shared by every screen.
//
// So the index is the gate, and what it does not list cannot be had. A post
// the workflow has not checked yet, a file it refused, an index that cannot be
// read: the list or the download fails with a sentence a player can read, and
// nothing is fetched from the post instead. A post's identity is still its
// attachment's address (hubOrigin.bundleUrl, the Update button); the copy that
// was downloaded is kept beside it (hubOrigin.release).
//
// Suggestions are comments, and comments are never copied: a suggestion's .zip
// is fetched from its comment, but only once the index lists it as checked
// (the workflow deletes the comment of one that fails).
//
// A leaf module: hubIssues.js makes the post lists of the index, and
// hubPosts.js, communityFlags.js and communityBasemaps.js all download through
// fetchHubFile.

import { HUB_OWNER, HUB_REPO, hubReleaseUrl } from "../../server/hubProvenance.js";

export const HUB_INDEX_URL = `https://raw.githubusercontent.com/${HUB_OWNER}/${HUB_REPO}/hub-index/index.json`;
const HUB_POST_URL = `https://github.com/${HUB_OWNER}/${HUB_REPO}/issues/`;
const CACHE_TTL_MS = 5 * 60 * 1000;
const INDEX_TIMEOUT_MS = 8000;

// What a player reads when the hub cannot give what was asked of it: the
// message of the error a list or a download fails with. In a *_TEXTS table
// because the string extractor reads those (scripts/i18n/), so the language
// packs carry each sentence whole.
export const HUB_FILE_TEXTS = Object.freeze({
  unreachable: "The community hub could not be reached. Check your connection and try again.",
  notListed: "The community hub's list cannot be read yet. Try again later.",
  notReleased: "This file is not among the community hub's checked files. Its post may have been updated or taken down, or may still be waiting to be checked.",
  suggestionUnchecked: "This suggestion is not among the ones the community hub has checked. It may still be waiting to be checked, or it was removed.",
});

// The index is written by the hub's workflow and read as a stranger's file
// all the same: each field is taken only as the type it should be and cut to a
// length, a copy can only be in the hub's own releases, an avatar only GitHub's
// own, and a post's page is built from its number rather than read. The caps
// are far above what the hub writes; they bound a damaged file.
const MAX_POSTS = 5000;
const MAX_ADDRESS = 600;
const MAX_TITLE = 300;
export const MAX_POST_BODY = 20000;
const MAX_LOGIN = 100;
const MAX_LABELS = 100;
const MAX_LABEL = 100;
const POST_KINDS = new Set(["scenario", "flag", "basemap"]);
const ASSOCIATIONS = new Set(["OWNER", "MEMBER", "COLLABORATOR", "CONTRIBUTOR", "FIRST_TIME_CONTRIBUTOR", "FIRST_TIMER", "MANNEQUIN", "NONE"]);
const ATTACHMENT_ADDRESS = /^https:\/\/\S+$/i;
const AVATAR_ADDRESS = /^https:\/\/avatars\.githubusercontent\.com\/[^\s"'<>\\]+$/i;
// A suggestion's file: a .zip attached to a comment, on GitHub.
const COMMENT_ZIP_ADDRESS = /^https:\/\/github\.com\/[^\s"'<>\\?#]+\.zip$/i;

const record = (value) => (value && typeof value === "object" && !Array.isArray(value) ? value : null);
const cut = (value, max) => (typeof value === "string" ? value.slice(0, max) : "");
const wholeCount = (value) => (Number.isSafeInteger(value) && value >= 0 ? value : 0);
const dateText = (value) => (typeof value === "string" && value.length <= 40 && !Number.isNaN(Date.parse(value)) ? value : "");

// One post of the index, in the field names of a GitHub issue, which is what
// the parsers read (hubPosts.js parsePost, communityFlags.js,
// communityBasemaps.js). null for an entry that is no post: no number, no body
// to find a file in, no date.
const normalizeIndexPost = (raw) => {
  const source = record(raw);
  const number = source?.number;
  if (!Number.isSafeInteger(number) || number <= 0 || typeof source.body !== "string") return null;
  const createdAt = dateText(source.created_at);
  if (!createdAt) return null;
  const user = record(source.user) ?? {};
  const login = cut(user.login, MAX_LOGIN).trim();
  const avatar = cut(user.avatar_url, MAX_ADDRESS + 1);
  // The post's kind is one of its labels; an index that names it only as
  // `kind` is read the same.
  const labels = [
    ...(POST_KINDS.has(source.kind) ? [source.kind] : []),
    ...(Array.isArray(source.labels) ? source.labels : []),
  ].filter((label) => typeof label === "string" && label && label.length <= MAX_LABEL);
  return {
    number,
    state: source.state === "closed" ? "closed" : "open",
    title: cut(source.title, MAX_TITLE),
    body: source.body.slice(0, MAX_POST_BODY),
    user: {
      ...(login ? { login } : {}),
      avatar_url: avatar.length <= MAX_ADDRESS && AVATAR_ADDRESS.test(avatar) ? avatar : null,
    },
    // This hub's issue of that number, whatever the index says: a card's link
    // can lead nowhere else.
    html_url: `${HUB_POST_URL}${number}`,
    created_at: createdAt,
    updated_at: dateText(source.updated_at) || createdAt,
    labels: [...new Set(labels)].slice(0, MAX_LABELS),
    author_association: ASSOCIATIONS.has(source.author_association) ? source.author_association : "NONE",
    reactions: { "+1": wholeCount(record(source.reactions)?.["+1"]) },
    comments: wholeCount(source.comments),
  };
};

// The index as the game uses it:
//   { listed, files: { attachment address -> its checked copy's address },
//     imports: { post number -> count }, posts: [issue], suggestions:
//     { comment id -> { post, zip } } }
// Anything malformed is left out. `listed` is false for an index with no list
// of posts, which is one written before the hub checked anything (version 1:
// files and counts only). Its copies were made without a look inside them, so
// none of them is kept either: with such an index the hub cannot be listed and
// nothing can be downloaded, until the hub writes a list.
export const normalizeHubIndex = (raw) => {
  const source = record(raw) ?? {};
  const imports = {};
  for (const [post, count] of Object.entries(record(source.imports) ?? {})) {
    const number = Number(count);
    if (/^\d+$/.test(post) && Number.isSafeInteger(number) && number >= 0) imports[post] = number;
  }
  if (!(Number(source.version) >= 2) || !Array.isArray(source.posts)) {
    return { listed: false, files: {}, imports, posts: [], suggestions: {} };
  }
  const files = {};
  for (const [from, to] of Object.entries(record(source.files) ?? {})) {
    const copy = hubReleaseUrl(to);
    if (copy && from.length <= MAX_ADDRESS && ATTACHMENT_ADDRESS.test(from)) files[from] = copy;
  }
  const posts = [];
  const seen = new Set();
  for (const entry of source.posts) {
    const post = normalizeIndexPost(entry);
    if (!post || seen.has(post.number)) continue;
    seen.add(post.number);
    posts.push(post);
    if (posts.length >= MAX_POSTS) break;
  }
  const suggestions = {};
  for (const [commentId, entry] of Object.entries(record(source.suggestions) ?? {})) {
    const post = record(entry)?.post;
    const zip = cut(record(entry)?.zip, MAX_ADDRESS + 1);
    if (!/^\d{1,20}$/.test(commentId) || !Number.isSafeInteger(post) || post <= 0) continue;
    if (zip.length <= MAX_ADDRESS && COMMENT_ZIP_ADDRESS.test(zip)) suggestions[commentId] = { post, zip };
  }
  return { listed: true, files, imports, posts, suggestions };
};

// What fetchHubIndex answers with when the hub's file could not be had at all.
const UNREAD_INDEX = Object.freeze({
  listed: false,
  unread: true,
  files: Object.freeze({}),
  imports: Object.freeze({}),
  posts: Object.freeze([]),
  suggestions: Object.freeze({}),
});

// Why an index gives no list and no files, as a sentence for the player, or
// null when it does: the hub could not be reached, or what it published is
// from before it kept a list.
export const hubIndexProblem = (index) => {
  if (index?.listed) return null;
  return !index || index.unread ? HUB_FILE_TEXTS.unreachable : HUB_FILE_TEXTS.notListed;
};

let cache = { at: 0, index: null, pending: null };

// The hub's index. Never throws: an index that could not be read is one that
// lists nothing (hubIndexProblem says why), and whoever needed a post or a
// file from it fails with that reason.
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
      const index = cache.index ?? UNREAD_INDEX;
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

// What is worked out of an index once and kept with it: the set of its copies,
// the suggestions of each post, the set of checked suggestion files.
const derived = new WeakMap();
const derivedOf = (index) => {
  let entry = derived.get(index);
  if (!entry) {
    const suggestionsByPost = new Map();
    for (const [commentId, { post, zip }] of Object.entries(index.suggestions ?? {})) {
      if (!suggestionsByPost.has(post)) suggestionsByPost.set(post, {});
      suggestionsByPost.get(post)[commentId] = zip;
    }
    entry = {
      copies: new Set(Object.values(index.files ?? {})),
      suggestionsByPost,
      suggestionZips: new Set(Object.values(index.suggestions ?? {}).map((suggestion) => suggestion.zip)),
    };
    derived.set(index, entry);
  }
  return entry;
};

// The checked copy of a hub file, or null when the index has none. A file is
// asked for by its attachment's address, as its post names it. An address that
// is itself one of the index's copies is its own copy: a scenario's link keeps
// the copy it was downloaded from (hubOrigin.release), and that copy can be
// asked for again while the hub still has it.
export const releaseCopyOf = (index, fileUrl) => {
  const url = String(fileUrl ?? "").trim();
  if (!url || !record(index?.files)) return null;
  if (Object.hasOwn(index.files, url)) return index.files[url];
  return derivedOf(index).copies.has(url) ? url : null;
};

// A scenario post's import count, or null when nothing has counted it yet.
export const importCountOf = (index, postId) => {
  const count = record(index?.imports) && Object.hasOwn(index.imports, String(postId)) ? index.imports[String(postId)] : null;
  return Number.isSafeInteger(count) ? count : null;
};

// The suggestion comments on one post that passed the hub's check:
// { comment id -> the .zip that was checked }. Empty when there are none.
const NO_SUGGESTIONS = Object.freeze({});
export const checkedSuggestionsOf = (index, postId) =>
  (record(index?.suggestions) && derivedOf(index).suggestionsByPost.get(Number(postId))) || NO_SUGGESTIONS;

// The checked copy to download for a hub file, or an error a player can read:
// the hub could not be read, or the file is not one it has released.
export const requireReleaseCopy = async (fileUrl) => {
  const index = await fetchHubIndex();
  const problem = hubIndexProblem(index);
  if (problem) throw new Error(problem);
  const release = releaseCopyOf(index, fileUrl);
  if (!release) throw new Error(HUB_FILE_TEXTS.notReleased);
  return release;
};

const proxied = (url) => fetch(`/api/hub/file?url=${encodeURIComponent(url)}`);

// A hub file's Response, through the /api/hub/file proxy (GitHub's files send
// no CORS headers): its checked copy in the hub's releases, always. A file
// with no copy is not fetched from its post instead: the call fails, with a
// sentence a player can read. `copy: false` is for what is never copied, a
// suggestion on a post: it is fetched from its comment, once the index lists
// that file as one the hub has checked.
export const fetchHubFile = async (fileUrl, { copy = true } = {}) => {
  if (copy) return proxied(await requireReleaseCopy(fileUrl));
  const index = await fetchHubIndex();
  const problem = hubIndexProblem(index);
  if (problem) throw new Error(problem);
  const url = String(fileUrl ?? "").trim();
  if (!derivedOf(index).suggestionZips.has(url)) throw new Error(HUB_FILE_TEXTS.suggestionUnchecked);
  return proxied(url);
};

// What kind of image a downloaded copy is, by its first bytes, or "" when it
// is none of the four the hub releases. Neither the file's address nor the
// response can say: a copy is not always what its post's attachment was called
// (the hub turns an .svg into a PNG and the post still names the .svg), and
// GitHub serves every release file as application/octet-stream.
export const imageTypeOfBytes = (bytes) => {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes ?? []);
  const startsWith = (...signature) => signature.every((value, index) => view[index] === value);
  if (startsWith(0x89, 0x50, 0x4e, 0x47)) return "image/png";
  if (startsWith(0xff, 0xd8, 0xff)) return "image/jpeg";
  if (startsWith(0x47, 0x49, 0x46, 0x38)) return "image/gif";
  if (startsWith(0x52, 0x49, 0x46, 0x46) && [0x57, 0x45, 0x42, 0x50].every((value, index) => view[8 + index] === value)) return "image/webp";
  return "";
};
