/*! Open Historia — library landing-page UX architecture © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/Game/GameUI/libraryLandingUx.test.js
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const source = fs.readFileSync(new URL("./libraryBar.jsx", import.meta.url), "utf8");

test("desktop library chrome stays grouped and uses named icon actions", () => {
  assert.match(source, /const APP_SHELL_MAX_WIDTH = "3000px"/);
  assert.doesNotMatch(source, /const APP_SHELL_MAX_WIDTH = "1760px"/);
  for (const kind of ["settings", "refresh", "import"]) {
    assert.match(source, new RegExp(`case "${kind}":`));
  }
  assert.match(source, /<ButtonIcon kind="settings" \/> Settings/);
  assert.match(source, /icon: "refresh", label: "Refresh"/);
  assert.match(source, /icon: "import", label: "Import Game"/);
  assert.match(source, /icon: "import", label: "Import Scenario"/);
  assert.doesNotMatch(source, /Import game/);
});

test("library landing uses one meaningful browse collection instead of duplicate sort shelves", () => {
  // A shelf's heading can carry an action (Recently deleted's Empty), and
  // keeps its divider.
  assert.match(source, /const MenuRow = \(\{ action, children, description, emptyText, icon, title \}\) =>/);
  assert.match(source, /<div style=\{\{ background: "rgba\(255,255,255,0\.08\)", flex: 1, height: 1 \}\} \/>/);
  assert.match(source, /const LibraryCollection = \(\{ children, controls, description, emptyText, title \}\) =>/);
  assert.match(source, /const LIBRARY_GRID_TEMPLATE = "repeat\(auto-fill, minmax\(min\(100%, 16\.5rem\), 1fr\)\)"/);
  assert.match(source, /gridTemplateColumns: LIBRARY_GRID_TEMPLATE/);
  assert.doesNotMatch(source, /LIBRARY_GRID_MAX_WIDTH/);
  assert.ok((source.match(/<section style=\{\{ marginBottom: isMobile \? "1\.75rem"/g) || []).length >= 2);
  assert.match(source, /lastPlayedGames\.slice\(0, isMobile \? 5 : 6\)/);
  assert.match(source, /title="Continue Playing"/);
  assert.match(source, /title="All Games"/);
  assert.match(source, /title="Recently Used"/);
  assert.match(source, /title="Scenario Library"/);
  assert.doesNotMatch(source, /title="Most Played"/);
  assert.doesNotMatch(source, /title="Last Updated"/);
  // Recently deleted stays under both libraries.
  assert.match(source, /<RecentlyDeletedRow kind="game" onChanged=\{refreshTrash\} trash=\{trash\} \/>/);
  assert.match(source, /<RecentlyDeletedRow kind="scenario" onChanged=\{refreshTrash\} trash=\{trash\} \/>/);
});

test("games and scenarios expose search, filters and in-place sorting", () => {
  assert.match(source, /aria-label="Search games"/);
  assert.match(source, /\[['"]active['"], ['"]Active['"]\]/);
  assert.match(source, /<option value="turns">Most turns<\/option>/);
  assert.match(source, /aria-label="Search scenarios"/);
  assert.match(source, /\[['"]community['"], ['"]Community['"]\]/);
  assert.match(source, /<option value="updated">Recently updated<\/option>/);
});


test("scenario cards deliberately strengthen contrast behind authored text", () => {
  assert.match(source, /const SCENARIO_CARD_TEXT_SHADOW = "0 1px 2px rgba\(0,0,0,0\.96\), 0 6px 18px rgba\(0,0,0,0\.82\), 0 16px 34px rgba\(0,0,0,0\.64\)"/);
  // One even tint over the cover, on the scenario card and on the game card.
  assert.match(source, /const COVER_TINT = "inset 0 0 0 100vmax rgba\(4,6,12,0\.\d+\)"/);
  assert.equal(source.split("boxShadow: COVER_TINT,").length - 1, 2);
  assert.match(source, /color: "rgba\(248,248,250,0\.96\)"/);
  assert.match(source, /textShadow: SCENARIO_CARD_TEXT_SHADOW/);
});

test("game and scenario actions use the same compact icon vocabulary", () => {
  for (const kind of ["play", "archive", "edit", "clone", "update", "menu"]) {
    assert.match(source, new RegExp(`case "${kind}":`));
  }
  assert.match(source, /<ButtonIcon kind="archive" \/> \{game\.archived \? "Unarchive" : "Archive"\}/);
  assert.match(source, /<ButtonIcon kind="edit" \/> Edit/);
  assert.match(source, /<ButtonIcon kind="clone" \/> Clone Scenario/);
});

test("a scenario's Update shows that it is working, and takes no second press", () => {
  // The card's button turns a ring and says "Updating…" while the post's file
  // is downloaded and put in place; before, it showed nothing and was pressed
  // again, which downloaded and replaced the scenario again.
  assert.match(source, /case "working":/);
  assert.match(source, /<svg aria-hidden="true" className="oh-working-ring" \{\.\.\.common\}>/);
  assert.match(source, /\? <><ButtonIcon kind="working" \/> Updating…<\/>/);
  assert.match(source, /aria-busy=\{updating \|\| undefined\}/);
  assert.match(source, /disabled=\{updating\}/);
  // The same scenario can sit on both shelves (Recently Used and the Scenario
  // Library): every card of it is told.
  assert.equal(source.match(/onUpdate=\{handleScenarioUpdate\}/g)?.length, 2);
  assert.equal(source.match(/updating=\{updatingScenarioIds\.has\(scenario\.id\)\}/g)?.length, 2);
  assert.equal(source.match(/updateNote=\{scenarioUpdateNotes\.get\(scenario\.id\) \?\? ""\}/g)?.length, 2);
  // Which ones are updating is kept outside the component (a game started
  // meanwhile remounts it), a second press starts nothing, and a failed
  // update gives the button back.
  assert.match(source, /^const scenarioUpdates = createWorkInProgress\(\);$/m);
  assert.match(source, /if \(!post\?\.bundleUrl \|\| !scenarioUpdates\.begin\(scenario\.id\)\) return;/);
  // In `finally`, so a failure gives the button back too; with what the update
  // left to say, which the card shows (workInProgress.test.js).
  assert.match(source, /\} finally \{\s+setIsBusy\(false\);\s+scenarioUpdates\.end\(scenario\.id, outcome\);\s+\}/);

  // The ring's turn is the loading logo's; reduced motion stops every
  // animation with one rule, so the ring stays still and the label says it.
  const styles = fs.readFileSync(new URL("../../styles.css", import.meta.url), "utf8");
  assert.match(styles, /\.oh-working-ring \{\s+animation: oh-logo-spin 0\.7s linear infinite;\s+\}/);
  assert.match(styles, /@keyframes oh-logo-spin \{/);
  assert.match(
    styles,
    /@media \(prefers-reduced-motion: reduce\) \{\s+\*,\s+\*::before,\s+\*::after \{\s+animation-duration: 0\.01ms !important;\s+animation-iteration-count: 1 !important;/,
  );
});

test("a copy downloaded the old way asks for its Update in the open, and an edited one is asked before it is replaced", () => {
  // The link of a copy downloaded before the hub checked its files names no
  // release (runtime/hubPosts.js hubUpdateReason: "unchecked"). Its card says
  // why it should be updated where it can be read, not only in a tooltip, in
  // the Recently Used row and in the library's grid.
  assert.match(source, /^const UPDATE_UNCHECKED_NOTE = "This copy was downloaded before the community hub started checking its files\. [^"]+";$/m);
  assert.match(source, /\{updateReason === "unchecked" && !updating && \(/);
  assert.match(source, /<span style=\{\{ flex: "1 1 10rem" \}\}>\{UPDATE_UNCHECKED_NOTE\}<\/span>/);
  assert.equal(source.match(/updateReason=\{scenarioUpdateReason\(scenario\)\}/g)?.length, 2);
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
  assert.ok(update.indexOf("setReplaceEditsTarget({ scenario, post })") < update.indexOf("scenarioUpdates.begin(scenario.id)"), "asked before anything is downloaded");
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

  // Every link the game makes is stamped where the file is downloaded
  // (hubPosts.js downloadHubScenario), with the checked copy it came from:
  // Update and Import & play here, Import in the Community tab.
  const hub = fs.readFileSync(new URL("./communityHub.jsx", import.meta.url), "utf8");
  assert.equal(source.match(/await downloadHubScenario\(/g)?.length, 2);
  assert.equal(hub.match(/await downloadHubScenario\(/g)?.length, 1);
  for (const text of [source, hub]) assert.doesNotMatch(text, /\.hubOrigin = |downloadHubBundle/);

  // The Community tab's badge says the same of such a copy.
  assert.match(hub, /unchecked: \{ label: "Update available", title: "Your copy was downloaded before the hub started checking its files\. Update it from the Scenarios tab\." \},/);
  assert.match(hub, /const update = status === "update" \|\| status === "unchecked";/);
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

test("Suggest changes on a copy whose original is gone says to update first, and can", () => {
  const card = fs.readFileSync(new URL("./ScenarioSuggestions.jsx", import.meta.url), "utf8");
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

test("a scenario can be unlinked from a community post, never linked to one", () => {
  const card = fs.readFileSync(new URL("./ScenarioSuggestions.jsx", import.meta.url), "utf8");
  for (const [name, text] of [["libraryBar.jsx", source], ["ScenarioSuggestions.jsx", card]]) {
    assert.doesNotMatch(
      text,
      /link\s?post|postIdFromInput|linkOpen|postInput|linkError|link my post|link your post|link it again|link it by/i,
      `${name} offers no way to link a post`,
    );
  }
  // The two Unlinks stay, each writes a null, and each confirm says it is for good.
  assert.match(card, />\s+Unlink from the community post\s+</);
  assert.match(card, />\s+Unlink the post\s+</);
  const handler = (name, next) => source.slice(source.indexOf(`const ${name} = `), source.indexOf(`const ${next} = `));
  const unlinkOrigin = handler("handleUnlinkOrigin", "handleForgetPost");
  const unlinkPost = handler("handleForgetPost", "handleRefreshSuggestions");
  assert.match(unlinkOrigin, /saveScenario\(scenario\.id, \{ hubOrigin: null \}\)/);
  assert.match(unlinkPost, /saveScenario\(scenario\.id, \{ hubPublished: null \}\)/);
  for (const text of [unlinkOrigin, unlinkPost]) assert.match(text, /window\.confirm\("[^"]*cannot be undone[^"]*"\)/);
  // Nothing in the interface writes a link: the only hubOrigin a scenario
  // write carries is that null, and a post's own record is written by Publish
  // and by the checks for suggestions, which skip what was unlinked.
  assert.deepEqual(source.match(/saveScenario\([^)]*hubOrigin[^)]*\)/g), ["saveScenario(scenario.id, { hubOrigin: null })"]);
  assert.equal(source.match(/unlinked: scenario\.hubUnlinked,/g)?.length, 2, "both checks for suggestions");
  // Publish keeps a scenario's key only while its record lives: unlinked, the
  // record is gone, so the next post carries a new key and the old one is
  // never found by it.
  const hub = fs.readFileSync(new URL("./communityHub.jsx", import.meta.url), "utf8");
  assert.match(hub, /const publishKey = scenario\.hubPublished\?\.key \|\| newPublishKey\(\);/);
});

test("the UI refresh intentionally leaves the decorative page background for later", () => {
  assert.doesNotMatch(source, /midnight_compass_world_map|landing.*background.*url|world_map\.png/i);
});
