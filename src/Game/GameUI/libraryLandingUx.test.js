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

test("library shelves use responsive desktop grids with section descriptions and dividers", () => {
  assert.match(source, /const MenuRow = \(\{ action, children, description, emptyText, icon, title \}\) =>/);
  assert.match(source, /gridTemplateColumns: "repeat\(auto-fill, minmax\(min\(100%, 18\.75rem\), 20rem\)\)"/);
  assert.match(source, /justifyContent: "start"/);
  assert.match(source, /linear-gradient\(90deg, rgba\(255,255,255,0\.12\), rgba\(255,255,255,0\.02\)\)/);
  assert.match(source, /description="Continue where you left off\."/);
  assert.match(source, /description="Your most active games\."/);
  assert.match(source, /description="Your most active scenarios\."/);
});

test("scenario cards deliberately strengthen contrast behind authored text", () => {
  assert.match(source, /const SCENARIO_CARD_TEXT_SHADOW = "0 1px 2px rgba\(0,0,0,0\.96\), 0 6px 18px rgba\(0,0,0,0\.82\), 0 16px 34px rgba\(0,0,0,0\.64\)"/);
  assert.match(source, /rgba\(4,6,12,0\.46\) 30%/);
  assert.match(source, /rgba\(5,8,14,0\.86\) 72%/);
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
  // The same scenario sits on up to three shelves: every card of it is told.
  assert.equal(source.match(/onUpdate=\{handleScenarioUpdate\}/g)?.length, 3);
  assert.equal(source.match(/updating=\{updatingScenarioIds\.has\(scenario\.id\)\}/g)?.length, 3);
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
