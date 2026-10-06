/*! Open Historia — Listen in: what ordinary people in a place are posting © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Listen in opens a phone on a place — one region, or a whole country — and
// shows what the people who live there are posting (GameUI/ListenInPhone.jsx).
// The posts are written by ONE AI request (AI/gameplay.js generateListenInFeed)
// and kept (listenInStore.js), so opening the same place again on the same game
// day costs nothing: requests are what most players run out of.
//
// This file is the plain data and the rules, with no React, no storage and no
// AI in it, so node can test it: what a place is, what a post may carry, which
// kept batch still answers for today, and what is thrown away.
import { compareGameDates, compareGameDatesNewestFirst, isGameDate } from "./gameDates.js";

const clean = (value) => String(value ?? "").trim();
const isRecord = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const clip = (value, limit) => {
  const text = clean(value).replace(/\s+/g, " ");
  return text.length > limit ? `${text.slice(0, limit - 1).trimEnd()}…` : text;
};
const count = (value, max) => {
  const number = Math.round(Number(value));
  return Number.isFinite(number) && number > 0 ? Math.min(max, number) : 0;
};

// What a feed holds. The model is asked for ten to twelve posts (the listenIn
// prompt); more than this many are not shown.
export const LISTEN_IN_MAX_POSTS = 14;
export const LISTEN_IN_MAX_TRENDS = 5;
const POST_TEXT_LIMIT = 480;
const NAME_LIMIT = 48;
const ABOUT_LIMIT = 72;
const HANDLE_LIMIT = 24;
const TREND_LIMIT = 40;
const MAX_MINUTES_AGO = 7 * 24 * 60;
const MAX_ENGAGEMENT = 99999999;

// How much is kept: per place the newest batches (scrolling down a feed goes
// back through the days it was read on), and per game the places read last.
export const LISTEN_IN_BATCHES_KEPT = 4;
export const LISTEN_IN_PLACES_KEPT = 24;

// --- Places ---------------------------------------------------------------

// A place a feed is about: a region and the country that holds it, or a
// country as a whole. `polityKey` is the country's stable key, `polity` the
// name it goes by now; a region nobody holds has neither. Null when there is
// nothing to listen in on.
export const listenInPlace = (raw) => {
  if (!isRecord(raw)) return null;
  const regionId = clean(raw.regionId);
  const polity = clean(raw.polity);
  const polityKey = clean(raw.polityKey) || polity;
  if (regionId) {
    return { scope: "region", regionId, regionName: clean(raw.regionName) || regionId, polity, polityKey };
  }
  return polityKey ? { scope: "country", regionId: "", regionName: "", polity: polity || polityKey, polityKey } : null;
};

// A region's feed is the region's whoever holds it, so it survives a conquest;
// a country's goes by its stable key, so it survives a change of name.
export const listenInPlaceKey = (place) => {
  const target = listenInPlace(place);
  if (!target) return "";
  return target.scope === "region" ? `region:${target.regionId}` : `country:${target.polityKey.toLowerCase()}`;
};

// The same country as a whole, for the phone's switch from a region's feed to
// the nation's. Null for a region nobody holds.
export const listenInCountryOf = (place) => {
  const target = listenInPlace(place);
  return target?.polityKey ? listenInPlace({ polity: target.polity, polityKey: target.polityKey }) : null;
};

// The language a feed is written in, by name: the player's own once they have
// chosen one, else the save's, which is what every other task of the game
// answers in. A feed is kept per language, so changing either asks afresh.
export const listenInFeedLanguage = ({ uiLanguage = "en", uiLanguageName = "", saveLanguage = "" } = {}) =>
  (clean(uiLanguage) && clean(uiLanguage) !== "en" && clean(uiLanguageName)
    ? clean(uiLanguageName)
    : clean(saveLanguage) || "English");

// --- Posts ----------------------------------------------------------------

// An account name as a profile shows it: no "@", no spaces, letters and digits
// of any script, "_" and ".". Blank stays blank: a world without telephones
// has no accounts, and the phone then shows the name alone.
const cleanHandle = (value) =>
  clean(value).replace(/^@+/, "").replace(/\s+/g, "").replace(/[^\p{L}\p{N}_.]/gu, "").slice(0, HANDLE_LIMIT);

// One post, or null when it has no author or nothing to say.
const normalizePost = (raw) => {
  if (!isRecord(raw)) return null;
  const author = clip(raw.author, NAME_LIMIT);
  const text = clean(raw.text).replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").slice(0, POST_TEXT_LIMIT).trim();
  if (!author || !text) return null;
  return {
    author,
    handle: cleanHandle(raw.handle),
    about: clip(raw.about, ABOUT_LIMIT),
    text,
    filler: raw.filler === true,
    minutesAgo: count(raw.minutesAgo, MAX_MINUTES_AGO),
    likes: count(raw.likes, MAX_ENGAGEMENT),
    reposts: count(raw.reposts, MAX_ENGAGEMENT),
    replies: count(raw.replies, MAX_ENGAGEMENT),
  };
};

// The posts of an answer as the phone shows them: malformed ones and repeats
// left out, newest first, no more than a feed holds.
export const normalizeListenInPosts = (raw) => {
  const seen = new Set();
  const posts = [];
  for (const entry of Array.isArray(raw) ? raw : []) {
    const post = normalizePost(entry);
    if (!post) continue;
    const key = post.text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    posts.push(post);
  }
  return posts
    .map((post, index) => ({ post, index }))
    .sort((a, b) => a.post.minutesAgo - b.post.minutesAgo || a.index - b.index)
    .slice(0, LISTEN_IN_MAX_POSTS)
    .map(({ post }) => post);
};

// What the place is talking about, as a few short lines.
export const normalizeListenInTrends = (raw) => {
  const seen = new Set();
  const trends = [];
  for (const entry of Array.isArray(raw) ? raw : []) {
    const trend = clip(entry, TREND_LIMIT);
    const key = trend.toLowerCase();
    if (!trend || seen.has(key)) continue;
    seen.add(key);
    trends.push(trend);
  }
  return trends.slice(0, LISTEN_IN_MAX_TRENDS);
};

// --- Batches and the store ------------------------------------------------

// One answer as it is kept: the posts written for one place on one game day in
// one language. `createdAt` is real time, and with the day makes the id.
export const createListenInBatch = ({ posts, trends, gameDate, round, language, now = Date.now() } = {}) => {
  const date = clean(gameDate);
  const createdAt = Number.isFinite(Number(now)) ? Number(now) : Date.now();
  const id = `${date || "undated"}:${createdAt.toString(36)}`;
  return {
    id,
    gameDate: date,
    round: Math.max(0, Math.round(Number(round)) || 0),
    language: clean(language) || "en",
    createdAt,
    trends: normalizeListenInTrends(trends),
    posts: normalizeListenInPosts(posts).map((post, index) => ({ ...post, id: `${id}:${index}` })),
  };
};

const normalizeBatch = (raw) => {
  if (!isRecord(raw) || !clean(raw.id)) return null;
  const posts = normalizeListenInPosts(raw.posts).map((post, index) => ({ ...post, id: `${clean(raw.id)}:${index}` }));
  if (!posts.length) return null;
  return {
    id: clean(raw.id),
    gameDate: clean(raw.gameDate),
    round: Math.max(0, Math.round(Number(raw.round)) || 0),
    language: clean(raw.language) || "en",
    createdAt: Number(raw.createdAt) || 0,
    trends: normalizeListenInTrends(raw.trends),
    posts,
  };
};

export const emptyListenInStore = () => ({ version: 1, places: {} });

// What was kept for one game, as read back from storage: anything malformed is
// dropped rather than trusted.
export const normalizeListenInStore = (raw) => {
  const store = emptyListenInStore();
  for (const entry of Object.values(isRecord(raw?.places) ? raw.places : {})) {
    const place = listenInPlace(entry?.place);
    const key = listenInPlaceKey(place);
    const batches = (Array.isArray(entry?.batches) ? entry.batches : []).map(normalizeBatch).filter(Boolean);
    if (!key || !batches.length) continue;
    store.places[key] = { place, openedAt: Number(entry.openedAt) || 0, batches: batches.slice(0, LISTEN_IN_BATCHES_KEPT) };
  }
  return store;
};

// A batch from a day after today is from a turn the player took back
// (a restore point, Intervene): it is not shown. An undated game shows all.
const fromNoLaterThan = (gameDate) => (batch) =>
  !isGameDate(gameDate) || !isGameDate(batch.gameDate) || compareGameDates(batch.gameDate, gameDate) <= 0;

// What the phone shows for a place today: the kept batches, newest day first.
export const listenInTimeline = (store, place, { gameDate = "" } = {}) => {
  const entry = store?.places?.[listenInPlaceKey(place)];
  if (!entry) return [];
  return entry.batches
    .filter(fromNoLaterThan(clean(gameDate)))
    .sort((a, b) => compareGameDatesNewestFirst(a.gameDate, b.gameDate) || b.createdAt - a.createdAt);
};

// The batch that already answers for this place today in this language, or
// null: opening the phone then asks for one. Refreshing asks regardless.
export const currentListenInBatch = (store, place, { gameDate = "", language = "en" } = {}) => {
  const date = clean(gameDate);
  return listenInTimeline(store, place, { gameDate: date })
    .find((batch) => batch.gameDate === date && batch.language === (clean(language) || "en")) ?? null;
};

// The store with a new batch on top of its place. Bounded: a place keeps its
// newest batches, a game the places read last, and batches from a day after
// the new one (a turn taken back) go.
export const addListenInBatch = (store, place, batch, { now = Date.now() } = {}) => {
  const target = listenInPlace(place);
  const key = listenInPlaceKey(target);
  const fresh = normalizeBatch(batch);
  const current = normalizeListenInStore(store);
  if (!key || !fresh) return current;
  const earlier = (current.places[key]?.batches ?? [])
    .filter((entry) => entry.id !== fresh.id)
    .filter(fromNoLaterThan(fresh.gameDate));
  const places = { ...current.places, [key]: { place: target, openedAt: Number(now) || 0, batches: [fresh, ...earlier].slice(0, LISTEN_IN_BATCHES_KEPT) } };
  const kept = Object.entries(places)
    .sort(([, a], [, b]) => b.openedAt - a.openedAt)
    .slice(0, LISTEN_IN_PLACES_KEPT);
  return { version: 1, places: Object.fromEntries(kept) };
};

// --- When the phone asks --------------------------------------------------

// A feed's request, named: one runs at a time per game, place, game day and
// language, and the phone joins it rather than starting another.
export const listenInRequestKey = ({ gameId = "", place, gameDate = "", language = "" } = {}) => {
  const key = listenInPlaceKey(place);
  return key ? [clean(gameId), key, clean(gameDate), clean(language) || "en"].join("|") : "";
};

// What the phone does for the place it shows. `asked`, `loading` and `failed`
// are what this opening has already done about that place's request.
//
// `shouldAsk` is the one rule that spends a request without a press: the phone
// is open on a place with nothing kept for today in this language. It holds
// once per opening — after the request has been made, has failed or is still
// running, only the player's own press (Load new posts, Try again) asks again,
// so nothing that comes back, or fails to, can make the phone ask in a loop.
export const listenInFeedView = ({ store, place, gameDate = "", language = "en", asked = false, loading = false, failed = false } = {}) => {
  const ready = Boolean(store) && Boolean(listenInPlace(place));
  const batches = ready ? listenInTimeline(store, place, { gameDate }) : [];
  const current = ready ? currentListenInBatch(store, place, { gameDate, language }) : null;
  const shouldAsk = ready && !current && !asked && !loading && !failed;
  return {
    ready,
    batches,
    current,
    shouldAsk,
    // The skeleton: reading what is kept, a request out, or one about to go.
    waiting: !ready || Boolean(loading) || shouldAsk,
    // Whether a press may ask now.
    canAsk: ready && !loading && !shouldAsk,
    trends: (current ?? batches[0])?.trends ?? [],
  };
};

// The line above a batch in the feed. A feed read on an earlier day says which
// day; an earlier one of the same day says only that it is earlier; the newest
// of today says nothing.
export const listenInBatchLine = (batches, index, gameDate = "") => {
  const batch = Array.isArray(batches) ? batches[index] : null;
  if (!batch) return null;
  const before = index > 0 ? batches[index - 1].gameDate : clean(gameDate);
  if (batch.gameDate !== before) return { kind: "date", gameDate: batch.gameDate };
  return index > 0 ? { kind: "earlier", gameDate: batch.gameDate } : null;
};

// --- What the phone prints ------------------------------------------------

// A poster's picture: their initials on one of a few quiet colours, always the
// same for the same name.
const AVATAR_COLOURS = ["#3f6f9f", "#2f8577", "#5a8a45", "#8a7f3a", "#b0792a", "#b8643a", "#a44e48", "#5f6875"];

export const listenInAvatar = (author) => {
  const name = clean(author);
  const words = name.split(/[\s._-]+/).filter(Boolean);
  const letter = (word) => Array.from(word)[0] ?? "";
  const initials = (words.length > 1 ? letter(words[0]) + letter(words[words.length - 1]) : Array.from(words[0] ?? "").slice(0, 2).join(""))
    .toLocaleUpperCase();
  let hash = 0;
  for (const char of name) hash = (Math.imul(hash, 31) + char.codePointAt(0)) >>> 0;
  return { initials: initials || "?", colour: AVATAR_COLOURS[hash % AVATAR_COLOURS.length] };
};

// Intl with the player's language, English when the browser does not have it.
const formatter = (build, language) => {
  try {
    return build(clean(language) || "en");
  } catch {
    return build("en");
  }
};

// How long ago a post was written, as a feed prints it: "now", "5m", "3h", "2d".
export const listenInAgeLabel = (minutesAgo, language = "en") => {
  const minutes = count(minutesAgo, MAX_MINUTES_AGO);
  if (minutes < 1) return formatter((code) => new Intl.RelativeTimeFormat(code, { numeric: "auto" }), language).format(0, "second");
  const [value, unit] = minutes < 60 ? [minutes, "minute"] : minutes < 1440 ? [Math.floor(minutes / 60), "hour"] : [Math.floor(minutes / 1440), "day"];
  return formatter((code) => new Intl.NumberFormat(code, { style: "unit", unit, unitDisplay: "narrow" }), language).format(value);
};

// A like or reply count, as a feed prints it: "0" is printed as nothing, 1,240 as "1.2K".
export const listenInCountLabel = (value, language = "en") => {
  const number = count(value, MAX_ENGAGEMENT);
  if (!number) return "";
  return formatter((code) => new Intl.NumberFormat(code, { notation: "compact", maximumFractionDigits: 1 }), language).format(number);
};
