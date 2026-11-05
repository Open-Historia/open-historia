/*! Open Historia — viewport-safe region cards and bounded subordinates regression © 2026 Open Historia contributors, AGPL-3.0-or-later (see LICENSE). */
import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const source = fs.readFileSync(new URL("./Regions.jsx", import.meta.url), "utf8");
const geometry = fs.readFileSync(new URL("./mapCards.js", import.meta.url), "utf8");
const country = fs.readFileSync(new URL("./CountryPanel.jsx", import.meta.url), "utf8");
const stats = fs.readFileSync(new URL("../GameUI/stats.jsx", import.meta.url), "utf8");

test("floating region card clamps its final visible top and never translates itself one full card height", () => {
  assert.match(source, /top: popupTop/);
  assert.match(source, /clampAnchoredCardTop\(screenPos\.y, popupBodyHeight \+ pointerHeight, window\.innerHeight\)/);
  assert.match(source, /maxHeight: asSheet \? \(isMobile \? SHEET_MAX_HEIGHT : SIDEWAYS_SHEET_MAX_HEIGHT\) : "calc\(100dvh - 2rem\)"/);
  assert.match(source, /overflowY: "auto"/);
  assert.match(source, /new ResizeObserver\(measure\)/);
  assert.match(source, /window\.addEventListener\("resize", measure\)/);
  assert.doesNotMatch(source, /translateY\(-100%\)/);
  assert.match(geometry, /const preferred = Number\(anchorY\) - height - 1;/);
  assert.match(source, /const pointerAligned = [\s\S]*?Math\.abs\(popupTop \+ popupBodyHeight \+ pointerHeight - screenPos\.y\) <= 12;/);
  assert.match(source, /\{pointerAligned && \(/, "never draw an arrow unrelated to the clicked point");
});

test("large subordinate lists are bounded to two examples, a count and the full Country view", () => {
  assert.match(source, /livePuppetsFor\(worldState, playerCountry\)\.filter\(\(row\) => row\.overlord === controllerKey\)/,
    "the existing visible-subordinates resolver must remain the only source of popup data");
  assert.match(source, /const puppetPreview = heldPuppets\.slice\(0, 2\);/);
  assert.match(source, /const remainingPuppets = heldPuppets\.length - puppetPreview\.length;/);
  assert.match(source, /<span data-no-translate[^>]*>\{heldPuppets\.length\}<\/span>/);
  assert.match(source, /\{puppetPreview\.map\(\(row\) => \(/);
  assert.match(source, /\{remainingPuppets > 0 && \(/);
  assert.doesNotMatch(source, /heldPuppets\.map\(\(row\) =>.*\.join\(", "\)/);
  assert.match(source, /<span[^>]*>Subordinate states<\/span>/);
  assert.match(stats, /livePuppetsFor\(world, viewer\)/, "the destination still uses the same visibility-aware relationship ledger");
  assert.match(stats, />Subordinate states</, "the Country dossier owns the complete subordinate-state list");
});

test("subordinate list entry opens the existing Country drawer, not a new puppet routing or AI path", () => {
  assert.match(source, /import \{ OPEN_COUNTRY_STATS_EVENT, openCountryPanel \} from "\.\/CountryPanel\.jsx";/);
  assert.match(source, /new CustomEvent\(OPEN_COUNTRY_STATS_EVENT, \{ detail: \{ country \} \}\)/);
  assert.match(source, /handleOpenCountryDossier\(controllerKey\)/);
  assert.match(country, /export const OPEN_COUNTRY_STATS_EVENT = "oh:open-country-stats";/);
  assert.match(source, /className="oh-tap"[^>]*[\s\S]*?>Country<\/button>/);
});

test("mobile sheets, live region identity and region-info tools remain on existing paths", () => {
  assert.match(source, /const asSheet = isMobile \|\| shortTouch;/);
  assert.match(source, /\.\.\.\(asSheet \? \(isMobile \? SHEET_PLACEMENT : SIDEWAYS_SHEET_PLACEMENT\) : \{/);
  assert.match(source, /maxHeight: asSheet \? \(isMobile \? SHEET_MAX_HEIGHT : SIDEWAYS_SHEET_MAX_HEIGHT\) :/);
  assert.match(source, /resolveLiveSelectionProps\(/);
  assert.match(source, /getWorldStateSnapshot\(\)/);
  assert.match(source, /handleToggleStats/);
  assert.match(source, /regionInfoFor\(/);
  assert.match(source, /regionPopupFadeIn/);
  assert.match(source, /regionSheetFadeIn/);
});
