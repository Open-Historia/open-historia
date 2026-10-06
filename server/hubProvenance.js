/*! Open Historia — where a scenario came from on the community hub © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */

// Four records a scenario keeps about the community hub (the GitHub repo whose
// issues are the Community tab's posts). Pure and dependency-free: the desktop
// store (server/libraryStore.js) and the web store (src/runtime/web/models.js)
// both read and write them through these functions, so the two never disagree.
//
// hubOrigin — the post this scenario was downloaded from:
//   { postId, bundleUrl, syncedAt, title?, author?, editedAt? }
//   bundleUrl is the exact file imported. GitHub gives every re-upload a new
//   URL, so it is both the update signal and the original to compare against
//   when the player suggests changes back. It used to be erased by the first
//   local edit; now an edit only stamps editedAt, and the link stays until the
//   player unlinks the scenario.
//
// hubPublished — the post this player made of their own scenario:
//   { key, publishedAt, postIds[], author?, title?, suggestions[], blocked?[], checkedAt?, commentCounts? }
//   The key is written into the post by the Publish button; finding it in a
//   post's body is how this install learns which post is its own (it never
//   learns the player's GitHub login). suggestions are the "suggested changes"
//   comments found on those posts; blocked are the contributors whose
//   suggestions the player rejected wholesale ("Reject all from @…"), never
//   stored again.
//
// hubReviews — how the author got on reviewing each suggestion:
//   { [suggestionId]: { status, accepted[], rejected[], updatedAt } }
//
// missingBasemap — a community basemap the scenario uses by reference but that
// could not be downloaded when it was imported or updated:
//   { reference: { mode: "communityRef", url, via?, hash?, kind?, fileName? }, background?, reason? }
//   reference is the bundle's own descriptor, so the game can try the download
//   again when the scenario is opened and an export still carries it;
//   background is the world.background of the version that referenced it, put
//   in place once the download lands; reason is why it failed last time.

const MAX_POST_IDS = 10;
export const MAX_HUB_SUGGESTIONS = 50;
const MAX_REVIEWS = 60;
const MAX_DECISIONS = 5000;

const nowIso = () => new Date().toISOString();
const text = (value, max) => String(value ?? "").trim().slice(0, max);
const positiveInt = (value) => {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
};
const isoOrNull = (value) => {
  const raw = String(value ?? "").trim();
  return raw && !Number.isNaN(Date.parse(raw)) ? raw : null;
};

// A publish key: what the Publish button writes into the post ("Scenario-Key:
// …"). Letters, digits and dashes, so it survives GitHub's markdown untouched.
export const HUB_KEY_PATTERN = /^[A-Za-z0-9-]{8,64}$/;
export const normalizeHubKey = (value) => {
  const key = String(value ?? "").trim();
  return HUB_KEY_PATTERN.test(key) ? key : "";
};

// Only GitHub-hosted files are ever fetched (the hub proxy refuses the rest),
// so a URL anywhere else is not one this record can point at.
const hubFileUrl = (value) => {
  const url = String(value ?? "").trim();
  return /^https:\/\/(?:github\.com|[a-z0-9-]+\.githubusercontent\.com)\//i.test(url) ? url.slice(0, 600) : "";
};

export const normalizeHubOrigin = (raw) => {
  if (!raw || typeof raw !== "object") return null;
  const postId = positiveInt(raw.postId);
  const bundleUrl = String(raw.bundleUrl ?? "").trim();
  if (!postId || !bundleUrl) return null;
  const title = text(raw.title, 200);
  const author = text(raw.author, 100);
  const editedAt = isoOrNull(raw.editedAt);
  return {
    bundleUrl,
    postId,
    syncedAt: String(raw.syncedAt ?? "").trim() || nowIso(),
    ...(title ? { title } : {}),
    ...(author ? { author } : {}),
    ...(editedAt ? { editedAt } : {}),
  };
};

// What a scenario write does to the link. A write that names hubOrigin sets it
// (the import and Update paths, which stamp it last) or clears it (Unlink).
// Every other write that changes the scenario is a local edit: the link stays,
// marked edited, so the Update button stops offering to overwrite the player's
// work while Suggest changes can still find the original. A write that only
// records bookkeeping (touch: false) leaves it exactly as it was.
export const hubOriginAfterWrite = (current, updates = {}, { touch = true } = {}) => {
  if (Object.prototype.hasOwnProperty.call(updates ?? {}, "hubOrigin")) return normalizeHubOrigin(updates.hubOrigin);
  const origin = normalizeHubOrigin(current);
  if (!origin || !touch) return origin;
  return origin.editedAt ? origin : { ...origin, editedAt: nowIso() };
};

