/*! Open Historia — the community hub in the library's interface © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/Game/GameUI/communityHubUx.test.js
//
// What the screens do with the hub, read out of their source: every link to a
// post is stamped where the post's checked copy is downloaded, a picture is
// shown from its checked copy only, and a download that cannot be had says why
// where the player is looking.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const read = (relative) => fs.readFileSync(new URL(relative, import.meta.url), "utf8");
const source = read("./libraryBar.jsx");
const hub = read("./communityHub.jsx");

test("every link the game makes is stamped where the file is downloaded, with the checked copy it came from", () => {
  // hubPosts.js downloadHubScenario: Update and Import & play in the library,
  // Import in the Community tab. No screen writes a link of its own.
  assert.equal(source.match(/await downloadHubScenario\(/g)?.length, 2);
  assert.equal(hub.match(/await downloadHubScenario\(/g)?.length, 1);
  for (const text of [source, hub]) assert.doesNotMatch(text, /\.hubOrigin = |downloadHubBundle/);
  // The translator reads the post list through the Community tab's module.
  assert.match(hub, /^export \{ fetchHubPosts \};$/m);
  assert.match(read("../../runtime/translator.js"), /const \{ fetchHubPosts \} = await import\("\.\.\/Game\/GameUI\/communityHub\.jsx"\);/);
});

test("Import & play says in its own prompt why the map could not be fetched", () => {
  // No editor is open behind the missing-map prompt, and the editor's error
  // was the only place the reason went: a press that failed showed nothing.
  const importPlay = source.slice(source.indexOf("const handleMissingScenarioImport = "), source.indexOf("const handleCreateScenario = "));
  assert.match(importPlay, /setMissingScenarioError\(""\);\s+setIsBusy\(true\);/, "a new try starts clean");
  assert.match(importPlay, /\} catch \(nextError\) \{\s+setMenuOpen\(true\);\s+setEditorError\(nextError\.message\);\s+setMissingScenarioError\(nextError\.message\);/);
  assert.match(source, /\{missingScenarioError && \(\s+<div role="alert"[^>]*>\s+\{missingScenarioError\}\s+<\/div>\s+\)\}/);
  assert.match(source, /setMissingScenarioError\(""\);\s+setMissingScenarioGame\(game\);/, "and so does the prompt, opened for another game");
});

test("a post's picture is shown from its checked copy, never from the post's own attachment", () => {
  // The Community tab's cover is the copy parsePost found, or the default cover.
  assert.match(hub, /src=\{post\.coverImageUrl \|\| DEFAULT_SCENARIO_COVER\}/);
  assert.match(read("../../runtime/hubPosts.js"), /const coverImageUrl = releaseCopyOf\(hubIndex, firstHubImage\(body\)\);/);
  // The flag and basemap browsers show pictureUrl, which their lists fill in
  // from the index; imageUrl and coverImageUrl are the addresses the posts
  // give, kept to look the copies up by.
  const pickers = {
    "src/Editor/FlagPicker.jsx": read("../../Editor/FlagPicker.jsx"),
    "src/Editor/BasemapPicker.jsx": read("../../Editor/BasemapPicker.jsx"),
    "src/Game/GameUI/GameFlagPicker.jsx": read("./GameFlagPicker.jsx"),
  };
  for (const [name, text] of Object.entries(pickers)) {
    assert.match(text, /post\??\.pictureUrl/, `${name} shows the checked copy`);
    assert.doesNotMatch(text, /(?:src|imageUrl)=\{post\??\.(?:imageUrl|coverImageUrl)\}/, `${name} loads nothing from a post`);
  }
  for (const file of ["communityFlags.js", "communityBasemaps.js"]) {
    assert.match(read(`../../runtime/${file}`), /pictureUrl: releaseCopyOf\(hubIndex, post\.(?:imageUrl|coverImageUrl)\)/);
  }
  // The hub closes a post once it has released its file, so the pages the
  // browsers link to list closed posts too.
  assert.doesNotMatch(pickers["src/Editor/BasemapPicker.jsx"], /is%3Aopen/);
});

test("the website's hub route answers for a file and nothing else", () => {
  const router = read("../../runtime/web/router.js");
  const route = router.slice(router.indexOf('if (domain === "hub") {'), router.indexOf("return errorResponse(`Unknown web-mode endpoint"));
  assert.match(route, /if \(segments\[0\] !== "file" \|\| method !== "GET"\) return errorResponse\(`Unknown hub endpoint: \$\{url\.pathname\}`, 404\);/);
  assert.match(route, /return fetch\(`\$\{base\}\/hub\/file\$\{url\.search\}`, \{ method \}\);/);
  // The counter's dedup by account went with its routes.
  assert.doesNotMatch(router, /getSession|Authorization/);
});
