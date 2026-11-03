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

test("the box is put away until the pen opens it, and Quote opens it too", () => {
  assert.match(panel, /aria-label=\{composing \? "Put the post away" : "Write a post"\}/);
  assert.match(panel, /\{composing && \(\n {10}<div style=\{\{ borderBottom/);
  assert.match(panel, /const startQuote = useCallback\(\(post\) => \{\n {4}setQuoting\(post\);\n {4}openComposer\(\);\n {2}\}, \[openComposer\]\);/);
  // A post sent puts it away again.
  assert.match(panel, /setChoices\(null\);\n {6}setComposing\(false\);\n {6}setPosted\(true\);/);
  // And a poll goes with the post, to the host in a shared game too.
  assert.match(panel, /requestFromHost\("post", \{ text, quote: quoting\?\.id \|\| "", \.\.\.\(poll \? \{ choices: poll \} : \{\}\) \}\)/);
  assert.match(panel, /withPlayerPost\(world, \{ by: country, text, quote: quoting\?\.id \|\| "", date: game\.gameDate, round: game\.round, choices: poll \}\)/);
});