// The origin a game export may hand on as "fetch the map from the hub": only
// while the copy is still the post's file. An edited copy has no other home,
// so it has to travel inside the game's zip.
export const fetchableHubOrigin = (origin) => {
  const normalized = normalizeHubOrigin(origin);
  if (!normalized || normalized.editedAt) return null;
  return { bundleUrl: normalized.bundleUrl, postId: normalized.postId, syncedAt: normalized.syncedAt };
};

// This library's copy of one hub file: a scenario downloaded from the same post,
// at the same file (bundleUrl changes with every re-upload), and not edited
// since. The scenario named `preferredId` wins a tie. Null when there is none,
// so a game played on that file is never pointed at an older or edited copy.
export const scenarioCopyOfHubFile = (origin, scenarios, preferredId = "") => {
  const wanted = normalizeHubOrigin(origin);
  if (!wanted) return null;
  const copies = (Array.isArray(scenarios) ? scenarios : []).filter((entry) => {
    const have = normalizeHubOrigin(entry?.hubOrigin);
    return Boolean(have) && !have.editedAt && have.postId === wanted.postId && have.bundleUrl === wanted.bundleUrl;
  });
  return copies.find((entry) => entry.id === preferredId) ?? copies[0] ?? null;
};

// The scenario an imported game names, when its sender said the map is a hub
// file (scenarioRef.hubOrigin). The sender's id alone says nothing: ids come
// from names, so this library's own "New Scenario" can hold the id of an
// unrelated map, and the game would open on it. The game names this library's
// copy of that file; with none, it names an id nothing here holds, so the
// library shows the map as missing and offers to fetch it. A built-in map, or
// one that is no hub file, keeps the sender's id.
export const importedGameScenarioId = (ref, scenarios) => {
  const requested = String(ref?.scenarioId ?? "").trim();
  const origin = ref?.builtIn ? null : normalizeHubOrigin(ref?.hubOrigin);
  if (!origin || !requested) return requested;
  const list = Array.isArray(scenarios) ? scenarios : [];
  const copy = scenarioCopyOfHubFile(origin, list, requested);
  if (copy) return copy.id;
  const taken = new Set(list.map((entry) => entry?.id));
  if (!taken.has(requested)) return requested;
  const base = `${requested}-hub-${origin.postId}`;
  let id = base;
  for (let suffix = 2; taken.has(id); suffix += 1) id = `${base}-${suffix}`;
  return id;
};

