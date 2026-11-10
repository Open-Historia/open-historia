/*! Open Historia — the main menu's skeletons: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/Game/GameUI/menuSkeleton.test.js
//
// "when loading a menu page, it shouldnt say loading, it should show outlines
// of where all the games/scenarios go with a glimmer animation (like youtube
// loading does)" (the owner, 2026-10-14).
//
// The outlines are rendered here as the page renders them: menuSkeleton.jsx
// compiled with esbuild (what Vite compiles JSX with) and drawn to markup by
// react-dom/server.

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const read = (relative) => fs.readFileSync(new URL(relative, import.meta.url), "utf8");

const skeleton = (() => {
  const { transformSync } = require("esbuild");
  const { code } = transformSync(read("./menuSkeleton.jsx"), { loader: "jsx", jsx: "automatic", format: "cjs" });
  const module = { exports: {} };
  new Function("require", "module", "exports", code)(require, module, module.exports);
  return module.exports;
})();
const { renderToStaticMarkup } = require("react-dom/server");
const { createElement: h } = require("react");

const render = (component, props) => renderToStaticMarkup(h(component, props));
const count = (html, text) => html.split(text).length - 1;
// What is on the screen: the markup without the line only a screen reader reads.
const seen = (html) => html.replace(/<span class="oh-visually-hidden">[^<]*<\/span>/g, "").replace(/<[^>]+>/g, "");
const unseen = (html) => [...html.matchAll(/<span class="oh-visually-hidden">([^<]*)<\/span>/g)].map((match) => match[1]);

const libraryBar = read("./libraryBar.jsx");
const hub = read("./communityHub.jsx");
const constant = (source, name) => new RegExp(`const ${name} = "([^"]+)";`).exec(source)?.[1];
const SHELF = constant(libraryBar, "SHELF_CARD_WIDTH");
const COMMUNITY_GRID = constant(hub, "COMMUNITY_GRID_TEMPLATE");

test("the library's outlines are its cards' shape: a game's and a scenario's, as many as asked", () => {
  const games = render(skeleton.MenuCardSkeletons, { count: 8, kind: "game", width: SHELF });
  assert.equal(count(games, 'class="oh-skeleton"'), 8);
  assert.equal(count(games, 'aria-hidden="true" class="oh-skeleton"'), 8, "every outline is hidden from a screen reader");
  // GameCard: 24px corners, at least 22rem, 1.2rem in, a phone shelf's width.
  assert.equal(count(games, "border-radius:24px"), 8);
  assert.equal(count(games, "min-height:22rem"), 8);
  assert.equal(count(games, "padding:1.2rem"), 8);
  assert.equal(count(games, `flex:0 0 ${SHELF}`), 8);
  const scenarios = render(skeleton.MenuCardSkeletons, { count: 3, kind: "scenario", width: SHELF });
  assert.equal(count(scenarios, 'class="oh-skeleton"'), 3);
  // ScenarioCard: at least 22rem, its title 4rem below the pill.
  assert.equal(count(scenarios, "min-height:22rem"), 3);
  assert.equal(count(scenarios, "margin-top:4rem"), 3);
  // Words nowhere: an outline is shapes and nothing else.
  for (const html of [games, scenarios]) assert.equal(seen(html).trim(), "");
});

test("the real cards are the size the outlines say", () => {
  const card = (name, next) => libraryBar.slice(libraryBar.indexOf(`const ${name} = `), libraryBar.indexOf(next));
  const game = card("GameCard", "// A responsive shelf on the main menu.");
  const scenario = card("ScenarioCard", "// Edit, Clone and Export live behind");
  for (const [source, height, padding] of [[game, "22rem", /padding: "0\.85rem 1\.05rem 1rem",/], [scenario, "22rem", /padding: "0\.85rem 1\.05rem 1rem",/]]) {
    assert.match(source, /borderRadius: "24px",/);
    assert.match(source, new RegExp(`minHeight: "${height}",`));
    assert.match(source, padding);
    assert.match(source, /flex: `0 0 \$\{SHELF_CARD_WIDTH\}`,/);
  }
  assert.match(hub, /aspectRatio: "16 \/ 9",/);
  assert.match(hub, /const ScenarioCover = \(\{ post, borderRadius = "10px", marginBottom \}\) =>/);
  assert.match(hub, /borderRadius: "16px",\s+boxShadow: "0 14px 32px rgba\(0,0,0,0\.45\)",\s+boxSizing: "border-box",\s+color: "#fff",\s+display: "flex",\s+flexDirection: "column",\s+flex: `0 0 \$\{CARD_WIDTH\}`,\s+gap: "0\.55rem",\s+maxWidth: CARD_WIDTH,\s+minWidth: 0,\s+padding: "0\.9rem",/);
  assert.match(hub, /<div style=\{\{ display: "grid", gap: "0\.8rem", gridTemplateColumns: COMMUNITY_GRID_TEMPLATE, paddingBottom: "0\.35rem" \}\}>/);
});

test("the Community tab's outlines: its browse grid of posts, each with its 16:9 cover", () => {
  const html = render(skeleton.CommunitySkeleton, { count: 6, gridTemplate: COMMUNITY_GRID, label: "Loading community scenarios…" });
  assert.match(html, /^<div role="status"><span class="oh-visually-hidden">Loading community scenarios…<\/span><div aria-hidden="true">/);
  assert.ok(html.includes(`grid-template-columns:${COMMUNITY_GRID}`));
  assert.equal(count(html, 'class="oh-skeleton"'), 6);
  assert.equal(count(html, "aspect-ratio:16 / 9"), 6);
  assert.equal(count(html, "border-radius:16px"), 6);
  assert.equal(count(html, "border-radius:10px;height:auto"), 6);
  // The tab's own code still on its way: the help, the five controls and the
  // licence line above the grid too, and still no words.
  const whole = render(skeleton.CommunitySkeleton, { count: 2, gridTemplate: COMMUNITY_GRID, label: "Loading Community…", withHeader: true });
  assert.equal(count(whole, 'class="oh-skeleton"'), 2);
  assert.equal(count(whole, "height:2rem"), 5);
  assert.equal(count(html, "height:2rem"), 0, "under the tab's own header, no second one");
  for (const markup of [html, whole]) assert.equal(seen(markup).trim(), "");
  assert.deepEqual(unseen(html), ["Loading community scenarios…"]);
  assert.deepEqual(unseen(whole), ["Loading Community…"]);
});

test("nothing on the screen says Loading: the menu's pages show outlines, and a screen reader alone is told", () => {
  // The three places that wrote it, each now an outline with the old words unseen.
  assert.doesNotMatch(libraryBar, /position: "fixed", right: "1\.25rem", top: "4\.35rem", zIndex: 10028/);
  assert.match(libraryBar, /\{!loaded && \(\s+<div className="oh-visually-hidden" role="status">\s+Loading games and scenarios\.\.\.\s+<\/div>\s+\)\}/);
  assert.match(libraryBar, /<Suspense fallback=\{<CommunitySkeleton count=\{isMobile \? 3 : 8\} gridTemplate=\{LIBRARY_GRID_TEMPLATE\} label="Loading Community…" withHeader \/>\}>/);
  assert.match(hub, /\{!posts && !error && \(\s+<CommunitySkeleton count=\{isMobile \? 3 : 8\} gridTemplate=\{COMMUNITY_GRID_TEMPLATE\} label="Loading community scenarios…" \/>\s+\)\}/);
  // The fallback cannot read the Community tab's template without loading the
  // tab, so it uses the library's: the same one.
  assert.equal(constant(libraryBar, "LIBRARY_GRID_TEMPLATE"), COMMUNITY_GRID);
  // In the library's own grids, until the library has come: one child either
  // way, so an empty view still says it is empty once it has.
  assert.match(libraryBar, /\{loaded\s+\? browsedGames\.map\(\(game\) => \([\s\S]{0,400}?\)\)\s+: <MenuCardSkeletons count=\{isMobile \? 3 : 8\} kind="game" width=\{SHELF_CARD_WIDTH\} \/>\}/);
  assert.match(libraryBar, /\{loaded\s+\? browsedScenarios\.map\(\(scenario\) => \([\s\S]{0,900}?\)\)\s+: <MenuCardSkeletons count=\{isMobile \? 3 : 7\} kind="scenario" width=\{SHELF_CARD_WIDTH\} \/>\}/);
  // The old words are kept only where a screen reader alone reads them (they
  // are translated already).
  for (const [source, text] of [[libraryBar, "Loading Community…"], [hub, "Loading community scenarios…"]]) {
    assert.equal(count(source, text), 1, text);
    assert.ok(source.includes(`label="${text}"`), text);
  }
  assert.equal(count(libraryBar, "Loading games and scenarios..."), 1);
});

test("the glimmer is a flat band carried across each card, and stands still under reduced motion", () => {
  const styles = read("../../styles.css");
  const rule = (selector) => {
    const at = styles.indexOf(`${selector} {`);
    assert.ok(at >= 0, `${selector} is in styles.css`);
    return styles.slice(at, styles.indexOf("}", at));
  };
  assert.match(rule(".oh-skeleton"), /overflow: hidden;\s+position: relative;/);
  const band = rule(".oh-skeleton::after");
  assert.match(band, /animation: oh-skeleton-glimmer [\d.]+s ease-in-out infinite;/);
  assert.match(band, /background: rgba\(255, 255, 255, 0\.0\d\);/);
  assert.match(band, /pointer-events: none;/);
  // At rest it is off the card, to the left: where reduced motion leaves it.
  assert.match(band, /transform: translateX\(-100%\);/);
  assert.doesNotMatch(band, /gradient/);
  assert.match(styles, /@keyframes oh-skeleton-glimmer \{\s+0% \{ transform: translateX\(-100%\); \}\s+65%, 100% \{ transform: translateX\(250%\); \}\s+\}/);
  // Where it stops, the band is clear of the card: moved by its own width
  // times the end of the sweep, it starts at or past the card's right edge.
  const width = Number(/width: (\d+)%;/.exec(band)?.[1]) / 100;
  const end = Number(/65%, 100% \{ transform: translateX\((\d+)%\); \}/.exec(styles)?.[1]) / 100;
  assert.ok(width > 0 && width * end >= 1, `a band ${width} of the card wide stops at ${width * end}`);
  assert.match(styles, /@media \(prefers-reduced-motion: reduce\) \{\s+\*,\s+\*::before,\s+\*::after \{\s+animation-duration: 0\.01ms !important;\s+animation-iteration-count: 1 !important;/);
  // Neither the outlines nor the band are placed by an inline style, which
  // would give them the entrance fade every positioned surface gets.
  assert.doesNotMatch(read("./menuSkeleton.jsx"), /position: "(?:fixed|absolute)"/);
  assert.match(rule(".oh-visually-hidden"), /clip-path: inset\(50%\);[\s\S]*position: absolute;[\s\S]*width: 1px;/);
});
