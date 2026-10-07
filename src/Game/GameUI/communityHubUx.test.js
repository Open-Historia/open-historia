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

test("a copy downloaded the old way asks for its Update in the open, and an edited one is asked before it is replaced", () => {
  // The link of a copy downloaded before the hub checked its files names no
  // release (runtime/hubPosts.js hubUpdateReason: "unchecked"). Its card says
  // why it should be updated where it can be read, not only in a tooltip, on
  // all three shelves.
  assert.match(source, /^const UPDATE_UNCHECKED_NOTE = "This copy was downloaded before the community hub started checking its files\. [^"]+";$/m);
  assert.match(source, /\{updateReason === "unchecked" && \(/);
  assert.match(source, /<span style=\{\{ flex: "1 1 10rem" \}\}>\{UPDATE_UNCHECKED_NOTE\}<\/span>/);
  assert.equal(source.match(/updateReason=\{scenarioUpdateReason\(scenario\)\}/g)?.length, 3);
  assert.match(source, /const scenarioUpdateReason = \(scenario\) =>\s+hubUpdateReason\(scenario, scenario\.hubOrigin \? hubPostById\?\.\[scenario\.hubOrigin\.postId\] : null\);/);
  // The posts are looked up for every scenario from the hub, edited or not.
  assert.match(source, /activeTab !== "scenarios" \|\| !scenarios\.some\(\(entry\) => entry\.hubOrigin\)\) return undefined;/);

  // An unedited copy's Update takes New Game's place, as it always has. An
  // edited copy keeps New Game, and its Update is a button of its own beside
  // the reason: it replaces the player's changes.
  assert.match(source, /const updateIsPrimary = updateAvailable && !scenario\.hubOrigin\?\.editedAt;/);
  assert.match(source, /onClick=\{\(\) => \(updateIsPrimary \? onUpdate\(scenario\) : onPlay\(scenario\)\)\}/);
  assert.match(source, /\{!updateIsPrimary && \(\s+<button\s+className="oh-tap-row"\s+onClick=\{\(\) => onUpdate\(scenario\)\}/);

  // That press only opens the question. It is asked in the library's own
  // prompt, not window.confirm, and nothing but its first button updates.
  const update = source.slice(source.indexOf("const handleScenarioUpdate = "), source.indexOf("// ---- suggested changes"));
  assert.match(update, /if \(post\?\.bundleUrl && scenario\.hubOrigin\?\.editedAt && !replaceEdits\) \{\s+setReplaceEditsTarget\(\{ scenario, post \}\);\s+return;\s+\}/);
  assert.doesNotMatch(update, /window\.confirm/);
  assert.ok(update.indexOf("setReplaceEditsTarget({ scenario, post })") < update.indexOf("downloadHubScenario("), "asked before anything is downloaded");
  const question = source.slice(source.indexOf("<Presence open={Boolean(replaceEditsTarget)}"), source.indexOf("ref={importScenarioInputRef}"));
  assert.match(question, />Replace your changes\?<\/div>/);
  assert.match(question, /your changes to it will be lost/);
  assert.match(question, /role="dialog"/);
  assert.match(question, /setReplaceEditsTarget\(null\);\s+handleScenarioUpdate\(pending\.scenario, \{ post: pending\.post, replaceEdits: true \}\);/);
  assert.equal(question.match(/handleScenarioUpdate\(/g)?.length, 1, "one way to say yes");
  assert.match(question, /onClick=\{\(\) => setReplaceEditsTarget\(null\)\}\s+style=\{touchFit\(\{ \.\.\.actionButtonStyle, minHeight: "2\.6rem" \}, touch\)\}\s+type="button"\s+>\s+Not now\s+</);
  assert.match(source, /useBackToClose\(Boolean\(replaceEditsTarget\), \(\) => setReplaceEditsTarget\(null\)\);/);
  // A drawer open on the scenario is loaded again, so its Save cannot write
  // the form it held over the hub's file.
  assert.match(update, /await updateScenarioFromBundle\(scenario\.id, bundle\);\s+(?:\/\/[^\n]*\s+)*if \(editorScenarioIdRef\.current === scenario\.id\) await openScenarioEditor\(scenario\.id\);/);
});

test("Suggest changes on a copy whose original is gone says to update first, and can", () => {
  const card = read("./ScenarioSuggestions.jsx");
  // Asked of the hub's index before anything is downloaded, so what the
  // player reads is what to do, not a download that failed.
  assert.match(card, /if \(hubOriginalGone\(\{ bundleUrl, release \}, hubIndex\)\) \{[\s\S]{0,300}?setPhase\("outdated"\);\s+return;\s+\}\s+const \[base, current\] = await Promise\.all\(\[downloadHubBundle\(bundleUrl\), exportScenarioBundle\(scenario\.id\)\]\);/);
  assert.match(card, /\{phase === "outdated" && \(/);
  assert.match(card, /Update the scenario first, then make your changes and suggest them\./);
  // The Update is offered there only while the post is still on the hub.
  assert.match(card, /const canUpdate = phase === "outdated" && Boolean\(hubPost && onUpdate\);/);
  assert.match(card, /\{canUpdate && \(\s+<button type="button" className="oh-tap-row" onClick=\{\(\) => onUpdate\(hubPost\)\}/);
  assert.match(card, /"The community hub no longer offers this scenario, so changes to it cannot be suggested\."/);
  // The library runs it as any other Update, with the post the dialog found:
  // one of an edited copy asks first, like a press on its card.
  assert.match(source, /onUpdate=\{\(post\) => \{\s+const scenario = scenarioById\(suggestTarget\);\s+setSuggestTarget\(null\);\s+handleScenarioUpdate\(scenario, \{ post \}\);\s+\}\}/);
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