export const normalizeHubSuggestionRef = (raw) => {
  if (!raw || typeof raw !== "object") return null;
  const id = text(raw.id, 80);
  const zipUrl = hubFileUrl(raw.zipUrl);
  const postId = positiveInt(raw.postId);
  if (!id || !zipUrl || !postId) return null;
  const commentId = positiveInt(raw.commentId);
  const createdAt = isoOrNull(raw.createdAt);
  const url = String(raw.url ?? "").trim();
  return {
    id,
    postId,
    zipUrl,
    ...(commentId ? { commentId } : {}),
    author: text(raw.author, 100),
    ...(createdAt ? { createdAt } : {}),
    ...(/^https:\/\/github\.com\//i.test(url) ? { url: url.slice(0, 600) } : {}),
    note: text(raw.note, 1000),
  };
};

// A GitHub login: letters, digits and single hyphens, at most 39 characters.
// Compared without case, as GitHub does.
export const normalizeHubLogin = (value) => {
  const login = String(value ?? "").trim().replace(/^@/, "");
  return /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/.test(login) ? login : "";
};
const MAX_BLOCKED = 100;
const loginList = (value) => {
  const out = [];
  const seen = new Set();
  for (const entry of Array.isArray(value) ? value : []) {
    const login = normalizeHubLogin(entry);
    if (!login || seen.has(login.toLowerCase())) continue;
    seen.add(login.toLowerCase());
    out.push(login);
    if (out.length >= MAX_BLOCKED) break;
  }
  return out;
};

// Contributors whose suggestions the author rejected wholesale ("Reject all
// from @…", for someone flooding a post with bad edits): everything they
// suggested, and anything they suggest later, is hidden and never stored.
export const isBlockedContributor = (published, login) => {
  const wanted = String(login ?? "").trim().replace(/^@/, "").toLowerCase();
  return Boolean(wanted) && (Array.isArray(published?.blocked) ? published.blocked : []).some((entry) => String(entry).toLowerCase() === wanted);
};

export const normalizeHubPublished = (raw) => {
  if (!raw || typeof raw !== "object") return null;
  const key = normalizeHubKey(raw.key);
  const postIds = [...new Set((Array.isArray(raw.postIds) ? raw.postIds : [raw.postId]).map(positiveInt).filter(Boolean))]
    .slice(0, MAX_POST_IDS);
  // A record needs something to find its post by: the key the post carries, or
  // a post the player linked by hand.
  if (!key && !postIds.length) return null;
  const blocked = loginList(raw.blocked);
  const suggestions = [];
  const seen = new Set();
  for (const entry of Array.isArray(raw.suggestions) ? raw.suggestions : []) {
    const ref = normalizeHubSuggestionRef(entry);
    if (!ref || seen.has(ref.id) || isBlockedContributor({ blocked }, ref.author)) continue;
    seen.add(ref.id);
    suggestions.push(ref);
  }
  // The newest are kept: a check adds what it finds after what was there.
  suggestions.splice(0, Math.max(0, suggestions.length - MAX_HUB_SUGGESTIONS));
  const commentCounts = {};
  if (raw.commentCounts && typeof raw.commentCounts === "object") {
    for (const [postId, count] of Object.entries(raw.commentCounts)) {
      const id = positiveInt(postId);
      const value = Number(count);
      if (id && postIds.includes(id) && Number.isInteger(value) && value >= 0) commentCounts[id] = value;
    }
  }
  const author = text(raw.author, 100);
  const title = text(raw.title, 200);
  const checkedAt = isoOrNull(raw.checkedAt);
  return {
    key,
    publishedAt: isoOrNull(raw.publishedAt) || nowIso(),
    postIds,
    ...(author ? { author } : {}),
    ...(title ? { title } : {}),
    suggestions,
    ...(blocked.length ? { blocked } : {}),
    ...(checkedAt ? { checkedAt } : {}),
    ...(Object.keys(commentCounts).length ? { commentCounts } : {}),
  };
};

// Block (or unblock) a contributor on one post record. Blocking drops what they
// left and forgets the comment counts, so the next look reads every comment
// again: a flood of their suggestions may have crowded out someone else's.
export const withContributorBlocked = (published, login, blocked = true) => {
  const current = normalizeHubPublished(published);
  const name = normalizeHubLogin(login);
  if (!current || !name) return current;
  const list = (current.blocked ?? []).filter((entry) => entry.toLowerCase() !== name.toLowerCase());
  const next = { ...current, blocked: blocked ? [...list, name] : list, commentCounts: {} };
  return normalizeHubPublished(next);
};

const REVIEW_STATUSES = new Set(["reviewing", "done", "dismissed"]);
const idList = (value) => [...new Set((Array.isArray(value) ? value : []).map((id) => text(id, 200)).filter(Boolean))].slice(0, MAX_DECISIONS);

export const normalizeHubReviews = (raw) => {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const rows = Object.entries(raw)
    .map(([id, entry]) => {
      const key = text(id, 80);
      if (!key || !entry || typeof entry !== "object") return null;
      const status = REVIEW_STATUSES.has(entry.status) ? entry.status : "reviewing";
      const accepted = idList(entry.accepted);
      const acceptedSet = new Set(accepted);
      // A change is accepted or rejected, never both; accepted wins.
      const rejected = idList(entry.rejected).filter((changeId) => !acceptedSet.has(changeId));
      return [key, { status, accepted, rejected, updatedAt: isoOrNull(entry.updatedAt) || nowIso() }];
    })
    .filter(Boolean)
    // Newest first, so the cap forgets the oldest reviews.
    .sort((a, b) => String(b[1].updatedAt).localeCompare(String(a[1].updatedAt)))
    .slice(0, MAX_REVIEWS);
  return Object.fromEntries(rows);
};

// The suggestions still waiting for the author: found on their posts and
// neither reviewed to the end nor dismissed.
export const openHubSuggestions = (published, reviews) => {
  const normalized = normalizeHubPublished(published);
  if (!normalized) return [];
  const status = normalizeHubReviews(reviews);
  return normalized.suggestions.filter((ref) => !["done", "dismissed"].includes(status[ref.id]?.status));
};

const REFERENCE_FIELDS = ["via", "hash", "kind", "fileName"];

export const normalizeMissingBasemap = (raw) => {
  if (!raw || typeof raw !== "object") return null;
  const source = raw.reference && typeof raw.reference === "object" ? raw.reference : null;
  const url = String(source?.url ?? "").trim();
  if (source?.mode !== "communityRef" || !/^https:\/\//i.test(url) || url.length > 1000) return null;
  const reference = { mode: "communityRef", url };
  for (const key of REFERENCE_FIELDS) {
    const value = text(source[key], 200);
    if (value) reference[key] = value;
  }
  const background = raw.background && typeof raw.background === "object" && !Array.isArray(raw.background) ? raw.background : null;
  const reason = text(raw.reason, 300);
  return { reference, ...(background ? { background } : {}), ...(reason ? { reason } : {}) };
};

// The missingBasemap record for a bundle whose community basemap is still only
// a reference after the game tried to download it (resolveScenarioBundleBackground
// in src/runtime/communityBasemaps.js), or null when its basemap is in it.
export const missingBasemapOfBundle = (bundle) => {
  const asset = bundle?.assets?.backgroundData;
  if (asset?.mode !== "communityRef") return null;
  return normalizeMissingBasemap({ reference: asset, background: bundle?.data?.world?.background, reason: asset.missingReason });
};
