/*! Open Historia — Rostra's Search and its box: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/Game/GameUI/rostraSearch.test.js
//
// Rostra's Search tab finds a country or a region and shows what its people are
// posting, as Listen in did (runtime/placeFeed.js has the rules, tested in
// placeFeed.test.js). These pin what finds a place, and, read as source since
// node cannot render the panel, where Search took Your country's place, the one
// request a place's feed is allowed to be, and the box the pen opens.

import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import { placeFeedSearch } from "../../runtime/placeFeed.js";

const read = (relative) => fs.readFileSync(new URL(relative, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const panel = read("./social.jsx");
const search = read("./rostraSearch.jsx");

test("a search finds countries and regions, best first, accents and case aside", () => {
  const countries = ["United States of America", "United Kingdom", "Colombia"];
  const regions = [
    { id: "USA.6", name: "Colorado", owner: "United States of America" },
    { id: "COL.3", name: "Bogotá", owner: "Colombia" },
    { id: "reg_x", name: "El Dorado", owner: "" },
  ];
  assert.deepEqual(placeFeedSearch({ query: "col", countries, regions }).map((place) => [place.scope, place.polity, place.regionName]), [
    ["country", "Colombia", ""],
    ["region", "United States of America", "Colorado"],
  ]);
  const bogota = placeFeedSearch({ query: "bogota", countries, regions });
  assert.deepEqual(bogota.map((place) => [place.regionId, place.polityKey]), [["COL.3", "Colombia"]]);
  // A word inside the name counts; a region nobody holds is still a place.
  assert.deepEqual(placeFeedSearch({ query: "dorado", countries, regions }).map((place) => place.regionName), ["El Dorado"]);
  assert.deepEqual(placeFeedSearch({ query: "kingdom", countries, regions }).map((place) => place.polity), ["United Kingdom"]);
  assert.deepEqual(placeFeedSearch({ query: "  ", countries, regions }), []);
  assert.equal(placeFeedSearch({ query: "o", countries, regions, limit: 2 }).length, 2);
});

test("Search stands where Your country was, and opens on the player's own", () => {
  assert.match(panel, /const TABS = \[\n {2}\["all", "For you", HomeIcon\],\n {2}\["search", "Search", SearchIcon\],\n {2}\["mentions", "Mentions", BellIcon\],\n {2}\["mine", "Your posts", PersonIcon\],\n\];/);
  assert.doesNotMatch(panel, /"Your country", FlagIcon/);
  assert.match(panel, /tab === "search" \? \(\n {12}<RostraSearch/);
  assert.match(search, /const own = useMemo\(\(\) => placeFeedPlace\(\{ polity: country, polityKey: country \}\), \[country\]\);/);
  assert.match(search, /const target = picked \?\? own;/);
});

test("a place's posts are one request, made on a pick or a press and never for the player's own country by itself", () => {
  // The one AI call there is, inside the one loader.
  assert.equal(search.match(/generatePlaceFeed\(/g).length, 1);
  assert.match(search, /const answer = await generatePlaceFeed\(\{ place: where, language \}\);/);
  // Only a picked place asks by being shown; the player's own waits for Load posts.
  assert.match(search, /asked: Boolean\(asked\[requestKey\]\) \|\| !wanted\[placeFeedPlaceKey\(place\)\],/);
  assert.match(search, /setWanted\(\(all\) => \(\{ \.\.\.all, \[placeFeedPlaceKey\(next\)\]: true \}\)\);/);
  // The rest of Rostra still asks no model: posts ride in the time skip.
  for (const source of [panel, read("../../runtime/socialFeed.js")]) {
    assert.doesNotMatch(source, /from "[^"]*(?:gameplayLazy|gameplay|main)\.jsx?"/);
    assert.doesNotMatch(source, /\b(?:callAI|runJsonTask|generatePlaceFeed)\(/);
  }
  // The feeds stay on the device, under a store of their own (not Listen in's,
  // which the game still deletes at start).
  assert.match(read("../../runtime/placeFeedStore.js"), /const DB_NAME = "oh-rostra-places";/);
  assert.match(read("../../main.jsx"), /deleteDatabase\("oh-listen-in"\)/);
});

test("an empty feed says so and offers Refresh: one request, made on the press", () => {
  const refresh = read("./rostraRefresh.jsx");
  assert.match(panel, /posts\.length === 0 && tab === "all" \? \(\n\s*<EmptyFeedRefresh canPost=\{canPost\} \/>/);
  assert.match(refresh, />Nothing has been posted yet\.</);
  // The one call, inside the press's handler; nothing asks on render.
  assert.equal(refresh.match(/generateRostraPosts\(/g).length, 1);
  assert.match(refresh, /const refresh = async \(\) => \{\n\s*if \(busy\) return;/);
  assert.match(refresh, /onClick=\{\(\) => void refresh\(\)\}/);
  assert.doesNotMatch(refresh, /useEffect/);
  // Search's empty place uses the same button.
  assert.match(search, /<RefreshButton onClick=\{ask\} \/>/);
  assert.doesNotMatch(search, />Load posts</);
});

test("Check in Rostra on a region card opens Search on that country, and asks for nothing by itself", async () => {
  const { onRostraPlace, openRostraPlace, takeRostraPlace } = await import("./rostraOpen.js");
  // Pressed before the panel was ever shown: the place waits for it.
  openRostraPlace({ polity: "French Republic", polityKey: "French Republic" });
  assert.deepEqual(takeRostraPlace(), { scope: "country", regionId: "", regionName: "", polity: "French Republic", polityKey: "French Republic" });
  assert.equal(takeRostraPlace(), null, "taken once");
  const heard = [];
  const stop = onRostraPlace((place) => heard.push(place.polity));
  openRostraPlace({ polity: "Kingdom of Spain" });
  openRostraPlace({ polity: "" });
  stop();
  openRostraPlace({ polity: "Italian Republic" });
  assert.deepEqual(heard, ["Kingdom of Spain"]);
  takeRostraPlace();
  // The card's button, only with Social media on; the panel takes the place
  // when it mounts and when it is open; Search shows it without asking.
  const card = read("../Selection/Regions.jsx");
  assert.match(card, /\{!isUnclaimed && isActiveFeatureEnabled\("socialMedia"\) && \(/);
  assert.match(card, /openRostraPlace\(\{ polity: name, polityKey: name \}\);/);
  assert.match(panel, /show\(\);\n\s*return onRostraPlace\(show\);/);
  assert.match(panel, /setTab\("search"\);/);
  const opened = search.match(/useEffect\(\(\) => \{\n\s*if \(!opened\?\.place\) return;[\s\S]+?\}, \[opened\]\);/)?.[0] ?? "";
  assert.match(opened, /setPicked\(opened\.place\);/);
  assert.doesNotMatch(opened, /setWanted|load\(/);
});

test("the box is put away until the pen opens it, and Quote opens it too", () => {
  assert.match(panel, /aria-label=\{composing \? "Put the post away" : "Write a post"\}/);
  assert.match(panel, /\{composing && \(\n {10}<div style=\{\{ borderBottom/);
  assert.match(panel, /const startQuote = useCallback\(\(post\) => \{\n {4}setQuoting\(post\);\n {4}openComposer\(\);\n {2}\}, \[openComposer\]\);/);
  // A post sent puts it away again.
  assert.match(panel, /setChoices\(null\);\n {6}setComposing\(false\);\n {6}setPosted\(true\);/);
  // And a poll goes with the post.
  assert.match(panel, /withPlayerPost\(world, \{ by: country, text, quote: quoting\?\.id \|\| "", date: game\.gameDate, round: game\.round, choices: poll \}\)/);
});
