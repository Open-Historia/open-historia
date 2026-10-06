/*! Open Historia — Listen in: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/runtime/listenIn.test.js

import assert from "node:assert/strict";
import test from "node:test";

import {
  LISTEN_IN_BATCHES_KEPT,
  LISTEN_IN_MAX_POSTS,
  LISTEN_IN_MAX_TRENDS,
  LISTEN_IN_PLACES_KEPT,
  addListenInBatch,
  createListenInBatch,
  currentListenInBatch,
  emptyListenInStore,
  listenInAgeLabel,
  listenInAvatar,
  listenInBatchLine,
  listenInCountLabel,
  listenInCountryOf,
  listenInFeedLanguage,
  listenInFeedView,
  listenInPlace,
  listenInPlaceKey,
  listenInRequestKey,
  listenInTimeline,
  normalizeListenInPosts,
  normalizeListenInStore,
  normalizeListenInTrends,
} from "./listenIn.js";

const bavaria = { regionId: "DEU.2_1", regionName: "Bayern", polity: "Germany", polityKey: "Germany" };
const germany = { polity: "Germany", polityKey: "Germany" };
const post = (text, extra = {}) => ({ author: "Maria Kowalska", handle: "mariak88", text, ...extra });
const batchOf = (gameDate, texts, extra = {}) =>
  createListenInBatch({ posts: texts.map((text) => post(text)), gameDate, language: "en", ...extra });

test("a place is a region with its country, or a country", () => {
  assert.deepEqual(listenInPlace(bavaria), { scope: "region", ...bavaria });
  assert.deepEqual(listenInPlace(germany), { scope: "country", regionId: "", regionName: "", ...germany });
  // A region nobody holds can still be listened in on; nothing at all cannot.
  assert.equal(listenInPlace({ regionId: "R1" }).polityKey, "");
  assert.equal(listenInPlace({ regionId: "R1" }).regionName, "R1");
  for (const nothing of [null, {}, { regionName: "Bayern" }, "Germany"]) assert.equal(listenInPlace(nothing), null);
});

test("a region's feed is the region's, a country's goes by its stable key", () => {
  assert.equal(listenInPlaceKey(bavaria), "region:DEU.2_1");
  // The same region under a new flag keeps its feed.
  assert.equal(listenInPlaceKey({ ...bavaria, polity: "Austria", polityKey: "Austria" }), "region:DEU.2_1");
  assert.equal(listenInPlaceKey(germany), "country:germany");
  // Renamed, the country keeps its key and so its feed.
  assert.equal(listenInPlaceKey({ polity: "German Reich", polityKey: "Germany" }), "country:germany");
  assert.equal(listenInPlaceKey(null), "");
  assert.deepEqual(listenInCountryOf(bavaria), listenInPlace(germany));
  assert.equal(listenInCountryOf({ regionId: "R1" }), null);
});

test("a feed is written in the player's language, else the save's", () => {
  assert.equal(listenInFeedLanguage({ uiLanguage: "de", uiLanguageName: "German", saveLanguage: "English" }), "German");
  assert.equal(listenInFeedLanguage({ uiLanguage: "en", uiLanguageName: "English", saveLanguage: "Spanish" }), "Spanish");
  assert.equal(listenInFeedLanguage({ uiLanguage: "en", uiLanguageName: "English" }), "English");
  assert.equal(listenInFeedLanguage(), "English");
});

test("posts are cleaned, deduplicated and put newest first", () => {
  const posts = normalizeListenInPosts([
    post("Bread is up again.", { minutesAgo: 120, likes: "41", reposts: 3.6, replies: -2, about: "  baker,   Lviv " }),
    post("  bread is up again. "),
    post("My cat is missing, grey with one white paw.", { filler: true, minutesAgo: 4, handle: "@ola nowak!" }),
    { author: "", text: "no author" },
    { author: "Jan", text: "   " },
    "not a post",
    null,
  ]);
  assert.deepEqual(posts.map((entry) => entry.text), ["My cat is missing, grey with one white paw.", "Bread is up again."]);
  assert.deepEqual(posts[0], {
    author: "Maria Kowalska", handle: "olanowak", about: "", text: "My cat is missing, grey with one white paw.",
    filler: true, minutesAgo: 4, likes: 0, reposts: 0, replies: 0,
  });
  assert.equal(posts[1].about, "baker, Lviv");
  assert.equal(posts[1].likes, 41);
  assert.equal(posts[1].reposts, 4);
  assert.equal(posts[1].replies, 0);
  assert.equal(posts[1].filler, false);
});

test("a feed holds no more than it shows, and a post no more than it can", () => {
  const many = Array.from({ length: 40 }, (_, index) => post(`Post number ${index}`, { minutesAgo: index }));
  assert.equal(normalizeListenInPosts(many).length, LISTEN_IN_MAX_POSTS);
  const long = normalizeListenInPosts([post("x".repeat(2000), { minutesAgo: 999999, likes: 1e12 })])[0];
  assert.ok(long.text.length <= 480);
  assert.equal(long.minutesAgo, 7 * 24 * 60);
  assert.equal(long.likes, 99999999);
  // A handle keeps the letters of any script; a blank one stays blank.
  assert.equal(normalizeListenInPosts([post("a b", { handle: "Олена_К.22" })])[0].handle, "Олена_К.22");
  assert.equal(normalizeListenInPosts([post("c d", { handle: "" })])[0].handle, "");
  assert.deepEqual(normalizeListenInPosts("nothing"), []);
});

test("trends are a few short lines", () => {
  // Blanks and repeats (whatever their capitals) go; no more than a feed shows stay.
  const trends = normalizeListenInTrends(["#FuelPrices", " #fuelprices ", "", "Border closure", 42, "a", "b", "c", "d"]);
  assert.deepEqual(trends, ["#FuelPrices", "Border closure", "42", "a", "b"]);
  assert.equal(trends.length, LISTEN_IN_MAX_TRENDS);
  assert.ok(normalizeListenInTrends(["y".repeat(200)])[0].length <= 40);
  assert.deepEqual(normalizeListenInTrends(null), []);
});

test("a batch is one answer for one place, day and language", () => {
  const batch = createListenInBatch({
    posts: [post("First"), post("Second", { minutesAgo: 9 })],
    trends: ["Harvest"],
    gameDate: "2016-01-04",
    round: 3,
    language: "de",
    now: 1700000000000,
  });
  assert.equal(batch.id, `2016-01-04:${(1700000000000).toString(36)}`);
  assert.deepEqual(batch.posts.map((entry) => entry.id), [`${batch.id}:0`, `${batch.id}:1`]);
  assert.equal(batch.gameDate, "2016-01-04");
  assert.equal(batch.round, 3);
  assert.equal(batch.language, "de");
  assert.deepEqual(batch.trends, ["Harvest"]);
});

test("opening the same place on the same day in the same language asks for nothing", () => {
  let store = emptyListenInStore();
  assert.equal(currentListenInBatch(store, bavaria, { gameDate: "2016-01-04", language: "en" }), null);
  const batch = batchOf("2016-01-04", ["Snow again."], { now: 1 });
  store = addListenInBatch(store, bavaria, batch, { now: 10 });
  assert.equal(currentListenInBatch(store, bavaria, { gameDate: "2016-01-04", language: "en" })?.id, batch.id);
  // Another day, another language or another place asks.
  assert.equal(currentListenInBatch(store, bavaria, { gameDate: "2016-02-04", language: "en" }), null);
  assert.equal(currentListenInBatch(store, bavaria, { gameDate: "2016-01-04", language: "de" }), null);
  assert.equal(currentListenInBatch(store, germany, { gameDate: "2016-01-04", language: "en" }), null);
});

test("scrolling down goes back through the days the place was read on", () => {
  let store = emptyListenInStore();
  store = addListenInBatch(store, bavaria, batchOf("2016-01-04", ["January."], { now: 1 }), { now: 1 });
  store = addListenInBatch(store, bavaria, batchOf("2016-03-01", ["March."], { now: 2 }), { now: 2 });
  store = addListenInBatch(store, bavaria, batchOf("2016-03-01", ["March again."], { now: 3 }), { now: 3 });
  assert.deepEqual(
    listenInTimeline(store, bavaria, { gameDate: "2016-03-01" }).map((batch) => batch.posts[0].text),
    ["March again.", "March.", "January."],
  );
  // The newest batch of the day is the one that answers for it.
  assert.equal(currentListenInBatch(store, bavaria, { gameDate: "2016-03-01", language: "en" }).posts[0].text, "March again.");
});

test("a turn taken back takes its posts with it", () => {
  let store = emptyListenInStore();
  store = addListenInBatch(store, bavaria, batchOf("2016-01-04", ["Before."], { now: 1 }), { now: 1 });
  store = addListenInBatch(store, bavaria, batchOf("2016-06-01", ["A summer that was undone."], { now: 2 }), { now: 2 });
  // Back in March, June's posts are not shown...
  assert.deepEqual(listenInTimeline(store, bavaria, { gameDate: "2016-03-01" }).map((batch) => batch.gameDate), ["2016-01-04"]);
  // ...and the next batch written removes them for good.
  store = addListenInBatch(store, bavaria, batchOf("2016-03-01", ["March, the second time."], { now: 3 }), { now: 3 });
  assert.deepEqual(store.places["region:DEU.2_1"].batches.map((batch) => batch.gameDate), ["2016-03-01", "2016-01-04"]);
});

test("years before AD 1 are compared by the calendar, not as text", () => {
  let store = emptyListenInStore();
  store = addListenInBatch(store, germany, batchOf("-0300-05-01", ["Three hundred."], { now: 1 }), { now: 1 });
  store = addListenInBatch(store, germany, batchOf("-0218-03-01", ["Two hundred and eighteen."], { now: 2 }), { now: 2 });
  // 218 BC is after 300 BC: both batches stand, the later one first.
  assert.deepEqual(listenInTimeline(store, germany, { gameDate: "-0218-03-01" }).map((batch) => batch.gameDate), ["-0218-03-01", "-0300-05-01"]);
  assert.deepEqual(listenInTimeline(store, germany, { gameDate: "-0250-01-01" }).map((batch) => batch.gameDate), ["-0300-05-01"]);
});

test("what is kept is bounded per place and per game", () => {
  let store = emptyListenInStore();
  for (let day = 1; day <= LISTEN_IN_BATCHES_KEPT + 3; day += 1) {
    store = addListenInBatch(store, bavaria, batchOf(`2016-01-${String(day).padStart(2, "0")}`, [`Day ${day}.`], { now: day }), { now: day });
  }
  const kept = store.places["region:DEU.2_1"].batches;
  assert.equal(kept.length, LISTEN_IN_BATCHES_KEPT);
  assert.equal(kept[0].posts[0].text, `Day ${LISTEN_IN_BATCHES_KEPT + 3}.`);

  for (let index = 0; index < LISTEN_IN_PLACES_KEPT + 5; index += 1) {
    store = addListenInBatch(store, { regionId: `R${index}`, regionName: `Region ${index}` }, batchOf("2016-02-01", ["Hello."], { now: 100 + index }), { now: 100 + index });
  }
  assert.equal(Object.keys(store.places).length, LISTEN_IN_PLACES_KEPT);
  // The places read longest ago went first, Bavaria among them.
  assert.equal(store.places["region:DEU.2_1"], undefined);
  assert.ok(store.places[`region:R${LISTEN_IN_PLACES_KEPT + 4}`]);
});

test("a batch with no usable post is not kept, and a damaged store is read as far as it holds", () => {
  const store = addListenInBatch(emptyListenInStore(), bavaria, createListenInBatch({ posts: [{ author: "", text: "" }], gameDate: "2016-01-04" }));
  assert.deepEqual(store, emptyListenInStore());
  const good = batchOf("2016-01-04", ["Fine."], { now: 5 });
  const read = normalizeListenInStore({
    places: {
      whatever: { place: bavaria, openedAt: 7, batches: [good, { id: "", posts: [] }, null, { id: "x", posts: "nope" }] },
      broken: { place: null, batches: [good] },
      empty: { place: germany, batches: [] },
    },
  });
  assert.deepEqual(Object.keys(read.places), ["region:DEU.2_1"]);
  assert.deepEqual(read.places["region:DEU.2_1"].batches.map((batch) => batch.id), [good.id]);
  assert.deepEqual(normalizeListenInStore("garbage"), emptyListenInStore());
});

test("a poster's picture is their initials on a quiet colour, the same every time", () => {
  assert.equal(listenInAvatar("Maria Kowalska").initials, "MK");
  assert.equal(listenInAvatar("jan").initials, "JA");
  assert.equal(listenInAvatar("Олена Ковальчук").initials, "ОК");
  assert.equal(listenInAvatar("").initials, "?");
  assert.equal(listenInAvatar("Maria Kowalska").colour, listenInAvatar("Maria Kowalska").colour);
  assert.match(listenInAvatar("Maria Kowalska").colour, /^#[0-9a-f]{6}$/);
});

test("ages and counts are printed the way a feed prints them", () => {
  assert.equal(listenInAgeLabel(0), "now");
  assert.equal(listenInAgeLabel(5), "5m");
  assert.equal(listenInAgeLabel(59), "59m");
  assert.equal(listenInAgeLabel(60), "1h");
  assert.equal(listenInAgeLabel(200), "3h");
  assert.equal(listenInAgeLabel(3000), "2d");
  assert.equal(listenInCountLabel(0), "");
  assert.equal(listenInCountLabel(41), "41");
  assert.equal(listenInCountLabel(1240), "1.2K");
  assert.equal(listenInCountLabel(3400000), "3.4M");
  // In the player's language, and in English when the code is not one.
  assert.notEqual(listenInAgeLabel(5, "de"), "");
  assert.equal(listenInAgeLabel(5, "not a language"), "5m");
});

// --- When the phone asks: every request it makes without a press ----------

const keptFor = (place, ...batches) =>
  batches.reduceRight((store, batch) => addListenInBatch(store, place, batch), emptyListenInStore());

test("a feed's request is named by game, place, day and language", () => {
  assert.equal(
    listenInRequestKey({ gameId: "g1", place: bavaria, gameDate: "2026-10-05", language: "English" }),
    "g1|region:DEU.2_1|2026-10-05|English",
  );
  assert.equal(
    listenInRequestKey({ gameId: "g1", place: germany, gameDate: "2026-10-05", language: "English" }),
    "g1|country:germany|2026-10-05|English",
  );
  // The same region under a new holder is the same request; no place is none.
  assert.equal(
    listenInRequestKey({ gameId: "g1", place: { ...bavaria, polity: "Austria", polityKey: "Austria" }, gameDate: "2026-10-05", language: "English" }),
    "g1|region:DEU.2_1|2026-10-05|English",
  );
  assert.equal(listenInRequestKey({ gameId: "g1", place: null }), "");
});

test("opening on a place with nothing for today asks, once", () => {
  const today = { place: bavaria, gameDate: "2026-10-05", language: "en" };
  // Still reading what is kept: a skeleton, and nothing asked yet.
  const reading = listenInFeedView({ ...today, store: null });
  assert.deepEqual([reading.ready, reading.shouldAsk, reading.waiting, reading.canAsk], [false, false, true, false]);
  // Read, and nothing kept: this is the one request made without a press.
  const empty = listenInFeedView({ ...today, store: emptyListenInStore() });
  assert.deepEqual([empty.shouldAsk, empty.waiting, empty.canAsk], [true, true, false]);
  // Out: waiting, not asked again, and no second press while it runs.
  const out = listenInFeedView({ ...today, store: emptyListenInStore(), asked: true, loading: true });
  assert.deepEqual([out.shouldAsk, out.waiting, out.canAsk], [false, true, false]);
});

test("whatever comes back, the phone does not ask again by itself", () => {
  const today = { place: bavaria, gameDate: "2026-10-05", language: "en" };
  // It failed: said so, not retried; Try again is a press.
  const failed = listenInFeedView({ ...today, store: emptyListenInStore(), asked: true, failed: true });
  assert.deepEqual([failed.shouldAsk, failed.waiting, failed.canAsk], [false, false, true]);
  // It came back and nothing of it could be kept: the same.
  const nothing = listenInFeedView({ ...today, store: emptyListenInStore(), asked: true });
  assert.deepEqual([nothing.shouldAsk, nothing.waiting, nothing.canAsk, nothing.batches.length], [false, false, true, 0]);
  // A failure this opening has seen stops the asking even before `asked` is set.
  assert.equal(listenInFeedView({ ...today, store: emptyListenInStore(), failed: true }).shouldAsk, false);
});

test("a feed kept for today is shown and costs nothing; Load new posts is a press", () => {
  const batch = batchOf("2026-10-05", ["bread is up again"], { trends: ["Bread"], now: 1000 });
  const store = keptFor(bavaria, batch);
  const view = listenInFeedView({ store, place: bavaria, gameDate: "2026-10-05", language: "en" });
  assert.deepEqual([view.shouldAsk, view.waiting, view.canAsk], [false, false, true]);
  assert.equal(view.current.id, batch.id);
  assert.deepEqual(view.trends, ["Bread"]);
  // Refreshing: the old posts stay under the skeleton.
  const refreshing = listenInFeedView({ store, place: bavaria, gameDate: "2026-10-05", language: "en", asked: true, loading: true });
  assert.deepEqual([refreshing.shouldAsk, refreshing.waiting, refreshing.canAsk, refreshing.batches.length], [false, true, false, 1]);
  // The country is another feed, and so is another language or the next day.
  assert.equal(listenInFeedView({ store, place: germany, gameDate: "2026-10-05", language: "en" }).shouldAsk, true);
  assert.equal(listenInFeedView({ store, place: bavaria, gameDate: "2026-10-05", language: "de" }).shouldAsk, true);
  const tomorrow = listenInFeedView({ store, place: bavaria, gameDate: "2026-10-06", language: "en" });
  assert.equal(tomorrow.shouldAsk, true);
  // Yesterday's is still there to scroll down to, and lends its trends meanwhile.
  assert.equal(tomorrow.batches.length, 1);
  assert.deepEqual(tomorrow.trends, ["Bread"]);
});

test("older batches are told apart by a line: the day, or only that they are earlier", () => {
  const morning = batchOf("2026-10-05", ["morning"], { now: 1000 });
  const evening = batchOf("2026-10-05", ["evening"], { now: 2000 });
  const yesterday = batchOf("2026-10-04", ["yesterday"], { now: 500 });
  const batches = listenInTimeline(keptFor(bavaria, evening, morning, yesterday), bavaria, { gameDate: "2026-10-05" });
  assert.deepEqual(batches.map((batch) => batch.id), [evening.id, morning.id, yesterday.id]);
  assert.equal(listenInBatchLine(batches, 0, "2026-10-05"), null);
  assert.deepEqual(listenInBatchLine(batches, 1, "2026-10-05"), { kind: "earlier", gameDate: "2026-10-05" });
  assert.deepEqual(listenInBatchLine(batches, 2, "2026-10-05"), { kind: "date", gameDate: "2026-10-04" });
  // Nothing for today yet: the newest kept batch says which day it is from.
  assert.deepEqual(listenInBatchLine(batches, 0, "2026-10-06"), { kind: "date", gameDate: "2026-10-05" });
  assert.equal(listenInBatchLine(batches, 9, "2026-10-05"), null);
});
